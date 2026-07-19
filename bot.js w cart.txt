require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const Stripe = require('stripe');
const twilio = require('twilio');
const { randomUUID } = require('crypto');
const PRODUCTS = require('./products');

const bot = new Telegraf(process.env.BOT_TOKEN);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// In-memory store of orders awaiting payment. orderId -> order details.
// NOTE: resets if the process restarts. Fine at this volume; move to a real
// DB (SQLite/Postgres) once you're doing serious numbers.
const pendingOrders = new Map();

bot.use(session());

function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.cart) ctx.session.cart = []; // items already added, waiting for checkout
  if (!ctx.session.current) ctx.session.current = {}; // item currently being picked
}

// Total price for a given quantity, using either the exact low-quantity
// table or the per-unit tier rate above it.
function computeTotal(schedule, quantity) {
  if (schedule.exact[quantity] !== undefined) {
    return schedule.exact[quantity];
  }
  const tier = schedule.tiers.find((t) => quantity >= t.min && quantity <= t.max);
  if (tier) return quantity * tier.unit;
  return null; // quantity out of any defined range
}

function hasAnyStock(product) {
  if (typeof product.stock === 'number') return product.stock > 0;
  return Object.values(product.stock).some((n) => n > 0);
}

function availableSizes(product) {
  if (typeof product.stock === 'number') return null; // no sizing
  return Object.entries(product.stock)
    .filter(([, count]) => count > 0)
    .map(([size]) => size);
}

function stockFor(product, size) {
  if (typeof product.stock === 'number') return product.stock;
  return product.stock[size] || 0;
}

// Accounts for items already sitting in the cart when checking availability,
// so someone can't add 5 of a size that only has 4 left across two cart lines.
function stockRemainingAfterCart(cart, product, size) {
  const total = stockFor(product, size);
  const alreadyInCart = cart
    .filter((item) => item.product.id === product.id && item.size === size)
    .reduce((sum, item) => sum + item.quantity, 0);
  return total - alreadyInCart;
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.total, 0);
}

function formatCartLine(item) {
  const sizeLine = item.size ? ` (${item.size})` : '';
  return `${item.quantity}x ${item.product.name}${sizeLine} — $${item.total.toFixed(2)}`;
}

function showCategoryMenu(ctx, promptPrefix) {
  ctx.session.step = 'category';
  ctx.session.current = {};

  const categoriesWithStock = CATEGORIES.filter((cat) =>
    PRODUCTS.some((p) => p.category === cat && hasAnyStock(p))
  );

  if (categoriesWithStock.length === 0) {
    return ctx.reply('Everything is out of stock right now — check back soon!');
  }

  const buttons = categoriesWithStock.map((cat) => [Markup.button.callback(cat, `cat:${cat}`)]);
  ctx.reply(`${promptPrefix}What are you shopping for?`, Markup.inlineKeyboard(buttons));
}

const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))];

bot.start((ctx) => {
  ctx.reply('Welcome to Levi Supplyz! 👟\n\nType /order to start a new order.\nType /cart anytime to view or remove items from your cart.');
});

bot.command('order', (ctx) => {
  ensureSession(ctx);
  ctx.session.cart = [];
  showCategoryMenu(ctx, '');
});

bot.command('cart', (ctx) => {
  ensureSession(ctx);

  if (ctx.session.cart.length === 0) {
    return ctx.reply('Your cart is empty — send /order to start shopping.');
  }

  const cartDisplay = ctx.session.cart
    .map((item, idx) => `${idx + 1}. ${formatCartLine(item)}`)
    .join('\n');

  const removeButtons = ctx.session.cart.map((item, idx) => [
    Markup.button.callback(`🗑 Remove item ${idx + 1}`, `remove_cart:${idx}`),
  ]);

  const actionButtons = [
    [Markup.button.callback('➕ Add another item', 'cart:add_more')],
    [Markup.button.callback('✅ Checkout', 'cart:checkout')],
  ];

  ctx.reply(
    `Your cart:\n${cartDisplay}\n\nRunning total: $${cartTotal(ctx.session.cart).toFixed(2)}\n\n` +
      `Remove items or continue:`,
    Markup.inlineKeyboard([...removeButtons, ...actionButtons])
  );
});

bot.action(/remove_cart:(\d+)/, async (ctx) => {
  ensureSession(ctx);
  const idx = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();

  if (idx < 0 || idx >= ctx.session.cart.length) {
    return ctx.reply('That item is no longer in your cart.');
  }

  const removed = ctx.session.cart.splice(idx, 1)[0];

  if (ctx.session.cart.length === 0) {
    return ctx.reply(`Removed: ${formatCartLine(removed)}\n\nYour cart is now empty. Send /order to keep shopping.`);
  }

  const cartDisplay = ctx.session.cart
    .map((item, i) => `${i + 1}. ${formatCartLine(item)}`)
    .join('\n');

  const removeButtons = ctx.session.cart.map((item, i) => [
    Markup.button.callback(`🗑 Remove item ${i + 1}`, `remove_cart:${i}`),
  ]);

  const actionButtons = [
    [Markup.button.callback('➕ Add another item', 'cart:add_more')],
    [Markup.button.callback('✅ Checkout', 'cart:checkout')],
  ];

  ctx.reply(
    `Removed: ${formatCartLine(removed)}\n\nYour cart:\n${cartDisplay}\n\nRunning total: $${cartTotal(ctx.session.cart).toFixed(2)}`,
    Markup.inlineKeyboard([...removeButtons, ...actionButtons])
  );
});

bot.action(/cat:(.+)/, async (ctx) => {
  ensureSession(ctx);
  const category = ctx.match[1];
  await ctx.answerCbQuery();

  const products = PRODUCTS.filter((p) => p.category === category && hasAnyStock(p));
  if (products.length === 0) {
    return ctx.reply('Nothing in stock in that category right now.');
  }

  const buttons = products.map((p) => [Markup.button.callback(p.name, `product:${p.id}`)]);
  ctx.reply(`${category} — pick an item:`, Markup.inlineKeyboard(buttons));
});

bot.action(/product:(.+)/, async (ctx) => {
  ensureSession(ctx);
  const product = PRODUCTS.find((p) => p.id === ctx.match[1]);
  if (!product) return ctx.answerCbQuery('Item not found');

  ctx.session.current = { product };
  await ctx.answerCbQuery();

  const sizes = availableSizes(product);
  if (sizes && sizes.length) {
    ctx.session.step = 'size';
    const buttons = sizes
      .map((s) => {
        const remaining = stockRemainingAfterCart(ctx.session.cart, product, s);
        return remaining > 0 ? [Markup.button.callback(`${s} (${remaining} left)`, `size:${s}`)] : null;
      })
      .filter(Boolean);

    if (buttons.length === 0) {
      return ctx.reply('Everything for that item is already in your cart at max stock. Pick something else.');
    }
    ctx.reply(`Size for ${product.name}?`, Markup.inlineKeyboard(buttons));
  } else {
    ctx.session.current.size = null;
    ctx.session.step = 'quantity';
    const remaining = stockRemainingAfterCart(ctx.session.cart, product, null);
    ctx.reply(`${product.name} — ${remaining} available.\nHow many would you like? (type a number)`);
  }
});

bot.action(/size:(.+)/, async (ctx) => {
  ensureSession(ctx);
  ctx.session.current.size = ctx.match[1];
  ctx.session.step = 'quantity';
  await ctx.answerCbQuery();

  const remaining = stockRemainingAfterCart(ctx.session.cart, ctx.session.current.product, ctx.session.current.size);
  ctx.reply(`Size ${ctx.session.current.size} — ${remaining} available.\nHow many would you like? (type a number)`);
});

bot.action('cart:add_more', async (ctx) => {
  ensureSession(ctx);
  await ctx.answerCbQuery();
  showCategoryMenu(ctx, '');
});

bot.action('cart:checkout', async (ctx) => {
  ensureSession(ctx);
  await ctx.answerCbQuery();

  if (ctx.session.cart.length === 0) {
    return ctx.reply('Your cart is empty — send /order to start picking items.');
  }

  ctx.session.step = 'shipping';
  const summary = ctx.session.cart.map(formatCartLine).join('\n');
  ctx.reply(
    `Your order:\n${summary}\n\nTotal: $${cartTotal(ctx.session.cart).toFixed(2)}\n\n` +
      `Now send your shipping info as ONE message, one line each:\n\n` +
      'Full Name\nStreet Address\nCity, State ZIP\nPhone Number'
  );
});

bot.on('text', async (ctx) => {
  ensureSession(ctx);
  const step = ctx.session.step;

  if (step === 'quantity') {
    const product = ctx.session.current.product;
    const size = ctx.session.current.size;
    const quantity = parseInt(ctx.message.text.trim(), 10);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return ctx.reply('Please send a valid quantity as a number, e.g. 3');
    }

    const available = stockRemainingAfterCart(ctx.session.cart, product, size);
    if (quantity > available) {
      return ctx.reply(`Only ${available} available (accounting for what's already in your cart). Please enter a smaller quantity.`);
    }

    const total = computeTotal(product.schedule, quantity);
    if (total === null) {
      return ctx.reply('That quantity is outside our pricing range — message us directly for a custom quote.');
    }

    ctx.session.cart.push({ product, size, quantity, total });
    ctx.session.current = {};
    ctx.session.step = 'cart_decision';

    const summary = ctx.session.cart.map(formatCartLine).join('\n');
    return ctx.reply(
      `Added! Your cart so far:\n${summary}\n\nRunning total: $${cartTotal(ctx.session.cart).toFixed(2)}\n\n` +
        `Want to add another item, or check out?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add another item', 'cart:add_more')],
        [Markup.button.callback('✅ Checkout', 'cart:checkout')],
      ])
    );
  }

  if (step === 'shipping') {
    const lines = ctx.message.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 4) {
      return ctx.reply(
        'That\'s missing a line. Please resend all 4:\nFull Name\nStreet Address\nCity, State ZIP\nPhone Number'
      );
    }

    const [name, address, cityStateZip, phone] = lines;
    const shipping = { name, address, cityStateZip, phone };
    const cart = ctx.session.cart;

    const orderId = randomUUID();
    pendingOrders.set(orderId, {
      items: cart,
      total: cartTotal(cart),
      shipping,
      telegramChatId: ctx.chat.id,
      telegramUsername: ctx.from.username || ctx.from.first_name,
    });

    try {
      const lineItems = cart.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.size ? `${item.product.name} (${item.size})` : item.product.name,
          },
          unit_amount: Math.round((item.total / item.quantity) * 100),
        },
        quantity: item.quantity,
      }));

      const paymentLink = await stripe.paymentLinks.create({
        line_items: lineItems,
        metadata: { orderId },
      });

      const summary = cart.map(formatCartLine).join('\n');
      await ctx.reply(
        `Order summary:\n${summary}\n\n` +
          `Total: $${cartTotal(cart).toFixed(2)}\n\n` +
          `Pay here to confirm your order:\n${paymentLink.url}\n\n` +
          `Your order ships once payment clears.`
      );
    } catch (err) {
      console.error('Stripe payment link error:', err);
      ctx.reply('Something went wrong generating your payment link. Please try /order again.');
      pendingOrders.delete(orderId);
    }

    ctx.session.step = null;
    ctx.session.cart = [];
  }
});

bot.launch();
console.log('Levi Supplyz bot running (polling)...');

// --- Express server: only used for the Stripe webhook ---
const app = express();

// Stripe webhooks need the raw body for signature verification,
// so this route must come before any express.json() middleware.
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    const order = pendingOrders.get(orderId);

    if (order) {
      // Decrement stock for every item in the cart now that payment cleared
      for (const item of order.items) {
        if (typeof item.product.stock === 'number') {
          item.product.stock -= item.quantity;
        } else if (item.size) {
          item.product.stock[item.size] -= item.quantity;
        }
      }

      const itemLines = order.items.map(formatCartLine).join('\n');
      const smsBody =
        `New Levi Supplyz order paid!\n` +
        `${itemLines}\n` +
        `Total: $${order.total.toFixed(2)}\n` +
        `Ship to: ${order.shipping.name}, ${order.shipping.address}, ${order.shipping.cityStateZip}\n` +
        `Buyer phone: ${order.shipping.phone}\n` +
        `Telegram: @${order.telegramUsername}`;

      try {
        await twilioClient.messages.create({
          body: smsBody,
          from: process.env.TWILIO_FROM_NUMBER,
          to: process.env.OWNER_PHONE_NUMBER,
        });
      } catch (err) {
        console.error('Twilio send failed:', err);
      }

      try {
        await bot.telegram.sendMessage(
          order.telegramChatId,
          'Payment received! Your order is confirmed and will ship soon. 🚀'
        );
      } catch (err) {
        console.error('Failed to notify buyer on Telegram:', err);
      }

      pendingOrders.delete(orderId);
    } else {
      console.warn('Received payment for unknown/expired orderId:', orderId);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
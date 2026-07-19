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

const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))];

bot.start((ctx) => {
  ctx.reply('Welcome to Levi Supplyz! 👟\n\nType /order to start a new order.');
});

bot.command('order', (ctx) => {
  ensureSession(ctx);
  ctx.session.order = {};
  ctx.session.step = 'category';

  const categoriesWithStock = CATEGORIES.filter((cat) =>
    PRODUCTS.some((p) => p.category === cat && hasAnyStock(p))
  );

  if (categoriesWithStock.length === 0) {
    return ctx.reply('Everything is out of stock right now — check back soon!');
  }

  const buttons = categoriesWithStock.map((cat) => [Markup.button.callback(cat, `cat:${cat}`)]);
  ctx.reply('What are you shopping for?', Markup.inlineKeyboard(buttons));
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

  ctx.session.order.product = product;
  await ctx.answerCbQuery();

  const sizes = availableSizes(product);
  if (sizes && sizes.length) {
    ctx.session.step = 'size';
    const buttons = sizes.map((s) => [
      Markup.button.callback(`${s} (${product.stock[s]} left)`, `size:${s}`),
    ]);
    ctx.reply(`Size for ${product.name}?`, Markup.inlineKeyboard(buttons));
  } else {
    ctx.session.order.size = null;
    ctx.session.step = 'quantity';
    ctx.reply(
      `${product.name} — ${product.stock} in stock.\nHow many would you like? (type a number)`
    );
  }
});

bot.action(/size:(.+)/, async (ctx) => {
  ensureSession(ctx);
  ctx.session.order.size = ctx.match[1];
  ctx.session.step = 'quantity';
  await ctx.answerCbQuery();

  const stock = stockFor(ctx.session.order.product, ctx.session.order.size);
  ctx.reply(`Size ${ctx.session.order.size} — ${stock} in stock.\nHow many would you like? (type a number)`);
});

bot.on('text', async (ctx) => {
  ensureSession(ctx);
  const step = ctx.session.step;

  if (step === 'quantity') {
    const product = ctx.session.order.product;
    const quantity = parseInt(ctx.message.text.trim(), 10);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return ctx.reply('Please send a valid quantity as a number, e.g. 3');
    }

    const available = stockFor(product, ctx.session.order.size);
    if (quantity > available) {
      return ctx.reply(`Only ${available} available. Please enter a smaller quantity.`);
    }

    const total = computeTotal(product.schedule, quantity);
    if (total === null) {
      return ctx.reply('That quantity is outside our pricing range — message us directly for a custom quote.');
    }

    ctx.session.order.quantity = quantity;
    ctx.session.order.total = total;
    ctx.session.step = 'shipping';

    return ctx.reply(
      `Total for ${quantity}x ${product.name}${ctx.session.order.size ? ` (${ctx.session.order.size})` : ''}: $${total.toFixed(2)}\n\n` +
        `Now send your shipping info as ONE message, one line each:\n\n` +
        'Full Name\nStreet Address\nCity, State ZIP\nPhone Number'
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
    const order = ctx.session.order;
    order.shipping = { name, address, cityStateZip, phone };

    const orderId = randomUUID();
    pendingOrders.set(orderId, {
      product: order.product,
      size: order.size,
      quantity: order.quantity,
      total: order.total,
      shipping: order.shipping,
      telegramChatId: ctx.chat.id,
      telegramUsername: ctx.from.username || ctx.from.first_name,
    });

    try {
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: order.size ? `${order.product.name} (${order.size})` : order.product.name,
              },
              unit_amount: Math.round((order.total / order.quantity) * 100),
            },
            quantity: order.quantity,
          },
        ],
        metadata: { orderId },
      });

      const sizeLine = order.size ? ` (${order.size})` : '';
      await ctx.reply(
        `Order summary:\n${order.product.name}${sizeLine} x${order.quantity}\n` +
          `Total: $${order.total.toFixed(2)}\n\n` +
          `Pay here to confirm your order:\n${paymentLink.url}\n\n` +
          `Your order ships once payment clears.`
      );
    } catch (err) {
      console.error('Stripe payment link error:', err);
      ctx.reply('Something went wrong generating your payment link. Please try /order again.');
      pendingOrders.delete(orderId);
    }

    ctx.session.step = null;
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
      // Decrement stock now that payment has cleared
      if (typeof order.product.stock === 'number') {
        order.product.stock -= order.quantity;
      } else if (order.size) {
        order.product.stock[order.size] -= order.quantity;
      }

      const sizeLine = order.size ? ` (${order.size})` : '';
      const smsBody =
        `New Levi Supplyz order paid!\n` +
        `${order.product.name}${sizeLine} x${order.quantity}\n` +
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
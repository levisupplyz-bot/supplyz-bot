# Levi Supplyz Telegram Order Bot

Takes an order in Telegram → sends the customer a Stripe payment link for the
exact total (including any quantity discounts) → once they pay, texts you the
order + shipping info via Twilio SMS.

## Where you left off
- ✅ Telegram bot created via BotFather — you have your `BOT_TOKEN`
- ✅ Twilio account started (free trial)
- ⬜ Buy a Twilio phone number
- ⬜ Grab Twilio Account SID + Auth Token
- ⬜ Grab Stripe secret key
- ⬜ Fill in `products.js` with your real inventory
- ⬜ Upload to GitHub, deploy on Railway
- ⬜ Add environment variables in Railway
- ⬜ Set up Stripe webhook pointing at your Railway URL

## 1. Fill in your `.env` file
Rename `.env.example` to `.env` and fill in each value as you collect it:
- `BOT_TOKEN` — from BotFather (you already have this)
- `STRIPE_SECRET_KEY` — Stripe dashboard → Developers → API keys → Secret key
- `STRIPE_WEBHOOK_SECRET` — you'll get this in step 4, after deploying
- `TWILIO_SID` / `TWILIO_AUTH_TOKEN` — Twilio dashboard → Account
- `TWILIO_FROM_NUMBER` — the phone number you buy in Twilio
- `OWNER_PHONE_NUMBER` — your personal cell, where order alerts go

## 2. Product catalog — already filled in
`products.js` now has your real inventory built in: all your Bape tees,
Essentials shorts, AirPods, and Extras, with the actual stock counts and
sizes you gave me, and both price schedules (the Bape/Essentials/Extras
schedule, and the separate AirPods schedule).

**When your stock changes**, open `products.js` and update the numbers in
the `stock` section for that item — that's the only edit you'll usually need.
When you get new items or restock Chrome Hearts, copy the pattern of an
existing product block and fill in the new name/sizes/stock.

**Important:** stock only lives in memory while the bot is running — if the
server restarts, stock counts reset back to whatever's in `products.js` on
disk (any sales since your last edit won't be reflected). At your current
volume that's fine, just remember to periodically update the file with
current counts, or come back later and we can wire this up to a database or
your Google Sheet properly.

## 3. Deploy on Railway
1. Push this folder to a GitHub repo (you've got one started: your
   "Levi Supplyz Bot" repo).
2. Go to railway.app, sign up, connect your GitHub account.
3. Create a new project → deploy from that repo.
4. In Railway's dashboard, add every variable from your `.env` file as an
   environment variable (same names, same values).
5. Railway gives you a public URL, something like
   `https://levi-supplyz-bot-production.up.railway.app`.

## 4. Connect the Stripe webhook
1. In your Stripe dashboard → Developers → Webhooks → **Add endpoint**.
2. URL: `https://YOUR-RAILWAY-URL/webhook`
3. Event to send: `checkout.session.completed`
4. Stripe gives you a **Signing secret** — copy it, set it as
   `STRIPE_WEBHOOK_SECRET` in Railway, then redeploy.

## 5. Test it
1. Message your bot on Telegram, send `/order`.
2. Pick a category (Bape, Essentials, Airpods, Extras), then an item, then a
   size if it has one (only in-stock sizes show up as buttons).
3. Type a quantity as a number — the bot checks it against real stock and
   tells you if you asked for too many.
4. Send shipping info as one message (Full Name / Address / City,State ZIP /
   Phone), then pay the link that comes back.
5. Use a Stripe test card (`4242 4242 4242 4242`, any future date/CVC) if
   you're using a test key.
6. Within a few seconds you should get a text on `OWNER_PHONE_NUMBER` with the
   full order + shipping details, and the customer gets a confirmation in
   Telegram. Stock for that item/size also goes down automatically.

## Notes for later
- Orders live in memory while the server runs — if it restarts between order
  creation and payment, that pending order is lost. Fine at your current
  volume; move to a real database (SQLite/Postgres) once you're doing serious
  numbers.
- The SMS to you only fires after payment clears, so you don't get pinged for
  orders that never pay.
- Shipping labels aren't automated — you still print those yourself through
  whatever shipping software you already use (Shippo, Pirate Ship, etc.). That
  can be added later as a separate step once the core bot is solid.

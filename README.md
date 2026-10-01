# TinDARhan

Point of sale for the DAR Batangas ARBO shop. A plain HTML/CSS/JavaScript
frontend served by a Node.js + Express backend with a PostgreSQL database,
so several devices share the same live inventory, sales and settings.

## Logging in

The first time the app starts with an empty database it creates one login:

| Username | Password |
|----------|----------|
| `DAR`    | the value of `ADMIN_PASSWORD`, or `TINDAHAN` if that isn't set |

**Change the password right after the first login:** sidebar → **Change
password**. Changing it logs out every other device using the login.

## Running locally

```bash
npm install
cp .env.example .env   # set DATABASE_URL (and optionally ADMIN_PASSWORD)
npm start
```

The app runs at `http://localhost:3000`.

## Deploying on Railway

1. Deploy this repository as a service in a Railway project.
2. In the same project, add a PostgreSQL database ("New" → "Database" →
   "Add PostgreSQL"). Railway injects `DATABASE_URL` automatically.
3. Optional: set `ADMIN_PASSWORD` on the service before the first start.
4. Redeploy if the app was running before the database was added.

On start the app creates or migrates its tables, and on an empty database
seeds the login and 12 starter items. `[FATAL] DATABASE_URL is not set` in
the logs means the database isn't attached to the same project.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string (set by Railway) |
| `ADMIN_PASSWORD` | no | First password for `DAR`, used only on first start |
| `PGSSLMODE` | no | `disable` for a local database without SSL |
| `PORT` | no | Port to listen on (set by Railway) |

## Security

- Every `/api` route except `POST /api/login` and `GET /api/health`
  requires a session token (`Authorization: Bearer …`). Tokens are random
  64-character values stored in the `sessions` table and expire after 24
  hours. Logging out deletes the token.
- The browser keeps the token in `sessionStorage`: each tab logs in once and
  closing the tab logs out. If the server rejects the token, the app
  returns to the login screen.
- Passwords are stored as bcrypt hashes. After 8 wrong passwords from one
  address, login is blocked for 15 minutes.
- Checkout uses prices and stock from the database, not the browser, and
  locks the item rows so two devices can't both sell the last unit.
- Editing an item's stock only succeeds if nobody sold that item since the
  form was opened, so a sale on another device isn't silently undone.
- Only the frontend folders (`css`, `js`, `assets`) and `index.html` are
  served; responses include `nosniff`, `X-Frame-Options: DENY` and a
  same-origin referrer policy.

## Features

- **Shop:** tap products to build the sale; Cash, GCash (shows the shop's
  QR code) or Pay Later (utang, needs the customer's name). Quick-cash
  buttons fill the amount received; the receipt opens after checkout.
- **Inventory:** search, filter by stock status (needs restock / out of
  stock) or date added, add and edit items with an optional photo and a
  per-item low-stock alert level.
- **Sales reports:** quick ranges (today, 7 days, 30 days, all time) or a
  custom range; totals, top sellers, and the transactions list with
  receipt, Mark paid / undo, and delete. Deleting a sale puts its items
  back into stock.
- **Notifications:** the bell lists out-of-stock and low-stock items and
  unpaid Pay Later balances; pop-up notices confirm each action.
- **Excel export:** the DAR Sales & Inventory Report layout (Product Inv,
  Daily Sales with cash-drawer reconciliation, Sales Summary). Built in
  the browser with [ExcelJS](https://github.com/exceljs/exceljs) from a CDN.
  Beginning and ending inventory are worked back from current stock and
  the sales since the range, so older ranges are approximate if stock was
  edited by hand afterwards.
- **Live sync:** logged-in devices refresh every 6 seconds while visible.
  Unchanged data is not redrawn, and the server's ETags keep repeat
  requests small.

## Motion

Animations confirm what just happened; they never hold anything up. The
cart, totals and stock change the moment a button is pressed, and the
animation plays on top.

- **Add to cart:** a copy of the product photo flies in an arc into the
  item count beside "Current sale" (on phones, into the "View sale" bar at
  the bottom of the screen). The count pops and the new line slides in when
  it lands; adding more of the same item pops the quantity instead.
- **Cart:** removed lines fold away, the total rolls to its new value, the
  payment choice slides between Cash, GCash and Pay Later, and Charge shows a
  spinner while the sale is saved (the cart is locked until then).
- **After checkout:** the receipt opens with a check that draws itself and
  the change to hand back. This part is not printed.
- **Everywhere else:** dialogs and the bell menu scale in and fade out,
  notices slide in and the ones below glide up when one closes, tabs fade in,
  products settle in on first load, report totals count up and the top-seller
  bars grow, and table rows flash after they are added, edited or paid.
- **Timing:** 90 ms for presses, 140 ms for hovers and exits, 220 ms for
  things appearing, 320 ms for panels, 520–760 ms for the flight. The values
  are CSS variables at the top of `css/style.css` (`--dur-*`, `--ease-*`).
- **Reduced motion:** when the device is set to reduce motion, the flight,
  slides, pops and count-ups are skipped and every change appears at once.

## API

All routes return JSON. Errors are `{ "error": "message" }`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Database check (public) |
| POST | `/api/login` | `{ username, password }` → `{ token }` (public) |
| POST | `/api/logout` | End this session |
| POST | `/api/password` | `{ currentPassword, newPassword }` |
| GET | `/api/items` | List items |
| POST | `/api/items` | Add an item |
| PUT | `/api/items/:id` | Update an item (`stock` + `expectedStock` optional) |
| DELETE | `/api/items/:id` | Delete an item |
| GET | `/api/sales` | List sales with their lines |
| POST | `/api/sales` | Record a sale (409 if stock is short) |
| DELETE | `/api/sales/:id` | Delete one sale and restore its stock |
| DELETE | `/api/sales` | Delete all sales (`{ "confirm": "DELETE" }`) |
| POST | `/api/sales/:id/settle` | Mark a Pay Later sale paid (`{ paymentMethod }`) |
| POST | `/api/sales/:id/unsettle` | Undo that |
| GET / PUT | `/api/settings/gcash_qr` | Read / save the GCash QR image |

## Project layout

```
server.js          Express app and API
server/db.js       Pool, schema and migrations, first-run seed
index.html         All screens and dialogs
css/style.css      Design tokens and styles (light and dark)
js/                One module per screen or concern:
  storage.js       API client (adds the session token)
  auth.js          Login, logout, change password
  pos.js           Shop and checkout
  inventory.js     Inventory table and item dialog
  reports.js       Sales reports and Excel export
  notify.js        Pop-up notices and the bell menu
  ui.js            Shared helpers and dialog focus handling
  motion.js        Add-to-cart flight and other animation helpers
  main.js          Startup, navigation, live sync
assets/            DAR seal, TinDARhan logo, login background
```

`js/storage.mock.js` is an in-memory stand-in for `storage.js`, used only
for offline previews of the interface; `index.html` never loads it.

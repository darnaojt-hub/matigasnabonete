/**
 * server.js
 * TinDARhan POS backend: serves the frontend and a JSON API over
 * PostgreSQL. Every /api route except login and health requires a
 * session token (Authorization: Bearer <token>) issued by /api/login.
 */

require('dotenv').config(); // no-op on Railway, which sets env vars directly

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, initSchema, nextItemId, nextSaleId } = require('./server/db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_HOURS = 24;
const PAYMENT_METHODS = ['Cash', 'GCash', 'Pay Later'];
const SETTING_KEYS = ['gcash_qr']; // settings the app may read/write
const MAX_IMAGE_CHARS = 3 * 1024 * 1024; // ~2 MB image as a data URL

app.set('trust proxy', 1); // Railway sits behind a proxy; needed for req.ip
app.use(cors());
app.use(express.json({ limit: '5mb' })); // largest body is one ~2 MB photo

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // API data is private and always revalidated (Express ETags turn repeat
  // polls into small 304 responses when nothing changed).
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'private, no-cache');
  next();
});

// Only the frontend assets are public; never the server source or env files.
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch((err) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const money = (n) => Math.round(Number(n) * 100) / 100;

function text(value, field, { required = false, max = 200 } = {}) {
  const v = String(value == null ? '' : value).trim();
  if (required && !v) throw new HttpError(400, field + ' is required.');
  if (v.length > max) throw new HttpError(400, field + ' is too long (max ' + max + ' characters).');
  return v;
}

function wholeNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, field + ' must be a whole number of 0 or more.');
  return n;
}

function price(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, field + ' must be 0 or more.');
  return money(n);
}

function image(value) {
  if (value === undefined) return undefined; // not sent: keep the current photo
  const v = String(value || '');
  if (v && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v)) throw new HttpError(400, 'Photo must be a PNG, JPG, WebP or GIF image.');
  if (v.length > MAX_IMAGE_CHARS) throw new HttpError(400, 'Photo is too large. Use an image under 2 MB.');
  return v;
}

function rowToItem(r) {
  return {
    id: r.id,
    name: r.name,
    farm: r.farm || '',
    image: r.image || '',
    price: Number(r.price),
    stock: r.stock,
    lowStockThreshold: r.low_stock_threshold,
    dateAdded: r.date_added,
  };
}

function rowToSale(saleRow, lineRows) {
  return {
    id: saleRow.id,
    datetime: saleRow.datetime,
    cashier: saleRow.cashier,
    paymentMethod: saleRow.payment_method,
    customerName: saleRow.customer_name || '',
    total: Number(saleRow.total),
    amountPaid: Number(saleRow.amount_paid),
    change: Number(saleRow.change),
    isSettled: !!saleRow.is_settled,
    settledAt: saleRow.settled_at,
    settledMethod: saleRow.settled_method || null,
    items: lineRows.map((l) => ({
      id: l.item_id,
      itemId: l.item_id,
      name: l.name,
      price: Number(l.price),
      qty: l.qty,
      subtotal: Number(l.subtotal),
    })),
  };
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadSale(db, id) {
  const { rows: saleRows } = await db.query('SELECT * FROM sales WHERE id = $1', [id]);
  if (!saleRows[0]) return null;
  const { rows: lineRows } = await db.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id ASC', [id]);
  return rowToSale(saleRows[0], lineRows);
}

// ---------- public routes ----------
app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// Wrong-password throttle: 8 failures per 15 minutes per address.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const loginFailures = new Map(); // ip -> { count, since }

// The attempt is counted before any await, so parallel guesses can't slip
// past the limit; a successful login clears it.
function countLoginAttempt(ip) {
  const now = Date.now();
  if (loginFailures.size > 1000) {
    for (const [key, r] of loginFailures) if (now - r.since >= LOGIN_WINDOW_MS) loginFailures.delete(key);
  }
  let record = loginFailures.get(ip);
  if (!record || now - record.since >= LOGIN_WINDOW_MS) record = { count: 0, since: now };
  if (record.count >= LOGIN_MAX_FAILURES) throw new HttpError(429, 'Too many wrong attempts. Wait a few minutes and try again.');
  record.count += 1;
  loginFailures.set(ip, record);
}

app.post('/api/login', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  const username = text((req.body || {}).username, 'Username', { required: true, max: 60 });
  const password = String((req.body || {}).password || '');
  if (!password) throw new HttpError(400, 'Password is required.');
  countLoginAttempt(ip);

  const { rows } = await pool.query('SELECT username, password_hash FROM users WHERE UPPER(username) = UPPER($1)', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Incorrect username or password.');
  }
  loginFailures.delete(ip);

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query(
    `INSERT INTO sessions (token, username, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, user.username, String(SESSION_HOURS)]
  );
  res.json({ ok: true, username: user.username, token });
}));

// ---------- everything below requires a session ----------
app.use('/api', asyncRoute(async (req, res, next) => {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('Authorization') || '');
  if (!match) throw new HttpError(401, 'Please log in.');
  const { rows } = await pool.query('SELECT username FROM sessions WHERE token = $1 AND expires_at > now()', [match[1]]);
  if (!rows[0]) throw new HttpError(401, 'Your session has ended. Please log in again.');
  req.user = rows[0].username;
  req.sessionToken = match[1];
  next();
}));

app.post('/api/logout', asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token = $1', [req.sessionToken]);
  res.json({ ok: true });
}));

// Change the logged-in user's password. Other devices are logged out.
app.post('/api/password', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const current = String(b.currentPassword || '');
  const next = String(b.newPassword || '');
  if (next.length < 8) throw new HttpError(400, 'The new password must be at least 8 characters.');
  if (next.length > 200) throw new HttpError(400, 'The new password is too long.');
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE username = $1', [req.user]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }
  if (await bcrypt.compare(next, rows[0].password_hash)) throw new HttpError(400, 'Choose a password different from the current one.');
  const hash = await bcrypt.hash(next, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, req.user]);
  await pool.query('DELETE FROM sessions WHERE username = $1 AND token <> $2', [req.user, req.sessionToken]);
  res.json({ ok: true });
}));

// ---------- items ----------
app.get('/api/items', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM items ORDER BY date_added ASC');
  res.json(rows.map(rowToItem));
}));

app.post('/api/items', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const values = [
    text(b.name, 'Item name', { required: true, max: 120 }),
    text(b.farm, 'Farm / maker', { max: 160 }),
    image(b.image) || '',
    price(b.price, 'Price'),
    wholeNumber(b.stock, 'Stock'),
    wholeNumber(b.lowStockThreshold, 'Low-stock alert', 5),
  ];
  const id = await allocateItemId();
  const { rows } = await pool.query(
    `INSERT INTO items (id, name, farm, image, price, stock, low_stock_threshold, date_added)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
    [id, ...values]
  );
  res.status(201).json(rowToItem(rows[0]));
}));

// Update an item. Stock and photo change only when sent. A new stock
// count is applied only if stock still equals expectedStock (what the
// editor saw), so a sale on another device isn't silently undone.
app.put('/api/items/:id', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const img = image(b.image);
  const newStock = b.stock === undefined ? null : wholeNumber(b.stock, 'Stock');
  const expected = b.expectedStock === undefined ? null : wholeNumber(b.expectedStock, 'Expected stock');
  const { rows } = await pool.query(
    `UPDATE items
     SET name = $1, farm = $2, image = COALESCE($3, image), price = $4,
         stock = COALESCE($5, stock),
         low_stock_threshold = COALESCE($6, low_stock_threshold)
     WHERE id = $7 AND ($5::int IS NULL OR $8::int IS NULL OR stock = $8::int)
     RETURNING *`,
    [
      text(b.name, 'Item name', { required: true, max: 120 }),
      text(b.farm, 'Farm / maker', { max: 160 }),
      img === undefined ? null : img,
      price(b.price, 'Price'),
      newStock,
      b.lowStockThreshold === undefined ? null : wholeNumber(b.lowStockThreshold, 'Low-stock alert'),
      req.params.id,
      expected,
    ]
  );
  if (!rows[0]) {
    const { rows: current } = await pool.query('SELECT stock FROM items WHERE id = $1', [req.params.id]);
    if (!current[0]) throw new HttpError(404, 'Item not found. It may have been deleted.');
    throw new HttpError(409, 'Stock changed on another device (now ' + current[0].stock + '). Close this form, then edit again.');
  }
  res.json(rowToItem(rows[0]));
}));

app.delete('/api/items/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Item not found. It may already have been deleted.');
  res.json({ ok: true });
}));

// ---------- sales ----------
app.get('/api/sales', asyncRoute(async (req, res) => {
  const { rows: saleRows } = await pool.query('SELECT * FROM sales ORDER BY datetime DESC');
  if (saleRows.length === 0) return res.json([]);
  const { rows: lineRows } = await pool.query(
    'SELECT * FROM sale_items WHERE sale_id = ANY($1) ORDER BY id ASC',
    [saleRows.map((s) => s.id)]
  );
  const linesBySale = {};
  lineRows.forEach((l) => { (linesBySale[l.sale_id] = linesBySale[l.sale_id] || []).push(l); });
  res.json(saleRows.map((s) => rowToSale(s, linesBySale[s.id] || [])));
}));

// Record a sale. Prices and stock come from the database (not the
// browser), and the item rows are locked so two devices can't both sell
// the last unit.
app.post('/api/sales', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const method = PAYMENT_METHODS.includes(b.paymentMethod) ? b.paymentMethod : 'Cash';
  const customerName = text(b.customerName, 'Customer name', { max: 80 });
  const cashier = text(b.cashier, 'Cashier', { max: 60 }) || 'Unassigned';
  if (method === 'Pay Later' && !customerName) throw new HttpError(400, 'Customer name is required for Pay Later sales.');
  if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'The sale has no items.');

  const saleId = await withTransaction(async (client) => {
    // Resolve each line to an item id ("itemId", or "id" from older builds).
    const wanted = new Map(); // itemId -> qty
    for (const line of b.items) {
      const qty = wholeNumber(line && line.qty, 'Quantity');
      if (qty === 0) continue;
      let itemId = line.itemId || line.id || null;
      if (!itemId && line.name) {
        const { rows } = await client.query('SELECT id FROM items WHERE name = $1', [String(line.name)]);
        if (rows.length === 1) itemId = rows[0].id;
      }
      if (!itemId) throw new HttpError(400, 'An item in the sale could not be found. Refresh and try again.');
      wanted.set(itemId, (wanted.get(itemId) || 0) + qty);
    }
    if (wanted.size === 0) throw new HttpError(400, 'The sale has no items.');

    const { rows: itemRows } = await client.query(
      'SELECT id, name, price, stock FROM items WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [[...wanted.keys()]]
    );
    const byId = new Map(itemRows.map((r) => [r.id, r]));
    const lines = [];
    for (const [itemId, qty] of wanted) {
      const item = byId.get(itemId);
      if (!item) throw new HttpError(409, 'An item in the sale was deleted from inventory. Remove it and try again.');
      if (item.stock < qty) {
        throw new HttpError(409, 'Only ' + item.stock + ' ' + item.name + ' left in stock. Update the sale and try again.');
      }
      const unit = money(item.price);
      lines.push({ itemId, name: item.name, price: unit, qty, subtotal: money(unit * qty) });
    }

    const total = money(lines.reduce((sum, l) => sum + l.subtotal, 0));
    let amountPaid = 0;
    let change = 0;
    if (method !== 'Pay Later') {
      amountPaid = money(b.amountPaid);
      if (!Number.isFinite(amountPaid) || amountPaid < total) {
        throw new HttpError(400, 'Amount received is less than the total of P' + total.toFixed(2) + '.');
      }
      change = money(amountPaid - total);
    }

    const id = await allocateSaleId(client);
    const settled = method !== 'Pay Later';
    await client.query(
      `INSERT INTO sales (id, datetime, cashier, payment_method, customer_name, total, amount_paid, change, is_settled, settled_at)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, ${settled ? 'now()' : 'NULL'})`,
      [id, cashier, method, customerName, total, amountPaid, change, settled]
    );
    for (const l of lines) {
      await client.query(
        'INSERT INTO sale_items (sale_id, item_id, name, price, qty, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, l.itemId, l.name, l.price, l.qty, l.subtotal]
      );
      await client.query('UPDATE items SET stock = stock - $1 WHERE id = $2', [l.qty, l.itemId]);
    }
    return id;
  });

  res.status(201).json(await loadSale(pool, saleId));
}));

// Delete one sale and put its items back into stock. Sales recorded before
// stock tracking worked have no item id on their lines and restore nothing.
app.delete('/api/sales/:id', asyncRoute(async (req, res) => {
  const saleId = req.params.id;
  const restoredQty = await withTransaction(async (client) => {
    // Deleting the lines first locks them, so a double delete can't restore twice.
    const { rows: lines } = await client.query('DELETE FROM sale_items WHERE sale_id = $1 RETURNING item_id, qty', [saleId]);
    const { rowCount } = await client.query('DELETE FROM sales WHERE id = $1', [saleId]);
    if (!rowCount) throw new HttpError(404, 'Sale not found. It may already have been deleted.');
    let restored = 0;
    lines.sort((a, b) => String(a.item_id).localeCompare(String(b.item_id))); // same lock order as checkout
    for (const line of lines) {
      if (!line.item_id || !(line.qty > 0)) continue;
      const { rowCount: updated } = await client.query('UPDATE items SET stock = stock + $1 WHERE id = $2', [line.qty, line.item_id]);
      if (updated) restored += line.qty;
    }
    return restored;
  });
  res.json({ ok: true, id: saleId, restoredQty });
}));

// Delete every sale and restart receipt numbers. Inventory is untouched.
app.delete('/api/sales', asyncRoute(async (req, res) => {
  if ((req.body || {}).confirm !== 'DELETE') throw new HttpError(400, 'Confirmation text does not match. Nothing was deleted.');
  const deleted = await withTransaction(async (client) => {
    await client.query(`DELETE FROM settings WHERE key = 'sale_seq'`); // locks the counter first
    const { rowCount } = await client.query('DELETE FROM sales');
    return rowCount;
  });
  res.json({ ok: true, deleted });
}));

// Mark a Pay Later sale as paid (Cash or GCash), or undo that.
async function explainSettleMiss(id, settling) {
  const { rows } = await pool.query(`SELECT is_settled FROM sales WHERE id = $1 AND payment_method = 'Pay Later'`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Pay Later sale not found.');
  throw new HttpError(409, settling ? 'This sale was already marked as paid.' : 'This sale is already unpaid.');
}

app.post('/api/sales/:id/settle', asyncRoute(async (req, res) => {
  const settledMethod = (req.body || {}).paymentMethod === 'GCash' ? 'GCash' : 'Cash';
  const { rowCount } = await pool.query(
    `UPDATE sales SET is_settled = true, settled_at = now(), amount_paid = total, change = 0, settled_method = $2
     WHERE id = $1 AND payment_method = 'Pay Later' AND is_settled = false`,
    [req.params.id, settledMethod]
  );
  if (!rowCount) await explainSettleMiss(req.params.id, true);
  res.json(await loadSale(pool, req.params.id));
}));

app.post('/api/sales/:id/unsettle', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE sales SET is_settled = false, settled_at = NULL, amount_paid = 0, change = 0, settled_method = NULL
     WHERE id = $1 AND payment_method = 'Pay Later' AND is_settled = true`,
    [req.params.id]
  );
  if (!rowCount) await explainSettleMiss(req.params.id, false);
  res.json(await loadSale(pool, req.params.id));
}));

// ---------- settings (only the keys the app uses) ----------
function settingKey(req) {
  if (!SETTING_KEYS.includes(req.params.key)) throw new HttpError(404, 'Unknown setting.');
  return req.params.key;
}

app.get('/api/settings/:key', asyncRoute(async (req, res) => {
  const key = settingKey(req);
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  res.json({ key, value: rows[0] ? rows[0].value : null });
}));

app.put('/api/settings/:key', asyncRoute(async (req, res) => {
  const key = settingKey(req);
  const value = (req.body || {}).value;
  const stored = key === 'gcash_qr' ? image(value == null ? '' : value) : String(value == null ? '' : value);
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, stored]
  );
  res.json({ ok: true });
}));

// ---------- id allocation (safe under concurrent requests) ----------
async function nextSeq(db, key) {
  const { rows } = await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = (settings.value::int + 1)::text
     RETURNING value`,
    [key]
  );
  return parseInt(rows[0].value, 10);
}
const allocateItemId = async () => nextItemId(await nextSeq(pool, 'item_seq'));
const allocateSaleId = async (client) => nextSaleId(await nextSeq(client, 'sale_seq'));

// Unknown API routes get JSON; any other GET serves the app.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Malformed or oversized request bodies: short JSON errors, no stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large. Use a smaller photo.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

initSchema()
  .then(() => app.listen(PORT, () => console.log(`TinDARhan POS server running on port ${PORT}`)))
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });

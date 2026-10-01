/**
 * db.js
 * PostgreSQL pool, schema (with in-place migrations for older databases)
 * and first-run seed data. DATABASE_URL comes from the environment;
 * Railway sets it when a PostgreSQL service is attached.
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('\n[FATAL] DATABASE_URL is not set.');
  console.error('On Railway: open your project -> "New" -> "Database" -> "Add PostgreSQL".');
  console.error('Railway will inject DATABASE_URL into this service automatically once');
  console.error('the Postgres service and this app are in the same project.\n');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  farm             TEXT DEFAULT '',
  image            TEXT DEFAULT '',
  price            NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock            INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  date_added       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration for databases created before the "farm" column existed.
ALTER TABLE items ADD COLUMN IF NOT EXISTS farm TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS sales (
  id               TEXT PRIMARY KEY,
  datetime         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cashier          TEXT NOT NULL DEFAULT 'Unassigned',
  payment_method   TEXT NOT NULL DEFAULT 'Cash',
  customer_name    TEXT DEFAULT '',
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  change            NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_settled       BOOLEAN NOT NULL DEFAULT true,
  settled_at       TIMESTAMPTZ
);

-- Migration: settlement tracking. Existing Pay Later sales stay unpaid.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_settled BOOLEAN;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
UPDATE sales SET is_settled = (payment_method <> 'Pay Later') WHERE is_settled IS NULL;
ALTER TABLE sales ALTER COLUMN is_settled SET DEFAULT true;
ALTER TABLE sales ALTER COLUMN is_settled SET NOT NULL;

-- Migration: how a Pay Later balance was paid ('Cash' / 'GCash').
-- NULL = still unpaid, or paid before this column existed.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_method TEXT;

-- Migration for databases created before "customer_name" (Pay Later) existed.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS sale_items (
  id               SERIAL PRIMARY KEY,
  sale_id          TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id          TEXT,
  name             TEXT NOT NULL,
  price            NUMERIC(12,2) NOT NULL,
  qty              INTEGER NOT NULL,
  subtotal         NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  username         TEXT PRIMARY KEY,
  password_hash    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key              TEXT PRIMARY KEY,
  value            TEXT
);

-- Login sessions (token issued by /api/login, sent as a Bearer token).
CREATE TABLE IF NOT EXISTS sessions (
  token            TEXT PRIMARY KEY,
  username         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_datetime ON sales(datetime);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_items_date_added ON items(date_added);
`;

const SEED_ITEMS = [
  ['Banana Chips', 'Lipa ARBO Producers', 60, 40, 10],
  ['Rice Chips (Ampao)', 'Malvar Farmers ARBO', 55, 35, 10],
  ['Boiled Peanuts', 'Sto. Tomas Growers ARBO', 45, 30, 8],
  ['Calamansi Juice Concentrate', 'Rosario Citrus ARBO', 90, 25, 5],
  ['Batangas Kapeng Barako', 'Lipa Barako Growers ARBO', 150, 20, 5],
  ['Pure Honey (Bottle)', 'Ibaan Beekeepers ARBO', 180, 18, 4],
  ['Turmeric Powder (Dilaw)', 'San Jose Herb Growers ARBO', 70, 22, 5],
  ['Spiced Vinegar', 'Taal Food Processors ARBO', 65, 28, 6],
  ['Batangas Lambanog', 'Lian Coconut Farmers ARBO', 220, 15, 3],
  ['Coco Jam (Minatamis)', 'Lian Coconut Farmers ARBO', 95, 20, 5],
  ['Bagoong / Sardines Pack', 'Nasugbu Fisherfolk ARBO', 85, 24, 6],
  ['Woven Souvenir Item', 'Padre Garcia Weavers ARBO', 120, 12, 3],
];

function nextItemId(seq) {
  return 'ITM' + String(seq).padStart(4, '0');
}
function nextSaleId(seq) {
  return 'SALE' + String(seq).padStart(5, '0');
}

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);

    // First run only: create the shop login. Set ADMIN_PASSWORD to choose
    // the first password; otherwise the documented default is used and
    // should be changed right away (sidebar > Change password).
    const { rows: userRows } = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (userRows[0].n === 0) {
      const initial = process.env.ADMIN_PASSWORD || 'TINDAHAN';
      const hash = await bcrypt.hash(initial, 10);
      await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        ['DAR', hash]
      );
      console.log('Created login user "DAR".' + (process.env.ADMIN_PASSWORD ? '' : ' Change the default password after logging in.'));
    }

    // Seed sample inventory only if the table is empty.
    const { rows: itemRows } = await client.query('SELECT COUNT(*)::int AS n FROM items');
    if (itemRows[0].n === 0) {
      let seq = 1;
      for (const [name, farm, price, stock, low] of SEED_ITEMS) {
        const id = nextItemId(seq++);
        await client.query(
          `INSERT INTO items (id, name, farm, image, price, stock, low_stock_threshold, date_added)
           VALUES ($1, $2, $3, '', $4, $5, $6, now())`,
          [id, name, farm, price, stock, low]
        );
      }
      // Keep the item id counter in step with the seeded ids.
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('item_seq', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(SEED_ITEMS.length)]
      );
      console.log(`Seeded ${SEED_ITEMS.length} starter inventory items.`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema, nextItemId, nextSaleId };

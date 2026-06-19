const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DB_CONFIG = {
  host: process.env.TIDB_HOST || 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: parseInt(process.env.TIDB_PORT || '4000'),
  user: process.env.TIDB_USER || '4EbcSLv9fU1Latq.root',
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'generator_billing',
  ssl: { rejectUnauthorized: true },
};

let pool;

async function getPool() {
  if (!pool) {
    pool = await mysql.createPool(DB_CONFIG);
  }
  return pool;
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const db = await getPool();
    const [existing] = await db.query('SELECT phone FROM registered_users WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.json({ success: false, error: 'هذا الرقم مسجل بالفعل' });
    }
    await db.query('INSERT INTO registered_users (phone, password_hash) VALUES (?, ?)', [phone, password]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { phone } = req.body;
    const db = await getPool();
    const [rows] = await db.query('SELECT phone, password_hash FROM registered_users WHERE phone = ?', [phone]);
    if (rows.length === 0) {
      return res.json({ success: false, error: 'الرقم غير مسجل' });
    }
    res.json({ success: true, user: { phone: rows[0].phone, password_hash: rows[0].password_hash } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update password
app.put('/api/password', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const db = await getPool();
    await db.query('UPDATE registered_users SET password_hash = ? WHERE phone = ?', [password, phone]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get all registered users (for worker login lookup)
app.get('/api/users', async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.query('SELECT phone FROM registered_users');
    res.json({ success: true, users: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Load user data by key
app.get('/api/data/:phone/:key', async (req, res) => {
  try {
    const { phone, key } = req.params;
    const db = await getPool();
    const [rows] = await db.query('SELECT data_value FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
    if (rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: JSON.parse(rows[0].data_value) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Save user data by key (upsert)
app.put('/api/data/:phone/:key', async (req, res) => {
  try {
    const { phone, key } = req.params;
    const { data } = req.body;
    const db = await getPool();
    const jsonStr = JSON.stringify(data);
    await db.query(
      'INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)',
      [phone, key, jsonStr]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Delete user data by key
app.delete('/api/data/:phone/:key', async (req, res) => {
  try {
    const { phone, key } = req.params;
    const db = await getPool();
    await db.query('DELETE FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

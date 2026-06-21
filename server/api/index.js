const mysql = require('mysql2/promise');

const TIDB_CONFIG = {
  host: process.env.TIDB_HOST || 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: parseInt(process.env.TIDB_PORT || '4000'),
  user: process.env.TIDB_USER || '4EbcSLv9fU1Latq.root',
  password: process.env.TIDB_PASSWORD || '5AK0LTMLL3YDw9GF',
  database: process.env.TIDB_DATABASE || 'generator_billing',
  ssl: { rejectUnauthorized: true },
  connectionTimeout: 10000,
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...TIDB_CONFIG,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
    await initDB();
  }
  return pool;
}

async function initDB() {
  const p = await getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      filename VARCHAR(255) PRIMARY KEY,
      data_value JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      phone VARCHAR(20) NOT NULL,
      data_key VARCHAR(100) NOT NULL,
      data_value JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (phone, data_key)
    )
  `);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeaders(corsHeaders()).end();
  }

  try {
    const pool = await getPool();

    if (req.method === 'GET') {
      const { phone, key, filename, table } = req.query;

      if (table === 'app_data' || filename) {
        if (!filename) {
          const [rows] = await pool.query('SELECT * FROM app_data');
          return res.status(200).setHeaders(corsHeaders()).json(rows);
        }
        const [rows] = await pool.query('SELECT * FROM app_data WHERE filename = ?', [filename]);
        return res.status(200).setHeaders(corsHeaders()).json(rows);
      }

      if (phone && key) {
        const [rows] = await pool.query('SELECT * FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
        return res.status(200).setHeaders(corsHeaders()).json(rows);
      }

      if (phone) {
        const [rows] = await pool.query('SELECT * FROM user_data WHERE phone = ?', [phone]);
        return res.status(200).setHeaders(corsHeaders()).json(rows);
      }

      return res.status(400).setHeaders(corsHeaders()).json({ error: 'Missing parameters' });
    }

    if (req.method === 'POST') {
      const body = req.body;

      if (body._table === 'app_data') {
        const { filename, data_value } = body;
        if (!filename) return res.status(400).setHeaders(corsHeaders()).json({ error: 'Missing filename' });
        await pool.query(
          'INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)',
          [filename, JSON.stringify(data_value)]
        );
        return res.status(200).setHeaders(corsHeaders()).json({ ok: true });
      }

      if (body._table === 'user_data') {
        const { phone, data_key, data_value } = body;
        if (!phone || !data_key) return res.status(400).setHeaders(corsHeaders()).json({ error: 'Missing phone or key' });
        await pool.query(
          'INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)',
          [phone, data_key, JSON.stringify(data_value)]
        );
        return res.status(200).setHeaders(corsHeaders()).json({ ok: true });
      }

      if (body._action === 'init') {
        await initDB();
        return res.status(200).setHeaders(corsHeaders()).json({ ok: true, message: 'Tables initialized' });
      }

      return res.status(400).setHeaders(corsHeaders()).json({ error: 'Invalid request' });
    }

    if (req.method === 'DELETE') {
      const { filename, phone, key } = req.query;

      if (filename) {
        await pool.query('DELETE FROM app_data WHERE filename = ?', [filename]);
        return res.status(200).setHeaders(corsHeaders()).json({ ok: true });
      }

      if (phone && key) {
        await pool.query('DELETE FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
        return res.status(200).setHeaders(corsHeaders()).json({ ok: true });
      }

      return res.status(400).setHeaders(corsHeaders()).json({ error: 'Missing parameters' });
    }

    return res.status(405).setHeaders(corsHeaders()).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).setHeaders(corsHeaders()).json({ error: err.message });
  }
};

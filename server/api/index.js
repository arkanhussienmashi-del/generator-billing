const mysql = require('mysql2/promise');

let pool = null;

async function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '4EbcSLv9fU1Latq.root',
    password: '5AK0LTMLL3YDw9GF',
    database: 'generator_billing',
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
  });
  return pool;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const p = await getPool();

    if (req.method === 'GET') {
      const { phone, key, filename, table } = req.query;

      if (table === 'app_data' || filename) {
        if (!filename) {
          const [rows] = await p.query('SELECT * FROM app_data');
          return res.status(200).json(rows);
        }
        const [rows] = await p.query('SELECT * FROM app_data WHERE filename = ?', [filename]);
        return res.status(200).json(rows);
      }

      if (phone && key) {
        const [rows] = await p.query('SELECT * FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
        return res.status(200).json(rows);
      }

      if (phone) {
        const [rows] = await p.query('SELECT * FROM user_data WHERE phone = ?', [phone]);
        return res.status(200).json(rows);
      }

      return res.status(400).json({ error: 'Missing params' });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);

      if (body._table === 'app_data') {
        await p.query('INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', [body.filename, JSON.stringify(body.data_value)]);
        return res.status(200).json({ ok: true });
      }

      if (body._table === 'user_data') {
        await p.query('INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', [body.phone, body.data_key, JSON.stringify(body.data_value)]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Invalid body' });
    }

    if (req.method === 'DELETE') {
      const { filename, phone, key } = req.query;
      if (filename) {
        await p.query('DELETE FROM app_data WHERE filename = ?', [filename]);
        return res.status(200).json({ ok: true });
      }
      if (phone && key) {
        await p.query('DELETE FROM user_data WHERE phone = ? AND data_key = ?', [phone, key]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Missing params' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

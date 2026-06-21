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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);

      if (body._action === 'updateRegisteredUser') {
        const { oldPhone, newPhone, newOwnerCode, newPassword } = body;
        if (!oldPhone) return res.status(400).json({ error: 'Missing oldPhone' });

        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length === 0) return res.status(404).json({ error: 'No users found' });

        let val = appRows[0].data_value;
        if (typeof val === 'string') val = JSON.parse(val);

        const users = Array.isArray(val) ? val : [];
        const idx = users.findIndex(u => u.phone === oldPhone);
        if (idx === -1) return res.status(404).json({ error: 'User not found' });

        if (newPhone && newPhone !== oldPhone) {
          const exists = users.find(u => u.phone === newPhone);
          if (exists) return res.status(400).json({ error: 'Phone already exists' });

          await p.query('UPDATE user_data SET phone = ? WHERE phone = ?', [newPhone, oldPhone]);
          users[idx].phone = newPhone;
        }

        if (newOwnerCode !== undefined) users[idx].ownerCode = newOwnerCode;
        if (newPassword) {
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256').update((newPhone || oldPhone) + newPassword.trim()).digest('hex');
          users[idx].password = hash;
        }

        await p.query('INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', ['registered_users', JSON.stringify(users)]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Invalid PUT' });
    }

    if (req.method === 'DELETE') {
      const { filename, phone, key, _action } = req.query;
      const body = req.body;

      if (_action === 'deleteUser' && body && body.phone) {
        const targetPhone = body.phone;
        await p.query('DELETE FROM user_data WHERE phone = ?', [targetPhone]);

        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length > 0) {
          let val = appRows[0].data_value;
          if (typeof val === 'string') val = JSON.parse(val);
          const users = Array.isArray(val) ? val.filter(u => u.phone !== targetPhone) : [];
          await p.query('INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', ['registered_users', JSON.stringify(users)]);
        }
        return res.status(200).json({ ok: true });
      }

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

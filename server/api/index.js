const mysql = require('mysql2/promise');
const crypto = require('crypto');

const PBKDF2_ITERATIONS = 10;
const ADMIN_PASSWORD = 'admin@billing2026';
const ADMIN_SECRET = 'genBillingAdmin' + 'Secret' + '2026';
const ADMIN_TOKEN_EXPIRY_HOURS = 24;

function pbkdf2HashSync(password, salt) {
  let hash = crypto.createHash('sha256').update(salt + ':' + password.trim()).digest('hex');
  for (let i = 0; i < PBKDF2_ITERATIONS; i++) {
    hash = crypto.createHash('sha256').update(hash + ':' + salt + ':' + i).digest('hex');
  }
  return hash;
}

function verifyAdminPassword(password) {
  return password === ADMIN_PASSWORD;
}

function signAdminToken(password) {
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const data = password + '.' + expiry;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('hex');
  return expiry + '.' + sig;
}

function verifyAdminToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length < 2) return false;
  const expiry = parseInt(parts[0]);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(ADMIN_PASSWORD + '.' + expiry).digest('hex');
  return sig === parts[1];
}

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
      const { phone, key, filename, table, _ping } = req.query;

      if (_ping === '1') {
        return res.status(200).json({ ok: true, time: new Date().toISOString() });
      }

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
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }

      if (body._action === 'adminLogin') {
        console.log('Admin login attempt');
        if (!verifyAdminPassword(body.password)) {
          console.log('Admin password rejected');
          return res.status(401).json({ error: 'Invalid admin password' });
        }
        console.log('Admin password accepted');
        const token = signAdminToken(body.password);
        return res.status(200).json({ ok: true, token });
      }

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
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }

      if (!verifyAdminToken(body._adminToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (body._action === 'updateRegisteredUser') {
        const { oldPhone, newPhone, newOwnerCode, newPassword } = body;
        if (!oldPhone) return res.status(400).json({ error: 'Missing oldPhone' });

        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length === 0) return res.status(404).json({ error: 'No users found' });

        let val = appRows[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = []; } }

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
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = pbkdf2HashSync(newPassword, salt);
          users[idx].password = 'pbkdf2:' + salt + ':' + hash;
        }

        await p.query('INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', ['registered_users', JSON.stringify(users)]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Invalid PUT' });
    }

    if (req.method === 'DELETE') {
      const { filename, phone, key, _action, _adminToken } = req.query;

      if (_action === 'deleteUser') {
        if (!_adminToken || !verifyAdminToken(_adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!phone) {
          return res.status(400).json({ error: 'Missing phone' });
        }
        const targetPhone = phone;
        await p.query('DELETE FROM user_data WHERE phone = ?', [targetPhone]);

        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length > 0) {
          let val = appRows[0].data_value;
          if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = []; } }
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

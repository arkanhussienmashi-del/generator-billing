const mysql = require('mysql2/promise');
const crypto = require('crypto');

const PBKDF2_ITERATIONS = 10;
const ADMIN_PASSWORD = 'admin@billing2026';
const ADMIN_SECRET = 'genBillingAdmin' + 'Secret' + '2026';
const ADMIN_TOKEN_EXPIRY_HOURS = 24;

const JWT_SECRET = process.env.JWT_SECRET || 'mowledyJwtSecret2026Key';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'otp_verification';
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT_MAX = 3;
const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const OTP_MIN_INTERVAL_MS = 60 * 1000;

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

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signJWT(payload) {
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  const data = JSON.stringify({ ...payload, exp: expiry });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + sig;
}

function verifyJWT(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const data = Buffer.from(parts[0], 'base64').toString('utf-8');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('hex');
    if (sig !== parts[1]) return null;
    const payload = JSON.parse(data);
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

async function sendWhatsAppOTP(phone, otp) {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.log('WhatsApp not configured, OTP: ' + otp + ' for phone: ' + phone);
    return { ok: true, simulated: true };
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: WHATSAPP_TEMPLATE_NAME,
          language: { code: 'ar' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: otp }],
            },
          ],
        },
      }),
    });
    const result = await response.json();
    if (result.messages) return { ok: true };
    console.error('WhatsApp API error:', result);
    return { ok: false, error: result };
  } catch (e) {
    console.error('WhatsApp send error:', e);
    return { ok: false, error: e.message };
  }
}

async function ensureOTPTable(p) {
  await p.query(`CREATE TABLE IF NOT EXISTS otp_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    otp VARCHAR(6) NOT NULL,
    purpose VARCHAR(20) DEFAULT 'login',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    attempts INT DEFAULT 0,
    request_count INT DEFAULT 0,
    window_start TIMESTAMP NULL,
    last_request_at TIMESTAMP NULL,
    verified TINYINT(1) DEFAULT 0,
    INDEX idx_phone_purpose (phone_number, purpose)
  )`);
}

async function checkOTPRateLimit(p, phone) {
  await ensureOTPTable(p);
  const [rows] = await p.query(
    'SELECT request_count, window_start, last_request_at FROM otp_codes WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1',
    [phone]
  );
  if (rows.length > 0) {
    const row = rows[0];
    const now = new Date();
    if (row.window_start) {
      const windowStart = new Date(row.window_start);
      if (now - windowStart < OTP_RATE_LIMIT_WINDOW_MS) {
        if (row.request_count >= OTP_RATE_LIMIT_MAX) {
          const waitMin = Math.ceil((OTP_RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 60000);
          return { allowed: false, reason: `تم تجاوز الحد الأقصى للطلبات. حاول بعد ${waitMin} دقيقة` };
        }
      }
    }
    if (row.last_request_at) {
      const lastReq = new Date(row.last_request_at);
      if (now - lastReq < OTP_MIN_INTERVAL_MS) {
        const waitSec = Math.ceil((OTP_MIN_INTERVAL_MS - (now - lastReq)) / 1000);
        return { allowed: false, reason: `انتظر ${waitSec} ثانية بين كل طلب` };
      }
    }
  }
  return { allowed: true };
}

async function createOTP(p, phone, purpose) {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const now = new Date();
  await p.query(
    'INSERT INTO otp_codes (phone_number, otp, purpose, expires_at, request_count, window_start, last_request_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [phone, otp, purpose, expiresAt, now, now]
  );
  return otp;
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

      if (body._action === 'adminGetAllOwners') {
        if (!verifyAdminToken(body._adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length === 0) return res.status(200).json({ owners: [] });

        let val = appRows[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = []; } }
        const users = Array.isArray(val) ? val : [];

        const owners = [];
        for (const user of users) {
          const phone = user.phone;
          const [workerRows] = await p.query("SELECT data_key, data_value FROM user_data WHERE phone = ? AND data_key = 'workers'", [phone]);
          let workers = [];
          if (workerRows.length > 0) {
            try {
              const wv = typeof workerRows[0].data_value === 'string' ? JSON.parse(workerRows[0].data_value) : workerRows[0].data_value;
              workers = Array.isArray(wv) ? wv : [];
            } catch (e) { workers = []; }
          }

          const [subRows] = await p.query("SELECT data_key, data_value FROM user_data WHERE phone = ? AND data_key = 'subscribers'", [phone]);
          let subscriberCount = 0;
          if (subRows.length > 0) {
            try {
              const sv = typeof subRows[0].data_value === 'string' ? JSON.parse(subRows[0].data_value) : subRows[0].data_value;
              subscriberCount = Array.isArray(sv) ? sv.length : 0;
            } catch (e) { subscriberCount = 0; }
          }

          const [nameRows] = await p.query("SELECT data_key, data_value FROM user_data WHERE phone = ? AND data_key = 'ownerName'", [phone]);
          let ownerName = '';
          if (nameRows.length > 0) {
            try {
              ownerName = typeof nameRows[0].data_value === 'string' ? JSON.parse(nameRows[0].data_value) : nameRows[0].data_value;
            } catch (e) { ownerName = nameRows[0].data_value || ''; }
          }

          owners.push({
            phone,
            ownerName: ownerName || '',
            ownerCode: user.ownerCode || '',
            workerCount: workers.length,
            subscriberCount,
            workers: workers.map(w => ({ name: w.name || '', code: w.code || '', pin: w.plainPin || '', generatorId: w.generatorId || '' })),
          });
        }

        return res.status(200).json({ owners });
      }

      if (body._action === 'checkSubscription') {
        const { phone } = body;
        if (!phone) return res.status(400).json({ error: 'Missing phone' });
        const [rows] = await p.query("SELECT data_value FROM user_data WHERE phone = ? AND data_key = 'subscription'", [phone]);
        if (rows.length === 0) {
          const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const subData = { status: 'trial', trial_ends_at: trialEnds, subscription_ends_at: null, created_at: new Date().toISOString() };
          await p.query('INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', [phone, 'subscription', JSON.stringify(subData)]);
          return res.status(200).json({ status: 'trial', daysLeft: 30, trial_ends_at: trialEnds, subscription_ends_at: null });
        }
        let val = rows[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = {}; } }
        const now = new Date();
        if (now < new Date(val.trial_ends_at)) {
          return res.status(200).json({ status: 'trial', daysLeft: Math.ceil((new Date(val.trial_ends_at) - now) / 86400000), trial_ends_at: val.trial_ends_at, subscription_ends_at: val.subscription_ends_at });
        }
        if (val.subscription_ends_at && now < new Date(val.subscription_ends_at)) {
          return res.status(200).json({ status: 'active', daysLeft: Math.ceil((new Date(val.subscription_ends_at) - now) / 86400000), trial_ends_at: val.trial_ends_at, subscription_ends_at: val.subscription_ends_at });
        }
        return res.status(200).json({ status: 'expired', daysLeft: 0, trial_ends_at: val.trial_ends_at, subscription_ends_at: val.subscription_ends_at });
      }

      if (body._action === 'activateSubscription') {
        if (!verifyAdminToken(body._adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const { phone } = body;
        if (!phone) return res.status(400).json({ error: 'Missing phone' });
        const subEnds = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
        const [rows] = await p.query("SELECT data_value FROM user_data WHERE phone = ? AND data_key = 'subscription'", [phone]);
        let subData;
        if (rows.length === 0) {
          subData = { status: 'active', trial_ends_at: new Date().toISOString(), subscription_ends_at: subEnds, created_at: new Date().toISOString() };
        } else {
          let val = rows[0].data_value;
          if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = {}; } }
          subData = { ...val, status: 'active', subscription_ends_at: subEnds };
        }
        await p.query('INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', [phone, 'subscription', JSON.stringify(subData)]);
        return res.status(200).json({ ok: true, subscription_ends_at: subEnds });
      }

      if (body._action === 'adminGetAllSubscriptions') {
        if (!verifyAdminToken(body._adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const [appRows] = await p.query('SELECT * FROM app_data WHERE filename = ?', ['registered_users']);
        if (appRows.length === 0) return res.status(200).json({ subscriptions: [] });
        let val = appRows[0].data_value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = []; } }
        const users = Array.isArray(val) ? val : [];
        const subscriptions = [];
        for (const user of users) {
          const phone = user.phone;
          const [subRows] = await p.query("SELECT data_value FROM user_data WHERE phone = ? AND data_key = 'subscription'", [phone]);
          let subData = { status: 'trial', trial_ends_at: null, subscription_ends_at: null, created_at: null };
          if (subRows.length > 0) {
            let sv = subRows[0].data_value;
            if (typeof sv === 'string') { try { sv = JSON.parse(sv); } catch (e) { sv = {}; } }
            subData = sv;
          }
          const now = new Date();
          let computedStatus = subData.status || 'trial';
          if (subData.trial_ends_at && now > new Date(subData.trial_ends_at)) {
            if (subData.subscription_ends_at && now < new Date(subData.subscription_ends_at)) {
              computedStatus = 'active';
            } else {
              computedStatus = 'expired';
            }
          }
          subscriptions.push({
            phone,
            ownerName: user.ownerName || '',
            status: computedStatus,
            trial_ends_at: subData.trial_ends_at,
            subscription_ends_at: subData.subscription_ends_at,
            created_at: subData.created_at,
          });
        }
        return res.status(200).json({ subscriptions });
      }

      if (body._action === 'generateActivationCode') {
        if (!verifyAdminToken(body._adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        const { phone } = body;
        if (!phone) return res.status(400).json({ error: 'Missing phone' });
        const code = 'MWD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const duration = req.body.durationDays || 180;
        await p.query('CREATE TABLE IF NOT EXISTS activation_codes (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, phone VARCHAR(20) NOT NULL, duration_days INTEGER DEFAULT 180, used TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await p.query('ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT 180').catch(function() {});
        await p.query('INSERT INTO activation_codes (code, phone, duration_days) VALUES (?, ?, ?)', [code, phone, duration]);
        return res.status(200).json({ ok: true, code });
      }

      if (body._action === 'redeemActivationCode') {
        const { phone, code } = body;
        if (!phone || !code) return res.status(400).json({ error: 'Missing phone or code' });
        await p.query('CREATE TABLE IF NOT EXISTS activation_codes (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, phone VARCHAR(20) NOT NULL, duration_days INTEGER DEFAULT 180, used TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await p.query('ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT 180').catch(function() {});
        const [rows] = await p.query('SELECT * FROM activation_codes WHERE code = ? AND phone = ? AND used = 0', [code, phone]);
        if (rows.length === 0) {
          return res.status(400).json({ error: 'الكود غير صحيح أو مستخدم بالفعل' });
        }
        await p.query('UPDATE activation_codes SET used = 1 WHERE code = ?', [code]);
        const durationDays = rows[0].duration_days || 180;
        const subEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
        const [subRows] = await p.query("SELECT data_value FROM user_data WHERE phone = ? AND data_key = 'subscription'", [phone]);
        let subData;
        if (subRows.length === 0) {
          subData = { status: 'active', trial_ends_at: new Date().toISOString(), subscription_ends_at: subEnds, created_at: new Date().toISOString() };
        } else {
          let val = subRows[0].data_value;
          if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { val = {}; } }
          const now = new Date();
          const currentEnd = val.subscription_ends_at ? new Date(val.subscription_ends_at) : now;
          const extDays = durationDays * 24 * 60 * 60 * 1000;
          const newEnd = currentEnd > now ? new Date(currentEnd.getTime() + extDays) : new Date(Date.now() + extDays);
          subData = { ...val, status: 'active', subscription_ends_at: newEnd.toISOString() };
        }
        await p.query('INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)', [phone, 'subscription', JSON.stringify(subData)]);
        return res.status(200).json({ ok: true, subscription_ends_at: subData.subscription_ends_at });
      }

      if (body._action === 'getActivationCodes') {
        if (!verifyAdminToken(body._adminToken)) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        await p.query('CREATE TABLE IF NOT EXISTS activation_codes (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, phone VARCHAR(20) NOT NULL, duration_days INTEGER DEFAULT 180, used TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        const { phone } = body;
        let q = 'SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT 50';
        let params = [];
        if (phone) { q = 'SELECT * FROM activation_codes WHERE phone = ? ORDER BY created_at DESC'; params = [phone]; }
        const [rows] = await p.query(q, params);
        return res.status(200).json({ codes: rows });
      }

      if (body._action === 'sendOtp') {
        const { phone, purpose } = body;
        if (!phone) return res.status(400).json({ error: 'Missing phone' });
        const otpPurpose = purpose || 'login';
        const rateCheck = await checkOTPRateLimit(p, phone);
        if (!rateCheck.allowed) {
          return res.status(429).json({ error: rateCheck.reason });
        }
        const otp = await createOTP(p, phone, otpPurpose);
        const whatsappResult = await sendWhatsAppOTP(phone, otp);
        return res.status(200).json({ ok: true, otp: whatsappResult.simulated ? otp : undefined });
      }

      if (body._action === 'verifyOtp') {
        const { phone, otp, purpose } = body;
        if (!phone || !otp) return res.status(400).json({ error: 'Missing phone or otp' });
        await ensureOTPTable(p);
        const otpPurpose = purpose || 'login';
        const [rows] = await p.query(
          'SELECT * FROM otp_codes WHERE phone_number = ? AND purpose = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1',
          [phone, otpPurpose]
        );
        if (rows.length === 0) {
          return res.status(400).json({ error: 'لا يوجد رمز تحقق صالح' });
        }
        const otpRow = rows[0];
        const now = new Date();
        if (now > new Date(otpRow.expires_at)) {
          return res.status(400).json({ error: 'انتهت صلاحية الرمز' });
        }
        if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
          return res.status(400).json({ error: 'تم تجاوز الحد الأقصى للمحاولات' });
        }
        if (otpRow.otp !== otp) {
          await p.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
          const remaining = OTP_MAX_ATTEMPTS - (otpRow.attempts + 1);
          return res.status(400).json({ error: `الرمز غير صحيح. متبقي ${remaining} محاولة` });
        }
        await p.query('UPDATE otp_codes SET verified = 1 WHERE id = ?', [otpRow.id]);
        const jwtToken = signJWT({ phone, purpose: otpPurpose });
        return res.status(200).json({ ok: true, token: jwtToken });
      }

      if (body._action === 'verifySession') {
        const token = body.token || '';
        const payload = verifyJWT(token);
        if (!payload) {
          return res.status(401).json({ error: 'Invalid session' });
        }
        return res.status(200).json({ ok: true, phone: payload.phone });
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

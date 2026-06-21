const mysql = require('mysql2/promise');

const TIDB_CONFIG = {
  host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '4EbcSLv9fU1Latq.root',
  password: '5AK0LTMLL3YDw9GF',
  database: 'generator_billing',
  ssl: { rejectUnauthorized: true },
  connectionTimeout: 10000,
};

const SUPABASE_URL = 'https://xisrouirxhvbkwvwfvkx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhpc3JvdWlyeGh2Ymt3dndmdmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODg1MzcsImV4cCI6MjA5NzQ2NDUzN30.jts63Wqick77MaAJFHHdyuaMqWkPMFXxPqIpfUV9frE';

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + path, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    },
  });
  if (!r.ok) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function migrate() {
  console.log('Connecting to TiDB...');
  const pool = mysql.createPool({ ...TIDB_CONFIG, connectionLimit: 5 });

  console.log('Creating tables...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      filename VARCHAR(255) PRIMARY KEY,
      data_value JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      phone VARCHAR(20) NOT NULL,
      data_key VARCHAR(100) NOT NULL,
      data_value JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (phone, data_key)
    )
  `);

  console.log('Migrating app_data...');
  const appData = await sbGet('/rest/v1/app_data?select=*');
  if (Array.isArray(appData)) {
    for (const row of appData) {
      let val = row.data_value;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
      await pool.query(
        'INSERT INTO app_data (filename, data_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)',
        [row.filename, JSON.stringify(val)]
      );
      console.log('  app_data: ' + row.filename);
    }
  }

  console.log('Migrating user_data...');
  const userData = await sbGet('/rest/v1/user_data?select=*');
  if (Array.isArray(userData)) {
    let count = 0;
    for (const row of userData) {
      let val = row.data_value;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
      await pool.query(
        'INSERT INTO user_data (phone, data_key, data_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data_value = VALUES(data_value)',
        [row.phone, row.data_key, JSON.stringify(val)]
      );
      count++;
      if (count % 50 === 0) console.log('  user_data: ' + count + ' rows...');
    }
    console.log('  user_data: ' + count + ' total rows');
  }

  console.log('Migration complete!');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

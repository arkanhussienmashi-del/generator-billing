const mysql = require('mysql2/promise');

async function initDB() {
  const conn = await mysql.createConnection({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '4EbcSLv9fU1Latq.root',
    password: '5AK0LTMLL3YDw9GF',
    ssl: { rejectUnauthorized: true },
  });

  console.log('Connected to TiDB Cloud');

  await conn.query('CREATE DATABASE IF NOT EXISTS generator_billing');
  console.log('Database created');

  await conn.query('USE generator_billing');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS registered_users (
      phone VARCHAR(20) PRIMARY KEY,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('Table registered_users created');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      data_key VARCHAR(100) NOT NULL,
      data_value LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_phone_key (phone, data_key),
      INDEX idx_phone (phone)
    )
  `);
  console.log('Table user_data created');

  await conn.end();
  console.log('Done!');
}

initDB().catch(e => { console.error(e); process.exit(1); });

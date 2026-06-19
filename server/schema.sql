CREATE DATABASE IF NOT EXISTS generator_billing;
USE generator_billing;

CREATE TABLE IF NOT EXISTS registered_users (
  phone VARCHAR(20) PRIMARY KEY,
  password_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  data_key VARCHAR(100) NOT NULL,
  data_value LONGTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_phone_key (phone, data_key),
  INDEX idx_phone (phone)
);

CREATE DATABASE IF NOT EXISTS xiaoyuanfangke
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE xiaoyuanfangke;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  role ENUM('ADMIN', 'SECURITY', 'DEPARTMENT') NOT NULL,
  department_id BIGINT NULL,
  department_name VARCHAR(100) NULL,
  can_approve TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_department (department_id)
);

CREATE TABLE IF NOT EXISTS visitor_applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(64) NOT NULL UNIQUE,
  department_id BIGINT NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  applicant_name VARCHAR(50) NOT NULL,
  applicant_phone VARCHAR(30) NOT NULL,
  visitor_name VARCHAR(50) NOT NULL,
  visitor_gender VARCHAR(10) NOT NULL,
  visitor_phone VARCHAR(30) NOT NULL,
  license_plate VARCHAR(30),
  reason VARCHAR(500) NOT NULL,
  visit_start DATETIME NOT NULL,
  visit_end DATETIME NOT NULL,
  requires_department_approval TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('DEPT_PENDING', 'SECURITY_PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SECURITY_PENDING',
  reject_reason VARCHAR(500),
  department_approver_id BIGINT,
  department_approver_name VARCHAR(50),
  department_approved_at DATETIME,
  security_approver_id BIGINT,
  security_approver_name VARCHAR(50),
  security_approved_at DATETIME,
  approver_id BIGINT,
  approver_name VARCHAR(50),
  approved_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_time (status, visit_end),
  INDEX idx_department_status (department_id, status),
  INDEX idx_token (token)
);

const path = require('path');
const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const mysql = require('mysql2/promise');

require('dotenv/config');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_NAME = process.env.DB_NAME || 'xiaoyuanfangke';

let pool;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'xiaoyuanfangke-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.dayjs = dayjs;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'ADMIN') {
    flash(req, 'error', '需要管理员权限');
    return res.redirect('/dashboard');
  }
  next();
}

function canApprove(req, res, next) {
  if (!req.session.user || !['ADMIN', 'SECURITY'].includes(req.session.user.role)) {
    flash(req, 'error', '需要审批权限');
    return res.redirect('/login');
  }
  next();
}

async function initDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    multipleStatements: true
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();

  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      real_name VARCHAR(50) NOT NULL,
      role ENUM('ADMIN', 'SECURITY') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
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
      status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
      reject_reason VARCHAR(500),
      approver_id BIGINT,
      approver_name VARCHAR(50),
      approved_at DATETIME,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status_time (status, visit_end),
      INDEX idx_token (token),
      CONSTRAINT fk_application_department FOREIGN KEY (department_id) REFERENCES departments(id)
    )
  `);

  const [[deptCount]] = await pool.query('SELECT COUNT(*) AS count FROM departments');
  if (deptCount.count === 0) {
    await pool.query('INSERT INTO departments (name) VALUES ?', [[
      ['校办公室'],
      ['教务处'],
      ['学生处'],
      ['信息中心'],
      ['后勤处'],
      ['保卫处']
    ]]);
  }

  await ensureUser('admin', 'admin123', '系统管理员', 'ADMIN');
  await ensureUser('security', 'security123', '保卫负责人', 'SECURITY');
}

async function ensureUser(username, password, realName, role) {
  const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, real_name, role) VALUES (?, ?, ?, ?)',
      [username, passwordHash, realName, role]
    );
  }
}

function normalizeDateTime(value) {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

async function applicationByToken(token) {
  const [[application]] = await pool.query('SELECT * FROM visitor_applications WHERE token = ?', [token]);
  return application;
}

app.get('/', async (req, res) => {
  const [departments] = await pool.query('SELECT * FROM departments WHERE enabled = 1 ORDER BY id ASC');
  res.render('apply', { departments, form: {} });
});

app.post('/applications', async (req, res) => {
  const {
    department_id,
    applicant_name,
    applicant_phone,
    visitor_name,
    visitor_gender,
    visitor_phone,
    license_plate,
    reason,
    visit_start,
    visit_end
  } = req.body;

  const [[department]] = await pool.query('SELECT * FROM departments WHERE id = ? AND enabled = 1', [department_id]);
  if (!department) {
    flash(req, 'error', '请选择有效部门');
    return res.redirect('/');
  }

  if (dayjs(visit_end).isBefore(dayjs(visit_start))) {
    flash(req, 'error', '结束时间不能早于开始时间');
    return res.redirect('/');
  }

  const token = randomUUID().replace(/-/g, '');
  await pool.query(
    `INSERT INTO visitor_applications
     (token, department_id, department_name, applicant_name, applicant_phone, visitor_name, visitor_gender, visitor_phone, license_plate, reason, visit_start, visit_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token,
      department.id,
      department.name,
      applicant_name.trim(),
      applicant_phone.trim(),
      visitor_name.trim(),
      visitor_gender,
      visitor_phone.trim(),
      (license_plate || '').trim(),
      reason.trim(),
      normalizeDateTime(visit_start),
      normalizeDateTime(visit_end)
    ]
  );

  res.redirect(`/applications/${token}`);
});

app.get('/applications/:token', async (req, res) => {
  const application = await applicationByToken(req.params.token);
  if (!application) return res.status(404).render('error', { message: '未找到申请信息' });
  const qrUrl = `${BASE_URL}/applications/${application.token}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 });
  res.render('application-detail', { application, qrUrl, qrDataUrl });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [[user]] = await pool.query('SELECT * FROM users WHERE username = ? AND enabled = 1', [username]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    flash(req, 'error', '账号或密码错误');
    return res.redirect('/login');
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    role: user.role
  };
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireLogin, async (req, res) => {
  const [[stats]] = await pool.query(`
    SELECT
      SUM(status = 'PENDING') AS pending,
      SUM(status = 'APPROVED') AS approved,
      SUM(status = 'REJECTED') AS rejected,
      COUNT(*) AS total
    FROM visitor_applications
  `);
  const [recent] = await pool.query('SELECT * FROM visitor_applications ORDER BY created_at DESC LIMIT 10');
  res.render('dashboard', { stats, recent });
});

app.get('/approvals', canApprove, async (req, res) => {
  const status = req.query.status || 'PENDING';
  const params = [];
  let sql = 'SELECT * FROM visitor_applications';
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const [applications] = await pool.query(sql, params);
  res.render('approvals', { applications, status });
});

app.post('/approvals/:id/approve', canApprove, async (req, res) => {
  await pool.query(
    `UPDATE visitor_applications
     SET status = 'APPROVED', reject_reason = NULL, approver_id = ?, approver_name = ?, approved_at = NOW()
     WHERE id = ?`,
    [req.session.user.id, req.session.user.realName, req.params.id]
  );
  flash(req, 'success', '申请已通过');
  res.redirect('/approvals');
});

app.post('/approvals/:id/reject', canApprove, async (req, res) => {
  await pool.query(
    `UPDATE visitor_applications
     SET status = 'REJECTED', reject_reason = ?, approver_id = ?, approver_name = ?, approved_at = NOW()
     WHERE id = ?`,
    [req.body.reject_reason || '信息有误，请重新提交', req.session.user.id, req.session.user.realName, req.params.id]
  );
  flash(req, 'success', '申请已打回');
  res.redirect('/approvals');
});

app.get('/admin/departments', requireAdmin, async (req, res) => {
  const [departments] = await pool.query('SELECT * FROM departments ORDER BY id ASC');
  res.render('admin-departments', { departments });
});

app.post('/admin/departments', requireAdmin, async (req, res) => {
  await pool.query('INSERT INTO departments (name) VALUES (?)', [req.body.name.trim()]);
  flash(req, 'success', '部门已新增');
  res.redirect('/admin/departments');
});

app.post('/admin/departments/:id', requireAdmin, async (req, res) => {
  await pool.query('UPDATE departments SET name = ?, enabled = ? WHERE id = ?', [
    req.body.name.trim(),
    req.body.enabled ? 1 : 0,
    req.params.id
  ]);
  flash(req, 'success', '部门已更新');
  res.redirect('/admin/departments');
});

app.post('/admin/departments/:id/delete', requireAdmin, async (req, res) => {
  const [[used]] = await pool.query('SELECT COUNT(*) AS count FROM visitor_applications WHERE department_id = ?', [req.params.id]);
  if (used.count > 0) {
    flash(req, 'error', '该部门已有申请记录，不能删除，可改为停用');
  } else {
    await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    flash(req, 'success', '部门已删除');
  }
  res.redirect('/admin/departments');
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  const [users] = await pool.query('SELECT id, username, real_name, role, enabled, created_at FROM users ORDER BY id ASC');
  res.render('admin-users', { users });
});

app.post('/admin/users', requireAdmin, async (req, res) => {
  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await pool.query(
    'INSERT INTO users (username, password_hash, real_name, role, enabled) VALUES (?, ?, ?, ?, ?)',
    [req.body.username.trim(), passwordHash, req.body.real_name.trim(), req.body.role, req.body.enabled ? 1 : 0]
  );
  flash(req, 'success', '账号已新增');
  res.redirect('/admin/users');
});

app.post('/admin/users/:id', requireAdmin, async (req, res) => {
  if (req.body.password) {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await pool.query(
      'UPDATE users SET real_name = ?, role = ?, enabled = ?, password_hash = ? WHERE id = ?',
      [req.body.real_name.trim(), req.body.role, req.body.enabled ? 1 : 0, passwordHash, req.params.id]
    );
  } else {
    await pool.query(
      'UPDATE users SET real_name = ?, role = ?, enabled = ? WHERE id = ?',
      [req.body.real_name.trim(), req.body.role, req.body.enabled ? 1 : 0, req.params.id]
    );
  }
  flash(req, 'success', '账号已更新');
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/delete', requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    flash(req, 'error', '不能删除当前登录账号');
  } else {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    flash(req, 'success', '账号已删除');
  }
  res.redirect('/admin/users');
});

app.get('/admin/applications', requireAdmin, async (req, res) => {
  const [applications] = await pool.query('SELECT * FROM visitor_applications ORDER BY created_at DESC');
  res.render('admin-applications', { applications });
});

app.post('/admin/applications/:id/delete', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM visitor_applications WHERE id = ?', [req.params.id]);
  flash(req, 'success', '申请记录已删除');
  res.redirect('/admin/applications');
});

app.get('/screen', async (req, res) => {
  const [applications] = await pool.query(
    `SELECT * FROM visitor_applications
     WHERE status = 'APPROVED' AND visit_end >= NOW()
     ORDER BY visit_start ASC`
  );
  res.render('screen', { applications });
});

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: err.message || '服务器发生错误' });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`校园访客审批平台已启动：${BASE_URL}`);
    });
  })
  .catch((error) => {
    console.error('启动失败：', error);
    process.exit(1);
  });

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

const STATUS_LABELS = {
  DEPT_PENDING: '待部门负责人审批',
  SECURITY_PENDING: '待保卫处审批',
  APPROVED: '已通过',
  REJECTED: '已打回'
};

const ROLE_LABELS = {
  ADMIN: '系统管理员',
  SECURITY: '保卫处账号',
  DEPARTMENT: '部门账号'
};

const SCREEN_FILTER_LABELS = {
  effective: '当前有效',
  upcoming: '即将到访',
  expired: '已失效',
  all: '全部已通过'
};

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
  res.locals.statusLabels = STATUS_LABELS;
  res.locals.roleLabels = ROLE_LABELS;
  res.locals.screenFilterLabels = SCREEN_FILTER_LABELS;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'ADMIN') {
    flash(req, 'error', '需要系统管理员权限');
    return res.redirect('/dashboard');
  }
  next();
}

function requireApprovalAccess(req, res, next) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'ADMIN' || user.role === 'SECURITY' || user.role === 'DEPARTMENT') return next();
  flash(req, 'error', '当前账号无审批查看权限');
  return res.redirect('/dashboard');
}

function canSecurityApprove(user) {
  return user && (user.role === 'ADMIN' || (user.role === 'SECURITY' && user.canApprove));
}

function canDepartmentApprove(user, application) {
  return user && (
    user.role === 'ADMIN' ||
    (user.role === 'DEPARTMENT' && user.canApprove && Number(user.departmentId) === Number(application.department_id))
  );
}

function normalizeDateTime(value) {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
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
      role ENUM('ADMIN', 'SECURITY', 'DEPARTMENT') NOT NULL,
      department_id BIGINT NULL,
      department_name VARCHAR(100) NULL,
      can_approve TINYINT(1) NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_department (department_id)
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
      requires_department_approval TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('DEPT_PENDING', 'SECURITY_PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SECURITY_PENDING',
      reject_reason VARCHAR(500),
      department_approver_id BIGINT,
      department_approver_name VARCHAR(50),
      assigned_department_approver_id BIGINT,
      assigned_department_approver_name VARCHAR(50),
      assigned_by_security_id BIGINT,
      assigned_by_security_name VARCHAR(50),
      assigned_at DATETIME,
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
    )
  `);

  await migrateSchema();
  await seedDefaults();
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function ensureColumn(table, definition) {
  const column = definition.trim().split(/\s+/)[0].replace(/`/g, '');
  if (!(await columnExists(table, column))) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function migrateSchema() {
  await pool.query(`ALTER TABLE users MODIFY role ENUM('ADMIN', 'SECURITY', 'DEPARTMENT') NOT NULL`);
  await ensureColumn('users', 'department_id BIGINT NULL');
  await ensureColumn('users', 'department_name VARCHAR(100) NULL');
  await ensureColumn('users', 'can_approve TINYINT(1) NOT NULL DEFAULT 0');

  await ensureColumn('visitor_applications', 'requires_department_approval TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('visitor_applications', 'department_approver_id BIGINT NULL');
  await ensureColumn('visitor_applications', 'department_approver_name VARCHAR(50) NULL');
  await ensureColumn('visitor_applications', 'assigned_department_approver_id BIGINT NULL');
  await ensureColumn('visitor_applications', 'assigned_department_approver_name VARCHAR(50) NULL');
  await ensureColumn('visitor_applications', 'assigned_by_security_id BIGINT NULL');
  await ensureColumn('visitor_applications', 'assigned_by_security_name VARCHAR(50) NULL');
  await ensureColumn('visitor_applications', 'assigned_at DATETIME NULL');
  await ensureColumn('visitor_applications', 'department_approved_at DATETIME NULL');
  await ensureColumn('visitor_applications', 'security_approver_id BIGINT NULL');
  await ensureColumn('visitor_applications', 'security_approver_name VARCHAR(50) NULL');
  await ensureColumn('visitor_applications', 'security_approved_at DATETIME NULL');
  await pool.query(`
    ALTER TABLE visitor_applications
    MODIFY status ENUM('PENDING', 'DEPT_PENDING', 'SECURITY_PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SECURITY_PENDING'
  `);
  await pool.query(`UPDATE visitor_applications SET status = 'SECURITY_PENDING' WHERE status = 'PENDING'`);
  await pool.query(`
    ALTER TABLE visitor_applications
    MODIFY status ENUM('DEPT_PENDING', 'SECURITY_PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SECURITY_PENDING'
  `);
}

async function seedDefaults() {
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

  const [[securityDept]] = await pool.query('SELECT id, name FROM departments WHERE name = ? LIMIT 1', ['保卫处']);
  await ensureUser('admin', 'admin123', '系统管理员', 'ADMIN', null, null, true);
  await ensureUser('security', 'security123', '保卫负责人', 'SECURITY', securityDept?.id || null, securityDept?.name || null, true);
}

async function ensureUser(username, password, realName, role, departmentId = null, departmentName = null, canApprove = false) {
  const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, real_name, role, department_id, department_name, can_approve)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, passwordHash, realName, role, departmentId, departmentName, canApprove ? 1 : 0]
    );
  }
}

async function applicationByToken(token) {
  const [[application]] = await pool.query('SELECT * FROM visitor_applications WHERE token = ?', [token]);
  return application;
}

async function applicationById(id) {
  const [[application]] = await pool.query('SELECT * FROM visitor_applications WHERE id = ?', [id]);
  return application;
}

function approvalScopeWhere(user, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (user.role === 'ADMIN' || user.role === 'SECURITY') {
    return { where: '1 = 1', params: [] };
  }
  return { where: `${prefix}department_id = ?`, params: [user.departmentId || 0] };
}

function nextStatus(requiresDepartmentApproval) {
  return requiresDepartmentApproval ? 'DEPT_PENDING' : 'SECURITY_PENDING';
}

app.get('/', asyncHandler(async (req, res) => {
  const [departments] = await pool.query('SELECT * FROM departments WHERE enabled = 1 ORDER BY id ASC');
  res.render('apply', { departments });
}));

app.post('/applications', asyncHandler(async (req, res) => {
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
  const requiresDepartmentApproval = req.body.requires_department_approval === '1';

  const requiredFields = [applicant_name, applicant_phone, visitor_name, visitor_gender, visitor_phone, reason, visit_start, visit_end];
  if (!department_id || requiredFields.some((value) => !requiredText(value))) {
    flash(req, 'error', '请完整填写申请信息');
    return res.redirect('/');
  }

  const [[department]] = await pool.query('SELECT * FROM departments WHERE id = ? AND enabled = 1', [department_id]);
  if (!department) {
    flash(req, 'error', '请选择有效部门');
    return res.redirect('/');
  }

  const startTime = dayjs(visit_start);
  const endTime = dayjs(visit_end);
  if (!startTime.isValid() || !endTime.isValid()) {
    flash(req, 'error', '请选择有效的到访时间');
    return res.redirect('/');
  }
  if (endTime.isBefore(startTime)) {
    flash(req, 'error', '结束时间不能早于开始时间');
    return res.redirect('/');
  }

  const token = randomUUID().replace(/-/g, '');
  await pool.query(
    `INSERT INTO visitor_applications
     (token, department_id, department_name, applicant_name, applicant_phone, visitor_name, visitor_gender, visitor_phone,
      license_plate, reason, visit_start, visit_end, requires_department_approval, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      normalizeDateTime(startTime),
      normalizeDateTime(endTime),
      requiresDepartmentApproval ? 1 : 0,
      nextStatus(requiresDepartmentApproval)
    ]
  );

  res.redirect(`/applications/${token}`);
}));

app.get('/applications/:token', asyncHandler(async (req, res) => {
  const application = await applicationByToken(req.params.token);
  if (!application) return res.status(404).render('error', { message: '未找到申请信息' });
  const qrUrl = `${BASE_URL}/applications/${application.token}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 });
  res.render('application-detail', { application, qrUrl, qrDataUrl });
}));

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', asyncHandler(async (req, res) => {
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
    role: user.role,
    departmentId: user.department_id,
    departmentName: user.department_name,
    canApprove: Boolean(user.can_approve)
  };
  res.redirect('/dashboard');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireLogin, asyncHandler(async (req, res) => {
  const scope = approvalScopeWhere(req.session.user);
  const [[stats]] = await pool.query(`
    SELECT
      SUM(status = 'DEPT_PENDING') AS dept_pending,
      SUM(status = 'SECURITY_PENDING') AS security_pending,
      SUM(status = 'APPROVED') AS approved,
      SUM(status = 'REJECTED') AS rejected,
      COUNT(*) AS total
    FROM visitor_applications
    WHERE ${scope.where}
  `, scope.params);
  const [recent] = await pool.query(`
    SELECT * FROM visitor_applications
    WHERE ${scope.where}
    ORDER BY created_at DESC
    LIMIT 10
  `, scope.params);
  res.render('dashboard', { stats, recent });
}));

app.get('/approvals', requireApprovalAccess, asyncHandler(async (req, res) => {
  const user = req.session.user;
  const status = req.query.status || 'ALL';
  const params = [];
  const whereParts = [];

  if (user.role === 'DEPARTMENT') {
    whereParts.push('department_id = ?');
    params.push(user.departmentId || 0);
  }

  if (['DEPT_PENDING', 'SECURITY_PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    whereParts.push('status = ?');
    params.push(status);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const [applications] = await pool.query(`SELECT * FROM visitor_applications ${where} ORDER BY created_at DESC`, params);
  const [departmentApprovers] = await pool.query(`
    SELECT id, real_name, department_id, department_name
    FROM users
    WHERE enabled = 1 AND role = 'DEPARTMENT' AND can_approve = 1
    ORDER BY department_name ASC, real_name ASC
  `);
  res.render('approvals', { applications, status, departmentApprovers });
}));

app.post('/approvals/:id/assign-department', requireApprovalAccess, asyncHandler(async (req, res) => {
  if (!canSecurityApprove(req.session.user)) {
    flash(req, 'error', '只有具有审批权限的保卫处账号或管理员可以指定部门审批人');
    return res.redirect('/approvals');
  }

  const application = await applicationById(req.params.id);
  if (!application) {
    flash(req, 'error', '申请不存在');
    return res.redirect('/approvals');
  }
  if (application.status !== 'SECURITY_PENDING') {
    flash(req, 'error', '只有待保卫处审批的申请可以指定部门审批人');
    return res.redirect('/approvals');
  }

  const [[approver]] = await pool.query(
    `SELECT id, real_name, department_id, department_name
     FROM users
     WHERE id = ? AND enabled = 1 AND role = 'DEPARTMENT' AND can_approve = 1`,
    [req.body.department_approver_id]
  );
  if (!approver) {
    flash(req, 'error', '请选择有效的部门审批人');
    return res.redirect('/approvals');
  }
  if (Number(approver.department_id) !== Number(application.department_id)) {
    flash(req, 'error', '指定审批人必须属于该申请所在部门');
    return res.redirect('/approvals');
  }

  await pool.query(
    `UPDATE visitor_applications
     SET status = 'DEPT_PENDING',
         requires_department_approval = 1,
         assigned_department_approver_id = ?,
         assigned_department_approver_name = ?,
         assigned_by_security_id = ?,
         assigned_by_security_name = ?,
         assigned_at = NOW()
     WHERE id = ?`,
    [approver.id, approver.real_name, req.session.user.id, req.session.user.realName, application.id]
  );
  flash(req, 'success', `已指定 ${approver.real_name} 进行部门负责人审批`);
  res.redirect('/approvals?status=DEPT_PENDING');
}));

app.post('/approvals/:id/approve', requireApprovalAccess, asyncHandler(async (req, res) => {
  const application = await applicationById(req.params.id);
  if (!application) {
    flash(req, 'error', '申请不存在');
    return res.redirect('/approvals');
  }

  if (application.status === 'DEPT_PENDING') {
    if (!canDepartmentApprove(req.session.user, application)) {
      flash(req, 'error', '当前账号不能审批该部门申请');
      return res.redirect('/approvals');
    }
    await pool.query(
      `UPDATE visitor_applications
       SET status = 'SECURITY_PENDING',
           department_approver_id = ?,
           department_approver_name = ?,
           department_approved_at = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.session.user.realName, req.params.id]
    );
    flash(req, 'success', '部门负责人审批已通过，申请已流转至保卫处');
    return res.redirect('/approvals');
  }

  if (application.status === 'SECURITY_PENDING') {
    if (!canSecurityApprove(req.session.user)) {
      flash(req, 'error', '当前账号不能进行保卫处审批');
      return res.redirect('/approvals');
    }
    await pool.query(
      `UPDATE visitor_applications
       SET status = 'APPROVED',
           reject_reason = NULL,
           security_approver_id = ?,
           security_approver_name = ?,
           security_approved_at = NOW(),
           approver_id = ?,
           approver_name = ?,
           approved_at = NOW()
       WHERE id = ?`,
      [req.session.user.id, req.session.user.realName, req.session.user.id, req.session.user.realName, req.params.id]
    );
    flash(req, 'success', '保卫处审批已通过');
    return res.redirect('/approvals');
  }

  flash(req, 'error', '该申请当前状态不能通过审批');
  res.redirect('/approvals');
}));

app.post('/approvals/:id/reject', requireApprovalAccess, asyncHandler(async (req, res) => {
  const application = await applicationById(req.params.id);
  if (!application) {
    flash(req, 'error', '申请不存在');
    return res.redirect('/approvals');
  }
  if (
    (application.status === 'DEPT_PENDING' && !canDepartmentApprove(req.session.user, application)) ||
    (application.status === 'SECURITY_PENDING' && !canSecurityApprove(req.session.user))
  ) {
    flash(req, 'error', '当前账号不能打回该申请');
    return res.redirect('/approvals');
  }
  await pool.query(
    `UPDATE visitor_applications
     SET status = 'REJECTED',
         reject_reason = ?,
         approver_id = ?,
         approver_name = ?,
         approved_at = NOW()
     WHERE id = ?`,
    [req.body.reject_reason || '信息有误，请重新提交', req.session.user.id, req.session.user.realName, req.params.id]
  );
  flash(req, 'success', '申请已打回');
  res.redirect('/approvals');
}));

app.get('/admin/departments', requireAdmin, asyncHandler(async (req, res) => {
  const [departments] = await pool.query('SELECT * FROM departments ORDER BY id ASC');
  res.render('admin-departments', { departments });
}));

app.post('/admin/departments', requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('INSERT INTO departments (name) VALUES (?)', [req.body.name.trim()]);
  flash(req, 'success', '部门已新增');
  res.redirect('/admin/departments');
}));

app.post('/admin/departments/:id', requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('UPDATE departments SET name = ?, enabled = ? WHERE id = ?', [
    req.body.name.trim(),
    req.body.enabled ? 1 : 0,
    req.params.id
  ]);
  flash(req, 'success', '部门已更新');
  res.redirect('/admin/departments');
}));

app.post('/admin/departments/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const [[used]] = await pool.query('SELECT COUNT(*) AS count FROM visitor_applications WHERE department_id = ?', [req.params.id]);
  if (used.count > 0) {
    flash(req, 'error', '该部门已有申请记录，不能删除，可改为停用');
  } else {
    await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    flash(req, 'success', '部门已删除');
  }
  res.redirect('/admin/departments');
}));

app.get('/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const [users] = await pool.query('SELECT u.id, u.username, u.real_name, u.role, u.department_name, u.can_approve, u.enabled, u.created_at FROM users u ORDER BY u.id ASC');
  const [departments] = await pool.query('SELECT * FROM departments WHERE enabled = 1 ORDER BY id ASC');
  res.render('admin-users', { users, departments });
}));

app.post('/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const role = req.body.role;
  const departmentId = role === 'ADMIN' ? null : req.body.department_id;
  let departmentName = null;
  if (departmentId) {
    const [[department]] = await pool.query('SELECT * FROM departments WHERE id = ? AND enabled = 1', [departmentId]);
    if (!department) {
      flash(req, 'error', '请选择有效部门');
      return res.redirect('/admin/users');
    }
    departmentName = department.name;
  }
  if (role !== 'ADMIN' && !departmentId) {
    flash(req, 'error', '非系统管理员账号必须绑定部门');
    return res.redirect('/admin/users');
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, real_name, role, department_id, department_name, can_approve, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.body.username.trim(),
      passwordHash,
      req.body.real_name.trim(),
      role,
      departmentId,
      departmentName,
      req.body.can_approve ? 1 : 0,
      req.body.enabled ? 1 : 0
    ]
  );
  flash(req, 'success', '账号已新增');
  res.redirect('/admin/users');
}));

app.post('/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const role = req.body.role;
  const departmentId = role === 'ADMIN' ? null : req.body.department_id;
  let departmentName = null;
  if (departmentId) {
    const [[department]] = await pool.query('SELECT * FROM departments WHERE id = ? AND enabled = 1', [departmentId]);
    if (!department) {
      flash(req, 'error', '请选择有效部门');
      return res.redirect('/admin/users');
    }
    departmentName = department.name;
  }
  if (role !== 'ADMIN' && !departmentId) {
    flash(req, 'error', '非系统管理员账号必须绑定部门');
    return res.redirect('/admin/users');
  }

  const values = [
    req.body.real_name.trim(),
    role,
    departmentId,
    departmentName,
    req.body.can_approve ? 1 : 0,
    req.body.enabled ? 1 : 0
  ];
  let sql = 'UPDATE users SET real_name = ?, role = ?, department_id = ?, department_name = ?, can_approve = ?, enabled = ?';
  if (req.body.password) {
    sql += ', password_hash = ?';
    values.push(await bcrypt.hash(req.body.password, 10));
  }
  sql += ' WHERE id = ?';
  values.push(req.params.id);
  await pool.query(sql, values);
  flash(req, 'success', '账号已更新');
  res.redirect('/admin/users');
}));

app.post('/admin/users/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    flash(req, 'error', '不能删除当前登录账号');
  } else {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    flash(req, 'success', '账号已删除');
  }
  res.redirect('/admin/users');
}));

app.get('/admin/applications', requireAdmin, asyncHandler(async (req, res) => {
  const [applications] = await pool.query('SELECT * FROM visitor_applications ORDER BY created_at DESC');
  res.render('admin-applications', { applications });
}));

app.post('/admin/applications/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM visitor_applications WHERE id = ?', [req.params.id]);
  flash(req, 'success', '申请记录已删除');
  res.redirect('/admin/applications');
}));

app.get('/screen', asyncHandler(async (req, res) => {
  const filter = req.query.filter || 'effective';
  const params = [];
  let timeWhere = '';
  if (filter === 'effective') {
    timeWhere = 'AND visit_start <= NOW() AND visit_end >= NOW()';
  } else if (filter === 'upcoming') {
    timeWhere = 'AND visit_start > NOW()';
  } else if (filter === 'expired') {
    timeWhere = 'AND visit_end < NOW()';
  }
  const [applications] = await pool.query(
    `SELECT * FROM visitor_applications
     WHERE status = 'APPROVED' ${timeWhere}
     ORDER BY visit_start ASC`,
    params
  );
  res.render('screen', { applications, filter });
}));

app.get('/api/screen', asyncHandler(async (req, res) => {
  const filter = req.query.filter || 'effective';
  let timeWhere = '';
  if (filter === 'effective') {
    timeWhere = 'AND visit_start <= NOW() AND visit_end >= NOW()';
  } else if (filter === 'upcoming') {
    timeWhere = 'AND visit_start > NOW()';
  } else if (filter === 'expired') {
    timeWhere = 'AND visit_end < NOW()';
  }
  const [applications] = await pool.query(
    `SELECT * FROM visitor_applications
     WHERE status = 'APPROVED' ${timeWhere}
     ORDER BY visit_start ASC`
  );
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    filter,
    applications: applications.map((item) => ({
      id: item.id,
      visitorName: item.visitor_name,
      visitorPhone: item.visitor_phone,
      licensePlate: item.license_plate || '无',
      departmentName: item.department_name,
      applicantName: item.applicant_name,
      applicantPhone: item.applicant_phone,
      reason: item.reason,
      visitStart: item.visit_start,
      visitEnd: item.visit_end,
      securityApproverName: item.security_approver_name || item.approver_name || '-',
      approvedAt: item.security_approved_at || item.approved_at
    }))
  });
}));

app.get('/health', asyncHandler(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { message: err.message || '服务器发生错误' });
});

async function start() {
  await initDatabase();
  return app.listen(PORT, () => {
    console.log(`校园访客审批平台已启动：${BASE_URL}`);
  });
}

async function stop(server) {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (pool) {
    await pool.end();
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error('启动失败：', error);
    process.exit(1);
  });
}

module.exports = {
  app,
  start,
  stop
};

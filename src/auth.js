const crypto = require('crypto');
const db = require('./db');
const { HttpError, hashPassword, verifyPassword, uid, nowIso } = require('./utils');

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 小时
const MAX_LOGIN_FAILS = 5;
const LOCK_DURATION = 15 * 60 * 1000; // 15 分钟

const sessions = new Map(); // token -> { adminId, expiresAt }
const loginFails = new Map(); // username -> { count, lockedUntil }

const COOKIE_NAME = 'lc_session';

/** 首次启动创建默认管理员，返回初始账号密码（仅首次） */
function ensureSeedAdmin() {
  const admins = db.list('admins');
  if (admins.length > 0) return null;
  const admin = {
    id: uid(),
    username: 'admin',
    passwordHash: hashPassword('Admin@123456'),
    role: 'admin',
    lastLoginAt: null,
    createdAt: nowIso()
  };
  db.save('admins', [admin]);
  return { username: admin.username, password: 'Admin@123456' };
}

function findAdminByUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  return db.list('admins').find((a) => a.username.toLowerCase() === key);
}

function login(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const fail = loginFails.get(key) || { count: 0, lockedUntil: 0 };

  if (fail.lockedUntil > Date.now()) {
    const minutes = Math.ceil((fail.lockedUntil - Date.now()) / 60000);
    throw new HttpError(423, `密码错误次数过多，账号已锁定，请 ${minutes} 分钟后再试`);
  }

  const admin = findAdminByUsername(username);
  const ok = admin && verifyPassword(password, admin.passwordHash);

  if (!ok) {
    const count = fail.count + 1;
    if (count >= MAX_LOGIN_FAILS) {
      loginFails.set(key, { count: 0, lockedUntil: Date.now() + LOCK_DURATION });
      throw new HttpError(401, '密码错误次数过多，账号已锁定 15 分钟');
    }
    loginFails.set(key, { count, lockedUntil: 0 });
    throw new HttpError(401, `账号或密码错误，还可尝试 ${MAX_LOGIN_FAILS - count} 次`);
  }

  loginFails.delete(key);

  const admins = db.list('admins');
  const record = admins.find((a) => a.id === admin.id);
  record.lastLoginAt = nowIso();
  db.save('admins', admins);

  return record;
}

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { adminId, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index > -1) acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return acc;
  }, {});
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) sessions.delete(token);
}

/** 后台接口鉴权中间件 */
function requireAdmin(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  const session = token && sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: '未登录或登录已过期' });
  }

  const admin = db.list('admins').find((a) => a.id === session.adminId);
  if (!admin) {
    sessions.delete(token);
    return res.status(401).json({ error: '账号不存在，请重新登录' });
  }

  req.admin = admin;
  next();
}

module.exports = {
  ensureSeedAdmin,
  login,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  requireAdmin,
  findAdminByUsername
};

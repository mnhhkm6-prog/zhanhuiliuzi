const crypto = require('crypto');

// 生产环境务必通过环境变量覆盖 APP_SECRET
const SECRET = process.env.APP_SECRET || 'lead-capture-secret-change-me-in-production';
const ENC_KEY = crypto.createHash('sha256').update('enc:' + SECRET).digest();

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/** AES-256-GCM 加密手机号，落库不存明文 */
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** 手机号哈希，用于去重与精确查询 */
function hmac(value) {
  return crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex');
}

function maskPhone(phone) {
  return String(phone).replace(/^(\d{3})(\d{4})(\d{4})$/, '$1****$3');
}

function isPhone(value) {
  return /^1[3-9]\d{9}$/.test(String(value || ''));
}

function isSmsCode(value) {
  return /^\d{6}$/.test(String(value || ''));
}

function randomSmsCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** 去除首尾空格，统一空字符串 */
function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

/** 日期 YYYY-MM-DD 校验 */
function isDateStr(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value));
}

/** 把 ISO 时间按东八区格式化为 YYYY-MM-DD HH:mm:ss */
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

/** 东八区今天 YYYY-MM-DD */
function todayStr() {
  return formatTime(nowIso()).slice(0, 10);
}

function dateStrOf(iso) {
  return formatTime(iso).slice(0, 10);
}

module.exports = {
  HttpError,
  uid,
  nowIso,
  encrypt,
  decrypt,
  hmac,
  maskPhone,
  isPhone,
  isSmsCode,
  randomSmsCode,
  hashPassword,
  verifyPassword,
  clean,
  isDateStr,
  formatTime,
  todayStr,
  dateStrOf
};

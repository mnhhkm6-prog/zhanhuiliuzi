const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');

for (const dir of [DATA_DIR, EXPORT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const TABLES = ['campaigns', 'leads', 'sms_codes', 'admins', 'export_logs', 'phone_views'];
const cache = new Map();

function fileOf(name) {
  return path.join(DATA_DIR, name + '.json');
}

/** 读取表数据（首次读取后缓存，保证进程内一致） */
function list(name) {
  if (!TABLES.includes(name)) throw new Error('未知数据表: ' + name);
  if (cache.has(name)) return cache.get(name);

  const file = fileOf(name);
  let rows = [];
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) rows = JSON.parse(raw);
  }
  cache.set(name, rows);
  return rows;
}

/** 原子写入：先写临时文件再重命名，避免进程中断时留下半截 JSON */
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

/** 覆盖写入整张表，数据落盘后进程重启仍保留 */
function save(name, rows) {
  cache.set(name, rows);
  writeAtomic(fileOf(name), JSON.stringify(rows, null, 2));
}

/** 读取对象型配置 */
function obj(name, defaults = {}) {
  if (cache.has(name)) return cache.get(name);
  const file = fileOf(name);
  let value = { ...defaults };
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) value = { ...defaults, ...JSON.parse(raw) };
  }
  cache.set(name, value);
  return value;
}

function saveObj(name, value) {
  cache.set(name, value);
  writeAtomic(fileOf(name), JSON.stringify(value, null, 2));
}

module.exports = { DATA_DIR, EXPORT_DIR, list, save, obj, saveObj };

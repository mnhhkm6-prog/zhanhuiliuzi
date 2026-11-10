/**
 * 每日备份 data 目录下的 JSON 数据
 * 用法：node scripts/backup.js [保留天数，默认 14]
 * 建议 crontab：0 3 * * * cd /path/to/留资 && /usr/bin/node scripts/backup.js >> logs/backup.log 2>&1
 */
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = Math.max(1, Number(process.argv[2]) || 14);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');

function dayStr(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const day = dayStr(new Date());
const target = path.join(BACKUP_DIR, day);
fs.mkdirSync(target, { recursive: true });

let count = 0;
for (const name of fs.readdirSync(DATA_DIR)) {
  const from = path.join(DATA_DIR, name);
  if (!name.endsWith('.json') || !fs.statSync(from).isFile()) continue;
  fs.copyFileSync(from, path.join(target, name));
  count += 1;
}

const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
let removed = 0;
for (const name of fs.readdirSync(BACKUP_DIR)) {
  const dir = path.join(BACKUP_DIR, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || !fs.statSync(dir).isDirectory()) continue;
  if (new Date(name + 'T00:00:00').getTime() < cutoff) {
    fs.rmSync(dir, { recursive: true, force: true });
    removed += 1;
  }
}

console.log(`[backup] ${new Date().toISOString()} 备份 ${count} 个文件到 ${target}，清理 ${removed} 个过期备份`);

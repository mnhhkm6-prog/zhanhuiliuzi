const path = require('path');
const express = require('express');

require('./src/env');
const auth = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const publicRoutes = require('./src/routes/public');
const campaignRoutes = require('./src/routes/campaigns');
const leadRoutes = require('./src/routes/leads');
const dashboardRoutes = require('./src/routes/dashboard');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', true);
app.disable('x-powered-by');

/** CORS：便于本地前端独立调试 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use('/api/public', publicRoutes);
app.use('/api/admin/auth', authRoutes);
app.use('/api/admin/campaigns', campaignRoutes);
app.use('/api/admin/leads', leadRoutes);
app.use('/api/admin', dashboardRoutes);

// 静态资源
app.use('/assets', express.static(path.join(__dirname, 'public')));

// H5 表单页：/c/:code
app.get('/c/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'h5.html'));
});
// 后台单页
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/', (req, res) => res.redirect('/admin'));

// 接口 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求数据格式错误，请检查 JSON' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({ error: err.message || '服务器内部错误', ...(err.extra || {}) });
});

const seeded = auth.ensureSeedAdmin();

const server = app.listen(PORT, () => {
  console.log('========================================');
  console.log(`展会留资系统已启动: http://localhost:${PORT}`);
  console.log(`管理后台:           http://localhost:${PORT}/admin`);
  console.log(`H5 表单地址:        http://localhost:${PORT}/c/<活动码>`);
  if (seeded) {
    console.log('----------------------------------------');
    console.log('已创建默认管理员（首次启动，请尽快修改密码）');
    console.log(`账号: ${seeded.username}`);
    console.log(`密码: ${seeded.password}`);
  }
  console.log('========================================');
});

module.exports = { app, server };

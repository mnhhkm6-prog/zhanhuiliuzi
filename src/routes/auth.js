const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { HttpError, clean, hashPassword, verifyPassword, nowIso } = require('../utils');

const router = express.Router();

router.post('/login', (req, res, next) => {
  try {
    const username = clean(req.body.username);
    const password = req.body.password;
    if (!username) throw new HttpError(400, '请输入账号');
    if (!password) throw new HttpError(400, '请输入密码');

    const admin = auth.login(username, password);
    const token = auth.createSession(admin.id);
    auth.setSessionCookie(res, token);

    res.json({ username: admin.username, role: admin.role, lastLoginAt: admin.lastLoginAt });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  auth.destroySession(req);
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/me', auth.requireAdmin, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role, lastLoginAt: req.admin.lastLoginAt });
});

router.put('/password', auth.requireAdmin, (req, res, next) => {
  try {
    const oldPassword = req.body.oldPassword;
    const newPassword = req.body.newPassword;
    if (!oldPassword) throw new HttpError(400, '请输入原密码');
    if (!newPassword) throw new HttpError(400, '请输入新密码');
    if (String(newPassword).length < 8) throw new HttpError(400, '新密码长度不能少于 8 位');

    const admins = db.list('admins');
    const admin = admins.find((a) => a.id === req.admin.id);
    if (!verifyPassword(oldPassword, admin.passwordHash)) throw new HttpError(400, '原密码不正确');
    if (verifyPassword(newPassword, admin.passwordHash)) throw new HttpError(400, '新密码不能与原密码相同');

    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = nowIso();
    db.save('admins', admins);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

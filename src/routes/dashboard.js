const express = require('express');
const db = require('../db');
const auth = require('../auth');
const settingsService = require('../settings');
const { sendSms } = require('../sms');
const { HttpError, nowIso, dateStrOf, clean, isPhone } = require('../utils');

const router = express.Router();
router.use(auth.requireAdmin);

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

router.get('/dashboard', (req, res) => {
  const today = dateStrOf(nowIso());
  const leads = db.list('leads');
  const campaigns = db.list('campaigns');
  const smsRows = db.list('sms_codes');

  const todayLeads = leads.filter((l) => dateStrOf(l.submittedAt) === today);
  const todaySms = smsRows.filter((r) => dateStrOf(r.sendAt) === today);
  const sentOk = todaySms.filter((r) => r.status !== 'failed').length;
  const failed = todaySms.filter((r) => r.status === 'failed').length;

  const dates = [];
  for (let i = 6; i >= 0; i -= 1) dates.push(shiftDate(today, -i));

  const trend = dates.map((date) => ({
    date,
    count: leads.filter((l) => dateStrOf(l.submittedAt) === date).length
  }));

  const ranking = campaigns
    .map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      status: c.status,
      leadCount: leads.filter((l) => l.campaignId === c.id).length,
      todayCount: leads.filter((l) => l.campaignId === c.id && dateStrOf(l.submittedAt) === today).length
    }))
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 5);

  res.json({
    today,
    totals: {
      leads: leads.length,
      todayLeads: todayLeads.length,
      campaigns: campaigns.length,
      activeCampaigns: campaigns.filter((c) => c.status === 'active').length
    },
    sms: {
      todaySent: sentOk,
      todayFailed: failed,
      successRate: sentOk + failed === 0 ? null : Math.round((sentOk / (sentOk + failed)) * 100)
    },
    trend,
    ranking,
    recentLeads: leads
      .slice()
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        name: l.name,
        company: l.company,
        campaignName: l.campaignName,
        submittedAt: l.submittedAt
      }))
  });
});

router.get('/settings', (req, res) => {
  res.json(settingsService.publicView());
});

router.put('/settings', (req, res, next) => {
  try {
    const body = req.body || {};
    const current = settingsService.get();
    const patch = {};

    if (body.smsProvider !== undefined) {
      if (!['mock', 'ihuyi', 'http'].includes(body.smsProvider)) {
        throw new HttpError(400, '短信服务商仅支持 mock / ihuyi / http');
      }
      patch.smsProvider = body.smsProvider;
    }
    for (const key of ['smsEndpoint', 'smsAppKey', 'smsSignName', 'smsTemplateCode', 'siteTitle']) {
      if (body[key] !== undefined) patch[key] = String(body[key]).trim();
    }
    if (body.ihuyiAccount !== undefined) patch.ihuyiAccount = String(body.ihuyiAccount).trim();
    if (body.ihuyiTemplateId !== undefined) {
      const templateId = String(body.ihuyiTemplateId).trim() || '1';
      if (!/^\d+$/.test(templateId)) throw new HttpError(400, '短信模板 ID 应为数字');
      patch.ihuyiTemplateId = templateId;
    }
    // 前端回传掩码时保留原密钥
    if (body.ihuyiApiKey !== undefined && body.ihuyiApiKey !== '******') {
      patch.ihuyiApiKey = String(body.ihuyiApiKey).trim();
    }
    if (body.smsAppSecret !== undefined && body.smsAppSecret !== '******') {
      patch.smsAppSecret = String(body.smsAppSecret).trim();
    }
    if (body.smsTestMode !== undefined) patch.smsTestMode = !!body.smsTestMode;

    const numeric = {
      codeExpireSeconds: [60, 1800],
      resendIntervalSeconds: [30, 600],
      dailyLimitPerPhone: [1, 100],
      maxVerifyAttempts: [1, 10]
    };
    for (const [key, [min, max]] of Object.entries(numeric)) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new HttpError(400, `${key} 取值需为 ${min}-${max} 之间的整数`);
      }
      patch[key] = value;
    }

    if (patch.smsProvider === 'http' && !(patch.smsEndpoint || current.smsEndpoint)) {
      throw new HttpError(400, '选择 http 服务商时必须填写短信网关地址');
    }
    const nextProvider = patch.smsProvider || current.smsProvider;
    const nextAccount = patch.ihuyiAccount !== undefined ? patch.ihuyiAccount : current.ihuyiAccount;
    const nextApiKey = patch.ihuyiApiKey !== undefined ? patch.ihuyiApiKey : current.ihuyiApiKey;
    if (nextProvider === 'ihuyi' && (!nextAccount || !nextApiKey)) {
      throw new HttpError(400, '使用互亿无线时必须填写 APIID 与 APIKEY');
    }

    settingsService.save(patch);
    res.json(settingsService.publicView());
  } catch (err) {
    next(err);
  }
});

/** 发送测试短信，验证通道是否可用（不下发验证码记录、不占用频控） */
router.post('/settings/test-sms', async (req, res, next) => {
  try {
    const phone = clean(req.body.phone);
    if (!isPhone(phone)) throw new HttpError(400, '请输入正确的 11 位手机号');

    const result = await sendSms(phone, '123456', settingsService.get());
    if (!result.ok) throw new HttpError(502, '发送失败：' + (result.error || '未知错误'));

    res.json({ success: true, provider: result.provider, msgId: result.msgId || '' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

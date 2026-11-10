const express = require('express');
const db = require('../db');
const settingsService = require('../settings');
const fieldsService = require('../formFields');
const { sendSms } = require('../sms');
const {
  HttpError,
  uid,
  nowIso,
  encrypt,
  hmac,
  maskPhone,
  isPhone,
  isSmsCode,
  randomSmsCode,
  clean,
  dateStrOf,
  formatTime
} = require('../utils');

const router = express.Router();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function findCampaignByCode(code) {
  const campaign = db.list('campaigns').find((c) => c.code === String(code || '').trim());
  if (!campaign) throw new HttpError(404, '活动不存在或链接已失效');
  return campaign;
}

function requireActiveCampaign(code) {
  const campaign = findCampaignByCode(code);
  if (campaign.status !== 'active') throw new HttpError(403, '活动已结束，无法提交');
  return campaign;
}

/** 按活动字段配置校验提交内容：核心字段进主表，自定义字段进 extra */
function validateSubmission(fields, body) {
  const core = { name: '', company: '', position: '' };
  const extra = {};
  let phone = '';

  for (const field of fields) {
    if (field.key === 'phone') {
      phone = clean(body.phone);
      if (!phone) throw new HttpError(400, `请填写${field.label}`);
      if (!isPhone(phone)) throw new HttpError(400, '请输入正确的 11 位手机号');
      continue;
    }

    if (fieldsService.CORE_LIMITS[field.key] !== undefined) {
      const value = clean(body[field.key]);
      if (!value) {
        if (field.required) throw new HttpError(400, `请填写${field.label}`);
        core[field.key] = '';
        continue;
      }
      if (value.length > field.maxLength) {
        throw new HttpError(400, `${field.label}不能超过 ${field.maxLength} 个字符`);
      }
      core[field.key] = value;
      continue;
    }

    const source = body.extra && typeof body.extra === 'object' ? body.extra : {};
    const raw = source[field.key];
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!value) {
      if (field.required) throw new HttpError(400, `请填写${field.label}`);
      continue;
    }
    if (value.length > field.maxLength) {
      throw new HttpError(400, `${field.label}不能超过 ${field.maxLength} 个字符`);
    }
    if (field.type === 'select' && !(field.options || []).includes(value)) {
      throw new HttpError(400, `${field.label}的选项不合法`);
    }
    extra[field.key] = value;
  }

  return { ...core, extra, phone };
}

/** C 端获取活动信息（用于渲染表单页） */
router.get('/campaigns/:code', (req, res, next) => {
  try {
    const campaign = findCampaignByCode(req.params.code);
    res.json({
      code: campaign.code,
      name: campaign.name,
      subtitle: campaign.subtitle || fieldsService.DEFAULT_SUBTITLE,
      successText: campaign.successText || fieldsService.DEFAULT_SUCCESS_TEXT,
      startDate: campaign.startDate || '',
      endDate: campaign.endDate || '',
      status: campaign.status,
      submitEnabled: campaign.status === 'active',
      siteTitle: settingsService.get().siteTitle,
      formFields: fieldsService.toPublic(fieldsService.resolve(campaign))
    });
  } catch (err) {
    next(err);
  }
});

/** 发送短信验证码 */
router.post('/sms/send', async (req, res, next) => {
  try {
    const settings = settingsService.get();
    const campaign = requireActiveCampaign(req.body.campaignCode);
    const phone = clean(req.body.phone);
    if (!isPhone(phone)) throw new HttpError(400, '请输入正确的 11 位手机号');

    const phoneHash = hmac(phone);
    // 同一活动内已留资的手机号不重复发送
    const submitted = db.list('leads').some((l) => l.campaignId === campaign.id && l.phoneHash === phoneHash);
    if (submitted) throw new HttpError(400, '该手机号已在本活动提交过，无需重复填写');

    const rows = db.list('sms_codes');
    const now = Date.now();
    const today = formatTime(nowIso()).slice(0, 10);

    const lastSend = rows
      .filter((r) => r.phoneHash === phoneHash && r.status !== 'failed')
      .sort((a, b) => b.sendAt.localeCompare(a.sendAt))[0];

    if (lastSend) {
      const elapsed = (now - new Date(lastSend.sendAt).getTime()) / 1000;
      if (elapsed < settings.resendIntervalSeconds) {
        const retryAfter = Math.ceil(settings.resendIntervalSeconds - elapsed);
        throw new HttpError(429, `发送过于频繁，请 ${retryAfter} 秒后再试`, { retryAfter });
      }
    }

    const todayCount = rows.filter(
      (r) => r.phoneHash === phoneHash && dateStrOf(r.sendAt) === today
    ).length;
    if (todayCount >= settings.dailyLimitPerPhone) {
      throw new HttpError(429, '该手机号今日验证码发送次数已达上限，请联系现场工作人员');
    }

    const ip = clientIp(req);
    const ipCount = rows.filter((r) => r.ip === ip && dateStrOf(r.sendAt) === today).length;
    if (ipCount >= 300) throw new HttpError(429, '当前网络请求过于频繁，请稍后再试');

    const code = randomSmsCode();
    const record = {
      id: uid(),
      campaignId: campaign.id,
      campaignCode: campaign.code,
      phoneHash,
      codeHash: hmac(`${phone}:${code}`),
      sendAt: nowIso(),
      expireAt: new Date(now + settings.codeExpireSeconds * 1000).toISOString(),
      verifyAttempts: 0,
      status: 'sent',
      ip,
      provider: settings.smsProvider,
      providerMsgId: '',
      error: ''
    };
    rows.push(record);
    db.save('sms_codes', rows);

    const result = await sendSms(phone, code, settings);
    if (!result.ok) {
      record.status = 'failed';
      record.error = result.error || '发送失败';
      db.save('sms_codes', rows);
      throw new HttpError(502, '验证码发送失败，请稍后重试');
    }
    record.provider = result.provider || settings.smsProvider;
    record.providerMsgId = result.msgId || '';
    db.save('sms_codes', rows);

    res.json({
      success: true,
      resendAfter: settings.resendIntervalSeconds,
      expireSeconds: settings.codeExpireSeconds,
      // 仅测试模式（mock）回显验证码，生产关闭
      devCode: settings.smsProvider === 'mock' && settings.smsTestMode ? code : undefined
    });
  } catch (err) {
    next(err);
  }
});

/** 提交留资信息 */
router.post('/leads', (req, res, next) => {
  try {
    const settings = settingsService.get();
    const campaign = requireActiveCampaign(req.body.campaignCode);
    const { name, company, position, phone, extra } = validateSubmission(fieldsService.resolve(campaign), req.body);
    const code = clean(req.body.code);

    if (!code) throw new HttpError(400, '请填写短信验证码');
    if (!isSmsCode(code)) throw new HttpError(400, '验证码为 6 位数字');

    const phoneHash = hmac(phone);
    const leads = db.list('leads');
    // 单场活动内同一手机号只能提交一次
    if (leads.some((l) => l.campaignId === campaign.id && l.phoneHash === phoneHash)) {
      throw new HttpError(400, '该手机号已在本活动提交过，无需重复填写');
    }

    const smsRows = db.list('sms_codes');
    const pending = smsRows
      .filter((r) => r.phoneHash === phoneHash && r.status === 'sent' && r.campaignCode === campaign.code)
      .sort((a, b) => b.sendAt.localeCompare(a.sendAt))[0];

    if (!pending) throw new HttpError(400, '请先获取短信验证码');
    if (new Date(pending.expireAt).getTime() < Date.now()) {
      pending.status = 'expired';
      db.save('sms_codes', smsRows);
      throw new HttpError(400, '验证码已过期，请重新获取');
    }
    if (pending.verifyAttempts >= settings.maxVerifyAttempts) {
      pending.status = 'expired';
      db.save('sms_codes', smsRows);
      throw new HttpError(400, '验证码错误次数过多，请重新获取');
    }
    if (pending.codeHash !== hmac(`${phone}:${code}`)) {
      pending.verifyAttempts += 1;
      db.save('sms_codes', smsRows);
      const left = settings.maxVerifyAttempts - pending.verifyAttempts;
      throw new HttpError(400, left > 0 ? `验证码错误，还可尝试 ${left} 次` : '验证码错误次数过多，请重新获取');
    }

    pending.status = 'used';
    pending.usedAt = nowIso();
    db.save('sms_codes', smsRows);

    const clientInfo = {
      ip: clientIp(req),
      ua: String(req.headers['user-agent'] || '').slice(0, 300)
    };

    const lead = {
      id: uid(),
      campaignId: campaign.id,
      campaignCode: campaign.code,
      campaignName: campaign.name,
      name,
      company,
      position,
      phoneEncrypted: encrypt(phone),
      phoneMasked: maskPhone(phone),
      phoneHash,
      extra,
      smsVerified: true,
      source: 'qrcode',
      updateCount: 0,
      submittedAt: nowIso(),
      updatedAt: nowIso(),
      clientInfo
    };
    leads.push(lead);
    db.save('leads', leads);

    res.status(201).json({ id: lead.id, updated: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

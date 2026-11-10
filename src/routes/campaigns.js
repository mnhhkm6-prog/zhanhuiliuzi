const express = require('express');
const crypto = require('crypto');
const qrcode = require('qrcode');
const db = require('../db');
const auth = require('../auth');
const { HttpError, uid, nowIso, clean, isDateStr } = require('../utils');
const fieldsService = require('../formFields');

const router = express.Router();
router.use(auth.requireAdmin);

const STATUS = ['active', 'ended', 'disabled'];

function generateCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const campaigns = db.list('campaigns');
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += chars[crypto.randomInt(0, chars.length)];
    if (!campaigns.some((c) => c.code === code)) return code;
  }
}

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function validate(body) {
  const name = clean(body.name);
  const startDate = clean(body.startDate) || '';
  const endDate = clean(body.endDate) || '';
  const status = clean(body.status) || 'active';
  const subtitle = clean(body.subtitle) || '';
  const successText = clean(body.successText) || '';

  if (!name) throw new HttpError(400, '请填写活动名称');
  if (name.length > 60) throw new HttpError(400, '活动名称不能超过 60 个字符');
  if (subtitle.length > 500) throw new HttpError(400, '副标题不能超过 500 个字符');
  if (successText.length > 100) throw new HttpError(400, '提交成功提示语不能超过 100 个字符');
  if (startDate && !isDateStr(startDate)) throw new HttpError(400, '开始日期格式应为 YYYY-MM-DD');
  if (endDate && !isDateStr(endDate)) throw new HttpError(400, '结束日期格式应为 YYYY-MM-DD');
  if (startDate && endDate && startDate > endDate) throw new HttpError(400, '开始日期不能晚于结束日期');
  if (!STATUS.includes(status)) throw new HttpError(400, '活动状态不合法');

  return { name, startDate, endDate, status, subtitle, successText };
}

router.get('/', (req, res) => {
  const leads = db.list('leads');
  const list = db.list('campaigns')
    .map((c) => ({
      ...c,
      leadCount: leads.filter((l) => l.campaignId === c.id).length,
      formUrl: `${baseUrl(req)}/c/${c.code}`
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ list, total: list.length });
});

router.post('/', (req, res, next) => {
  try {
    const data = validate(req.body);
    const campaigns = db.list('campaigns');
    const campaign = {
      id: uid(),
      code: generateCode(),
      ...data,
      formFields: fieldsService.defaults(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    campaigns.push(campaign);
    db.save('campaigns', campaigns);
    res.status(201).json({ ...campaign, leadCount: 0, formUrl: `${baseUrl(req)}/c/${campaign.code}` });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const campaigns = db.list('campaigns');
    const campaign = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) throw new HttpError(404, '活动不存在');

    const data = validate(req.body);
    // 未提交的文案字段保留原值（如启停操作）
    if (req.body.subtitle === undefined) delete data.subtitle;
    if (req.body.successText === undefined) delete data.successText;
    Object.assign(campaign, data, { updatedAt: nowIso() });
    db.save('campaigns', campaigns);

    const leads = db.list('leads');
    leads.forEach((l) => {
      if (l.campaignId === campaign.id) l.campaignName = campaign.name;
    });
    db.save('leads', leads);

    res.json({
      ...campaign,
      leadCount: leads.filter((l) => l.campaignId === campaign.id).length,
      formUrl: `${baseUrl(req)}/c/${campaign.code}`
    });
  } catch (err) {
    next(err);
  }
});

/** 生成活动二维码：默认 PNG，format=svg 返回矢量图 */
router.get('/:id/qrcode', async (req, res, next) => {
  try {
    const campaign = db.list('campaigns').find((c) => c.id === req.params.id);
    if (!campaign) throw new HttpError(404, '活动不存在');

    const url = `${baseUrl(req)}/c/${campaign.code}`;
    const download = req.query.download === '1';

    if (req.query.format === 'svg') {
      const svg = await qrcode.toString(url, { type: 'svg', margin: 1, width: 600 });
      res.type('image/svg+xml');
      if (download) res.setHeader('Content-Disposition', `attachment; filename="qrcode-${campaign.code}.svg"`);
      return res.send(svg);
    }

    const buffer = await qrcode.toBuffer(url, { width: 600, margin: 1 });
    res.type('image/png');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="qrcode-${campaign.code}.png"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/** 读取活动表单配置（含页面文案） */
router.get('/:id/form-fields', (req, res, next) => {
  try {
    const campaign = db.list('campaigns').find((c) => c.id === req.params.id);
    if (!campaign) throw new HttpError(404, '活动不存在');
    res.json({
      campaignId: campaign.id,
      subtitle: campaign.subtitle || fieldsService.DEFAULT_SUBTITLE,
      successText: campaign.successText || fieldsService.DEFAULT_SUCCESS_TEXT,
      fields: fieldsService.resolve(campaign)
    });
  } catch (err) {
    next(err);
  }
});

/** 保存活动表单字段配置 */
router.put('/:id/form-fields', (req, res, next) => {
  try {
    const campaigns = db.list('campaigns');
    const campaign = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) throw new HttpError(404, '活动不存在');

    campaign.formFields = fieldsService.normalize(req.body.fields);
    campaign.updatedAt = nowIso();
    db.save('campaigns', campaigns);

    res.json({ campaignId: campaign.id, fields: campaign.formFields });
  } catch (err) {
    next(err);
  }
});

/** 删除活动：已有留资数据的活动不允许删除，避免数据丢失 */
router.delete('/:id', (req, res, next) => {
  try {
    const campaigns = db.list('campaigns');
    const index = campaigns.findIndex((c) => c.id === req.params.id);
    if (index === -1) throw new HttpError(404, '活动不存在');

    const leadCount = db.list('leads').filter((l) => l.campaignId === req.params.id).length;
    if (leadCount > 0) {
      throw new HttpError(400, `该活动已有 ${leadCount} 条留资数据，不能删除；如不再使用请改为「停用」`);
    }

    campaigns.splice(index, 1);
    db.save('campaigns', campaigns);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

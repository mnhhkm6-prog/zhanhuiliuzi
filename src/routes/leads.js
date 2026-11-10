const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../db');
const auth = require('../auth');
const { EXPORT_DIR } = require('../db');
const { HttpError, uid, nowIso, decrypt, maskPhone, clean, formatTime, isDateStr } = require('../utils');

const router = express.Router();
router.use(auth.requireAdmin);

function filterLeads(query) {
  let rows = db.list('leads').slice();

  const campaignId = clean(query.campaignId);
  if (campaignId) rows = rows.filter((l) => l.campaignId === campaignId);

  const from = clean(query.from);
  const to = clean(query.to);
  if (from) {
    if (!isDateStr(from)) throw new HttpError(400, '开始日期格式应为 YYYY-MM-DD');
    rows = rows.filter((l) => formatTime(l.submittedAt).slice(0, 10) >= from);
  }
  if (to) {
    if (!isDateStr(to)) throw new HttpError(400, '结束日期格式应为 YYYY-MM-DD');
    rows = rows.filter((l) => formatTime(l.submittedAt).slice(0, 10) <= to);
  }

  const keyword = clean(query.keyword);
  if (keyword) {
    const kw = keyword.toLowerCase();
    const digits = /^\d{3,11}$/.test(keyword);
    rows = rows.filter((l) => {
      if ((l.name || '').toLowerCase().includes(kw)) return true;
      if ((l.company || '').toLowerCase().includes(kw)) return true;
      if (digits && decrypt(l.phoneEncrypted).includes(keyword)) return true;
      return false;
    });
  }

  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

function toSummary(lead) {
  return {
    id: lead.id,
    campaignId: lead.campaignId,
    campaignName: lead.campaignName,
    name: lead.name,
    company: lead.company,
    position: lead.position,
    phoneMasked: lead.phoneMasked || maskPhone(decrypt(lead.phoneEncrypted)),
    extra: lead.extra || {},
    smsVerified: !!lead.smsVerified,
    updateCount: lead.updateCount || 0,
    submittedAt: lead.submittedAt,
    updatedAt: lead.updatedAt
  };
}

function filterSnapshot(query) {
  return {
    campaignId: clean(query.campaignId) || '',
    from: clean(query.from) || '',
    to: clean(query.to) || '',
    keyword: clean(query.keyword) || ''
  };
}

router.get('/', (req, res, next) => {
  try {
    const rows = filterLeads(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const start = (page - 1) * pageSize;

    res.json({
      list: rows.slice(start, start + pageSize).map(toSummary),
      total: rows.length,
      page,
      pageSize
    });
  } catch (err) {
    next(err);
  }
});

/** 汇总本批数据涉及的自定义字段列（按活动配置的标题） */
function buildExtraColumns(rows) {
  const campaigns = db.list('campaigns');
  const labels = new Map();
  rows.forEach((lead) => {
    const campaign = campaigns.find((c) => c.id === lead.campaignId);
    const fields = (campaign && campaign.formFields) || [];
    Object.keys(lead.extra || {}).forEach((key) => {
      if (labels.has(key)) return;
      const field = fields.find((f) => f.key === key);
      labels.set(key, field ? field.label : key);
    });
  });
  return [...labels.entries()].map(([key, label]) => ({ key: 'extra_' + key, label }));
}

/** Excel 导出（必须在 /:id 之前注册） */
router.get('/export', async (req, res, next) => {
  try {
    const rows = filterLeads(req.query);
    if (rows.length === 0) throw new HttpError(400, '当前条件下没有可导出的数据');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '展会留资系统';
    workbook.created = new Date();

    const extraColumns = buildExtraColumns(rows);

    const sheet = workbook.addWorksheet('留资数据');
    sheet.columns = [
      { header: '姓名', key: 'name', width: 14 },
      { header: '公司名称', key: 'company', width: 32 },
      { header: '职位', key: 'position', width: 18 },
      { header: '手机号', key: 'phone', width: 16 },
      ...extraColumns.map((col) => ({ header: col.label, key: col.key, width: 20 })),
      { header: '所属活动', key: 'campaignName', width: 28 },
      { header: '短信验证', key: 'smsVerified', width: 10 },
      { header: '提交时间', key: 'submittedAt', width: 20 },
      { header: '更新时间', key: 'updatedAt', width: 20 },
      { header: '更新次数', key: 'updateCount', width: 10 }
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FB' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;

    rows.forEach((lead) => {
      const row = {
        name: lead.name,
        company: lead.company,
        position: lead.position,
        phone: decrypt(lead.phoneEncrypted),
        campaignName: lead.campaignName,
        smsVerified: lead.smsVerified ? '已验证' : '未验证',
        submittedAt: formatTime(lead.submittedAt),
        updatedAt: formatTime(lead.updatedAt || lead.submittedAt),
        updateCount: lead.updateCount || 0
      };
      extraColumns.forEach((col) => {
        const key = col.key.slice('extra_'.length);
        row[col.key] = (lead.extra && lead.extra[key]) || '';
      });
      sheet.addRow(row);
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: 'A1',
      to: `${String.fromCharCode(64 + sheet.columnCount)}1`
    };

    const buffer = await workbook.xlsx.writeBuffer();

    const id = uid();
    const campaignName = filterSnapshot(req.query).campaignId
      ? (db.list('campaigns').find((c) => c.id === filterSnapshot(req.query).campaignId) || {}).name || '活动'
      : '全部活动';
    const stamp = formatTime(nowIso()).replace(/[-: ]/g, '').slice(0, 14);
    const fileName = `留资数据_${campaignName}_${stamp}.xlsx`;
    const storedName = `${id}.xlsx`;
    fs.writeFileSync(path.join(EXPORT_DIR, storedName), Buffer.from(buffer));

    const logs = db.list('export_logs');
    logs.push({
      id,
      adminId: req.admin.id,
      adminName: req.admin.username,
      filterSnapshot: filterSnapshot(req.query),
      rowCount: rows.length,
      fileName,
      storedName,
      fileSize: buffer.byteLength,
      createdAt: nowIso()
    });
    db.save('export_logs', logs);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('X-Row-Count', String(rows.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="leads.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

router.get('/export-logs', (req, res) => {
  const camps = db.list('campaigns');
  const list = db.list('export_logs')
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((log) => ({
      ...log,
      campaignName: log.filterSnapshot && log.filterSnapshot.campaignId
        ? (camps.find((c) => c.id === log.filterSnapshot.campaignId) || {}).name || '已删除活动'
        : '全部活动'
    }));
  res.json({ list, total: list.length });
});

router.get('/export-logs/:id/download', (req, res, next) => {
  try {
    const log = db.list('export_logs').find((l) => l.id === req.params.id);
    if (!log) throw new HttpError(404, '导出记录不存在');
    const filePath = path.join(EXPORT_DIR, log.storedName);
    if (!fs.existsSync(filePath)) throw new HttpError(404, '导出文件已失效，请重新导出');
    res.download(filePath, log.fileName);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const lead = db.list('leads').find((l) => l.id === req.params.id);
    if (!lead) throw new HttpError(404, '留资记录不存在');
    res.json({
      ...toSummary(lead),
      source: lead.source,
      clientInfo: lead.clientInfo || {},
      lastClientInfo: lead.lastClientInfo || null
    });
  } catch (err) {
    next(err);
  }
});

/** 查看完整手机号（记录查看行为） */
router.get('/:id/phone', (req, res, next) => {
  try {
    const lead = db.list('leads').find((l) => l.id === req.params.id);
    if (!lead) throw new HttpError(404, '留资记录不存在');

    const logs = db.list('phone_views');
    logs.push({
      id: uid(),
      leadId: lead.id,
      adminId: req.admin.id,
      adminName: req.admin.username,
      viewedAt: nowIso()
    });
    db.save('phone_views', logs);

    res.json({ id: lead.id, phone: decrypt(lead.phoneEncrypted) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

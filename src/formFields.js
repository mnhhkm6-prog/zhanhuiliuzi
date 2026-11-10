const crypto = require('crypto');
const { HttpError, clean } = require('./utils');

const DEFAULT_SUBTITLE = '填写以下信息，现场领取资料 / 礼品';
const DEFAULT_SUCCESS_TEXT = '感谢您的填写，请向现场工作人员领取资料';

const CORE_LABELS = { name: '姓名', company: '公司名称', position: '职位' };
const CORE_LIMITS = { name: 30, company: 100, position: 50 };

function coreField(key, label, required) {
  return {
    key,
    label,
    type: 'text',
    required: required !== false,
    locked: false,
    placeholder: '',
    options: [],
    maxLength: CORE_LIMITS[key]
  };
}

/** 手机号 + 短信验证码，固定项，不可删除/改类型 */
function phoneField() {
  return {
    key: 'phone',
    label: '手机号',
    type: 'phone',
    required: true,
    locked: true,
    placeholder: '',
    options: [],
    maxLength: 11
  };
}

function defaults() {
  return [coreField('name', CORE_LABELS.name), coreField('company', CORE_LABELS.company), coreField('position', CORE_LABELS.position), phoneField()];
}

/** 老数据没有 formFields 时回落到默认字段；已有配置但缺手机号时补齐（手机号为必选项） */
function resolve(campaign) {
  const fields = campaign && Array.isArray(campaign.formFields) ? campaign.formFields : [];
  if (!fields.length) return defaults();
  return fields.some((f) => f.key === 'phone') ? fields : [...fields, phoneField()];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 规范化字段配置：核心字段可改标题/必填/顺序，手机号固定且必然存在 */
function normalize(raw) {
  if (raw === undefined || raw === null) return defaults();
  if (!Array.isArray(raw)) throw new HttpError(400, '表单字段格式不正确');
  if (raw.length > 14) throw new HttpError(400, '表单字段最多 14 个');

  const used = new Set();
  const result = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const key = clean(item.key) || '';

    if (key === 'phone') {
      if (!used.has('phone')) {
        used.add('phone');
        result.push(phoneField());
      }
      return;
    }

    if (CORE_LIMITS[key] !== undefined) {
      if (used.has(key)) return;
      const label = clean(item.label) || CORE_LABELS[key];
      if (label.length > 30) throw new HttpError(400, `字段标题「${label}」不能超过 30 个字符`);
      used.add(key);
      result.push(coreField(key, label, item.required !== false));
      return;
    }

    const label = clean(item.label);
    if (!label) throw new HttpError(400, `第 ${index + 1} 个字段缺少标题`);
    if (label.length > 30) throw new HttpError(400, `字段标题「${label}」不能超过 30 个字符`);

    const type = ['text', 'textarea', 'select'].includes(item.type) ? item.type : 'text';
    let fieldKey = /^f_[a-zA-Z0-9]{2,20}$/.test(key) && !used.has(key)
      ? key
      : 'f_' + crypto.randomBytes(4).toString('hex');
    used.add(fieldKey);

    let options = [];
    if (type === 'select') {
      const rawOptions = Array.isArray(item.options) ? item.options : String(item.options || '').split(/[,，|]/);
      options = [...new Set(rawOptions.map((o) => String(o).trim()).filter(Boolean))];
      if (options.length < 2) throw new HttpError(400, `「${label}」至少需要 2 个选项`);
      if (options.length > 20) throw new HttpError(400, `「${label}」选项不能超过 20 个`);
      if (options.some((o) => o.length > 30)) throw new HttpError(400, `「${label}」的单个选项不能超过 30 个字符`);
    }

    result.push({
      key: fieldKey,
      label,
      type,
      required: !!item.required,
      locked: false,
      placeholder: String(item.placeholder || '').trim().slice(0, 50),
      options,
      maxLength: type === 'textarea'
        ? clamp(Number(item.maxLength) || 500, 10, 1000)
        : clamp(Number(item.maxLength) || 100, 10, 200)
    });
  });

  if (!used.has('phone')) result.push(phoneField());
  return result;
}

/** 对外（C 端）精简结构 */
function toPublic(fields) {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: !!f.required,
    locked: !!f.locked,
    placeholder: f.placeholder || '',
    options: f.options || [],
    maxLength: f.maxLength
  }));
}

module.exports = { DEFAULT_SUBTITLE, DEFAULT_SUCCESS_TEXT, CORE_LIMITS, defaults, resolve, normalize, toPublic };

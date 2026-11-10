const db = require('./db');

const DEFAULTS = {
  // mock：本地测试不发短信；ihuyi：互亿无线；http：自定义三方短信网关
  smsProvider: 'mock',
  // 互亿无线
  ihuyiAccount: '',
  ihuyiApiKey: '',
  ihuyiTemplateId: '1',
  // 自定义 HTTP 网关
  smsEndpoint: '',
  smsAppKey: '',
  smsAppSecret: '',
  smsSignName: '',
  smsTemplateCode: '',
  // 测试模式下接口回显验证码，便于联调；上线需关闭
  smsTestMode: true,
  codeExpireSeconds: 300,
  resendIntervalSeconds: 60,
  dailyLimitPerPhone: 10,
  maxVerifyAttempts: 5,
  siteTitle: '展会留资登记'
};

/** 环境变量优先于后台配置，便于密钥不落库 */
function envOverrides() {
  const o = {};
  if (process.env.SMS_PROVIDER) o.smsProvider = process.env.SMS_PROVIDER;
  if (process.env.IHUYI_ACCOUNT) o.ihuyiAccount = process.env.IHUYI_ACCOUNT;
  if (process.env.IHUYI_API_KEY) o.ihuyiApiKey = process.env.IHUYI_API_KEY;
  if (process.env.IHUYI_TEMPLATE_ID) o.ihuyiTemplateId = process.env.IHUYI_TEMPLATE_ID;
  if (process.env.SMS_TEST_MODE !== undefined) o.smsTestMode = process.env.SMS_TEST_MODE === 'true';
  return o;
}

function get() {
  return { ...DEFAULTS, ...db.obj('settings', {}), ...envOverrides() };
}

function save(patch) {
  const next = { ...get(), ...patch };
  const persisted = { ...next };
  // 来自环境变量的密钥不落库，避免明文写入 data/settings.json
  if (process.env.IHUYI_API_KEY) persisted.ihuyiApiKey = '';
  if (process.env.IHUYI_ACCOUNT) persisted.ihuyiAccount = '';
  db.saveObj('settings', persisted);
  return next;
}

/** 返回给后台展示时隐藏密钥 */
function publicView() {
  const s = get();
  return {
    smsProvider: s.smsProvider,
    ihuyiAccount: s.ihuyiAccount,
    ihuyiApiKey: s.ihuyiApiKey ? '******' : '',
    ihuyiTemplateId: s.ihuyiTemplateId,
    smsEndpoint: s.smsEndpoint,
    smsAppKey: s.smsAppKey,
    smsAppSecret: s.smsAppSecret ? '******' : '',
    smsSignName: s.smsSignName,
    smsTemplateCode: s.smsTemplateCode,
    smsTestMode: !!s.smsTestMode,
    codeExpireSeconds: s.codeExpireSeconds,
    resendIntervalSeconds: s.resendIntervalSeconds,
    dailyLimitPerPhone: s.dailyLimitPerPhone,
    maxVerifyAttempts: s.maxVerifyAttempts,
    siteTitle: s.siteTitle,
    // 密钥来自环境变量时，后台不允许覆盖
    envLocked: {
      provider: !!process.env.SMS_PROVIDER,
      ihuyiAccount: !!process.env.IHUYI_ACCOUNT,
      ihuyiApiKey: !!process.env.IHUYI_API_KEY
    }
  };
}

module.exports = { DEFAULTS, get, save, publicView };

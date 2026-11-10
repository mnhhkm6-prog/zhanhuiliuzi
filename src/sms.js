/**
 * 短信服务：屏蔽三方差异，后台/环境变量可切换服务商，替换无需改业务代码。
 * - mock：不发真实短信，验证码打印到服务端日志
 * - ihuyi：互亿无线 https://api.ihuyi.com/sms/Submit.json（表单提交，code=2 成功）
 * - http：自定义网关，POST JSON { phone, code, signName, templateCode }，请求头 X-App-Key / X-App-Secret
 */

const IHUYI_ERRORS = {
  400: '非法 IP 访问，请在服务商后台配置服务器出口 IP',
  401: '账号不能为空',
  402: '密码不能为空',
  403: '手机号码不能为空',
  405: 'APIID 或 APIKEY 不正确',
  4050: '账号被冻结',
  40501: '动态密码已过期',
  40502: '动态密码校验失败',
  40504: '超出每天最大发送量',
  40505: '没有签订合同',
  4051: '剩余短信条数不足，请充值',
  4052: '访问 IP 与备案 IP 不符，请将服务器公网 IP 加入互亿无线 IP 白名单',
  4053: '用户不存在',
  4054: '账户无效',
  406: '手机号码格式不正确',
  407: '短信内容含有敏感字符',
  4070: '签名格式不正确',
  4071: '没有提交备案模板',
  4072: '短信内容与审核通过的模板不匹配',
  40722: '模板变量内容超过长度限制',
  4073: '短信内容超出长度限制',
  4074: '短信内容包含 emoji 符号',
  4075: '签名未通过审核',
  4077: '短信变量内容含有敏感字符',
  408: '发送超限，号码已被加入黑名单',
  4082: '超出同一手机号一天 100 条限制',
  4085: '同一手机号一天验证码发送超出 10 条',
  4086: '提交失败'
};

function parseIhuyiBody(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // 兼容 XML 返回
    const code = (text.match(/<code>([^<]*)<\/code>/) || [])[1];
    const msg = (text.match(/<msg>([^<]*)<\/msg>/) || [])[1];
    const smsid = (text.match(/<smsid>([^<]*)<\/smsid>/) || [])[1];
    if (code === undefined) return null;
    return { code, msg, smsid };
  }
}

/** 互亿无线：模板变量方式发送，content 只传验证码 */
async function sendViaIhuyi(phone, code, settings) {
  if (!settings.ihuyiAccount || !settings.ihuyiApiKey) {
    return { ok: false, error: '未配置互亿无线 APIID / APIKEY' };
  }

  const params = new URLSearchParams({
    account: settings.ihuyiAccount,
    password: settings.ihuyiApiKey,
    mobile: phone,
    content: code,
    templateid: String(settings.ihuyiTemplateId || '1')
  });

  try {
    const res = await fetch('https://api.ihuyi.com/sms/Submit.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(8000)
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `互亿无线接口返回 HTTP ${res.status}` };

    const body = parseIhuyiBody(text);
    if (!body) return { ok: false, error: '互亿无线返回内容无法解析' };

    const codeNum = Number(body.code);
    if (codeNum === 2) {
      return { ok: true, msgId: String(body.smsid || ''), provider: 'ihuyi' };
    }
    return {
      ok: false,
      error: `互亿无线错误 ${body.code}：${IHUYI_ERRORS[body.code] || body.msg || '提交失败'}`
    };
  } catch (err) {
    return { ok: false, error: '短信接口请求失败：' + err.message };
  }
}

async function sendViaHttp(phone, code, settings) {
  try {
    const res = await fetch(settings.smsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Key': settings.smsAppKey || '',
        'X-App-Secret': settings.smsAppSecret || ''
      },
      body: JSON.stringify({
        phone,
        code,
        signName: settings.smsSignName || '',
        templateCode: settings.smsTemplateCode || ''
      }),
      signal: AbortSignal.timeout(8000)
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `短信网关返回 ${res.status}: ${text.slice(0, 120)}` };
    let body = {};
    try {
      body = JSON.parse(text || '{}');
    } catch (_) {
      body = {};
    }
    return { ok: true, msgId: body.msgId || body.messageId || body.requestId || '', provider: 'http' };
  } catch (err) {
    return { ok: false, error: '短信网关请求失败: ' + err.message };
  }
}

async function sendSms(phone, code, settings) {
  if (settings.smsProvider === 'ihuyi') return sendViaIhuyi(phone, code, settings);
  if (settings.smsProvider === 'http' && settings.smsEndpoint) return sendViaHttp(phone, code, settings);

  console.log(`[SMS-MOCK] 手机号 ${phone} 验证码 ${code}（生产环境请切换为真实短信通道）`);
  return { ok: true, msgId: 'mock-' + Date.now(), provider: 'mock' };
}

module.exports = { sendSms };

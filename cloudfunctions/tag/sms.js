// 腾讯云短信（SendSms，API 3.0）。不装 SDK，直接按 TC3-HMAC-SHA256 签名发 HTTPS 请求。
// 要在云函数 tag 的环境变量里配：
//   SMS_SECRET_ID / SMS_SECRET_KEY  建议用只有短信权限的子账号密钥
//   SMS_SDK_APP_ID                  短信控制台“应用管理”里的 SDKAppID
//   SMS_SIGN_NAME                   审核通过的签名内容，比如：掉了么
//   SMS_TEMPLATE_VERIFY             验证码模板 ID（一个变量：验证码）
//   SMS_TEMPLATE_FOUND              捡到通知模板 ID（没有变量）
// 没配齐就当短信没开：绑定时不要求手机号，捡到时只发微信提醒。
const crypto = require('crypto');
const https = require('https');

const HOST = 'sms.tencentcloudapi.com';
const SERVICE = 'sms';
const VERSION = '2021-01-11';
const REGION = 'ap-guangzhou';

function config(env = process.env) {
  const c = {
    secretId: env.SMS_SECRET_ID || '',
    secretKey: env.SMS_SECRET_KEY || '',
    appId: env.SMS_SDK_APP_ID || '',
    sign: env.SMS_SIGN_NAME || '',
    verifyTemplate: env.SMS_TEMPLATE_VERIFY || '',
    foundTemplate: env.SMS_TEMPLATE_FOUND || ''
  };
  c.enabled = !!(c.secretId && c.secretKey && c.appId && c.sign && c.verifyTemplate && c.foundTemplate);
  return c;
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s, 'utf8').digest();

// 返回要带上的请求头。timestamp 是秒
function signRequest({ secretId, secretKey, action, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload)].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonicalRequest)].join('\n');
  const secretSigning = hmac(hmac(hmac(`TC3${secretKey}`, date), SERVICE), 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: HOST,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': VERSION,
    'X-TC-Region': REGION
  };
}

function post(headers, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, method: 'POST', path: '/', headers, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(new Error(`短信接口返回看不懂：${body.slice(0, 100)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('短信接口超时')));
    req.on('error', reject);
    req.end(payload);
  });
}

// 发一条短信。成功返回 'sent'，失败返回 'error 原因'（不抛出）
async function sendSms(c, phone, templateId, params, send = post) {
  if (!c.enabled) return 'error 短信没有配置';
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: c.appId,
    SignName: c.sign,
    TemplateId: templateId,
    TemplateParamSet: params
  });
  const headers = signRequest({ secretId: c.secretId, secretKey: c.secretKey, action: 'SendSms', payload, timestamp: Math.floor(Date.now() / 1000) });
  try {
    const res = await send(headers, payload);
    const r = (res && res.Response) || {};
    if (r.Error) return `error ${r.Error.Code} ${r.Error.Message}`.slice(0, 200);
    const status = (r.SendStatusSet || [])[0];
    if (status && status.Code === 'Ok') return 'sent';
    return `error ${status ? `${status.Code} ${status.Message}` : '没有返回发送结果'}`.slice(0, 200);
  } catch (err) {
    return `error ${err.message || err}`.slice(0, 200);
  }
}

module.exports = { config, signRequest, sendSms };

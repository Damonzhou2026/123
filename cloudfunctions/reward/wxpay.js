// 微信支付 API v3 的最小封装：请求签名、调起支付的签名、发请求。
// 商户配置全部从云函数环境变量读取，不能写进代码仓库。
const crypto = require('crypto');
const https = require('https');

const HOST = 'api.mch.weixin.qq.com';

function loadConfig(env) {
  const cfg = {
    mchid: env.WXPAY_MCHID,
    appid: env.WXPAY_APPID,
    serialNo: env.WXPAY_SERIAL_NO,
    // 环境变量里换行写成 \n
    privateKey: (env.WXPAY_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    notifyUrl: env.WXPAY_NOTIFY_URL,
    feeRate: env.REWARD_FEE_RATE === undefined ? 0.1 : Number(env.REWARD_FEE_RATE)
  };
  const missing = ['mchid', 'appid', 'serialNo', 'privateKey', 'notifyUrl'].filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`微信支付还没配置：缺少 ${missing.join(', ')}`);
  return cfg;
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function sign(message, privateKey) {
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

// 请求头里的 Authorization
function authorization(method, pathWithQuery, body, cfg, nonceStr, timestamp) {
  const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = sign(message, cfg.privateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`;
}

// 小程序 wx.requestPayment 需要的参数
function paymentParams(prepayId, cfg, nonceStr = nonce(), timestamp = String(Math.floor(Date.now() / 1000))) {
  const pkg = `prepay_id=${prepayId}`;
  return {
    timeStamp: timestamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign: sign(`${cfg.appid}\n${timestamp}\n${nonceStr}\n${pkg}\n`, cfg.privateKey)
  };
}

function request(cfg, method, pathWithQuery, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'shiguang-miniprogram',
    Authorization: authorization(method, pathWithQuery, body, cfg, nonce(), String(Math.floor(Date.now() / 1000)))
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path: pathWithQuery, method, headers, timeout: 10000 }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (err) { data = { raw }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('微信支付接口超时')));
    req.end(body);
  });
}

module.exports = { loadConfig, authorization, paymentParams, request, sign };

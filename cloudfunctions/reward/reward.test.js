// 运行：node cloudfunctions/reward/reward.test.js
const assert = require('assert');
const crypto = require('crypto');
const { computeSplit, makeOutTradeNo } = require('./split');
const wxpay = require('./wxpay');

// 拆分：服务费四舍五入到分，两部分加起来等于总额
assert.deepStrictEqual(computeSplit(5000, 0.1), { finderFen: 4500, feeFen: 500 });
assert.deepStrictEqual(computeSplit(2000, 0), { finderFen: 2000, feeFen: 0 });
assert.deepStrictEqual(computeSplit(1, 0.1), { finderFen: 1, feeFen: 0 });
const odd = computeSplit(3333, 0.15);
assert.strictEqual(odd.finderFen + odd.feeFen, 3333);
assert.throws(() => computeSplit(0, 0.1));
assert.throws(() => computeSplit(10.5, 0.1));
assert.throws(() => computeSplit(100, 1));
assert.throws(() => computeSplit(100, NaN));

// 订单号：只含允许的字符，不超过 32 位
const no = makeOutTradeNo('R', Date.now(), 'ab12cd34');
assert.ok(/^[A-Za-z0-9_\-*]{6,32}$/.test(no), no);
assert.ok(makeOutTradeNo('R', Number.MAX_SAFE_INTEGER, 'x'.repeat(40)).length <= 32);

// 配置缺项时报出缺了哪些
assert.throws(() => wxpay.loadConfig({}), /WXPAY_|mchid/);

// 签名：用临时生成的密钥对验证签名格式正确、能被公钥验证
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const cfg = wxpay.loadConfig({
  WXPAY_MCHID: '1900000001',
  WXPAY_APPID: 'wx1234567890',
  WXPAY_SERIAL_NO: 'SERIAL',
  WXPAY_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
  WXPAY_NOTIFY_URL: 'https://example.com/notify'
});
assert.strictEqual(cfg.feeRate, 0.1);

const auth = wxpay.authorization('POST', '/v3/pay/transactions/jsapi', '{"a":1}', cfg, 'NONCE', '1700000000');
assert.ok(auth.startsWith('WECHATPAY2-SHA256-RSA2048 mchid="1900000001",nonce_str="NONCE",signature="'));
const signature = auth.match(/signature="([^"]+)"/)[1];
const message = 'POST\n/v3/pay/transactions/jsapi\n1700000000\nNONCE\n{"a":1}\n';
assert.ok(crypto.createVerify('RSA-SHA256').update(message).verify(publicKey, signature, 'base64'));

const params = wxpay.paymentParams('wx201410272009395522657a690389285100', cfg, 'N2', '1700000001');
assert.strictEqual(params.package, 'prepay_id=wx201410272009395522657a690389285100');
assert.strictEqual(params.signType, 'RSA');
const payMessage = `wx1234567890\n1700000001\nN2\n${params.package}\n`;
assert.ok(crypto.createVerify('RSA-SHA256').update(payMessage).verify(publicKey, params.paySign, 'base64'));

console.log('reward tests passed');

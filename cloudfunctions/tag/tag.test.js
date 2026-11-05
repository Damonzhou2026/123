// 运行：node cloudfunctions/tag/tag.test.js
const assert = require('assert');
const { ALPHABET, randomCode, normalizeCode, normalizePhone, maskPhone, hashCode } = require('./codes');
const sms = require('./sms');

// 编号
for (let i = 0; i < 200; i++) {
  const c = randomCode();
  assert.strictEqual(c.length, 8);
  assert.ok([...c].every((ch) => ALPHABET.includes(ch)));
  assert.strictEqual(normalizeCode(c.toLowerCase()), c);
}
assert.strictEqual(normalizeCode('K7M2Q9XA'), 'K7M2Q9XA');
assert.strictEqual(normalizeCode('K7M2Q9X0'), ''); // 0 不在字母表里
assert.strictEqual(normalizeCode('K7M2Q9X'), '');
assert.strictEqual(normalizeCode(null), '');

// 手机号
assert.strictEqual(normalizePhone('138 0013 8000'), '13800138000');
assert.strictEqual(normalizePhone('+8613800138000'), '13800138000');
assert.strictEqual(normalizePhone('12800138000'), '');
assert.strictEqual(normalizePhone('1380013800'), '');
assert.strictEqual(maskPhone('13800138000'), '138****8000');
assert.strictEqual(maskPhone(''), '');

// 验证码哈希和 openid 绑定
assert.notStrictEqual(hashCode('123456', 'a'), hashCode('123456', 'b'));
assert.strictEqual(hashCode('123456', 'a'), hashCode('123456', 'a'));

// 短信配置：缺一项就算没开
assert.strictEqual(sms.config({}).enabled, false);
const env = {
  SMS_SECRET_ID: 'id', SMS_SECRET_KEY: 'key', SMS_SDK_APP_ID: '1400000000',
  SMS_SIGN_NAME: '掉了么', SMS_TEMPLATE_VERIFY: '1', SMS_TEMPLATE_FOUND: '2'
};
const c = sms.config(env);
assert.strictEqual(c.enabled, true);
assert.strictEqual(sms.config({ ...env, SMS_TEMPLATE_FOUND: '' }).enabled, false);

// 签名：格式对、同样输入结果相同、payload 变了签名就变
const h1 = sms.signRequest({ secretId: 'id', secretKey: 'key', action: 'SendSms', payload: '{}', timestamp: 1762300000 });
const h2 = sms.signRequest({ secretId: 'id', secretKey: 'key', action: 'SendSms', payload: '{}', timestamp: 1762300000 });
const h3 = sms.signRequest({ secretId: 'id', secretKey: 'key', action: 'SendSms', payload: '{"a":1}', timestamp: 1762300000 });
assert.match(h1.Authorization, /^TC3-HMAC-SHA256 Credential=id\/2025-11-04\/sms\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/);
assert.strictEqual(h1.Authorization, h2.Authorization);
assert.notStrictEqual(h1.Authorization, h3.Authorization);
assert.strictEqual(h1['X-TC-Version'], '2021-01-11');

(async () => {
  // 发送结果的解析
  let sent;
  const ok = await sms.sendSms(c, '13800138000', '2', [], async (headers, payload) => {
    sent = JSON.parse(payload);
    return { Response: { SendStatusSet: [{ Code: 'Ok' }] } };
  });
  assert.strictEqual(ok, 'sent');
  assert.deepStrictEqual(sent.PhoneNumberSet, ['+8613800138000']);
  assert.strictEqual(sent.SignName, '掉了么');
  const limited = await sms.sendSms(c, '13800138000', '2', [], async () => ({ Response: { SendStatusSet: [{ Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: '超过日上限' }] } }));
  assert.match(limited, /^error LimitExceeded/);
  const authFail = await sms.sendSms(c, '13800138000', '2', [], async () => ({ Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'x' } } }));
  assert.match(authFail, /^error AuthFailure/);
  const thrown = await sms.sendSms(c, '13800138000', '2', [], async () => { throw new Error('超时'); });
  assert.strictEqual(thrown, 'error 超时');
  assert.strictEqual(await sms.sendSms(sms.config({}), '13800138000', '2', []), 'error 短信没有配置');
  console.log('tag 测试通过');
})().catch((err) => { console.error(err); process.exit(1); });

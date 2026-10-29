const assert = require('assert');
const { markRisky } = require('./safety');

const out = markRisky([
  { mine: false, text: '你先转个邮费我给你寄过去' },
  { mine: false, text: '我到图书馆门口了' },
  { mine: true, text: '押金我不交' },
  { mine: false, text: '把验证码发我一下' }
]);
assert.strictEqual(out[0].risky, true);
assert.strictEqual(out[1].risky, undefined);
// 自己发的不提醒
assert.strictEqual(out[2].risky, undefined);
assert.strictEqual(out[3].risky, true);
console.log('safety ok');

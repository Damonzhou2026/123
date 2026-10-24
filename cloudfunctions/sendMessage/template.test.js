// 运行：node cloudfunctions/sendMessage/template.test.js
const assert = require('assert');
const { parseTemplate, buildData, beijingTime } = require('./template');

const fields = parseTemplate('发送人:{{name1.DATA}}\n消息内容:{{thing2.DATA}}\n发送时间：{{time3.DATA}}\n物品名称:{{thing4.DATA}}\n备注:{{thing5.DATA}}\n');
assert.deepStrictEqual(fields.map((f) => f.key), ['name1', 'thing2', 'time3', 'thing4', 'thing5']);
assert.strictEqual(fields[2].label, '发送时间');

const time = new Date('2026-10-24T02:31:00Z');
assert.strictEqual(beijingTime(time), '2026-10-24 10:31');

const data = buildData(fields, {
  text: '我到了，在\n服务台旁边，穿蓝色外套，你大概几点能到这里呢？',
  sender: '拾得者',
  title: '黑色钱包',
  time
});
assert.strictEqual(data.name1.value, '拾得者');
// thing 最多 20 个字，换行变空格
assert.strictEqual(data.thing2.value.length, 20);
assert.ok(data.thing2.value.startsWith('我到了，在 服务台'));
assert.strictEqual(data.time3.value, '2026-10-24 10:31');
assert.strictEqual(data.thing4.value, '黑色钱包');
assert.strictEqual(data.thing5.value, '对方发来新消息，点开回复');

// 其他常见写法
const other = buildData(parseTemplate('留言内容:{{thing1.DATA}}\n留言时间:{{date2.DATA}}\n状态:{{phrase3.DATA}}'), {
  text: '你好', sender: '失主', title: '钥匙', time
});
assert.deepStrictEqual(other, { thing1: { value: '你好' }, date2: { value: '2026-10-24' }, phrase3: { value: '新消息' } });

console.log('template tests passed');

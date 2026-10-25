// 运行：node cloudfunctions/createPost/notifyMatches.test.js
const assert = require('assert');
const { pickLostToNotify } = require('./notifyMatches');

const now = new Date('2026-10-25T08:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
const found = { _openid: 'finder', category: '钥匙', createdAt: now };

const lost = (id, owner, extra) => ({ _id: id, _openid: owner, category: '钥匙', createdAt: hoursAgo(2), distance: 200, ...extra });

const picks = pickLostToNotify(found, [
  lost('a', 'owner1'),
  lost('b', 'owner2', { category: '手机', distance: 4500 }), // 类别不同又远：分数不够
  lost('c', 'finder'), // 自己发的失物不提醒
  lost('d', 'owner1', { distance: 1000 }), // 同一个失主只提醒一次（取分高的 a）
  lost('e', 'owner3', { createdAt: hoursAgo(24 * 3) })
]);
assert.deepStrictEqual(picks.map((p) => p.lost._id), ['a', 'e']);
assert.ok(picks[0].score >= picks[1].score);

// 有照片向量时，照片明显不像就不提醒
const unit = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
const withPhoto = { ...found, embeddingSource: 'zhipu', embeddings: [unit(0)] };
assert.strictEqual(pickLostToNotify(withPhoto, [lost('f', 'owner4', { embeddingSource: 'zhipu', embeddings: [unit(80)] })]).length, 0);
assert.strictEqual(pickLostToNotify(withPhoto, [lost('g', 'owner4', { embeddingSource: 'zhipu', embeddings: [unit(5)] })]).length, 1);

console.log('notifyMatches tests passed');

// 运行：node cloudfunctions/findMatches/scoring.test.js
const assert = require('assert');
const { scoreMatch, cosine } = require('./scoring');

const now = new Date('2026-10-21T08:00:00Z');
const hoursLater = (h) => new Date(now.getTime() + h * 3600 * 1000);

// 余弦相似度
assert.strictEqual(cosine([1, 0], [1, 0]), 1);
assert.strictEqual(cosine([1, 0], [-1, 0]), 0);
assert.strictEqual(cosine([1, 0], [1, 0, 0]), null);
assert.strictEqual(cosine(null, [1]), null);
assert.strictEqual(cosine([0, 0], [1, 1]), null);

// 同类别、近距离、时间接近：没有图片时分数高
const lost = { category: '钥匙', createdAt: now };
const near = scoreMatch(lost, { category: '钥匙', createdAt: hoursLater(1) }, 300);
assert.strictEqual(near.imageCompared, false);
assert.ok(near.score > 0.9, `near score ${near.score}`);

// 类别不同、距离远：分数低
const far = scoreMatch(lost, { category: '手机', createdAt: hoursLater(24 * 10) }, 4800);
assert.ok(far.score < 0.35, `far score ${far.score}`);

// 超出距离和时间窗口的项不会出现负分
const outside = scoreMatch(lost, { category: '手机', createdAt: hoursLater(24 * 30) }, 9000);
assert.strictEqual(outside.score, 0);

// 有图片向量时以图片为主：同类别但图片完全相反，分数被拉低
const withImg = scoreMatch(
  { ...lost, embedding: [1, 0] },
  { category: '钥匙', createdAt: hoursLater(1), embedding: [-1, 0] },
  300
);
assert.strictEqual(withImg.imageCompared, true);
assert.ok(withImg.score < 0.45, `image-mismatch score ${withImg.score}`);

console.log('scoring tests passed');

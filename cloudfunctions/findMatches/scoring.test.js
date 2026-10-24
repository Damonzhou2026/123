// 运行：node cloudfunctions/findMatches/scoring.test.js
const assert = require('assert');
const { scoreMatch, cosine, imageSimilarity } = require('./scoring');

const now = new Date('2026-10-21T08:00:00Z');
const hoursLater = (h) => new Date(now.getTime() + h * 3600 * 1000);

// 余弦相似度
assert.strictEqual(cosine([1, 0], [1, 0]), 1);
assert.strictEqual(cosine([1, 0], [-1, 0]), -1);
assert.strictEqual(cosine([1, 0], [0, 1]), 0);
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

// 照片相似度：多张照片取最像的一对；无关照片（余弦 0.4 以下）记 0
const unit = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
assert.strictEqual(imageSimilarity({ embeddings: [unit(90), unit(0)] }, { embeddings: [unit(0)] }), 1);
assert.strictEqual(imageSimilarity({ embeddings: [unit(0)] }, { embeddings: [unit(80)] }), 0);
assert.strictEqual(imageSimilarity({ embeddings: [] }, { embeddings: [unit(0)] }), null);
assert.strictEqual(imageSimilarity({}, { embeddings: [unit(0)] }), null);
// 旧数据只有 embedding 字段也能比
assert.strictEqual(imageSimilarity({ embedding: unit(0) }, { embeddings: [unit(0)] }), 1);
const mid = imageSimilarity({ embeddings: [unit(0)] }, { embeddings: [unit(45)] });
assert.ok(mid > 0.6 && mid < 0.7, `mid similarity ${mid}`);

// 同一件东西的照片（很像）：即使距离稍远，分数也高
const samePhoto = scoreMatch(
  { ...lost, embeddings: [unit(0)] },
  { category: '钥匙', createdAt: hoursLater(24 * 3), embeddings: [unit(10)] },
  2500
);
assert.strictEqual(samePhoto.imageCompared, true);
assert.ok(samePhoto.score > 0.8, `same-photo score ${samePhoto.score}`);

// 同类别、很近，但照片明显不是同一件：分数远低于照片很像的
const otherKeys = scoreMatch(
  { ...lost, embeddings: [unit(0)] },
  { category: '钥匙', createdAt: hoursLater(1), embeddings: [unit(75)] },
  300
);
assert.ok(otherKeys.score < 0.4, `other-keys score ${otherKeys.score}`);

// 不同来源的向量不比；智谱的门槛更高
assert.strictEqual(
  imageSimilarity({ embeddingSource: 'zhipu', embeddings: [unit(0)] }, { embeddingSource: 'dashscope', embeddings: [unit(0)] }),
  null
);
const cos50 = unit(Math.acos(0.5) * 180 / Math.PI);
assert.strictEqual(imageSimilarity({ embeddingSource: 'zhipu', embeddings: [unit(0)] }, { embeddingSource: 'zhipu', embeddings: [cos50] }), 0);
assert.ok(imageSimilarity({ embeddingSource: 'dashscope', embeddings: [unit(0)] }, { embeddingSource: 'dashscope', embeddings: [cos50] }) > 0.2);

console.log('scoring tests passed');

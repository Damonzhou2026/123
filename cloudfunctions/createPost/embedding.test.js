// 运行：node cloudfunctions/createPost/embedding.test.js
const assert = require('assert');
const { parseEmbedding, fetchEmbeddings } = require('./embedding');

// 百炼接口的返回格式
assert.deepStrictEqual(
  parseEmbedding({ output: { embeddings: [{ index: 0, type: 'image', embedding: [0.1234567, -0.5] }] } }),
  [0.12346, -0.5]
);
// 出错时返回 { code, message }，没有 output
assert.strictEqual(parseEmbedding({ code: 'InvalidApiKey', message: 'bad key' }), null);
assert.strictEqual(parseEmbedding(null), null);
assert.strictEqual(parseEmbedding({ output: { embeddings: [{ embedding: [] }] } }), null);

// 没配置 API Key 时不请求，返回空数组
delete process.env.DASHSCOPE_API_KEY;
fetchEmbeddings(['https://example.com/a.jpg']).then((list) => {
  assert.deepStrictEqual(list, []);
  console.log('embedding tests passed');
});

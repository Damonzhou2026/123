// 运行：node cloudfunctions/createPost/embedding.test.js
const assert = require('assert');
const { parseDashscope, parseZhipuEmbedding, parseZhipuText, fetchEmbeddings } = require('./embedding');

// 百炼接口的返回格式
assert.deepStrictEqual(
  parseDashscope({ output: { embeddings: [{ index: 0, type: 'image', embedding: [0.1234567, -0.5] }] } }),
  [0.12346, -0.5]
);
// 出错时返回 { code, message }，没有 output
assert.strictEqual(parseDashscope({ code: 'InvalidApiKey', message: 'bad key' }), null);
assert.strictEqual(parseDashscope(null), null);
assert.strictEqual(parseDashscope({ output: { embeddings: [{ embedding: [] }] } }), null);

// 智谱的返回格式
assert.deepStrictEqual(parseZhipuEmbedding({ data: [{ index: 0, embedding: [0.333333333, 1] }] }), [0.33333, 1]);
assert.strictEqual(parseZhipuEmbedding({ error: { code: '1113', message: '余额不足' } }), null);
assert.strictEqual(parseZhipuText({ choices: [{ message: { content: '  黑色皮质钱包，带金色扣  ' } }] }), '黑色皮质钱包，带金色扣');
assert.strictEqual(parseZhipuText({ choices: [{ message: { content: '' } }] }), '');
assert.strictEqual(parseZhipuText({ error: { message: 'x' } }), '');

// 没配置 Key 时不请求，返回空
delete process.env.DASHSCOPE_API_KEY;
delete process.env.ZHIPU_API_KEY;
fetchEmbeddings(['https://example.com/a.jpg']).then((result) => {
  assert.deepStrictEqual(result, { source: '', embeddings: [], description: '' });
  console.log('embedding tests passed');
});

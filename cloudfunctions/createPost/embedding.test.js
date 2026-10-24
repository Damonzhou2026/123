// 运行：node cloudfunctions/createPost/embedding.test.js
const assert = require('assert');
const { parseDashscope, parseZhipuEmbedding, parseZhipuText, describeError, fetchEmbeddings } = require('./embedding');

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

// 错误整理成一句话
assert.strictEqual(
  describeError('智谱看图', { status: 401, body: { error: { code: '1000', message: '身份验证失败' } }, error: '' }),
  '智谱看图：HTTP 401 1000 身份验证失败'
);
assert.strictEqual(describeError('智谱看图', { status: 0, body: null, error: '请求超时' }), '智谱看图：请求超时');

// 没配置 Key 时不请求，返回空
delete process.env.DASHSCOPE_API_KEY;
delete process.env.ZHIPU_API_KEY;
fetchEmbeddings({}, ['cloud://a.jpg']).then((result) => {
  assert.deepStrictEqual(result, { source: '', embeddings: [], description: '', error: '' });
  // 照片下载失败时记下原因
  process.env.ZHIPU_API_KEY = 'test';
  return fetchEmbeddings({ downloadFile: () => Promise.reject(new Error('x')) }, ['cloud://a.jpg']);
}).then((result) => {
  assert.strictEqual(result.error, '下载照片失败');
  console.log('embedding tests passed');
});

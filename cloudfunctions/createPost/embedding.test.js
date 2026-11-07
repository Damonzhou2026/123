// 运行：node cloudfunctions/createPost/embedding.test.js
const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');
const { parseDashscope, parseZhipuEmbedding, parseZhipuText, describeError, fetchEmbeddings, isRateLimited, fallbackModel } = require('./embedding');

// 假的智谱接口：handler(payload) 返回 { status, body }，记下每次请求的 payload
const calls = [];
function mockZhipu(handler) {
  calls.length = 0;
  https.request = (url, options, onRes) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = (data) => {
      const payload = JSON.parse(data);
      calls.push({ url, payload });
      const { status, body } = handler(payload, url);
      const res = new EventEmitter();
      res.statusCode = status;
      onRes(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    };
    return req;
  };
}
const photoCloud = { downloadFile: () => Promise.resolve({ fileContent: Buffer.from('img') }) };
const limited = { status: 429, body: { error: { code: '1302', message: '并发数过高' } } };
const described = { status: 200, body: { choices: [{ message: { content: '黑色钥匙串，挂小熊' } }] } };
const embedded = { status: 200, body: { data: [{ embedding: [0.6, 0.8] }] } };
// 免费看图模型一直被限流，其他都正常
const busyFree = (payload) => (payload.input ? embedded : payload.model === 'glm-4.6v-flash' ? limited : described);

// 限流的几种样子
assert.strictEqual(isRateLimited({ status: 429, body: null }), true);
assert.strictEqual(isRateLimited({ status: 200, body: { error: { code: 1305 } } }), true);
assert.strictEqual(isRateLimited({ status: 401, body: { error: { code: '1000' } } }), false);
assert.strictEqual(isRateLimited(null), false);
// 备用模型默认 flashx，填 off 关掉
delete process.env.ZHIPU_FALLBACK_MODEL;
assert.strictEqual(fallbackModel(), 'glm-4.6v-flashx');
process.env.ZHIPU_FALLBACK_MODEL = 'off';
assert.strictEqual(fallbackModel(), '');
delete process.env.ZHIPU_FALLBACK_MODEL;

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
  assert.deepStrictEqual(result, { source: '', embeddings: [], description: '', model: '', error: '' });
  // 照片下载失败时记下原因
  process.env.ZHIPU_API_KEY = 'test';
  return fetchEmbeddings({ downloadFile: () => Promise.reject(new Error('x')) }, ['cloud://a.jpg']);
}).then((result) => {
  assert.strictEqual(result.error, '下载照片失败');
  // 没照片也没描述：不请求
  return fetchEmbeddings(photoCloud, [], '  ');
}).then((result) => {
  assert.deepStrictEqual(result.embeddings, []);
  // 免费模型一直被限流：重试一次，再换备用模型
  mockZhipu(busyFree);
  return fetchEmbeddings(photoCloud, ['cloud://a.jpg']);
}).then((result) => {
  assert.deepStrictEqual(calls.map((c) => c.payload.model), ['glm-4.6v-flash', 'glm-4.6v-flash', 'glm-4.6v-flashx', 'embedding-3']);
  assert.strictEqual(result.model, 'glm-4.6v-flashx');
  assert.strictEqual(result.description, '黑色钥匙串，挂小熊');
  assert.deepStrictEqual(result.embeddings, [[0.6, 0.8]]);
  assert.strictEqual(result.error, '');
  // 关掉备用模型时，限流就记成错误，留给定时补跑
  process.env.ZHIPU_FALLBACK_MODEL = 'off';
  mockZhipu(busyFree);
  return fetchEmbeddings(photoCloud, ['cloud://a.jpg']);
}).then((result) => {
  delete process.env.ZHIPU_FALLBACK_MODEL;
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(result.embeddings, []);
  assert.ok(result.error.includes('1302'), result.error);
  // 不是限流的错误（比如 Key 不对）不换备用模型
  mockZhipu(() => ({ status: 401, body: { error: { code: '1000', message: '身份验证失败' } } }));
  return fetchEmbeddings(photoCloud, ['cloud://a.jpg']);
}).then((result) => {
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(result.error, '智谱看图（glm-4.6v-flash）：HTTP 401 1000 身份验证失败');
  // 没照片的失物：直接把文字变成向量，不调看图模型
  mockZhipu(() => embedded);
  return fetchEmbeddings(photoCloud, [], '黑色钥匙串，挂小熊');
}).then((result) => {
  assert.deepStrictEqual(calls.map((c) => c.payload.model), ['embedding-3']);
  assert.strictEqual(calls[0].payload.input, '黑色钥匙串，挂小熊');
  assert.deepStrictEqual(result, { source: 'zhipu', embeddings: [[0.6, 0.8]], description: '黑色钥匙串，挂小熊', model: 'text', error: '' });
  // 配的是百炼时，没照片就不算向量（百炼的文字和图片向量不在一个尺度上）
  process.env.DASHSCOPE_API_KEY = 'test';
  return fetchEmbeddings(photoCloud, [], '黑色钥匙串');
}).then((result) => {
  delete process.env.DASHSCOPE_API_KEY;
  assert.deepStrictEqual(result.embeddings, []);
  console.log('embedding tests passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

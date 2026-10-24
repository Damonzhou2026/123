// 照片特征向量：调用阿里云百炼的通义多模态向量模型。
// 在 createPost 云函数的环境变量里配置 DASHSCOPE_API_KEY 后启用；没配置时返回空数组，
// 匹配只按类别、距离、时间打分。
// 计费约 0.0005 元 / 千 Token，一张图默认约 400 Token，也就是每张照片约 0.0002 元。
const https = require('https');

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const DEFAULT_MODEL = 'tongyi-embedding-vision-plus-2026-03-06';
// 512 维足够区分物品，存进数据库也不占地方
const DEFAULT_DIMENSION = 512;
const TIMEOUT_MS = 8000;

function postJson(url, apiKey, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

// 从接口返回里取出向量，保留 5 位小数，减少存储
function parseEmbedding(response) {
  const item = response && response.output && Array.isArray(response.output.embeddings) && response.output.embeddings[0];
  if (!item || !Array.isArray(item.embedding) || item.embedding.length === 0) return null;
  return item.embedding.map((x) => Math.round(x * 1e5) / 1e5);
}

async function fetchEmbedding(imageUrl) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !imageUrl) return null;
  const response = await postJson(ENDPOINT, apiKey, {
    model: process.env.EMBEDDING_MODEL || DEFAULT_MODEL,
    input: { contents: [{ image: imageUrl }] },
    parameters: { dimension: Number(process.env.EMBEDDING_DIMENSION) || DEFAULT_DIMENSION }
  });
  if (response && !response.output) {
    console.error('图片向量接口出错', response.code, response.message);
  }
  return parseEmbedding(response);
}

// 每张照片各算一个向量（不同角度都能比）。失败的照片跳过。
async function fetchEmbeddings(imageUrls) {
  const results = await Promise.all(imageUrls.map(fetchEmbedding));
  return results.filter(Boolean);
}

module.exports = { fetchEmbeddings, parseEmbedding };

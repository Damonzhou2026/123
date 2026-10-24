// 照片特征向量，支持两家，在 createPost 云函数的环境变量里配一个 Key 就启用：
//
// - ZHIPU_API_KEY（智谱）：先让免费的 GLM-4.6V-Flash 看图写一段物品描述，
//   再用 embedding-3 把描述变成向量。看的是“是什么、什么颜色、什么牌子”，
//   费用几乎为零（看图免费，向量 0.5 元 / 百万 Token）。
// - DASHSCOPE_API_KEY（阿里云百炼）：通义多模态向量直接把照片变成向量，
//   对外观细节更敏感。每张照片约 0.0002 元。
//
// 两个都配时用百炼。都没配时返回空，匹配只按类别、距离、时间打分。
// 不同来源的向量不能互相比较，所以结果里带上 source，存进数据库。
const https = require('https');

const TIMEOUT_MS = 15000;
const DIMENSION = 512;

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const DASHSCOPE_MODEL = 'tongyi-embedding-vision-plus-2026-03-06';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_EMBED_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const ZHIPU_VISION_MODEL = 'glm-4.6v-flash';
const ZHIPU_EMBED_MODEL = 'embedding-3';
const DESCRIBE_PROMPT = '这些照片拍的是同一件失物或捡到的物品。请只描述物品本身，不要描述背景、手和环境。'
  + '按顺序写：物品种类、颜色、品牌或上面的文字、材质、形状大小、明显特征（挂件、贴纸、划痕、磨损等）。'
  + '用一段中文，100 字以内，不要分点，不要猜测看不清的内容。';

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

// 保留 5 位小数，减少存储
function roundVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  return vector.map((x) => Math.round(x * 1e5) / 1e5);
}

// 百炼返回 { output: { embeddings: [{ embedding }] } }
function parseDashscope(response) {
  const item = response && response.output && Array.isArray(response.output.embeddings) && response.output.embeddings[0];
  return roundVector(item && item.embedding);
}

// 智谱向量返回 { data: [{ embedding }] }
function parseZhipuEmbedding(response) {
  const item = response && Array.isArray(response.data) && response.data[0];
  return roundVector(item && item.embedding);
}

// 智谱对话返回 { choices: [{ message: { content } }] }
function parseZhipuText(response) {
  const choice = response && Array.isArray(response.choices) && response.choices[0];
  const content = choice && choice.message && choice.message.content;
  return typeof content === 'string' && content.trim() ? content.trim().slice(0, 300) : '';
}

function logError(name, response) {
  console.error(`${name} 出错`, response ? JSON.stringify(response.error || response).slice(0, 300) : '无响应');
}

// 每张照片各算一个向量（不同角度都能比）。失败的照片跳过。
async function dashscopeEmbeddings(apiKey, imageUrls) {
  const results = await Promise.all(imageUrls.map(async (url) => {
    const response = await postJson(DASHSCOPE_URL, apiKey, {
      model: DASHSCOPE_MODEL,
      input: { contents: [{ image: url }] },
      parameters: { dimension: DIMENSION }
    });
    const vector = parseDashscope(response);
    if (!vector) logError('百炼图片向量', response);
    return vector;
  }));
  return { source: 'dashscope', embeddings: results.filter(Boolean), description: '' };
}

// 所有照片一起看一次，写一段描述，再变成一个向量
async function zhipuEmbeddings(apiKey, imageUrls) {
  const chat = await postJson(ZHIPU_CHAT_URL, apiKey, {
    model: ZHIPU_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        { type: 'text', text: DESCRIBE_PROMPT }
      ]
    }],
    thinking: { type: 'disabled' },
    temperature: 0.1
  });
  const description = parseZhipuText(chat);
  if (!description) {
    logError('智谱看图', chat);
    return { source: 'zhipu', embeddings: [], description: '' };
  }
  const embed = await postJson(ZHIPU_EMBED_URL, apiKey, {
    model: ZHIPU_EMBED_MODEL,
    input: description,
    dimensions: DIMENSION
  });
  const vector = parseZhipuEmbedding(embed);
  if (!vector) logError('智谱向量', embed);
  return { source: 'zhipu', embeddings: vector ? [vector] : [], description };
}

async function fetchEmbeddings(imageUrls) {
  const urls = imageUrls.filter(Boolean);
  if (urls.length === 0) return { source: '', embeddings: [], description: '' };
  if (process.env.DASHSCOPE_API_KEY) return dashscopeEmbeddings(process.env.DASHSCOPE_API_KEY, urls);
  if (process.env.ZHIPU_API_KEY) return zhipuEmbeddings(process.env.ZHIPU_API_KEY, urls);
  return { source: '', embeddings: [], description: '' };
}

module.exports = { fetchEmbeddings, parseDashscope, parseZhipuEmbedding, parseZhipuText };

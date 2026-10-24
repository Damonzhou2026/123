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
// 出错时把原因放进 error，存进数据库，免费套餐看不到日志也能排查。
const https = require('https');

const TIMEOUT_MS = 25000;
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

// 返回 { status, body, error }，不抛异常
function postJson(url, apiKey, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${apiKey}`
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch (err) {
          body = null;
        }
        resolve({ status: res.statusCode, body, error: body ? '' : `HTTP ${res.statusCode}：${raw.slice(0, 100)}` });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: null, error: `网络错误：${err.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: '请求超时' }); });
    req.end(data);
  });
}

// 把接口返回的错误整理成一句话，存进数据库
function describeError(step, res) {
  if (res.error) return `${step}：${res.error}`;
  const body = res.body || {};
  const err = body.error || body;
  const detail = [err.code, err.message].filter(Boolean).join(' ');
  return `${step}：HTTP ${res.status} ${detail || JSON.stringify(body).slice(0, 100)}`.slice(0, 200);
}

// 保留 5 位小数，减少存储
function roundVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  return vector.map((x) => Math.round(x * 1e5) / 1e5);
}

// 百炼返回 { output: { embeddings: [{ embedding }] } }
function parseDashscope(body) {
  const item = body && body.output && Array.isArray(body.output.embeddings) && body.output.embeddings[0];
  return roundVector(item && item.embedding);
}

// 智谱向量返回 { data: [{ embedding }] }
function parseZhipuEmbedding(body) {
  const item = body && Array.isArray(body.data) && body.data[0];
  return roundVector(item && item.embedding);
}

// 智谱对话返回 { choices: [{ message: { content } }] }
function parseZhipuText(body) {
  const choice = body && Array.isArray(body.choices) && body.choices[0];
  const content = choice && choice.message && choice.message.content;
  return typeof content === 'string' && content.trim() ? content.trim().slice(0, 300) : '';
}

// 免费模型并发有限，被限流（HTTP 429）时等一下再试一次
async function postWithRetry(url, apiKey, payload) {
  const res = await postJson(url, apiKey, payload);
  if (res.status !== 429) return res;
  await new Promise((r) => setTimeout(r, 1500));
  return postJson(url, apiKey, payload);
}

// 每张照片各算一个向量（不同角度都能比）。失败的照片跳过。
async function dashscopeEmbeddings(apiKey, cloud, fileIDs) {
  const { fileList } = await cloud.getTempFileURL({ fileList: fileIDs });
  const urls = fileList.map((f) => f.tempFileURL).filter(Boolean);
  const errors = [];
  const results = await Promise.all(urls.map(async (url) => {
    const res = await postJson(DASHSCOPE_URL, apiKey, {
      model: DASHSCOPE_MODEL,
      input: { contents: [{ image: url }] },
      parameters: { dimension: DIMENSION }
    });
    const vector = parseDashscope(res.body);
    if (!vector) errors.push(describeError('百炼图片向量', res));
    return vector;
  }));
  const embeddings = results.filter(Boolean);
  return { source: 'dashscope', embeddings, description: '', error: embeddings.length ? '' : (errors[0] || '没有可用的照片') };
}

// 所有照片一起看一次，写一段描述，再变成一个向量。
// 照片直接以 base64 发过去，不让智谱去下载云存储的临时链接。
async function zhipuEmbeddings(apiKey, cloud, fileIDs) {
  const files = await Promise.all(fileIDs.map((fileID) => cloud.downloadFile({ fileID }).catch(() => null)));
  const images = files.filter((f) => f && f.fileContent).map((f) => f.fileContent.toString('base64'));
  if (images.length === 0) return { source: 'zhipu', embeddings: [], description: '', error: '下载照片失败' };

  const chat = await postWithRetry(ZHIPU_CHAT_URL, apiKey, {
    model: ZHIPU_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        ...images.map((b64) => ({ type: 'image_url', image_url: { url: b64 } })),
        { type: 'text', text: DESCRIBE_PROMPT }
      ]
    }],
    thinking: { type: 'disabled' },
    temperature: 0.1
  });
  const description = parseZhipuText(chat.body);
  if (!description) {
    return { source: 'zhipu', embeddings: [], description: '', error: describeError('智谱看图', chat) };
  }

  const embed = await postWithRetry(ZHIPU_EMBED_URL, apiKey, {
    model: ZHIPU_EMBED_MODEL,
    input: description,
    dimensions: DIMENSION
  });
  const vector = parseZhipuEmbedding(embed.body);
  return {
    source: 'zhipu',
    embeddings: vector ? [vector] : [],
    description,
    error: vector ? '' : describeError('智谱向量', embed)
  };
}

async function fetchEmbeddings(cloud, fileIDs) {
  const empty = { source: '', embeddings: [], description: '', error: '' };
  if (!Array.isArray(fileIDs) || fileIDs.length === 0) return empty;
  try {
    if (process.env.DASHSCOPE_API_KEY) return await dashscopeEmbeddings(process.env.DASHSCOPE_API_KEY, cloud, fileIDs);
    if (process.env.ZHIPU_API_KEY) return await zhipuEmbeddings(process.env.ZHIPU_API_KEY.trim(), cloud, fileIDs);
  } catch (err) {
    return { ...empty, error: `出错：${err.message}`.slice(0, 200) };
  }
  return empty;
}

module.exports = { fetchEmbeddings, parseDashscope, parseZhipuEmbedding, parseZhipuText, describeError };

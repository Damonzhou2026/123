// 匹配打分：图片相似度为主，类别、距离、时间为辅。
// findMatches 和 createPost（拾得者发布后提醒失主）各有一份，改的时候一起改，node tools/check-copies.js 会检查。
// 没有图片特征向量时（还没接入图像服务），只按类别、距离、时间打分。

const MAX_DISTANCE_M = 5000;
const MAX_GAP_MS = 14 * 24 * 3600 * 1000;

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

// 余弦值低于 low 记 0 分，高于 high 记满分，中间线性。真实数据多了以后再微调。
// 百炼直接比照片：两张无关照片通常也有 0.3～0.4，同一件东西一般在 0.8 以上。
// 智谱比的是看图写出的描述：同类物品的描述本来就像（都是“黑色钱包”），所以门槛更高。
const COS_RANGE = {
  dashscope: { low: 0.4, high: 0.85 },
  zhipu: { low: 0.6, high: 0.92 }
};
const DEFAULT_RANGE = COS_RANGE.dashscope;

function photoVectors(post) {
  if (Array.isArray(post.embeddings) && post.embeddings.length > 0) return post.embeddings;
  // 兼容旧数据：只有第一张照片的向量
  if (Array.isArray(post.embedding) && post.embedding.length > 0) return [post.embedding];
  return [];
}

// 两边各有 1～3 张照片，取最像的一对
function imageSimilarity(post, candidate) {
  // 不同模型的向量不能比
  if ((post.embeddingSource || '') !== (candidate.embeddingSource || '')) return null;
  const range = COS_RANGE[post.embeddingSource] || DEFAULT_RANGE;
  let best = null;
  photoVectors(post).forEach((a) => {
    photoVectors(candidate).forEach((b) => {
      const c = cosine(a, b);
      if (c != null && (best == null || c > best)) best = c;
    });
  });
  if (best == null) return null;
  return clamp01((best - range.low) / (range.high - range.low));
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function scoreMatch(post, candidate, distanceMeters) {
  const category = post.category === candidate.category ? 1 : 0;
  const distance = clamp01(1 - distanceMeters / MAX_DISTANCE_M);
  const gap = Math.abs(new Date(post.createdAt) - new Date(candidate.createdAt));
  const time = clamp01(1 - gap / MAX_GAP_MS);
  const image = imageSimilarity(post, candidate);

  if (image == null) {
    return { score: 0.5 * category + 0.3 * distance + 0.2 * time, imageCompared: false };
  }
  return { score: 0.6 * image + 0.2 * category + 0.1 * distance + 0.1 * time, imageCompared: true };
}

module.exports = { scoreMatch, cosine, imageSimilarity, MAX_DISTANCE_M, MAX_GAP_MS };

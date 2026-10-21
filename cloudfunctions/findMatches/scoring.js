// 匹配打分：图片相似度为主，类别、距离、时间为辅。
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
  // 余弦值映射到 0～1
  return (dot / Math.sqrt(na * nb) + 1) / 2;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function scoreMatch(post, candidate, distanceMeters) {
  const category = post.category === candidate.category ? 1 : 0;
  const distance = clamp01(1 - distanceMeters / MAX_DISTANCE_M);
  const gap = Math.abs(new Date(post.createdAt) - new Date(candidate.createdAt));
  const time = clamp01(1 - gap / MAX_GAP_MS);
  const image = cosine(post.embedding, candidate.embedding);

  if (image == null) {
    return { score: 0.5 * category + 0.3 * distance + 0.2 * time, imageCompared: false };
  }
  return { score: 0.6 * image + 0.2 * category + 0.1 * distance + 0.1 * time, imageCompared: true };
}

module.exports = { scoreMatch, cosine, MAX_DISTANCE_M, MAX_GAP_MS };

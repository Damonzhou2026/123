const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 用真实照片校准看图匹配的分数区间（findMatches/scoring.js 里的 COS_RANGE）。
// 做法见 README“校准匹配分数”：发几对名称以“校准+编号”开头的失物和拾物，
// 编号相同的是同一件东西，编号不同的是不同的东西。然后在控制台“云端测试”里运行这个云函数。
// 结果直接返回，也存进 calibration 集合（文档 id 是 latest）。
const TITLE = /^校准(\d+)/;

exports.main = async () => {
  if (cloud.getWXContext().OPENID) return { ok: false, message: '只能在控制台运行' };

  const { data } = await db.collection('posts')
    .where({ title: db.RegExp({ regexp: '^校准\\d+' }) })
    .field({ title: 1, type: 1, category: 1, embeddings: 1, embedding: 1, embeddingSource: 1, embeddingError: 1, photoDescription: 1 })
    .limit(200).get();

  const posts = data.map((p) => ({ ...p, code: (p.title.match(TITLE) || [])[1] }));
  const lost = posts.filter((p) => p.type === 'lost');
  const found = posts.filter((p) => p.type === 'found');
  const noVector = posts.filter((p) => vectors(p).length === 0).map((p) => ({ title: p.title, error: p.embeddingError || '' }));

  const pairs = [];
  lost.forEach((a) => found.forEach((b) => {
    if ((a.embeddingSource || '') !== (b.embeddingSource || '')) return;
    const cos = bestCosine(a, b);
    if (cos == null) return;
    pairs.push({ lost: a.title, found: b.title, same: a.code === b.code, sameCategory: a.category === b.category, cos: round(cos) });
  }));

  const same = pairs.filter((p) => p.same).map((p) => p.cos).sort((x, y) => x - y);
  // 最容易混的是同类别的不同东西（都是黑色钱包），只拿这些来定下限
  const diff = pairs.filter((p) => !p.same && p.sameCategory).map((p) => p.cos).sort((x, y) => x - y);
  const result = {
    source: (posts[0] && posts[0].embeddingSource) || '',
    postCount: posts.length,
    noVector,
    same: summary(same),
    differentSameCategory: summary(diff),
    // 建议：不同东西里 90% 都低于 low，同一件东西里 75% 都高于 high
    suggested: same.length && diff.length ? { low: round(quantile(diff, 0.9)), high: round(quantile(same, 0.25)) } : null,
    pairs: pairs.sort((x, y) => y.cos - x.cos),
    descriptions: posts.map((p) => ({ title: p.title, description: p.photoDescription || '' })),
    createdAt: new Date()
  };
  await withCollection('calibration', () => db.collection('calibration').doc('latest').set({ data: result }))
    .catch((err) => console.error('保存结果失败', err));
  return { ok: true, ...result };
};

function vectors(post) {
  if (Array.isArray(post.embeddings) && post.embeddings.length) return post.embeddings;
  if (Array.isArray(post.embedding) && post.embedding.length) return [post.embedding];
  return [];
}

function bestCosine(a, b) {
  let best = null;
  vectors(a).forEach((x) => vectors(b).forEach((y) => {
    const c = cosine(x, y);
    if (c != null && (best == null || c > best)) best = c;
  }));
  return best;
}

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
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summary(sorted) {
  if (!sorted.length) return { count: 0 };
  return { count: sorted.length, min: sorted[0], median: round(quantile(sorted, 0.5)), max: sorted[sorted.length - 1] };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

// 集合还没建时自动建一个，省得去控制台手动建（已经存在时 createCollection 会报错，忽略就行）
async function withCollection(name, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!/not exist|不存在|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(`${err.errCode || ''} ${err.message || err.errMsg || ''}`)) throw err;
    await db.createCollection(name).catch(() => {});
    return fn();
  }
}

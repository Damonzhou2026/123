const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 运营数据：最近 8 周每周的发布、配对、归还和 7 天找回率，以及待处理的举报。
// 只有环境变量 ADMIN_OPENIDS（逗号分隔）里的人能看；别人调用会拿到自己的 openid，方便第一次配置。
const DAY = 24 * 3600 * 1000;
const WEEKS = 8;
const BEIJING = 8 * 3600 * 1000;
const MAX_DOCS = 2000;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const admins = String(process.env.ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!admins.includes(OPENID)) return { ok: false, admin: false, openid: OPENID };

  const now = Date.now();
  const weekStarts = [];
  for (let i = WEEKS - 1; i >= 0; i--) weekStarts.push(weekStart(now) - i * 7 * DAY);
  const since = new Date(weekStarts[0]);

  const [posts, claims, pendingReports, blocked, users] = await Promise.all([
    loadAll(db.collection('posts').where({ createdAt: _.gte(since) }).field({ type: 1, createdAt: 1 })),
    // 配对和归还按发生的时间算，所以取最近创建的认领（配对一般在认领后几天内）
    loadAll(db.collection('claims').where({ createdAt: _.gte(new Date(weekStarts[0] - 14 * DAY)) })
      .field({ lostPostId: 1, status: 1, reviewedAt: 1, returnedAt: 1 })),
    db.collection('reports').where({ status: 'pending' }).count().then((r) => r.total).catch(() => 0),
    db.collection('posts').where({ status: 'blocked' }).count().then((r) => r.total),
    db.collection('users').count().then((r) => r.total)
  ]);

  const rows = weekStarts.map((start) => ({
    start,
    label: dateLabel(start),
    lost: 0,
    found: 0,
    matched: 0,
    returned: 0,
    lostCounted: 0,
    lostReturned7d: 0
  }));
  const rowFor = (t) => rows.find((r) => t >= r.start && t < r.start + 7 * DAY);

  posts.forEach((p) => {
    const r = rowFor(new Date(p.createdAt).getTime());
    if (r) r[p.type === 'lost' ? 'lost' : 'found'] += 1;
  });
  claims.forEach((c) => {
    if (c.reviewedAt && ['approved', 'returned', 'cancelled'].includes(c.status)) {
      const r = rowFor(new Date(c.reviewedAt).getTime());
      if (r) r.matched += 1;
    }
    if (c.status === 'returned' && c.returnedAt) {
      const r = rowFor(new Date(c.returnedAt).getTime());
      if (r) r.returned += 1;
    }
  });

  // 7 天找回率：这周登记的失物里，7 天内确认拿回的占多少。发布还不满 7 天的不算进分母
  const returnedAt = {};
  claims.forEach((c) => { if (c.status === 'returned' && c.returnedAt) returnedAt[c.lostPostId] = new Date(c.returnedAt).getTime(); });
  posts.filter((p) => p.type === 'lost').forEach((p) => {
    const created = new Date(p.createdAt).getTime();
    if (now - created < 7 * DAY) return;
    const r = rowFor(created);
    if (!r) return;
    r.lostCounted += 1;
    if (returnedAt[p._id] && returnedAt[p._id] - created <= 7 * DAY) r.lostReturned7d += 1;
  });
  rows.forEach((r) => { r.rate7d = r.lostCounted ? Math.round((r.lostReturned7d / r.lostCounted) * 100) : null; });

  return { ok: true, admin: true, rows: rows.reverse(), pendingReports, blocked, users, truncated: posts.length >= MAX_DOCS };
};

// 分页读出全部（最多 MAX_DOCS 条）
async function loadAll(query) {
  const all = [];
  while (all.length < MAX_DOCS) {
    const { data } = await query.skip(all.length).limit(100).get();
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

// 北京时间这一周的周一 0 点
function weekStart(t) {
  const days = Math.floor((t + BEIJING) / DAY);
  // 1970-01-01 是周四
  const monday = days - ((days + 3) % 7);
  return monday * DAY - BEIJING;
}

function dateLabel(t) {
  const d = new Date(t + BEIJING);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 举报发布（冒领、违规内容等）或聊天里的对方（骚扰、诈骗等）。
// 记在 reports 集合里，运营在云开发控制台查看处理（status 改成 done）。
// 同一条发布被 3 个不同的人举报，先自动下架，等人工核实。
const REASONS = {
  post: ['虚假或冒充的发布', '照片或文字违规', '广告或骚扰', '其他'],
  claim: ['冒领', '骚扰或辱骂', '索要钱财或诈骗', '其他']
};
const AUTO_BLOCK_REPORTS = 3;
const MAX_PER_DAY = 10;
const MAX_DETAIL = 200;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { targetType, targetId } = event;
  if (!REASONS[targetType] || typeof targetId !== 'string' || !targetId) return { ok: false, message: '举报对象不对' };
  if (!REASONS[targetType].includes(event.reason)) return { ok: false, message: '请选择举报原因' };
  const detail = typeof event.detail === 'string' ? event.detail.trim().slice(0, MAX_DETAIL) : '';

  let reportedOpenid = '';
  let postId = '';
  if (targetType === 'post') {
    const post = await db.collection('posts').doc(targetId).get().then((r) => r.data).catch(() => null);
    if (!post) return { ok: false, message: '找不到这条发布' };
    if (post._openid === OPENID) return { ok: false, message: '不能举报自己的发布' };
    reportedOpenid = post._openid;
    postId = post._id;
  } else {
    const claim = await db.collection('claims').doc(targetId).get().then((r) => r.data).catch(() => null);
    if (!claim || (claim.claimantOpenid !== OPENID && claim.finderOpenid !== OPENID)) return { ok: false, message: '找不到这次认领' };
    reportedOpenid = claim.claimantOpenid === OPENID ? claim.finderOpenid : claim.claimantOpenid;
    postId = claim.foundPostId;
  }

  const reports = db.collection('reports');
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const { total: today } = await withCollection('reports', () => reports.where({ reporterOpenid: OPENID, createdAt: _.gte(since) }).count());
  if (today >= MAX_PER_DAY) return { ok: false, message: '今天举报次数太多了，请明天再试或发邮件联系我们' };

  // 一个人对同一个对象只记一次
  const reportId = `${targetId}_${OPENID}`;
  const existing = await reports.doc(reportId).get().then((r) => r.data).catch(() => null);
  if (existing) return { ok: false, message: '你已经举报过了，我们会尽快处理' };

  await reports.doc(reportId).set({
    data: {
      targetType,
      targetId,
      postId,
      reportedOpenid,
      reporterOpenid: OPENID,
      reason: event.reason,
      detail,
      status: 'pending',
      createdAt: db.serverDate()
    }
  });

  if (targetType === 'post') {
    const { total } = await reports.where({ targetId }).count();
    if (total >= AUTO_BLOCK_REPORTS) {
      await db.collection('posts').where({ _id: targetId, status: 'open' })
        .update({ data: { status: 'blocked', blockReason: 'reports' } });
    }
  }
  return { ok: true };
};

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

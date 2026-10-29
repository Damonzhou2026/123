const cloud = require('wx-server-sdk');
const { pushAndLog } = require('./push');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CANCEL_REASONS = ['认错了，不是对方的东西', '对方一直不回复', '对方没来交接', '其他'];

// 拾得者确认或拒绝一条认领。确认后两条发布都标记为已配对，其他待处理的认领自动拒绝。
// 配对之后：任一方可以取消配对（action: cancel）；拾得者可以说“我已交还”（action: handedOver）。
exports.main = async (event) => {
  if (event.action === 'cancel') return cancelMatch(event);
  if (event.action === 'handedOver') return markHandedOver(event);
  return review(event);
};

async function review(event) {
  const { OPENID } = cloud.getWXContext();
  const approve = event.approve === true;

  try {
    const result = await db.runTransaction(async (tx) => {
      const claimRef = tx.collection('claims').doc(event.claimId);
      const { data: claim } = await claimRef.get();
      if (claim.finderOpenid !== OPENID) return tx.rollback('只有拾得者可以确认认领');
      if (claim.status !== 'pending') return tx.rollback('这条认领已经处理过了');

      if (!approve) {
        await claimRef.update({ data: { status: 'rejected', reviewedAt: db.serverDate() } });
        return { status: 'rejected', claim };
      }

      const foundRef = tx.collection('posts').doc(claim.foundPostId);
      const { data: found } = await foundRef.get();
      if (found.status !== 'open') return tx.rollback('这件物品已经配对过了');

      await claimRef.update({ data: { status: 'approved', reviewedAt: db.serverDate() } });
      await foundRef.update({ data: { status: 'matched', matchedClaimId: claim._id } });
      await tx.collection('posts').doc(claim.lostPostId).update({ data: { status: 'matched', matchedClaimId: claim._id } });
      return { status: 'approved', foundPostId: claim.foundPostId, claim, title: found.title };
    });

    if (result.status === 'approved') {
      // 事务外处理：同一件物品的其他待处理认领全部拒绝
      await db.collection('claims')
        .where({ foundPostId: result.foundPostId, status: 'pending' })
        // 自动拒绝的不算答错次数，配对取消后这些人还可以再认领
        .update({ data: { status: 'rejected', autoRejected: true, reviewedAt: db.serverDate() } });
    }

    // 告诉失主结果，推送失败不影响确认
    const { claim } = result;
    const approved = result.status === 'approved';
    const title = result.title
      || await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data.title).catch(() => '');
    await pushAndLog(cloud, db, claim._id, claim.claimantOpenid, {
      text: approved ? '拾得者确认是你的东西，点开约交接时间地点' : '拾得者认为答案不对，这次认领没通过',
      sender: '拾得者',
      title: title || '',
      page: approved ? `pages/chat/chat?claimId=${claim._id}` : `pages/matches/matches?id=${claim.lostPostId}`
    });
    return { ok: true, status: result.status };
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '操作失败') };
  }
}

// 取消配对：认错了人、对方失联或没来交接。两条发布回到“匹配中”，别人又可以认领。
async function cancelMatch(event) {
  const { OPENID } = cloud.getWXContext();
  const reason = CANCEL_REASONS.includes(event.reason) ? event.reason : '';
  if (!reason) return { ok: false, message: '请选择取消的原因' };

  // 托管了感谢金的不能直接取消，要人工退款（托管现在是关着的）
  const payment = await db.collection('payments').doc(event.claimId).get().then((r) => r.data).catch(() => null);
  if (payment && payment.status !== 'created') return { ok: false, message: '感谢金已经托管，取消配对请发邮件联系我们处理退款' };

  let claim;
  try {
    claim = await db.runTransaction(async (tx) => {
      const claimRef = tx.collection('claims').doc(event.claimId);
      const { data } = await claimRef.get();
      if (data.claimantOpenid !== OPENID && data.finderOpenid !== OPENID) return tx.rollback('找不到这次配对');
      if (data.status !== 'approved') return tx.rollback('现在不能取消配对');

      const role = data.claimantOpenid === OPENID ? 'owner' : 'finder';
      await claimRef.update({ data: { status: 'cancelled', cancelledBy: role, cancelReason: reason, cancelledAt: db.serverDate() } });
      for (const id of [data.foundPostId, data.lostPostId]) {
        await tx.collection('posts').doc(id).update({ data: { status: 'open', matchedClaimId: '' } });
      }
      return { ...data, cancelledBy: role };
    });
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '操作失败') };
  }

  // 告诉另一方。推送失败不影响取消
  const toOwner = claim.cancelledBy === 'finder';
  const title = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data.title).catch(() => '');
  await pushAndLog(cloud, db, claim._id, toOwner ? claim.claimantOpenid : claim.finderOpenid, {
    text: `对方取消了配对：${reason}`,
    sender: toOwner ? '拾得者' : '失主',
    title: title || '',
    page: `pages/matches/matches?id=${toOwner ? claim.lostPostId : claim.foundPostId}`
  });
  return { ok: true };
}

// 拾得者说“我已交还”：提醒失主确认。失主 3 天没点，每天的定时任务（dailyJobs）会自动确认
async function markHandedOver(event) {
  const { OPENID } = cloud.getWXContext();
  const claimRef = db.collection('claims').doc(event.claimId);
  const claim = await claimRef.get().then((r) => r.data).catch(() => null);
  if (!claim || claim.finderOpenid !== OPENID) return { ok: false, message: '只有拾得者可以操作' };
  if (claim.status !== 'approved') return { ok: false, message: '现在不能操作' };
  if (claim.handedOverAt) return { ok: true };

  await claimRef.update({ data: { handedOverAt: db.serverDate() } });
  const title = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data.title).catch(() => '');
  await pushAndLog(cloud, db, claim._id, claim.claimantOpenid, {
    text: '拾得者说已经把东西交给你了，拿到了请点“我已拿回物品”',
    sender: '拾得者',
    title: title || '',
    page: `pages/chat/chat?claimId=${claim._id}`
  });
  return { ok: true };
}

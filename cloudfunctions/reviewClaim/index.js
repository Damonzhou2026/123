const cloud = require('wx-server-sdk');
const { pushAndLog } = require('./push');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 拾得者确认或拒绝一条认领。确认后两条发布都标记为已配对，其他待处理的认领自动拒绝。
exports.main = async (event) => {
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
        .update({ data: { status: 'rejected', reviewedAt: db.serverDate() } });
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
};

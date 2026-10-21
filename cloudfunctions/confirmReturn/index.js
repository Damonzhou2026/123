const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 失主确认已经拿回物品：认领变成“已归还”，两条发布关闭。之后双方可以互相评星。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    await db.runTransaction(async (tx) => {
      const claimRef = tx.collection('claims').doc(event.claimId);
      const { data: claim } = await claimRef.get();
      if (claim.claimantOpenid !== OPENID) return tx.rollback('只有失主可以确认拿回');
      if (claim.status !== 'approved') return tx.rollback('现在还不能确认拿回');

      await claimRef.update({ data: { status: 'returned', returnedAt: db.serverDate() } });
      await tx.collection('posts').doc(claim.lostPostId).update({ data: { status: 'closed' } });
      await tx.collection('posts').doc(claim.foundPostId).update({ data: { status: 'closed' } });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '操作失败') };
  }
};

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
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '操作失败') };
  }

  // 防丢贴的东西找回来了：贴纸回到“使用中”，主人之前标记丢失发的那条失物也撤下
  await tagRecovered(event.claimId).catch((err) => console.error('更新防丢贴失败', err));

  // 有托管的感谢金就分给拾得者。失败不影响确认，聊天页之后会再重试。
  const settled = await cloud.callFunction({ name: 'reward', data: { action: 'settle', claimId: event.claimId } })
    .then((r) => r.result)
    .catch((err) => ({ ok: false, message: err.message }));
  return { ok: true, reward: settled };
};

async function tagRecovered(claimId) {
  const claim = await db.collection('claims').doc(claimId).get().then((r) => r.data).catch(() => null);
  if (!claim || !claim.tagId) return;
  const tag = await db.collection('tags').doc(claim.tagId).get().then((r) => r.data).catch(() => null);
  if (!tag || tag.ownerOpenid !== claim.claimantOpenid || !tag.lostPostId) return;
  await db.collection('posts').where({ _id: tag.lostPostId, status: 'open' })
    .update({ data: { status: 'closed' } }).catch(() => {});
  await db.collection('tags').doc(tag._id).update({
    data: { status: tag.status === 'paused' ? 'paused' : 'active', lostPostId: '' }
  });
}

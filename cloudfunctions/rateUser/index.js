const cloud = require('wx-server-sdk');
const { validateRating } = require('./validate');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 归还完成后，失主和拾得者互相评星。每人对每次归还只能评一次，评分累计到对方的用户档案上。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const input = validateRating(event);
  if (input.error) return { ok: false, message: input.error };

  try {
    await db.runTransaction(async (tx) => {
      const { data: claim } = await tx.collection('claims').doc(event.claimId).get();
      if (claim.claimantOpenid !== OPENID && claim.finderOpenid !== OPENID) return tx.rollback('找不到这次归还');
      if (claim.status !== 'returned') return tx.rollback('确认拿回之后才能评价');

      const rateeOpenid = claim.claimantOpenid === OPENID ? claim.finderOpenid : claim.claimantOpenid;
      // 对方注销后认领上的身份会被抹成 deleted
      if (rateeOpenid === 'deleted') return tx.rollback('对方已经注销，不能评价了');
      // 用固定 id 保证一人一次
      const ratingId = `${claim._id}_${OPENID}`;
      const existing = await tx.collection('ratings').doc(ratingId).get().then((r) => r.data).catch(() => null);
      if (existing) return tx.rollback('你已经评价过了');

      await tx.collection('ratings').doc(ratingId).set({
        data: {
          claimId: claim._id,
          raterOpenid: OPENID,
          rateeOpenid,
          stars: input.stars,
          tags: input.tags,
          createdAt: db.serverDate()
        }
      });

      const userRef = tx.collection('users').doc(rateeOpenid);
      const user = await userRef.get().then((r) => r.data).catch(() => null);
      if (user) {
        await userRef.update({ data: { ratingSum: _.inc(input.stars), ratingCount: _.inc(1) } });
      } else {
        await userRef.set({ data: { ratingSum: input.stars, ratingCount: 1 } });
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '评价失败') };
  }
};

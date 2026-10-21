const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 我发布过的失物和拾物，最新的在前
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const { data } = await db.collection('posts')
    .where({ _openid: OPENID })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .field({ type: 1, title: 1, photos: 1, placeName: 1, status: 1, createdAt: 1, matchedClaimId: 1 })
    .get();
  return { ok: true, items: data };
};

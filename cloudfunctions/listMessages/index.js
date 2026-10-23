const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PAGE_SIZE = 100;

// 读取一段对话最近的消息，并告诉调用者自己是失主还是拾得者
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const claim = await db.collection('claims').doc(event.claimId).get().then((r) => r.data).catch(() => null);
  if (!claim || (claim.claimantOpenid !== OPENID && claim.finderOpenid !== OPENID)) {
    return { ok: false, message: '找不到这段对话' };
  }

  const found = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data).catch(() => ({}));
  const { data } = await db.collection('messages')
    .where({ claimId: claim._id })
    .orderBy('createdAt', 'desc')
    .limit(PAGE_SIZE)
    .get();

  const counterpartOpenid = claim.claimantOpenid === OPENID ? claim.finderOpenid : claim.claimantOpenid;
  const [counterpart, myRating, lost, payment] = await Promise.all([
    db.collection('users').doc(counterpartOpenid).get().then((r) => r.data).catch(() => null),
    db.collection('ratings').doc(`${claim._id}_${OPENID}`).get().then((r) => r.data).catch(() => null),
    db.collection('posts').doc(claim.lostPostId).get().then((r) => r.data).catch(() => ({})),
    db.collection('payments').doc(claim._id).get().then((r) => r.data).catch(() => null)
  ]);

  return {
    ok: true,
    role: claim.claimantOpenid === OPENID ? 'owner' : 'finder',
    status: claim.status,
    rated: !!myRating,
    counterpart: counterpart && counterpart.ratingCount
      ? { rating: Math.round((counterpart.ratingSum / counterpart.ratingCount) * 10) / 10, count: counterpart.ratingCount }
      : { rating: null, count: 0 },
    // 感谢金：失主设置的金额，和托管状态（none 未付 / created 待支付 / paid 已托管 / settling 分账中 / settled 已到账）
    reward: { amount: lost.reward || 0, status: payment ? payment.status : 'none' },
    item: { title: found.title || '', photo: (found.photos || [])[0] || '', placeName: found.placeName || '' },
    messages: data.reverse().map((m) => ({
      _id: m._id,
      text: m.text,
      createdAt: m.createdAt,
      mine: m.senderOpenid === OPENID
    }))
  };
};

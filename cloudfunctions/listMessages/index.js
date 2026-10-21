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

  return {
    ok: true,
    role: claim.claimantOpenid === OPENID ? 'owner' : 'finder',
    status: claim.status,
    item: { title: found.title || '', photo: (found.photos || [])[0] || '', placeName: found.placeName || '' },
    messages: data.reverse().map((m) => ({
      _id: m._id,
      text: m.text,
      createdAt: m.createdAt,
      mine: m.senderOpenid === OPENID
    }))
  };
};

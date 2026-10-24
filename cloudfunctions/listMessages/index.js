const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PAGE_SIZE = 100;
// 记录“谁什么时候在看聊天页”，新消息推送靠它判断对方在不在线。聊天页 3 秒拉一次，不用每次都写
const SEEN_WRITE_MS = 20 * 1000;

// 读取一段对话最近的消息，并告诉调用者自己是失主还是拾得者
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const claim = await db.collection('claims').doc(event.claimId).get().then((r) => r.data).catch(() => null);
  if (!claim || (claim.claimantOpenid !== OPENID && claim.finderOpenid !== OPENID)) {
    return { ok: false, message: '找不到这段对话' };
  }

  const role = claim.claimantOpenid === OPENID ? 'owner' : 'finder';
  const claimRef = db.collection('claims').doc(claim._id);
  // 离开聊天页时记一下，对方再发消息就马上推送，不用等 1 分钟
  if (event.leaving === true) {
    await claimRef.update({ data: { [`leftAt.${role}`]: db.serverDate() } }).catch(() => {});
    return { ok: true };
  }
  const seen = claim.seenAt && claim.seenAt[role];
  const left = claim.leftAt && claim.leftAt[role];
  if (!seen || Date.now() - new Date(seen).getTime() > SEEN_WRITE_MS || (left && new Date(left) >= new Date(seen))) {
    await claimRef.update({ data: { [`seenAt.${role}`]: db.serverDate() } }).catch(() => {});
  }

  const found = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data).catch(() => ({}));
  const { data } = await db.collection('messages')
    .where({ claimId: claim._id })
    .orderBy('createdAt', 'desc')
    .limit(PAGE_SIZE)
    .get();

  const counterpartOpenid = claim.claimantOpenid === OPENID ? claim.finderOpenid : claim.claimantOpenid;
  const [counterpart, me, myRating, lost, payment] = await Promise.all([
    db.collection('users').doc(counterpartOpenid).get().then((r) => r.data).catch(() => null),
    db.collection('users').doc(OPENID).get().then((r) => r.data).catch(() => null),
    db.collection('ratings').doc(`${claim._id}_${OPENID}`).get().then((r) => r.data).catch(() => null),
    db.collection('posts').doc(claim.lostPostId).get().then((r) => r.data).catch(() => ({})),
    db.collection('payments').doc(claim._id).get().then((r) => r.data).catch(() => null)
  ]);

  const photo = (found.photos || [])[0] || '';
  const urls = await toTempUrls([photo]);

  return {
    ok: true,
    role,
    status: claim.status,
    rated: !!myRating,
    counterpart: counterpart && counterpart.ratingCount
      ? { rating: Math.round((counterpart.ratingSum / counterpart.ratingCount) * 10) / 10, count: counterpart.ratingCount }
      : { rating: null, count: 0 },
    // 感谢金：失主设置的金额，和托管状态（none 未付 / created 待支付 / paid 已托管 / settling 分账中 / settled 已到账）
    reward: { amount: lost.reward || 0, status: payment ? payment.status : 'none' },
    // 我还能收几次新消息提醒，以及是哪个模板的
    notify: me && me.notify ? { tmplId: me.notify.tmplId, credits: me.notify.credits || 0 } : { tmplId: '', credits: 0 },
    item: { title: found.title || '', photo: urls[photo] || photo, placeName: found.placeName || '' },
    messages: data.reverse().map((m) => ({
      _id: m._id,
      text: m.text,
      createdAt: m.createdAt,
      mine: m.senderOpenid === OPENID
    }))
  };
};

// 照片存的是云存储 fileID。免费套餐不能把存储权限改成“所有用户可读”，
// 对方直接用 fileID 看不到图，所以由云函数换成临时链接再返回。
async function toTempUrls(fileIDs) {
  const ids = [...new Set(fileIDs.filter((id) => typeof id === 'string' && id.startsWith('cloud://')))];
  if (ids.length === 0) return {};
  const { fileList } = await cloud.getTempFileURL({ fileList: ids });
  const urls = {};
  fileList.forEach((f) => { if (f.tempFileURL) urls[f.fileID] = f.tempFileURL; });
  return urls;
}

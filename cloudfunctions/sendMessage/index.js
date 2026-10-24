const cloud = require('wx-server-sdk');
const { pushAndLog } = require('./push');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_LENGTH = 500;
// 对方 1 分钟内还在聊天页拉过消息、也没有离开聊天页，就当他在线，不推送
const ONLINE_MS = 60 * 1000;

// 配对成功的失主和拾得者之间发消息。只有认领被确认后才能聊，聊天不暴露手机号。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const text = typeof event.text === 'string' ? event.text.trim() : '';
  if (!text) return { ok: false, message: '消息不能为空' };
  if (text.length > MAX_LENGTH) return { ok: false, message: `消息不能超过 ${MAX_LENGTH} 字` };

  const claim = await db.collection('claims').doc(event.claimId).get().then((r) => r.data).catch(() => null);
  if (!claim || (claim.claimantOpenid !== OPENID && claim.finderOpenid !== OPENID)) {
    return { ok: false, message: '找不到这段对话' };
  }
  if (claim.status !== 'approved' && claim.status !== 'returned') return { ok: false, message: '拾得者确认后才能聊天' };

  const { _id } = await db.collection('messages').add({
    data: {
      claimId: claim._id,
      senderOpenid: OPENID,
      text,
      createdAt: db.serverDate()
    }
  });

  // 推送失败不影响消息本身
  const notified = await notifyRecipient(claim, OPENID, text);
  return { ok: true, id: _id, notified };
};

// 用微信订阅消息提醒对方。对方得先在小程序里点过“允许”，每点一次只能推一条。
async function notifyRecipient(claim, senderOpenid, text) {
  const senderRole = claim.claimantOpenid === senderOpenid ? 'owner' : 'finder';
  const role = senderRole === 'owner' ? 'finder' : 'owner';
  const touser = role === 'owner' ? claim.claimantOpenid : claim.finderOpenid;

  // 对方正开着聊天页，或者上次提醒之后还没回来看过，就不再推，省着用授权次数
  const seen = claim.seenAt && claim.seenAt[role];
  const notifiedAt = claim.notifiedAt && claim.notifiedAt[role];
  const left = claim.leftAt && claim.leftAt[role];
  const stillOnPage = !left || new Date(left) < new Date(seen);
  let skip = '';
  if (seen && stillOnPage && Date.now() - new Date(seen).getTime() < ONLINE_MS) skip = 'online';
  else if (notifiedAt && (!seen || new Date(notifiedAt) > new Date(seen))) skip = 'already';
  if (skip) {
    await db.collection('claims').doc(claim._id)
      .update({ data: { lastPush: { result: skip, error: '', at: db.serverDate() } } })
      .catch(() => {});
    return skip;
  }

  const found = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data).catch(() => ({}));
  const result = await pushAndLog(cloud, db, claim._id, touser, {
    text,
    sender: senderRole === 'owner' ? '失主' : '拾得者',
    title: found.title || '',
    page: `pages/chat/chat?claimId=${claim._id}`
  });
  if (result === 'sent') {
    await db.collection('claims').doc(claim._id).update({ data: { [`notifiedAt.${role}`]: db.serverDate() } });
  }
  return result;
}

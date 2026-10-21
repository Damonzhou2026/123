const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_LENGTH = 500;

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
  if (claim.status !== 'approved') return { ok: false, message: '拾得者确认后才能聊天' };

  const { _id } = await db.collection('messages').add({
    data: {
      claimId: claim._id,
      senderOpenid: OPENID,
      text,
      createdAt: db.serverDate()
    }
  });
  return { ok: true, id: _id };
};

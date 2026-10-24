const cloud = require('wx-server-sdk');
const { parseTemplate, buildData } = require('./template');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_LENGTH = 500;
// 对方 1 分钟内还在聊天页拉过消息，就当他在线，不推送
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

  // 推送失败不影响消息本身。结果记在 claims 的 lastPush 上，免费套餐看不到云函数日志时可以在数据库里查
  let pushError = '';
  const notified = await notifyRecipient(claim, OPENID, text).catch((err) => {
    console.error('新消息推送失败', err);
    pushError = String(err.errCode || '') + ' ' + (err.errMsg || err.message || String(err));
    return 'error';
  });
  await db.collection('claims').doc(claim._id)
    .update({ data: { lastPush: { result: notified, error: pushError.slice(0, 300), at: db.serverDate() } } })
    .catch(() => {});
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
  if (seen && Date.now() - new Date(seen).getTime() < ONLINE_MS) return 'online';
  if (notifiedAt && (!seen || new Date(notifiedAt) > new Date(seen))) return 'already';

  const userRef = db.collection('users').doc(touser);
  const user = await userRef.get().then((r) => r.data).catch(() => null);
  const sub = user && user.notify;
  if (!sub || !sub.tmplId || !(sub.credits > 0)) return 'not-subscribed';

  const fields = await templateFields(sub.tmplId);
  if (!fields) return 'no-template';

  const found = await db.collection('posts').doc(claim.foundPostId).get().then((r) => r.data).catch(() => ({}));
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: sub.tmplId,
      page: `pages/chat/chat?claimId=${claim._id}`,
      miniprogramState: sub.state || 'formal',
      lang: 'zh_CN',
      data: buildData(fields, {
        text,
        sender: senderRole === 'owner' ? '失主' : '拾得者',
        title: found.title || '',
        time: new Date()
      })
    });
  } catch (err) {
    // 43101：对方没有可用的授权次数了（或者在微信设置里关掉了）
    if (err.errCode === 43101) {
      await userRef.update({ data: { 'notify.credits': 0 } });
      return 'not-subscribed';
    }
    throw err;
  }

  await Promise.all([
    userRef.update({ data: { 'notify.credits': _.inc(-1) } }),
    db.collection('claims').doc(claim._id).update({ data: { [`notifiedAt.${role}`]: db.serverDate() } })
  ]);
  return 'sent';
}

// 模板的字段列表，从公众平台“我的模板”读，读到后缓存
const templateCache = {};
async function templateFields(tmplId) {
  if (!templateCache[tmplId]) {
    const { data } = await cloud.openapi.subscribeMessage.getTemplateList({});
    const tmpl = (data || []).find((t) => t.priTmplId === tmplId);
    if (!tmpl) {
      console.error('“我的模板”里找不到这个模板 ID', tmplId);
      return null;
    }
    templateCache[tmplId] = parseTemplate(tmpl.content);
  }
  return templateCache[tmplId];
}

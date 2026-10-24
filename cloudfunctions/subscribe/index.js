const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 推送时打开哪个版本的小程序：开发版、体验版还是正式版
const STATES = { develop: 'developer', trial: 'trial', release: 'formal' };

// 用户在弹窗里点了“允许”收新消息提醒，记一次授权次数。每次只能推一条，推完就要再点一次。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const tmplId = typeof event.tmplId === 'string' ? event.tmplId.trim() : '';
  if (!tmplId || tmplId.length > 64) return { ok: false, message: '模板 ID 不对' };

  const ref = db.collection('users').doc(OPENID);
  const user = await ref.get().then((r) => r.data).catch(() => null);
  const old = user && user.notify;
  const notify = {
    tmplId,
    // 换了模板，之前的次数就作废了
    credits: old && old.tmplId === tmplId ? (old.credits || 0) + 1 : 1,
    state: STATES[event.envVersion] || 'formal'
  };
  if (user) await ref.update({ data: { notify: _.set(notify) } });
  else await ref.set({ data: { notify } });
  return { ok: true, credits: notify.credits };
};

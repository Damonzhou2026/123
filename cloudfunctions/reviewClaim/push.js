// 给某个用户推一条订阅消息，用掉他一次授权次数。
// sendMessage、submitClaim、reviewClaim、createPost 各放一份（云函数不能共用文件），改的时候四份一起改。
const { parseTemplate, buildData } = require('./template');

// info: { text, sender（失主/拾得者）, title（物品名）, page（点开后打开的页面） }
// 返回 sent / not-subscribed / no-template，其他错误直接抛出
async function pushTo(cloud, db, touser, info) {
  const userRef = db.collection('users').doc(touser);
  const user = await userRef.get().then((r) => r.data).catch(() => null);
  const sub = user && user.notify;
  if (!sub || !sub.tmplId || !(sub.credits > 0)) return 'not-subscribed';

  const fields = await templateFields(cloud, sub.tmplId);
  if (!fields) return 'no-template';

  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: sub.tmplId,
      page: info.page,
      miniprogramState: sub.state || 'formal',
      lang: 'zh_CN',
      data: buildData(fields, { text: info.text, sender: info.sender, title: info.title, time: new Date() })
    });
  } catch (err) {
    // 43101：对方没有可用的授权次数了（或者在微信设置里关掉了）
    if (err.errCode === 43101) {
      await userRef.update({ data: { 'notify.credits': 0 } });
      return 'not-subscribed';
    }
    throw err;
  }
  await userRef.update({ data: { 'notify.credits': db.command.inc(-1) } });
  return 'sent';
}

// 推送并把结果记在认领记录的 lastPush 上（免费套餐看不到云函数日志，排查时在数据库里看）
async function pushAndLog(cloud, db, claimId, touser, info) {
  let error = '';
  const result = await pushTo(cloud, db, touser, info).catch((err) => {
    console.error('推送失败', err);
    error = `${err.errCode || ''} ${err.errMsg || err.message || String(err)}`;
    return 'error';
  });
  await db.collection('claims').doc(claimId)
    .update({ data: { lastPush: { result, error: error.slice(0, 300), at: db.serverDate() } } })
    .catch(() => {});
  return result;
}

// 模板的字段列表，从公众平台“我的模板”读，读到后缓存
const templateCache = {};
async function templateFields(cloud, tmplId) {
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

module.exports = { pushTo, pushAndLog };

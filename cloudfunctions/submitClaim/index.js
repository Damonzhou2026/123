const cloud = require('wx-server-sdk');
const { pushAndLog } = require('./push');
const { SCENE, checkText } = require('./secCheck');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 失主回答拾得者的核验问题，发起认领；由拾得者确认答案是否正确
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const answer = typeof event.answer === 'string' ? event.answer.trim() : '';
  if (!answer || answer.length > 60) return { ok: false, message: '请填写答案（60 字以内）' };
  if (await checkText(cloud, OPENID, answer, SCENE.comment)) return { ok: false, message: '答案含有违规信息，请修改后再提交' };

  const posts = db.collection('posts');
  const [lost, found] = await Promise.all([
    posts.doc(event.lostPostId).get().then((r) => r.data).catch(() => null),
    posts.doc(event.foundPostId).get().then((r) => r.data).catch(() => null)
  ]);
  if (!lost || lost.type !== 'lost' || lost._openid !== OPENID) return { ok: false, message: '只能用自己的丢失发布来认领' };
  if (lost.status !== 'open') return { ok: false, message: '你的这条丢失发布已经不在匹配中了' };
  if (!found || found.type !== 'found' || found.status !== 'open') return { ok: false, message: '这件物品已经不能认领了' };
  if (found._openid === OPENID) return { ok: false, message: '不能认领自己捡到的物品' };

  const claims = db.collection('claims');
  const { data: existing } = await claims
    .where({ foundPostId: found._id, claimantOpenid: OPENID, status: db.command.in(['pending', 'approved']) })
    .limit(1)
    .get();
  if (existing.length > 0) return { ok: false, message: '你已经认领过这件物品了' };

  const { _id } = await claims.add({
    data: {
      lostPostId: lost._id,
      foundPostId: found._id,
      claimantOpenid: OPENID,
      finderOpenid: found._openid,
      question: found.verifyQuestion,
      answer,
      status: 'pending',
      createdAt: db.serverDate()
    }
  });

  // 提醒拾得者来核对答案，推送失败不影响认领
  await pushAndLog(cloud, db, _id, found._openid, {
    text: '有人认领你捡到的东西，点开核对答案',
    sender: '失主',
    title: found.title || '',
    page: `pages/matches/matches?id=${found._id}`
  });
  return { ok: true, id: _id };
};

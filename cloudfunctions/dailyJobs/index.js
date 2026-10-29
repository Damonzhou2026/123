const cloud = require('wx-server-sdk');
const { pushTo, pushAndLog } = require('./push');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 每天上午 10 点跑一次（定时触发器写在 config.json 里），处理没人收尾的事：
// 1. 配对 3 天还没确认拿回：提醒失主一次
// 2. 拾得者点了“我已交还”，失主 3 天没确认：自动算作已归还
// 3. 发布 30 天还在匹配中：问发布者还在找吗，可以续期
// 4. 问过之后 7 天没续期：自动下架（status 改成 expired）
const DAY = 24 * 3600 * 1000;
const REMIND_CONFIRM_AFTER = 3 * DAY;
const AUTO_CONFIRM_AFTER = 3 * DAY;
const EXPIRE_ASK_AFTER = 30 * DAY;
const EXPIRE_AFTER_ASK = 7 * DAY;
const BATCH = 100;

exports.main = async () => {
  // 只给定时触发器和控制台“云端测试”调用；小程序里调用时会带上用户的 openid
  if (cloud.getWXContext().OPENID) return { ok: false, message: '不能从小程序调用' };
  const now = Date.now();
  const result = {};
  for (const [name, job] of Object.entries({ remindConfirm, autoConfirm, askExpire, expire })) {
    result[name] = await job(now).catch((err) => `出错：${err.message || err}`);
  }
  console.log(result);
  return { ok: true, result };
};

async function postTitle(id) {
  return db.collection('posts').doc(id).get().then((r) => r.data.title).catch(() => '');
}

async function remindConfirm(now) {
  const { data } = await db.collection('claims')
    .where({ status: 'approved', reviewedAt: _.lt(new Date(now - REMIND_CONFIRM_AFTER)), remindedConfirmAt: _.exists(false) })
    .limit(BATCH).get();
  for (const claim of data) {
    await db.collection('claims').doc(claim._id).update({ data: { remindedConfirmAt: db.serverDate() } });
    await pushAndLog(cloud, db, claim._id, claim.claimantOpenid, {
      text: '东西拿回了吗？拿回了请点“我已拿回物品”，对方才能收到你的评价',
      sender: '掉了么',
      title: await postTitle(claim.foundPostId),
      page: `pages/chat/chat?claimId=${claim._id}`
    });
  }
  return data.length;
}

async function autoConfirm(now) {
  const { data } = await db.collection('claims')
    .where({ status: 'approved', handedOverAt: _.lt(new Date(now - AUTO_CONFIRM_AFTER)) })
    .limit(BATCH).get();
  for (const claim of data) {
    await db.runTransaction(async (tx) => {
      const ref = tx.collection('claims').doc(claim._id);
      const { data: fresh } = await ref.get();
      if (fresh.status !== 'approved') return;
      await ref.update({ data: { status: 'returned', autoConfirmed: true, returnedAt: db.serverDate() } });
      await tx.collection('posts').doc(claim.lostPostId).update({ data: { status: 'closed' } });
      await tx.collection('posts').doc(claim.foundPostId).update({ data: { status: 'closed' } });
    }).catch((err) => console.error('自动确认失败', claim._id, err));
  }
  return data.length;
}

async function askExpire(now) {
  const before = new Date(now - EXPIRE_ASK_AFTER);
  const { data } = await db.collection('posts')
    .where(_.and([
      { status: 'open', expireAskedAt: _.exists(false) },
      // 续期过的从续期那天开始算
      _.or([{ renewedAt: _.exists(false), createdAt: _.lt(before) }, { renewedAt: _.lt(before) }])
    ]))
    .field({ _openid: 1, title: 1, type: 1 })
    .limit(BATCH).get();
  for (const post of data) {
    await db.collection('posts').doc(post._id).update({ data: { expireAskedAt: db.serverDate() } });
    await pushTo(cloud, db, post._openid, {
      text: post.type === 'lost' ? '已经发布 30 天了，还在找吗？7 天后自动下架，点开可以续期' : '已经发布 30 天了，还没找到失主。7 天后自动下架，点开可以续期',
      sender: '掉了么',
      title: post.title || '',
      page: `pages/matches/matches?id=${post._id}&renew=1`
    }).catch((err) => console.error('提醒续期失败', post._id, err));
  }
  return data.length;
}

async function expire(now) {
  const { data } = await db.collection('posts')
    .where({ status: 'open', expireAskedAt: _.lt(new Date(now - EXPIRE_AFTER_ASK)) })
    .field({ type: 1 })
    .limit(BATCH).get();
  for (const post of data) {
    await db.collection('posts').doc(post._id).update({ data: { status: 'expired', expiredAt: db.serverDate() } });
    const field = post.type === 'lost' ? 'lostPostId' : 'foundPostId';
    await db.collection('claims').where({ [field]: post._id, status: 'pending' })
      .update({ data: { status: 'rejected', autoRejected: true, reviewedAt: db.serverDate() } });
  }
  return data.length;
}

// 拾得者发布后，在附近已有的失物里找匹配，照片比对成功且分数够高的推一条订阅消息提醒失主。
// 失主要在发布时点过“允许提醒”才收得到；推送失败不影响发布。
const { scoreMatch, MAX_DISTANCE_M, MAX_GAP_MS } = require('./scoring');
const { pushTo } = require('./push');

// 匹配页列出的门槛是 0.35，主动打扰人要更有把握
const NOTIFY_SCORE = 0.8;
const MAX_NOTIFY = 5;

// candidates 是 geoNear 查出来的失物（带 distance），返回要提醒的，分数从高到低
function pickLostToNotify(found, candidates) {
  const seenOwners = new Set();
  return candidates
    .filter((c) => c._openid !== found._openid)
    .map((c) => ({ lost: c, ...scoreMatch(found, c, c.distance) }))
    // 必须真的比对过照片：没比照片时只按类别、距离、时间打分，同类东西离得近就会很高
    .filter((m) => m.imageCompared && m.score >= NOTIFY_SCORE)
    .sort((a, b) => b.score - a.score)
    // 同一个失主丢了几样东西也只提醒一次
    .filter((m) => {
      if (seenOwners.has(m.lost._openid)) return false;
      seenOwners.add(m.lost._openid);
      return true;
    })
    .slice(0, MAX_NOTIFY);
}

// found：刚存进数据库的拾物（带 _id）。结果记在拾物的 matchPushes 上，方便在数据库里排查。
async function notifyLostOwners(cloud, db, found) {
  const _ = db.command;
  const now = found.createdAt.getTime();
  const { list } = await db.collection('posts')
    .aggregate()
    .geoNear({
      distanceField: 'distance',
      spherical: true,
      near: found.location,
      maxDistance: MAX_DISTANCE_M,
      query: { type: 'lost', status: 'open', createdAt: _.gte(new Date(now - MAX_GAP_MS)) }
    })
    .limit(50)
    .end();

  const picks = pickLostToNotify(found, list);
  const pushes = [];
  for (const { lost, score } of picks) {
    let error = '';
    const result = await pushTo(cloud, db, lost._openid, {
      text: `有人捡到了可能是你的${lost.title}，点开看看`,
      sender: '拾得者',
      title: lost.title || '',
      page: `pages/matches/matches?id=${lost._id}`
    }).catch((err) => {
      error = `${err.errCode || ''} ${err.errMsg || err.message || String(err)}`.slice(0, 200);
      return 'error';
    });
    pushes.push({ lostPostId: lost._id, score: Math.round(score * 100) / 100, result, error });
  }
  if (pushes.length) {
    await db.collection('posts').doc(found._id).update({ data: { matchPushes: pushes } }).catch(() => {});
  }
  return pushes;
}

module.exports = { pickLostToNotify, notifyLostOwners, NOTIFY_SCORE };

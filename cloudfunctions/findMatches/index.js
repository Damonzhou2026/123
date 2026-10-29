const cloud = require('wx-server-sdk');
const { scoreMatch, MAX_DISTANCE_M, MAX_GAP_MS } = require('./scoring');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MIN_SCORE = 0.35;
const MAX_RESULTS = 10;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { data: post } = await db.collection('posts').doc(event.postId).get().catch(() => ({ data: null }));
  if (!post) return { ok: false, message: '找不到这条发布' };
  if (post._openid !== OPENID) return { ok: false, message: '只能查看自己发布的匹配' };

  const claims = await loadClaims(post);
  if (post.status !== 'open') {
    return { ok: true, post: publicPost(post), matches: [], claims };
  }

  const opposite = post.type === 'lost' ? 'found' : 'lost';
  const createdAt = new Date(post.createdAt).getTime();

  const { list } = await db.collection('posts')
    .aggregate()
    .geoNear({
      distanceField: 'distance',
      spherical: true,
      near: post.location,
      maxDistance: MAX_DISTANCE_M,
      query: {
        type: opposite,
        status: 'open',
        createdAt: _.gte(new Date(createdAt - MAX_GAP_MS)).and(_.lte(new Date(createdAt + MAX_GAP_MS)))
      }
    })
    .limit(50)
    .end();

  const matches = list
    .filter((c) => c._openid !== OPENID)
    .map((c) => ({ c, ...scoreMatch(post, c, c.distance) }))
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ c, score, imageCompared }) => ({
      _id: c._id,
      title: c.title,
      category: c.category,
      photos: c.photos,
      placeName: c.placeName,
      createdAt: c.createdAt,
      distance: c.distance,
      verifyQuestion: c.verifyQuestion || '',
      claimStatus: claimStatusFor(claims, c._id),
      score,
      imageCompared
    }));

  // 对方的照片换成临时链接
  const urls = await toTempUrls(matches.map((m) => (m.photos || [])[0]));
  matches.forEach((m) => { m.photos = (m.photos || []).map((id) => urls[id] || id); });

  return { ok: true, post: publicPost(post), matches, claims };
};

function publicPost(post) {
  return { _id: post._id, type: post.type, status: post.status, photos: post.photos, matchedClaimId: post.matchedClaimId || '', blockReason: post.blockReason || '' };
}

function claimStatusFor(claims, foundPostId) {
  const claim = claims.find((c) => c.foundPostId === foundPostId);
  return claim ? claim.status : '';
}

// 失主：自己发起过的认领（用来显示“等待确认”）。
// 拾得者：别人对这件物品的认领，附上失主的照片，方便对比后确认。
async function loadClaims(post) {
  const field = post.type === 'lost' ? 'lostPostId' : 'foundPostId';
  const { data } = await db.collection('claims')
    .where({ [field]: post._id })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  if (post.type === 'lost') {
    return data.map((c) => ({ _id: c._id, foundPostId: c.foundPostId, status: c.status }));
  }

  const lostIds = data.map((c) => c.lostPostId);
  const { data: lostPosts } = lostIds.length
    ? await db.collection('posts').where({ _id: _.in(lostIds) }).field({ photos: 1, title: 1 }).get()
    : { data: [] };
  const urls = await toTempUrls(lostPosts.map((p) => (p.photos || [])[0]));
  return data.map((c) => {
    const lost = lostPosts.find((p) => p._id === c.lostPostId) || {};
    const lostPhoto = (lost.photos || [])[0] || '';
    return {
      _id: c._id,
      status: c.status,
      question: c.question,
      answer: c.answer,
      createdAt: c.createdAt,
      lostTitle: lost.title || '',
      lostPhoto: urls[lostPhoto] || lostPhoto
    };
  });
}

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

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
      score,
      imageCompared
    }));

  return {
    ok: true,
    post: { _id: post._id, type: post.type, photos: post.photos },
    matches
  };
};

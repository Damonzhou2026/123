const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const RADIUS_M = 3000;

exports.main = async (event) => {
  const { latitude, longitude } = event;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { ok: false, message: '缺少位置' };
  }
  const type = event.type === 'lost' ? 'lost' : 'found';

  const { list } = await db.collection('posts')
    .aggregate()
    .geoNear({
      distanceField: 'distance',
      spherical: true,
      near: db.Geo.Point(longitude, latitude),
      maxDistance: RADIUS_M,
      query: { type, status: 'open' }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .project({ title: 1, category: 1, photos: 1, placeName: 1, createdAt: 1, distance: 1 })
    .end();

  return { ok: true, items: list };
};

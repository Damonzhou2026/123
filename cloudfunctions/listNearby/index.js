const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const RADIUS_M = 3000;
// 首页对附近所有人公开。这几类照片可能拍到证件号、卡号、手机里的内容，首页不给看，
// 只在匹配页给发了失物的人看。和 miniprogram/utils/constants.js 保持一致
const PRIVATE_PHOTO_CATEGORIES = ['证件', '钱包', '手机'];

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

  const shown = list.map((p) => (PRIVATE_PHOTO_CATEGORIES.includes(p.category)
    ? { ...p, photos: [], photoHidden: true }
    : { ...p, photos: (p.photos || []).slice(0, 1) }));
  const urls = await toTempUrls(shown.map((p) => p.photos[0]));
  const items = shown.map((p) => ({ ...p, photos: p.photos.map((id) => urls[id] || id) }));
  return { ok: true, items };
};

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

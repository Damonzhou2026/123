const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 和 listNearby、miniprogram/utils/constants.js 保持一致
const PRIVATE_PHOTO_CATEGORIES = ['证件', '钱包', '手机'];

// 物品详情：首页点开、或者从微信群里的转发卡片点进来，谁都能看。
// 拾物另外告诉看的人：他有哪些还在找的失物可以拿来认领，以及他之前认领过没有。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const post = await db.collection('posts').doc(event.id).get().then((r) => r.data).catch(() => null);
  const isMine = !!post && post._openid === OPENID;
  if (!post || (post.status === 'blocked' && !isMine)) return { ok: false, message: '这条发布不存在或已下架' };

  const photoHidden = !isMine && PRIVATE_PHOTO_CATEGORIES.includes(post.category);
  const photos = photoHidden ? [] : await toTempUrls(post.photos || []);
  const handover = post.handover || { type: 'self', place: '' };
  const location = latLng(post.location);

  const item = {
    _id: post._id,
    type: post.type,
    status: post.status,
    title: post.title,
    category: post.category,
    customCategory: post.customCategory || '',
    placeName: post.placeName || '',
    latitude: location ? location.latitude : null,
    longitude: location ? location.longitude : null,
    createdAt: post.createdAt,
    reward: post.type === 'lost' ? post.reward || 0 : 0,
    verifyQuestion: post.type === 'found' ? post.verifyQuestion || '' : '',
    // 交到服务台的具体地点，核验通过前只告诉发布者自己，免得别人抢先去冒领
    handover: { type: handover.type, place: isMine ? handover.place : '' },
    photos,
    photoHidden,
    isMine
  };

  let myLostPosts = [];
  let myClaim = null;
  if (post.type === 'found' && !isMine) {
    const [lost, claims] = await Promise.all([
      db.collection('posts').where({ _openid: OPENID, type: 'lost', status: 'open' })
        .orderBy('createdAt', 'desc').limit(6).field({ title: 1 }).get(),
      db.collection('claims').where({ foundPostId: post._id, claimantOpenid: OPENID })
        .orderBy('createdAt', 'desc').limit(1).get()
    ]);
    myLostPosts = lost.data.map((p) => ({ _id: p._id, title: p.title }));
    myClaim = claims.data[0] ? { _id: claims.data[0]._id, status: claims.data[0].status } : null;
  }
  return { ok: true, item, myLostPosts, myClaim };
};

// 数据库读出来的地理位置可能是 Geo.Point 对象，也可能是 GeoJSON（coordinates: [经度, 纬度]）
function latLng(point) {
  if (!point) return null;
  if (typeof point.latitude === 'number') return { latitude: point.latitude, longitude: point.longitude };
  if (Array.isArray(point.coordinates)) return { latitude: point.coordinates[1], longitude: point.coordinates[0] };
  return null;
}

// 照片存的是云存储 fileID。免费套餐不能把存储权限改成“所有用户可读”，
// 对方直接用 fileID 看不到图，所以由云函数换成临时链接再返回。
async function toTempUrls(fileIDs) {
  const ids = [...new Set(fileIDs.filter((id) => typeof id === 'string' && id.startsWith('cloud://')))];
  if (ids.length === 0) return [];
  const { fileList } = await cloud.getTempFileURL({ fileList: ids });
  return fileList.map((f) => f.tempFileURL).filter(Boolean);
}

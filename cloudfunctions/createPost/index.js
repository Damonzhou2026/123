const cloud = require('wx-server-sdk');
const { fetchEmbeddings } = require('./embedding');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];
const OTHER_CATEGORY = '其他';
const MAX_CUSTOM_CATEGORY = 10; // 字，和 miniprogram/utils/constants.js 保持一致
const NO_REWARD_CATEGORIES = ['证件'];
const MAX_REWARD = 10000; // 元，和 miniprogram/utils/constants.js 保持一致

function validate(e) {
  if (e.type !== 'lost' && e.type !== 'found') return '类型错误';
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 40) return '请填写物品名称（40 字以内）';
  if (!CATEGORIES.includes(e.category)) return '类别错误';
  if (e.category === OTHER_CATEGORY) {
    const custom = typeof e.customCategory === 'string' ? e.customCategory.trim() : '';
    if (!custom || custom.length > MAX_CUSTOM_CATEGORY) return `请填写具体是什么东西（${MAX_CUSTOM_CATEGORY} 字以内）`;
  }
  if (!Array.isArray(e.photos) || e.photos.length === 0 || e.photos.length > 3) return '请上传 1～3 张照片';
  if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return '请选择位置';
  if (e.type === 'found' && (typeof e.verifyQuestion !== 'string' || !e.verifyQuestion.trim())) return '请设置核验问题';
  if (e.type === 'lost') {
    if (!Number.isInteger(e.reward) || e.reward < 0 || e.reward > MAX_REWARD) return `感谢金请填 0～${MAX_REWARD} 的整数`;
    if (e.reward > 0 && NO_REWARD_CATEGORIES.includes(e.category)) return '证件类物品不设感谢金';
  }
  return '';
}

exports.main = async (event) => {
  const error = validate(event);
  if (error) return { ok: false, message: error };

  const { OPENID } = cloud.getWXContext();
  const vision = await fetchEmbeddings(cloud, event.photos);

  const doc = {
    _openid: OPENID,
    type: event.type,
    title: event.title.trim(),
    category: event.category,
    // 类别选「其他」时用户自己填的名称；匹配仍按 category 比较，不受影响
    customCategory: event.category === OTHER_CATEGORY ? event.customCategory.trim() : '',
    photos: event.photos,
    placeName: String(event.placeName || '').slice(0, 60),
    location: db.Geo.Point(event.longitude, event.latitude),
    // 感谢金只由失主自愿设置；拾得者不能定价
    reward: event.type === 'lost' ? event.reward : 0,
    verifyQuestion: event.type === 'found' ? event.verifyQuestion.trim().slice(0, 60) : '',
    // 照片特征向量，findMatches 用来看图比对；只有同一来源的向量能互相比
    embeddings: vision.embeddings,
    embeddingSource: vision.source,
    // 智谱看图写的物品描述，只存不返回，方便以后排查匹配效果
    photoDescription: vision.description,
    // 看图失败的原因（Key 不对、超时等），正常时为空
    embeddingError: vision.error,
    status: 'open',
    createdAt: db.serverDate()
  };

  const { _id } = await db.collection('posts').add({ data: doc });
  return { ok: true, id: _id };
};

const cloud = require('wx-server-sdk');
const { fetchEmbeddings } = require('./embedding');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];
const NO_REWARD_CATEGORIES = ['证件'];
const MAX_REWARD = 10000;

function validate(e) {
  if (e.type !== 'lost' && e.type !== 'found') return '类型错误';
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 40) return '请填写物品名称（40 字以内）';
  if (!CATEGORIES.includes(e.category)) return '类别错误';
  if (!Array.isArray(e.photos) || e.photos.length === 0 || e.photos.length > 3) return '请上传 1～3 张照片';
  if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return '请选择位置';
  if (e.type === 'found' && (typeof e.verifyQuestion !== 'string' || !e.verifyQuestion.trim())) return '请设置核验问题';
  if (e.type === 'lost') {
    if (!Number.isInteger(e.reward) || e.reward < 0 || e.reward > MAX_REWARD) return '感谢金金额不正确';
    if (e.reward > 0 && NO_REWARD_CATEGORIES.includes(e.category)) return '证件类物品不设感谢金';
  }
  return '';
}

exports.main = async (event) => {
  const error = validate(event);
  if (error) return { ok: false, message: error };

  const { OPENID } = cloud.getWXContext();
  const { fileList } = await cloud.getTempFileURL({ fileList: event.photos });
  const embeddings = await fetchEmbeddings(fileList.map((f) => f.tempFileURL).filter(Boolean));

  const doc = {
    _openid: OPENID,
    type: event.type,
    title: event.title.trim(),
    category: event.category,
    photos: event.photos,
    placeName: String(event.placeName || '').slice(0, 60),
    location: db.Geo.Point(event.longitude, event.latitude),
    // 感谢金只由失主自愿设置；拾得者不能定价
    reward: event.type === 'lost' ? event.reward : 0,
    verifyQuestion: event.type === 'found' ? event.verifyQuestion.trim().slice(0, 60) : '',
    // 每张照片一个特征向量，findMatches 用来看图比对
    embeddings,
    status: 'open',
    createdAt: db.serverDate()
  };

  const { _id } = await db.collection('posts').add({ data: doc });
  return { ok: true, id: _id };
};

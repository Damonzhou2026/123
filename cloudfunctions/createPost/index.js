const cloud = require('wx-server-sdk');
const { fetchEmbeddings } = require('./embedding');
const { SCENE, checkText, submitImages } = require('./secCheck');
const { notifyLostOwners } = require('./notifyMatches');
const { pushTo } = require('./push');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];
const OTHER_CATEGORY = '其他';
const MAX_CUSTOM_CATEGORY = 10; // 字，和 miniprogram/utils/constants.js 保持一致
const NO_REWARD_CATEGORIES = ['证件'];
const MAX_REWARD = 10000; // 元，和 miniprogram/utils/constants.js 保持一致
const MAX_POSTS_PER_DAY = 10;
const MAX_DESCRIPTION = 100; // 字，和 miniprogram/utils/constants.js 保持一致
// 看图失败的发布由定时触发器补跑：只补一天内的，每条最多再试 3 次
const RETRY_WITHIN_MS = 24 * 3600 * 1000;
const MAX_VISION_RETRIES = 3;
const RETRY_BATCH = 5;
const RETRY_TIME_BUDGET_MS = 30 * 1000; // 云函数 60 秒超时，留一半余量

function validate(e) {
  if (e.type !== 'lost' && e.type !== 'found') return '类型错误';
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 40) return '请填写物品名称（40 字以内）';
  if (!CATEGORIES.includes(e.category)) return '类别错误';
  if (e.category === OTHER_CATEGORY) {
    const custom = typeof e.customCategory === 'string' ? e.customCategory.trim() : '';
    if (!custom || custom.length > MAX_CUSTOM_CATEGORY) return `请填写具体是什么东西（${MAX_CUSTOM_CATEGORY} 字以内）`;
  }
  if (!Array.isArray(e.photos) || e.photos.length > 3) return '最多上传 3 张照片';
  if (e.description != null && (typeof e.description !== 'string' || e.description.length > MAX_DESCRIPTION)) return `描述请写 ${MAX_DESCRIPTION} 字以内`;
  // 捡到的东西一定要拍照；失主手里常常没有照片，可以只写描述
  if (e.type === 'found' && e.photos.length === 0) return '请拍一张捡到的东西';
  if (e.type === 'lost' && e.photos.length === 0 && !(e.description || '').trim()) return '没有照片的话，请描述一下它的样子';
  if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return '请选择位置';
  if (e.type === 'found' && (typeof e.verifyQuestion !== 'string' || !e.verifyQuestion.trim())) return '请设置核验问题';
  if (e.type === 'found' && e.handover && e.handover.type === 'deposited') {
    if (typeof e.handover.place !== 'string' || !e.handover.place.trim() || e.handover.place.length > 40) return '请填写交到了哪里（30 字以内）';
  }
  if (e.forLostPostId != null && typeof e.forLostPostId !== 'string') return '参数错误';
  if (e.type === 'lost') {
    if (!Number.isInteger(e.reward) || e.reward < 0 || e.reward > MAX_REWARD) return `感谢金请填 0～${MAX_REWARD} 的整数`;
    if (e.reward > 0 && NO_REWARD_CATEGORIES.includes(e.category)) return '证件类物品不设感谢金';
  }
  return '';
}

// 没有照片时拿来算向量的文字：名称、类别加上失主写的描述
function matchText(post) {
  if (Array.isArray(post.photos) && post.photos.length) return '';
  if (!post.description) return '';
  return `${post.title}（${post.customCategory || post.category}）：${post.description}`;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  // 定时触发器调用时没有 OPENID
  if (!OPENID && event.Type === 'Timer') return retryVision();

  const error = validate(event);
  if (error) return { ok: false, message: error };

  // 每人每天最多发 10 条，防止刷屏和批量发假失物
  const { total: today } = await db.collection('posts')
    .where({ _openid: OPENID, createdAt: db.command.gte(new Date(Date.now() - 24 * 3600 * 1000)) })
    .count();
  if (today >= MAX_POSTS_PER_DAY) return { ok: false, message: '今天发布得太多了，明天再来吧' };

  const customCategory = event.category === OTHER_CATEGORY ? event.customCategory.trim() : '';
  const placeName = String(event.placeName || '').slice(0, 60);
  const verifyQuestion = event.type === 'found' ? event.verifyQuestion.trim().slice(0, 60) : '';
  const description = String(event.description || '').trim();
  // 拾得者把东西交到了服务台等处：地点只告诉通过核验的失主
  const deposited = event.type === 'found' && event.handover && event.handover.type === 'deposited';
  const handover = { type: deposited ? 'deposited' : 'self', place: deposited ? event.handover.place.trim() : '' };
  // 从某条失物的详情页点“我捡到了”发的，发布后直接提醒那位失主
  const forLostPostId = event.type === 'found' ? event.forLostPostId || '' : '';

  // 名称、自填类别、地点、核验问题都会给别人看到，先过内容安全检测
  const risky = await checkText(cloud, OPENID, [event.title.trim(), customCategory, placeName, verifyQuestion, handover.place, description], SCENE.forum);
  if (risky) return { ok: false, message: '填写的内容含有违规信息，请修改后再发布' };

  // 照片走微信异步检测，和看图同时进行；结果出来后违规的发布由 mediaCheckCallback 下架
  const text = matchText({ ...event, title: event.title.trim(), customCategory, description });
  const [vision, mediaCheck] = await Promise.all([
    fetchEmbeddings(cloud, event.photos, text),
    event.photos.length ? submitImages(cloud, OPENID, event.photos, SCENE.forum) : Promise.resolve({ traceIds: [], error: '' })
  ]);

  const doc = {
    _openid: OPENID,
    type: event.type,
    title: event.title.trim(),
    category: event.category,
    // 类别选「其他」时用户自己填的名称；匹配仍按 category 比较，不受影响
    customCategory,
    photos: event.photos,
    // 物品描述（选填）：失主没有照片时必填，用它来做 AI 匹配
    description,
    placeName,
    location: db.Geo.Point(event.longitude, event.latitude),
    // 感谢金只由失主自愿设置；拾得者不能定价
    reward: event.type === 'lost' ? event.reward : 0,
    verifyQuestion,
    handover,
    forLostPostId,
    // 照片特征向量，findMatches 用来看图比对；只有同一来源的向量能互相比
    embeddings: vision.embeddings,
    embeddingSource: vision.source,
    // 智谱看图写的物品描述，只存不返回，方便以后排查匹配效果
    photoDescription: vision.description,
    // 用哪个模型看的图：免费的 glm-4.6v-flash，被限流时是备用的付费模型；text 表示没照片、用描述算的
    photoModel: vision.model,
    // 看图失败的原因（Key 不对、超时、被限流等），正常时为空；不为空的会被定时任务补跑
    embeddingError: vision.error,
    embeddingRetries: 0,
    // 照片安全检测：traceIds 用来对上微信推回来的结果；result 是 pending / pass / risky；
    // 提交失败时 error 记原因（比如没配接口权限），这时照片不会被检测
    mediaCheck: { traceIds: mediaCheck.traceIds, result: mediaCheck.traceIds.length ? 'pending' : 'none', error: mediaCheck.error },
    status: 'open',
    createdAt: db.serverDate()
  };

  const { _id } = await db.collection('posts').add({ data: doc });

  // 捡到东西：去找附近已经登记的失物，像的话提醒失主。失败不影响发布
  if (doc.type === 'found') {
    if (forLostPostId) {
      await notifyLinkedOwner(OPENID, { ...doc, _id }).catch((err) => console.error('提醒失主失败', err));
    }
    await notifyLostOwners(cloud, db, { ...doc, _id, createdAt: new Date() })
      .catch((err) => console.error('提醒失主失败', err));
  }
  return { ok: true, id: _id };
};

// 定时触发器（config.json 里的 retryVision，每 10 分钟）：看图失败的发布再试一次。
// 一条一条来，免费模型并发少；补上后，捡到的东西再去提醒附近的失主
async function retryVision() {
  const _ = db.command;
  const started = Date.now();
  const { data: posts } = await db.collection('posts')
    .where({
      status: 'open',
      embeddingError: _.neq(''),
      embeddingRetries: _.lt(MAX_VISION_RETRIES),
      createdAt: _.gte(new Date(started - RETRY_WITHIN_MS))
    })
    .orderBy('createdAt', 'asc')
    .limit(RETRY_BATCH)
    .get();

  const results = [];
  for (const post of posts) {
    if (Date.now() - started > RETRY_TIME_BUDGET_MS) break;
    const vision = await fetchEmbeddings(cloud, post.photos, matchText(post));
    const fixed = vision.embeddings.length > 0;
    await db.collection('posts').doc(post._id).update({
      data: {
        embeddings: vision.embeddings,
        embeddingSource: vision.source,
        photoDescription: vision.description,
        photoModel: vision.model,
        embeddingError: vision.error || (fixed ? '' : '没有算出向量'),
        embeddingRetries: _.inc(1)
      }
    });
    if (fixed && post.type === 'found') {
      await notifyLostOwners(cloud, db, {
        ...post,
        embeddings: vision.embeddings,
        embeddingSource: vision.source,
        createdAt: new Date(post.createdAt)
      }).catch((err) => console.error('提醒失主失败', err));
    }
    results.push({ id: post._id, fixed, error: vision.error });
  }
  return { ok: true, tried: results.length, results };
}

// 捡到的人在某条失物详情页点了“我捡到了”：不管 AI 打几分，都提醒这位失主来看看。
// 结果记在拾物的 linkedPush 上
async function notifyLinkedOwner(finderOpenid, found) {
  const lost = await db.collection('posts').doc(found.forLostPostId).get().then((r) => r.data).catch(() => null);
  if (!lost || lost.type !== 'lost' || lost.status !== 'open' || lost._openid === finderOpenid) return;
  const result = await pushTo(cloud, db, lost._openid, {
    text: `有人说捡到了你的${lost.title}，点开核对一下`,
    sender: '拾得者',
    title: lost.title || '',
    page: `pages/matches/matches?id=${lost._id}`
  }).catch((err) => `error ${err.errCode || ''} ${err.errMsg || err.message || ''}`.slice(0, 200));
  await db.collection('posts').doc(found._id).update({ data: { linkedPush: { lostPostId: lost._id, result } } }).catch(() => {});
}

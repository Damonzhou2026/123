const cloud = require('wx-server-sdk');
const { SCENE, checkText, submitImages } = require('./secCheck');
const { pushTo } = require('./push');
const sms = require('./sms');
const { randomCode, normalizeCode, normalizePhone, maskPhone, hashCode } = require('./codes');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 防丢贴：每张贴纸一个编号（tags 集合的 _id），扫码打开 pages/tag/tag。
// 状态：unbound 还没绑定 / active 使用中 / lost 主人标记丢了 / paused 主人暂停了提醒
//
// 动作：
//   get       扫码进来时查这张贴纸，按身份返回：没绑定、我的、别人的
//   sendCode  绑定或换手机号时发短信验证码
//   bind      绑定（只有没绑定的贴纸能绑）
//   update    主人改名称、照片、留言、手机号
//   unbind    主人解绑，贴纸回到没绑定，可以给别的东西用
//   pause     主人暂停 / 恢复提醒
//   markLost  主人说丢了：页面先用 createPost 发一条失物，再把失物 id 记到贴纸上
//   recovered 主人说找回来了：撤下那条失物
//   report    拾主点“我捡到了”：建一段已配对的对话，提醒主人
//   mine      我的防丢贴
//   generate  管理员批量生成编号（环境变量 ADMIN_OPENIDS）
//   qrcode    管理员生成某个编号的小程序码，域名备案下来之前测试用
const ACTIONS = { get, sendCode, bind, update, unbind, pause, markLost, recovered, report, mine, generate, qrcode };

const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];
const OTHER_CATEGORY = '其他';
const MAX_CUSTOM_CATEGORY = 10;
const MAX_TITLE = 20;
const MAX_NOTE = 30;
const MAX_REPORT_TEXT = 200;
const MAX_REPORT_PHOTOS = 3;
const DAY = 24 * 3600 * 1000;

// 防骚扰
const REPORTS_PER_TAG_PER_DAY = 2; // 同一个人对同一张贴纸，每天最多说 2 次“我捡到了”
const REPORTS_PER_DAY = 10; // 一个人每天最多对 10 张贴纸说“我捡到了”
const SMS_PER_TAG_PER_DAY = 3; // 一张贴纸每天最多发 3 条捡到短信，再多只发微信提醒
const CODE_SMS_GAP_MS = 60 * 1000; // 验证码 60 秒才能再发
const CODE_SMS_PER_DAY = 5; // 一个人每天最多收 5 条验证码
const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_MAX_TRIES = 5;
const MAX_GENERATE = 500;

exports.main = async (event) => {
  const action = ACTIONS[event && event.action];
  if (!action) return { ok: false, message: '未知操作' };
  const { OPENID } = cloud.getWXContext();
  try {
    return await action(event, OPENID);
  } catch (err) {
    console.error(event.action, err);
    return { ok: false, message: typeof err === 'string' ? err : (err.message || '操作失败') };
  }
};

async function ensureCollections() {
  for (const name of ['tags', 'tagReports', 'smsCodes']) {
    await db.createCollection(name).catch(() => {});
  }
}

async function loadTag(code) {
  const id = normalizeCode(code);
  if (!id) return null;
  return db.collection('tags').doc(id).get().then((r) => r.data).catch(() => null);
}

function isAdmin(openid) {
  return String(process.env.ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).includes(openid);
}

async function tempUrl(fileID) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return '';
  const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] }).catch(() => ({ fileList: [] }));
  return (fileList[0] && fileList[0].tempFileURL) || '';
}

function displayCategory(tag) {
  return tag.category === OTHER_CATEGORY && tag.customCategory ? tag.customCategory : tag.category;
}

// ---------- 查码 ----------

async function get(event, openid) {
  const tag = await loadTag(event.code);
  if (!tag) return { ok: false, message: '没有找到这张防丢贴，请确认二维码是掉了么的防丢贴' };
  const smsEnabled = sms.config().enabled;

  if (tag.status === 'unbound') return { ok: true, view: 'unbound', code: tag._id, smsEnabled };

  if (tag.ownerOpenid === openid) {
    const { data: claims } = await db.collection('claims')
      .where({ tagId: tag._id }).orderBy('createdAt', 'desc').limit(10)
      .field({ status: 1, createdAt: 1 }).get();
    return {
      ok: true,
      view: 'mine',
      code: tag._id,
      smsEnabled,
      tag: {
        status: tag.status,
        title: tag.title,
        category: tag.category,
        customCategory: tag.customCategory || '',
        note: tag.note || '',
        forChild: !!tag.forChild,
        photo: tag.photo || '',
        photoUrl: await tempUrl(tag.photo),
        phone: maskPhone(tag.phone),
        lostPostId: tag.lostPostId || '',
        blocked: tag.mediaCheck && tag.mediaCheck.result === 'risky'
      },
      claims
    };
  }

  // 别人扫到：只给看物品名称、照片和主人的一句话，不给任何联系方式。
  // 孩子的东西连照片和那句话都不给看，免得暴露孩子的信息
  const hideDetails = !!tag.forChild || (tag.mediaCheck && tag.mediaCheck.result === 'risky');
  const mine = await db.collection('claims')
    .where({ tagId: tag._id, finderOpenid: openid, status: 'approved' }).limit(1).get();
  return {
    ok: true,
    view: 'others',
    code: tag._id,
    tag: {
      status: tag.status === 'paused' ? 'paused' : tag.status,
      title: tag.forChild ? '小朋友的东西' : tag.title,
      category: displayCategory(tag),
      forChild: !!tag.forChild,
      note: hideDetails ? '' : tag.note || '',
      photoUrl: hideDetails ? '' : await tempUrl(tag.photo)
    },
    myClaimId: mine.data[0] ? mine.data[0]._id : ''
  };
}

// ---------- 验证码 ----------

async function sendCode(event, openid) {
  const c = sms.config();
  if (!c.enabled) return { ok: false, message: '短信提醒还没开通' };
  const phone = normalizePhone(event.phone);
  if (!phone) return { ok: false, message: '请填写正确的手机号' };
  await ensureCollections();

  const ref = db.collection('smsCodes').doc(openid);
  const old = await ref.get().then((r) => r.data).catch(() => null);
  const now = Date.now();
  if (old && now - new Date(old.sentAt).getTime() < CODE_SMS_GAP_MS) return { ok: false, message: '验证码刚发过，1 分钟后再试' };
  const sameDay = old && now - new Date(old.dayStart).getTime() < DAY;
  if (sameDay && old.dayCount >= CODE_SMS_PER_DAY) return { ok: false, message: '今天发的验证码太多了，明天再试' };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const result = await sms.sendSms(c, phone, c.verifyTemplate, [code]);
  if (result !== 'sent') {
    console.error('验证码发送失败', result);
    return { ok: false, message: '验证码发送失败，请稍后再试' };
  }
  await ref.set({
    data: {
      phone,
      codeHash: hashCode(code, openid),
      tries: 0,
      sentAt: new Date(now),
      expiresAt: new Date(now + CODE_TTL_MS),
      dayStart: sameDay ? old.dayStart : new Date(now),
      dayCount: sameDay ? old.dayCount + 1 : 1
    }
  });
  return { ok: true };
}

// 核对验证码，对了就作废，返回错误文字或空字符串
async function verifyCode(openid, phone, code) {
  const ref = db.collection('smsCodes').doc(openid);
  const saved = await ref.get().then((r) => r.data).catch(() => null);
  if (!saved || saved.phone !== phone || !saved.codeHash) return '请先获取验证码';
  if (Date.now() > new Date(saved.expiresAt).getTime()) return '验证码过期了，请重新获取';
  if (saved.tries >= CODE_MAX_TRIES) return '错的次数太多，请重新获取验证码';
  if (hashCode(String(code || '').trim(), openid) !== saved.codeHash) {
    await ref.update({ data: { tries: _.inc(1) } });
    return '验证码不对';
  }
  await ref.update({ data: { codeHash: '', tries: 0 } });
  return '';
}

// ---------- 绑定和修改 ----------

// 检查绑定 / 修改表单，返回 { error } 或整理好的字段
function readForm(e) {
  const title = typeof e.title === 'string' ? e.title.trim() : '';
  if (!title || title.length > MAX_TITLE) return { error: `请填写物品名称（${MAX_TITLE} 字以内）` };
  if (!CATEGORIES.includes(e.category)) return { error: '类别错误' };
  const customCategory = e.category === OTHER_CATEGORY && typeof e.customCategory === 'string' ? e.customCategory.trim() : '';
  if (e.category === OTHER_CATEGORY && (!customCategory || customCategory.length > MAX_CUSTOM_CATEGORY)) {
    return { error: `请填写具体是什么东西（${MAX_CUSTOM_CATEGORY} 字以内）` };
  }
  const note = typeof e.note === 'string' ? e.note.trim() : '';
  if (note.length > MAX_NOTE) return { error: `想对捡到的人说的话请在 ${MAX_NOTE} 字以内` };
  const photo = typeof e.photo === 'string' && e.photo.startsWith('cloud://') ? e.photo : '';
  return { title, category: e.category, customCategory, note, photo, forChild: e.forChild === true };
}

// 新手机号要先过验证码；返回 { error } 或 { phone }（空字符串表示不填）
async function readPhone(event, openid) {
  if (!event.phone) return { phone: '' };
  const phone = normalizePhone(event.phone);
  if (!phone) return { error: '请填写正确的手机号' };
  const error = await verifyCode(openid, phone, event.smsCode);
  return error ? { error } : { phone };
}

async function checkForm(openid, form) {
  // 名称、类别、留言会给捡到的人看，先过内容安全检测
  const risky = await checkText(cloud, openid, [form.title, form.customCategory, form.note], SCENE.profile);
  return risky ? '填写的内容含有违规信息，请修改' : '';
}

async function bind(event, openid) {
  const form = readForm(event);
  if (form.error) return { ok: false, message: form.error };
  const code = normalizeCode(event.code);
  if (!code) return { ok: false, message: '编号不对' };
  await ensureCollections();

  const existing = await loadTag(code);
  if (!existing) return { ok: false, message: '没有找到这张防丢贴' };
  if (existing.status !== 'unbound') return { ok: false, message: '这张防丢贴已经被绑定了' };

  const riskyText = await checkForm(openid, form);
  if (riskyText) return { ok: false, message: riskyText };
  const phone = await readPhone(event, openid);
  if (phone.error) return { ok: false, message: phone.error };

  const mediaCheck = form.photo ? await submitImages(cloud, openid, [form.photo], SCENE.profile) : { traceIds: [], error: '' };
  // 两个人同时绑同一张：事务里再看一次，后到的失败
  await db.runTransaction(async (tx) => {
    const ref = tx.collection('tags').doc(code);
    const { data } = await ref.get();
    if (data.status !== 'unbound') return tx.rollback('这张防丢贴已经被绑定了');
    await ref.update({
      data: {
        ...form,
        phone: phone.phone,
        ownerOpenid: openid,
        status: 'active',
        lostPostId: '',
        mediaCheck: { traceIds: mediaCheck.traceIds, result: mediaCheck.traceIds.length ? 'pending' : 'none', error: mediaCheck.error },
        boundAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  });
  return { ok: true };
}

async function loadOwnTag(event, openid) {
  const tag = await loadTag(event.code);
  if (!tag || tag.ownerOpenid !== openid || tag.status === 'unbound') return null;
  return tag;
}

async function update(event, openid) {
  const tag = await loadOwnTag(event, openid);
  if (!tag) return { ok: false, message: '找不到你的这张防丢贴' };
  const form = readForm(event);
  if (form.error) return { ok: false, message: form.error };
  const riskyText = await checkForm(openid, form);
  if (riskyText) return { ok: false, message: riskyText };

  const data = { ...form, updatedAt: db.serverDate() };
  // removePhone：主人把手机号删了；phone：换了新号（要验证码）；都没传就不动
  if (event.removePhone === true) data.phone = '';
  else if (event.phone) {
    const phone = await readPhone(event, openid);
    if (phone.error) return { ok: false, message: phone.error };
    data.phone = phone.phone;
  }
  if (form.photo !== (tag.photo || '')) {
    const mediaCheck = form.photo ? await submitImages(cloud, openid, [form.photo], SCENE.profile) : { traceIds: [], error: '' };
    data.mediaCheck = { traceIds: mediaCheck.traceIds, result: mediaCheck.traceIds.length ? 'pending' : 'none', error: mediaCheck.error };
    if (tag.photo) await cloud.deleteFile({ fileList: [tag.photo] }).catch(() => {});
  }
  await db.collection('tags').doc(tag._id).update({ data });
  return { ok: true };
}

// 解绑：清掉主人的信息和照片，贴纸可以重新绑定
async function unbind(event, openid) {
  const tag = await loadOwnTag(event, openid);
  if (!tag) return { ok: false, message: '找不到你的这张防丢贴' };
  await resetTag(tag);
  return { ok: true };
}

async function resetTag(tag) {
  if (tag.lostPostId) await closeLostPost(tag.lostPostId);
  await db.collection('tags').doc(tag._id).update({
    data: {
      status: 'unbound',
      ownerOpenid: '',
      title: '',
      category: '',
      customCategory: '',
      note: '',
      photo: '',
      forChild: false,
      phone: '',
      lostPostId: '',
      mediaCheck: _.remove(),
      unboundAt: db.serverDate()
    }
  });
  if (tag.photo) await cloud.deleteFile({ fileList: [tag.photo] }).catch(() => {});
}

async function pause(event, openid) {
  const tag = await loadOwnTag(event, openid);
  if (!tag) return { ok: false, message: '找不到你的这张防丢贴' };
  const paused = event.paused === true;
  const status = paused ? 'paused' : (tag.lostPostId ? 'lost' : 'active');
  await db.collection('tags').doc(tag._id).update({ data: { status, updatedAt: db.serverDate() } });
  return { ok: true, status };
}

// ---------- 丢了 / 找回来了 ----------

async function markLost(event, openid) {
  const tag = await loadOwnTag(event, openid);
  if (!tag) return { ok: false, message: '找不到你的这张防丢贴' };
  const post = await db.collection('posts').doc(String(event.lostPostId || '')).get().then((r) => r.data).catch(() => null);
  if (!post || post._openid !== openid || post.type !== 'lost') return { ok: false, message: '找不到那条失物' };
  await db.collection('posts').doc(post._id).update({ data: { tagId: tag._id } });
  await db.collection('tags').doc(tag._id).update({ data: { status: 'lost', lostPostId: post._id, lostAt: db.serverDate() } });
  return { ok: true };
}

async function recovered(event, openid) {
  const tag = await loadOwnTag(event, openid);
  if (!tag) return { ok: false, message: '找不到你的这张防丢贴' };
  if (tag.lostPostId) await closeLostPost(tag.lostPostId);
  await db.collection('tags').doc(tag._id).update({
    data: { status: tag.status === 'paused' ? 'paused' : 'active', lostPostId: '' }
  });
  return { ok: true };
}

// 还在匹配中的失物撤下来；已经配对的留着让双方走完交接
async function closeLostPost(postId) {
  await db.collection('posts').where({ _id: postId, status: 'open' })
    .update({ data: { status: 'withdrawn', withdrawnAt: db.serverDate() } }).catch(() => {});
  await db.collection('claims').where({ lostPostId: postId, status: 'pending' })
    .update({ data: { status: 'rejected', autoRejected: true, reviewedAt: db.serverDate() } }).catch(() => {});
}

// ---------- 我捡到了 ----------

function readReport(e) {
  const text = typeof e.text === 'string' ? e.text.trim() : '';
  if (text.length > MAX_REPORT_TEXT) return { error: `留言请在 ${MAX_REPORT_TEXT} 字以内` };
  const photos = Array.isArray(e.photos) ? e.photos.filter((p) => typeof p === 'string' && p.startsWith('cloud://')) : [];
  if (photos.length > MAX_REPORT_PHOTOS) return { error: `最多 ${MAX_REPORT_PHOTOS} 张照片` };
  if (!text && photos.length === 0) return { error: '请留一句话或拍张照片，告诉主人东西在哪' };
  const hasLocation = typeof e.latitude === 'number' && typeof e.longitude === 'number'
    && Math.abs(e.latitude) <= 90 && Math.abs(e.longitude) <= 180;
  return {
    text,
    photos,
    placeName: hasLocation ? String(e.placeName || '').slice(0, 60) : '',
    location: hasLocation ? db.Geo.Point(e.longitude, e.latitude) : null
  };
}

async function report(event, openid) {
  const input = readReport(event);
  if (input.error) return { ok: false, message: input.error };
  const tag = await loadTag(event.code);
  if (!tag || tag.status === 'unbound') return { ok: false, message: '这张防丢贴还没有绑定主人' };
  if (tag.ownerOpenid === openid) return { ok: false, message: '这是你自己的防丢贴' };
  if (tag.status === 'paused') return { ok: false, message: '主人暂停了这张防丢贴的提醒，可以把东西交给附近的服务台或保安' };
  await ensureCollections();

  // 已经在和主人聊了：直接回到那段对话
  const existing = await db.collection('claims')
    .where({ tagId: tag._id, finderOpenid: openid, status: 'approved' }).limit(1).get();
  if (existing.data[0]) return { ok: true, claimId: existing.data[0]._id, existing: true };

  const since = new Date(Date.now() - DAY);
  const reports = db.collection('tagReports');
  const [forTag, total] = await Promise.all([
    reports.where({ tagId: tag._id, finderOpenid: openid, createdAt: _.gte(since) }).count().then((r) => r.total),
    reports.where({ finderOpenid: openid, createdAt: _.gte(since) }).count().then((r) => r.total)
  ]);
  if (forTag >= REPORTS_PER_TAG_PER_DAY || total >= REPORTS_PER_DAY) return { ok: false, message: '今天提交得太多了，明天再试' };

  const placeText = input.placeName ? `我在${input.placeName}附近捡到的。` : '';
  const message = [input.text, placeText].filter(Boolean).join(' ');
  if (await checkText(cloud, openid, [input.text, input.placeName], SCENE.comment)) {
    return { ok: false, message: '留言含有违规信息，请修改' };
  }
  const mediaCheck = input.photos.length ? await submitImages(cloud, openid, input.photos, SCENE.comment) : { traceIds: [], error: '' };

  // 建一对已配对的发布和认领，聊天、我已交还、我已拿回、互评、举报都直接复用。
  // 这两条发布只为这段对话存在：source 标成 tag，不进附近列表和匹配（状态一开始就是 matched）
  const now = db.serverDate();
  // 孩子的东西：拾主在聊天页和“我的发布”里也只看到“小朋友的东西”
  const title = tag.forChild ? '小朋友的东西' : tag.title;
  const base = { title, category: tag.category, customCategory: tag.customCategory || '', reward: 0, verifyQuestion: '', status: 'matched', source: 'tag', tagId: tag._id, createdAt: now };
  const lost = await db.collection('posts').add({
    data: { ...base, _openid: tag.ownerOpenid, type: 'lost', photos: tag.photo ? [tag.photo] : [], placeName: '' }
  });
  const found = await db.collection('posts').add({
    data: {
      ...base,
      _openid: openid,
      type: 'found',
      photos: input.photos,
      placeName: input.placeName,
      ...(input.location ? { location: input.location } : {}),
      handover: { type: 'self', place: '' },
      mediaCheck: { traceIds: mediaCheck.traceIds, result: mediaCheck.traceIds.length ? 'pending' : 'none', error: mediaCheck.error }
    }
  });
  const claim = await db.collection('claims').add({
    data: {
      source: 'tag',
      tagId: tag._id,
      lostPostId: lost._id,
      foundPostId: found._id,
      claimantOpenid: tag.ownerOpenid,
      finderOpenid: openid,
      answer: '',
      status: 'approved',
      createdAt: now,
      reviewedAt: now
    }
  });
  await Promise.all([
    db.collection('posts').doc(lost._id).update({ data: { matchedClaimId: claim._id } }),
    db.collection('posts').doc(found._id).update({ data: { matchedClaimId: claim._id } })
  ]);
  if (message) {
    await db.collection('messages').add({ data: { claimId: claim._id, senderOpenid: openid, text: message.slice(0, 500), createdAt: now } });
  }

  const notified = await notifyOwner(tag, claim._id);
  await reports.add({
    data: {
      tagId: tag._id,
      finderOpenid: openid,
      claimId: claim._id,
      text: input.text,
      photos: input.photos,
      placeName: input.placeName,
      wechat: notified.wechat,
      sms: notified.sms,
      createdAt: now
    }
  });
  return { ok: true, claimId: claim._id };
}

// 先发微信订阅消息；没发出去（主人没授权或次数用完）再发短信
async function notifyOwner(tag, claimId) {
  const wechat = await pushTo(cloud, db, tag.ownerOpenid, {
    text: `有人捡到了你的${tag.title}，点开和对方联系`,
    sender: '拾得者',
    title: tag.title,
    page: `pages/chat/chat?claimId=${claimId}`
  }).catch((err) => `error ${err.errCode || ''} ${err.errMsg || err.message || ''}`.slice(0, 200));
  if (wechat === 'sent') return { wechat, sms: 'skipped' };

  const c = sms.config();
  if (!c.enabled || !tag.phone) return { wechat, sms: c.enabled ? 'no-phone' : 'off' };
  const sentToday = await db.collection('tagReports')
    .where({ tagId: tag._id, sms: 'sent', createdAt: _.gte(new Date(Date.now() - DAY)) }).count().then((r) => r.total);
  if (sentToday >= SMS_PER_TAG_PER_DAY) return { wechat, sms: 'limit' };
  return { wechat, sms: await sms.sendSms(c, tag.phone, c.foundTemplate, []) };
}

// ---------- 我的防丢贴 ----------

async function mine(event, openid) {
  const { data } = await db.collection('tags').where({ ownerOpenid: openid })
    .orderBy('boundAt', 'desc').limit(50)
    .field({ title: 1, category: 1, customCategory: 1, photo: 1, status: 1 }).get()
    .catch(() => ({ data: [] }));
  return { ok: true, items: data.map((t) => ({ code: t._id, title: t.title, category: displayCategory(t), photo: t.photo || '', status: t.status })) };
}

// ---------- 管理员 ----------

async function generate(event, openid) {
  if (!isAdmin(openid)) return { ok: false, message: '没有权限：云函数 tag 的环境变量 ADMIN_OPENIDS 里加上你的 openid', openid };
  const count = Number(event.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATE) return { ok: false, message: `一次生成 1～${MAX_GENERATE} 个` };
  const batch = String(event.batch || '').trim().slice(0, 20) || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  await ensureCollections();

  const codes = [];
  while (codes.length < count) {
    const code = randomCode();
    // 撞上已有的编号（概率极小）就换一个
    const ok = await db.collection('tags').add({ data: { _id: code, status: 'unbound', batch, createdAt: db.serverDate() } })
      .then(() => true).catch(() => false);
    if (ok) codes.push(code);
  }
  return { ok: true, batch, codes };
}

async function qrcode(event, openid) {
  if (!isAdmin(openid)) return { ok: false, message: '没有权限' };
  const code = normalizeCode(event.code);
  if (!code) return { ok: false, message: '编号不对' };
  const envVersion = ['develop', 'trial', 'release'].includes(event.envVersion) ? event.envVersion : 'release';
  const res = await cloud.openapi.wxacode.getUnlimited({
    scene: code,
    page: 'pages/tag/tag',
    checkPath: false,
    envVersion,
    width: 430
  });
  const { fileID } = await cloud.uploadFile({ cloudPath: `tags/qrcode/${code}-${envVersion}.png`, fileContent: res.buffer });
  return { ok: true, url: await tempUrl(fileID) };
}

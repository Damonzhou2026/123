// 防丢贴页面：扫贴纸上的二维码进来。同一个码按身份显示不同内容：
//   unbound 还没绑定 → 绑定表单
//   mine    自己的 → 管理（丢了 / 找回来了 / 编辑 / 暂停 / 解绑，以及谁捡到过）
//   others  别人的 → “我捡到了”
// 进来的方式有三种：普通链接二维码（query.q 是整个网址）、小程序码（query.scene 是编号）、页面跳转（query.code）
const { CATEGORIES, OTHER_CATEGORY, MAX_CUSTOM_CATEGORY } = require('../../utils/constants');
const { askMessageNotify } = require('../../utils/notify');
const { timeAgo } = require('../../utils/format');

const MAX_REPORT_PHOTOS = 3;
const CLAIM_STATUS = { approved: '正在联系', returned: '已拿回', cancelled: '已取消' };

// 从网址或参数里取出 8 位编号
function parseCode(query) {
  if (query.code) return String(query.code).toUpperCase();
  if (query.q) {
    const url = decodeURIComponent(query.q);
    const m = url.match(/[?&]c=([A-Za-z0-9]{8})/) || url.match(/\/t\/([A-Za-z0-9]{8})/);
    if (m) return m[1].toUpperCase();
  }
  if (query.scene) return decodeURIComponent(query.scene).toUpperCase();
  return '';
}

function emptyForm() {
  return {
    title: '', categoryIndex: 0, customCategory: '', note: '', forChild: false,
    photo: '', photoPreview: '', photoPath: '', phone: '', smsCode: '', changePhone: false
  };
}

Page({
  data: {
    loading: true,
    error: '',
    view: '',
    code: '',
    smsEnabled: false,
    tag: {},
    claims: [],
    editing: false,
    categories: CATEGORIES,
    otherCategory: OTHER_CATEGORY,
    maxCustomCategory: MAX_CUSTOM_CATEGORY,
    form: emptyForm(),
    countdown: 0,
    saving: false,
    // 拾主
    myClaimId: '',
    reportOpen: false,
    reportText: '',
    reportPhotos: [],
    maxReportPhotos: MAX_REPORT_PHOTOS,
    reportPlace: '',
    reportLat: null,
    reportLng: null,
    reporting: false
  },

  onLoad(query) {
    const code = parseCode(query || {});
    this.setData({ code });
    if (!code) {
      this.setData({ loading: false, error: '没有认出这个二维码。请确认扫的是掉了么的防丢贴。' });
      return;
    }
    this.load();
  },

  onShow() {
    // 从聊天页或匹配页回来时刷新状态
    if (this.loaded) this.load(true);
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  async load(silent) {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'tag', data: { action: 'get', code: this.data.code } });
      if (!result.ok) throw new Error(result.message);
      this.loaded = true;
      const claims = (result.claims || []).map((c) => ({ ...c, timeText: timeAgo(c.createdAt), statusText: CLAIM_STATUS[c.status] || '' }));
      this.setData({
        loading: false,
        error: '',
        view: result.view,
        smsEnabled: !!result.smsEnabled,
        tag: result.tag || {},
        claims,
        myClaimId: result.myClaimId || ''
      });
      wx.setNavigationBarTitle({ title: result.view === 'unbound' ? '绑定防丢贴' : result.view === 'mine' ? '我的防丢贴' : '掉了么防丢贴' });
    } catch (err) {
      if (!silent) this.setData({ loading: false, error: err.message || '加载失败，请稍后再试' });
    }
  },

  // ---------- 绑定 / 编辑表单 ----------

  setForm(key, value) {
    this.setData({ [`form.${key}`]: value });
  },
  onTitle(e) { this.setForm('title', e.detail.value); },
  onCustomCategory(e) { this.setForm('customCategory', e.detail.value); },
  onNote(e) { this.setForm('note', e.detail.value); },
  onPhone(e) { this.setForm('phone', e.detail.value); },
  onSmsCode(e) { this.setForm('smsCode', e.detail.value); },
  onCategory(e) { this.setForm('categoryIndex', Number(e.detail.value)); },
  onForChild(e) { this.setForm('forChild', e.detail.value); },
  onChangePhone() { this.setForm('changePhone', true); },

  async choosePhoto() {
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'] });
      const path = res.tempFiles[0].tempFilePath;
      this.setData({ 'form.photoPath': path, 'form.photoPreview': path });
    } catch (err) {
      // 取消选择
    }
  },

  removePhoto() {
    this.setData({ 'form.photoPath': '', 'form.photoPreview': '', 'form.photo': '' });
  },

  async sendCode() {
    if (this.data.countdown > 0) return;
    const phone = this.data.form.phone.trim();
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
      return;
    }
    try {
      const { result } = await wx.cloud.callFunction({ name: 'tag', data: { action: 'sendCode', phone } });
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '验证码已发送', icon: 'none' });
      this.setData({ countdown: 60 });
      this.timer = setInterval(() => {
        const countdown = this.data.countdown - 1;
        this.setData({ countdown });
        if (countdown <= 0) clearInterval(this.timer);
      }, 1000);
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  startEdit() {
    const t = this.data.tag;
    this.setData({
      editing: true,
      form: {
        ...emptyForm(),
        title: t.title,
        categoryIndex: Math.max(0, CATEGORIES.indexOf(t.category)),
        customCategory: t.customCategory,
        note: t.note,
        forChild: t.forChild,
        photo: t.photo,
        photoPreview: t.photoUrl
      }
    });
  },

  cancelEdit() {
    this.setData({ editing: false, form: emptyForm() });
  },

  validateForm() {
    const f = this.data.form;
    if (!f.title.trim()) return '请填写物品名称';
    if (CATEGORIES[f.categoryIndex] === OTHER_CATEGORY && !f.customCategory.trim()) return '请填写具体是什么东西';
    const phone = f.phone.trim();
    if (phone && !/^1\d{10}$/.test(phone)) return '请填写 11 位手机号';
    if (phone && !f.smsCode.trim()) return '请填写短信验证码';
    return '';
  },

  async saveForm() {
    if (this.data.saving) return;
    const error = this.validateForm();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }
    const binding = this.data.view === 'unbound';
    // 绑定时顺便开微信提醒：这是有人捡到时最先用到的提醒方式。必须在点击后第一个 await 之前调用
    if (binding) await askMessageNotify();
    this.setData({ saving: true });
    try {
      const f = this.data.form;
      let photo = f.photo;
      if (f.photoPath) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `tags/${this.data.code}-${Date.now()}.${f.photoPath.split('.').pop()}`,
          filePath: f.photoPath
        });
        photo = up.fileID;
      }
      const phone = f.phone.trim();
      const { result } = await wx.cloud.callFunction({
        name: 'tag',
        data: {
          action: binding ? 'bind' : 'update',
          code: this.data.code,
          title: f.title.trim(),
          category: CATEGORIES[f.categoryIndex],
          customCategory: CATEGORIES[f.categoryIndex] === OTHER_CATEGORY ? f.customCategory.trim() : '',
          note: f.note.trim(),
          forChild: f.forChild,
          photo,
          phone: phone || undefined,
          smsCode: phone ? f.smsCode.trim() : undefined
        }
      });
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: binding ? '绑定好了' : '已保存', icon: 'success' });
      this.setData({ editing: false, form: emptyForm() });
      await this.load(true);
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ---------- 主人 ----------

  async run(data, successText) {
    if (this.busy) return null;
    this.busy = true;
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'tag', data: { code: this.data.code, ...data } });
      if (!result.ok) throw new Error(result.message);
      wx.hideLoading();
      if (successText) wx.showToast({ title: successText, icon: 'success' });
      await this.load(true);
      return result;
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      return null;
    } finally {
      this.busy = false;
    }
  },

  // 丢了：用绑定时的名称、类别、照片发一条失物，进匹配库；同时打开微信提醒
  async markLost() {
    const t = this.data.tag;
    await askMessageNotify();
    if (!t.photo) {
      wx.showModal({ title: '先加一张照片', content: 'AI 要靠照片帮你匹配。点“编辑”给这件东西加一张照片，再来点“丢了”。', showCancel: false });
      return;
    }
    let loc;
    try {
      wx.showToast({ title: '选一下大概在哪丢的', icon: 'none' });
      loc = await wx.chooseLocation();
    } catch (err) {
      return;
    }
    wx.showLoading({ title: '发布中', mask: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'createPost',
        data: {
          type: 'lost',
          title: t.title,
          category: t.category,
          customCategory: t.customCategory,
          photos: [t.photo],
          placeName: loc.name || loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
          reward: 0,
          verifyQuestion: '',
          handover: null,
          forLostPostId: ''
        }
      });
      if (!result.ok) throw new Error(result.message);
      wx.hideLoading();
      await this.run({ action: 'markLost', lostPostId: result.id });
      wx.navigateTo({ url: `/pages/matches/matches?id=${result.id}` });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '发布失败', icon: 'none' });
    }
  },

  openLostPost() {
    wx.navigateTo({ url: `/pages/matches/matches?id=${this.data.tag.lostPostId}` });
  },

  async recovered() {
    const { confirm } = await wx.showModal({ title: '找回来了？', content: '那条失物会撤下，防丢贴回到使用中。' });
    if (confirm) await this.run({ action: 'recovered' }, '太好了');
  },

  async togglePause() {
    const paused = this.data.tag.status !== 'paused';
    if (paused) {
      const { confirm } = await wx.showModal({ title: '暂停提醒？', content: '暂停后别人扫码不能联系你，适合东西暂时不用、放在家里的时候。随时可以恢复。' });
      if (!confirm) return;
    }
    await this.run({ action: 'pause', paused }, paused ? '已暂停' : '已恢复');
  },

  async unbind() {
    const { confirm } = await wx.showModal({
      title: '解绑这张防丢贴？',
      content: '名称、照片和手机号都会删掉，贴纸可以重新绑定到别的东西上。',
      confirmText: '解绑',
      confirmColor: '#D93025'
    });
    if (confirm) await this.run({ action: 'unbind' }, '已解绑');
  },

  async removePhone() {
    const { confirm } = await wx.showModal({ title: '删除手机号？', content: '删除后有人捡到时只能通过微信提醒你。' });
    if (!confirm) return;
    const t = this.data.tag;
    await this.run({
      action: 'update', removePhone: true, title: t.title, category: t.category, customCategory: t.customCategory,
      note: t.note, forChild: t.forChild, photo: t.photo
    }, '已删除');
  },

  async enableNotify() {
    const ok = await askMessageNotify();
    wx.showToast({ title: ok ? '有人捡到时微信会提醒你' : '没有开启', icon: 'none' });
  },

  openClaim(e) {
    wx.navigateTo({ url: `/pages/chat/chat?claimId=${e.currentTarget.dataset.id}` });
  },

  // ---------- 拾主 ----------

  openReport() {
    this.setData({ reportOpen: true });
  },
  onReportText(e) { this.setData({ reportText: e.detail.value }); },

  async chooseReportPhotos() {
    const left = MAX_REPORT_PHOTOS - this.data.reportPhotos.length;
    if (left <= 0) return;
    try {
      const res = await wx.chooseMedia({ count: left, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'] });
      this.setData({ reportPhotos: this.data.reportPhotos.concat(res.tempFiles.map((f) => f.tempFilePath)).slice(0, MAX_REPORT_PHOTOS) });
    } catch (err) {
      // 取消选择
    }
  },

  removeReportPhoto(e) {
    const reportPhotos = this.data.reportPhotos.slice();
    reportPhotos.splice(e.currentTarget.dataset.index, 1);
    this.setData({ reportPhotos });
  },

  async chooseReportPlace() {
    try {
      const loc = await wx.chooseLocation();
      this.setData({ reportPlace: loc.name || loc.address, reportLat: loc.latitude, reportLng: loc.longitude });
    } catch (err) {
      // 取消选择
    }
  },

  async submitReport() {
    if (this.data.reporting) return;
    const d = this.data;
    if (!d.reportText.trim() && d.reportPhotos.length === 0) {
      wx.showToast({ title: '留一句话或拍张照片', icon: 'none' });
      return;
    }
    // 主人回复时提醒拾主
    await askMessageNotify();
    this.setData({ reporting: true });
    try {
      const uploads = await Promise.all(d.reportPhotos.map((path) => wx.cloud.uploadFile({
        cloudPath: `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${path.split('.').pop()}`,
        filePath: path
      })));
      const { result } = await wx.cloud.callFunction({
        name: 'tag',
        data: {
          action: 'report',
          code: d.code,
          text: d.reportText.trim(),
          photos: uploads.map((u) => u.fileID),
          placeName: d.reportPlace,
          latitude: d.reportLat == null ? undefined : d.reportLat,
          longitude: d.reportLng == null ? undefined : d.reportLng
        }
      });
      if (!result.ok) throw new Error(result.message);
      if (!result.existing) wx.showToast({ title: '已经通知主人了', icon: 'success' });
      this.setData({ reportOpen: false, myClaimId: result.claimId });
      wx.navigateTo({ url: `/pages/chat/chat?claimId=${result.claimId}` });
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' });
    } finally {
      this.setData({ reporting: false });
    }
  },

  openMyClaim() {
    wx.navigateTo({ url: `/pages/chat/chat?claimId=${this.data.myClaimId}` });
  },

  postOther() {
    wx.navigateTo({ url: '/pages/post/post?type=found' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});

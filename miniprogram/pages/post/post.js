const { PRIVATE_PHOTO_CATEGORIES, CATEGORIES, OTHER_CATEGORY, MAX_CUSTOM_CATEGORY, NO_REWARD_CATEGORIES, MAX_REWARD, MAX_PHOTOS } = require('../../utils/constants');
const { askMessageNotify } = require('../../utils/notify');

// 拾得者把东西放在哪。选“其他”要自己填地点，前三个可以补充一句（比如几号楼）
const SELF_SPOT = '在我这里';
const OTHER_SPOT = '其他';
const SPOTS = [SELF_SPOT, '服务台', '宿管', '保安室', OTHER_SPOT];

Page({
  data: {
    isLost: true,
    categories: CATEGORIES,
    otherCategory: OTHER_CATEGORY,
    maxCustomCategory: MAX_CUSTOM_CATEGORY,
    categoryIndex: 0,
    // 证件、钱包、手机：照片不在首页公开
    privatePhoto: PRIVATE_PHOTO_CATEGORIES.includes(CATEGORIES[0]),
    customCategory: '',
    photoPaths: [],
    maxPhotos: MAX_PHOTOS,
    title: '',
    placeName: '',
    latitude: null,
    longitude: null,
    rewardOptions: [0, 20, 50, 100],
    reward: 0,
    customReward: false,
    customRewardText: '',
    maxReward: MAX_REWARD,
    rewardAllowed: true,
    verifyQuestion: '',
    // 拾得者：东西在自己手上，还是已经交到服务台、宿管、保安室或其他地方
    spots: SPOTS,
    spot: SPOTS[0],
    depositPlace: '',
    submitting: false
  },

  onLoad(query) {
    const isLost = query.type !== 'found';
    this.setData({ isLost });
    wx.setNavigationBarTitle({ title: isLost ? '发布：我丢了' : '发布：我捡到' });
    // 从物品详情页过来：claimFor 是要认领的拾物，forLost 是捡到的人说“我捡到了”的那条失物
    this.claimFor = query.claimFor || '';
    this.forLost = query.forLost || '';
    this.prefill(query);
  },

  // 带过来的类别和地点先填上，用户可以改
  prefill(query) {
    const data = {};
    const index = CATEGORIES.indexOf(decodeURIComponent(query.category || ''));
    if (index >= 0) {
      data.categoryIndex = index;
      data.privatePhoto = PRIVATE_PHOTO_CATEGORIES.includes(CATEGORIES[index]);
      data.rewardAllowed = !NO_REWARD_CATEGORIES.includes(CATEGORIES[index]);
      if (CATEGORIES[index] === OTHER_CATEGORY) data.customCategory = decodeURIComponent(query.customCategory || '');
    }
    const latitude = Number(query.latitude);
    const longitude = Number(query.longitude);
    if (query.latitude && query.longitude && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      Object.assign(data, { latitude, longitude, placeName: decodeURIComponent(query.placeName || '') });
    }
    if (Object.keys(data).length) this.setData(data);
  },

  async choosePhoto() {
    const left = MAX_PHOTOS - this.data.photoPaths.length;
    if (left <= 0) return;
    try {
      const res = await wx.chooseMedia({
        count: left,
        mediaType: ['image'],
        sourceType: this.data.isLost ? ['album', 'camera'] : ['camera', 'album'],
        sizeType: ['compressed']
      });
      const added = res.tempFiles.map((f) => f.tempFilePath);
      this.setData({ photoPaths: this.data.photoPaths.concat(added).slice(0, MAX_PHOTOS) });
    } catch (err) {
      // 用户取消选择，不处理
    }
  },

  removePhoto(e) {
    const photoPaths = this.data.photoPaths.slice();
    photoPaths.splice(e.currentTarget.dataset.index, 1);
    this.setData({ photoPaths });
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onVerify(e) { this.setData({ verifyQuestion: e.detail.value }); },
  onSpot(e) { this.setData({ spot: e.currentTarget.dataset.value }); },
  onDepositPlace(e) { this.setData({ depositPlace: e.detail.value }); },
  onCustomCategory(e) { this.setData({ customCategory: e.detail.value }); },

  onCategory(e) {
    const categoryIndex = Number(e.detail.value);
    const rewardAllowed = !NO_REWARD_CATEGORIES.includes(CATEGORIES[categoryIndex]);
    this.setData({ privatePhoto: PRIVATE_PHOTO_CATEGORIES.includes(CATEGORIES[categoryIndex]) });
    if (rewardAllowed) this.setData({ categoryIndex, rewardAllowed });
    else this.setData({ categoryIndex, rewardAllowed, reward: 0, customReward: false, customRewardText: '' });
  },

  onReward(e) { this.setData({ reward: e.currentTarget.dataset.value, customReward: false }); },
  onCustomReward() { this.setData({ customReward: true }); },
  onCustomRewardText(e) { this.setData({ customRewardText: e.detail.value }); },

  // 最终提交的感谢金（元，整数）。自定义金额填错时返回 null
  rewardAmount() {
    const d = this.data;
    if (!d.isLost || !d.rewardAllowed) return 0;
    if (!d.customReward) return d.reward;
    const text = d.customRewardText.trim();
    if (!/^\d+$/.test(text)) return null;
    const amount = Number(text);
    return amount >= 1 && amount <= MAX_REWARD ? amount : null;
  },

  // 交到哪了：给失主看的一句话，比如“宿管（3 号楼）”
  handover() {
    const { spot } = this.data;
    const detail = this.data.depositPlace.trim();
    if (spot === SELF_SPOT) return { type: 'self', place: '' };
    if (spot === OTHER_SPOT) return { type: 'deposited', place: detail };
    return { type: 'deposited', place: detail ? `${spot}（${detail}）` : spot };
  },

  isOtherCategory() {
    return CATEGORIES[this.data.categoryIndex] === OTHER_CATEGORY;
  },

  async chooseLocation() {
    try {
      const loc = await wx.chooseLocation();
      this.setData({ placeName: loc.name || loc.address, latitude: loc.latitude, longitude: loc.longitude });
    } catch (err) {
      // 用户取消选择，不处理
    }
  },

  validate() {
    const d = this.data;
    if (d.photoPaths.length === 0) return '请先上传照片';
    if (!d.title.trim()) return '请填写物品名称';
    if (this.isOtherCategory() && !d.customCategory.trim()) return '请填写具体是什么东西';
    if (d.latitude == null) return '请选择位置';
    if (!d.isLost && !d.verifyQuestion.trim()) return '请设置一个核验问题，防止被冒领';
    if (!d.isLost && d.spot === OTHER_SPOT && !d.depositPlace.trim()) return '请填写交到了哪里';
    if (this.rewardAmount() === null) return `感谢金请填 1～${MAX_REWARD} 的整数`;
    return '';
  },

  async submit() {
    if (this.data.submitting) return;
    const error = this.validate();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }
    const d = this.data;
    // 先问要不要收提醒：拾得者是有人来认领时提醒；失主是有人捡到像他的东西时提醒
    await askMessageNotify();
    this.setData({ submitting: true });
    try {
      const uploads = await Promise.all(d.photoPaths.map((path) => wx.cloud.uploadFile({
        cloudPath: `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${path.split('.').pop()}`,
        filePath: path
      })));
      const { result } = await wx.cloud.callFunction({
        name: 'createPost',
        data: {
          type: d.isLost ? 'lost' : 'found',
          title: d.title.trim(),
          category: d.categories[d.categoryIndex],
          customCategory: this.isOtherCategory() ? d.customCategory.trim() : '',
          photos: uploads.map((u) => u.fileID),
          placeName: d.placeName,
          latitude: d.latitude,
          longitude: d.longitude,
          reward: this.rewardAmount(),
          verifyQuestion: d.isLost ? '' : d.verifyQuestion.trim(),
          handover: d.isLost ? null : this.handover(),
          forLostPostId: this.forLost
        }
      });
      if (!result.ok) throw new Error(result.message);
      // 为了认领才登记的失物：回到那件拾物的详情页，直接回答问题
      wx.redirectTo({
        url: this.claimFor
          ? `/pages/item/item?id=${this.claimFor}&lostId=${result.id}`
          : `/pages/matches/matches?id=${result.id}`
      });
    } catch (err) {
      wx.showToast({ title: err.message || '发布失败，请重试', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});

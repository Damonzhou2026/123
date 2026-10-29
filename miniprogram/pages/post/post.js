const { PRIVATE_PHOTO_CATEGORIES, CATEGORIES, OTHER_CATEGORY, MAX_CUSTOM_CATEGORY, NO_REWARD_CATEGORIES, MAX_REWARD, MAX_PHOTOS } = require('../../utils/constants');
const { askMessageNotify } = require('../../utils/notify');

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
    submitting: false
  },

  onLoad(query) {
    const isLost = query.type !== 'found';
    this.setData({ isLost });
    wx.setNavigationBarTitle({ title: isLost ? '发布：我丢了' : '发布：我捡到' });
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
          verifyQuestion: d.isLost ? '' : d.verifyQuestion.trim()
        }
      });
      if (!result.ok) throw new Error(result.message);
      wx.redirectTo({ url: `/pages/matches/matches?id=${result.id}` });
    } catch (err) {
      wx.showToast({ title: err.message || '发布失败，请重试', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});

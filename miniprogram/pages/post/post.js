const { CATEGORIES, OTHER_CATEGORY, MAX_CUSTOM_CATEGORY, NO_REWARD_CATEGORIES, MAX_REWARD } = require('../../utils/constants');
const { askMessageNotify } = require('../../utils/notify');

Page({
  data: {
    isLost: true,
    categories: CATEGORIES,
    otherCategory: OTHER_CATEGORY,
    maxCustomCategory: MAX_CUSTOM_CATEGORY,
    categoryIndex: 0,
    customCategory: '',
    photoPath: '',
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
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: this.data.isLost ? ['album', 'camera'] : ['camera', 'album'],
        sizeType: ['compressed']
      });
      this.setData({ photoPath: res.tempFiles[0].tempFilePath });
    } catch (err) {
      // 用户取消选择，不处理
    }
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onVerify(e) { this.setData({ verifyQuestion: e.detail.value }); },
  onCustomCategory(e) { this.setData({ customCategory: e.detail.value }); },

  onCategory(e) {
    const categoryIndex = Number(e.detail.value);
    const rewardAllowed = !NO_REWARD_CATEGORIES.includes(CATEGORIES[categoryIndex]);
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
    if (!d.photoPath) return '请先上传照片';
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
    // 捡到东西的人：有人来认领时要提醒他，先问要不要收提醒
    if (!d.isLost) await askMessageNotify();
    this.setData({ submitting: true });
    try {
      const ext = d.photoPath.split('.').pop();
      const upload = await wx.cloud.uploadFile({
        cloudPath: `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath: d.photoPath
      });
      const { result } = await wx.cloud.callFunction({
        name: 'createPost',
        data: {
          type: d.isLost ? 'lost' : 'found',
          title: d.title.trim(),
          category: d.categories[d.categoryIndex],
          customCategory: this.isOtherCategory() ? d.customCategory.trim() : '',
          photos: [upload.fileID],
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

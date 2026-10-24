const { timeAgo } = require('../../utils/format');

Page({
  data: {
    items: [],
    loading: true,
    locationDenied: false,
    privacyDenied: false
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      const { latitude, longitude } = await wx.getLocation({ type: 'gcj02' });
      const { result } = await wx.cloud.callFunction({
        name: 'listNearby',
        data: { latitude, longitude, type: 'found' }
      });
      const items = (result.items || []).map((it) => ({ ...it, timeText: timeAgo(it.createdAt) }));
      this.setData({ items, loading: false, locationDenied: false, privacyDenied: false });
    } catch (err) {
      const msg = err.errMsg || '';
      // 没同意隐私保护指引时，微信报 "privacy permission is not authorized"
      const privacyDenied = /privacy/.test(msg);
      const denied = !privacyDenied && /auth deny|authorize/.test(msg);
      this.setData({ loading: false, locationDenied: denied, privacyDenied });
      if (!denied && !privacyDenied) wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
    }
  },

  goPost(e) {
    wx.navigateTo({ url: `/pages/post/post?type=${e.currentTarget.dataset.type}` });
  },

  openPrivacy() {
    this.selectComponent('#privacy').open();
  },

  onPrivacyAgree() {
    if (this.data.privacyDenied) this.load();
  },

  openSetting() {
    wx.openSetting({ success: () => this.load() });
  }
});

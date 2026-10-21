const { timeAgo } = require('../../utils/format');

Page({
  data: {
    items: [],
    loading: true,
    locationDenied: false
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
      this.setData({ items, loading: false, locationDenied: false });
    } catch (err) {
      const denied = /auth deny|authorize/.test(err.errMsg || '');
      this.setData({ loading: false, locationDenied: denied });
      if (!denied) wx.showToast({ title: '加载失败，下拉重试', icon: 'none' });
    }
  },

  goPost(e) {
    wx.navigateTo({ url: `/pages/post/post?type=${e.currentTarget.dataset.type}` });
  },

  openSetting() {
    wx.openSetting({ success: () => this.load() });
  }
});

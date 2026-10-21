const { timeAgo } = require('../../utils/format');

const STATUS_TEXT = {
  open: '正在匹配',
  matched: '已配对，点开聊天'
};

Page({
  data: {
    loading: true,
    items: []
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'listMyPosts' });
      if (!result.ok) throw new Error(result.message);
      const items = result.items.map((it) => ({
        ...it,
        timeText: timeAgo(it.createdAt),
        statusText: STATUS_TEXT[it.status] || ''
      }));
      this.setData({ loading: false, items });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败，下拉重试', icon: 'none' });
    }
  },

  open(e) {
    const item = this.data.items[e.currentTarget.dataset.index];
    const url = item.status === 'matched' && item.matchedClaimId
      ? `/pages/chat/chat?claimId=${item.matchedClaimId}`
      : `/pages/matches/matches?id=${item._id}`;
    wx.navigateTo({ url });
  }
});

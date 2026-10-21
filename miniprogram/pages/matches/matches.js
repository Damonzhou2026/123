const { timeAgo, distanceText } = require('../../utils/format');

Page({
  data: {
    loading: true,
    isLost: true,
    myPhoto: '',
    matches: []
  },

  onLoad(query) {
    this.postId = query.id;
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'findMatches',
        data: { postId: this.postId }
      });
      if (!result.ok) throw new Error(result.message);
      const matches = result.matches.map((m) => ({
        ...m,
        scoreText: `${Math.round(m.score * 100)}%`,
        distanceText: distanceText(m.distance),
        timeText: timeAgo(m.createdAt)
      }));
      this.setData({
        loading: false,
        isLost: result.post.type === 'lost',
        myPhoto: result.post.photos[0],
        matches
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败，下拉重试', icon: 'none' });
    }
  }
});

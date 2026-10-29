// 运营数据：只有云函数 stats 的环境变量 ADMIN_OPENIDS 里的人能看。
// 入口：“我的发布”页面底部，长按“其他问题请发邮件”那行字。
Page({
  data: {
    loading: true,
    admin: false,
    openid: '',
    rows: [],
    pendingReports: 0,
    blocked: 0,
    users: 0,
    truncated: false
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'stats' });
      if (!result.admin) {
        this.setData({ loading: false, admin: false, openid: result.openid || '' });
        return;
      }
      const rows = result.rows.map((r) => ({ ...r, rateText: r.rate7d == null ? '—' : `${r.rate7d}%` }));
      this.setData({ loading: false, admin: true, ...result, rows });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  copyOpenid() {
    wx.setClipboardData({ data: this.data.openid });
  }
});

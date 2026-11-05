const { TAG_LINK_PREFIX } = require('../../utils/constants');

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
    truncated: false,
    // 防丢贴编号
    tagCount: '20',
    tagBatch: '',
    tagCodes: [],
    tagLinks: '',
    tagLinkPrefix: TAG_LINK_PREFIX,
    qrUrl: '',
    qrCode: ''
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
  },

  onTagCount(e) { this.setData({ tagCount: e.detail.value }); },
  onTagBatch(e) { this.setData({ tagBatch: e.detail.value }); },

  // 批量生成防丢贴编号，结果按行复制给印刷厂（每行一个二维码内容）
  async generateTags() {
    if (this.busy) return;
    this.busy = true;
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'tag',
        data: { action: 'generate', count: Number(this.data.tagCount), batch: this.data.tagBatch.trim() }
      });
      if (!result.ok) throw new Error(result.openid ? `${result.message}：${result.openid}` : result.message);
      const lines = result.codes.map((c) => `${TAG_LINK_PREFIX}${c}`);
      this.setData({ tagCodes: result.codes, tagLinks: lines.join('\n'), tagBatch: result.batch, qrUrl: '', qrCode: '' });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({ title: '生成失败', content: err.message || '请重试', showCancel: false });
    } finally {
      this.busy = false;
    }
  },

  copyTagLinks() {
    wx.setClipboardData({ data: this.data.tagLinks });
  },

  // 生成一个小程序码，用微信扫它测试防丢贴页（开发版 / 体验版 / 正式版跟着当前运行的版本走）
  async makeQrcode(e) {
    const code = e.currentTarget.dataset.code;
    const { envVersion } = wx.getAccountInfoSync().miniProgram;
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'tag', data: { action: 'qrcode', code, envVersion } });
      if (!result.ok) throw new Error(result.message);
      this.setData({ qrUrl: result.url, qrCode: code });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({ title: '生成失败', content: err.message || err.errMsg || '请重试', showCancel: false });
    }
  },

  previewQrcode() {
    wx.previewImage({ urls: [this.data.qrUrl] });
  }
});

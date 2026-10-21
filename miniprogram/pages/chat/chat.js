// 云数据库集合只允许云函数访问，所以聊天页定时拉取新消息
const POLL_MS = 3000;

Page({
  data: {
    loading: true,
    role: 'owner',
    item: {},
    messages: [],
    draft: '',
    scrollTo: '',
    sending: false,
    quickReplies: ['我现在过去', '我到了，你在哪？', '可以改到服务台交接吗？']
  },

  onLoad(query) {
    this.claimId = query.claimId;
    this.load();
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => this.load(true), POLL_MS);
  },

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  async load(silent) {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'listMessages',
        data: { claimId: this.claimId }
      });
      if (!result.ok) throw new Error(result.message);
      const changed = result.messages.length !== this.data.messages.length;
      this.setData({
        loading: false,
        role: result.role,
        item: result.item,
        messages: result.messages,
        scrollTo: changed && result.messages.length ? `m-${result.messages.length - 1}` : this.data.scrollTo
      });
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value });
  },

  useQuick(e) {
    this.setData({ draft: e.currentTarget.dataset.text });
  },

  async send() {
    const text = this.data.draft.trim();
    if (!text || this.data.sending) return;
    this.setData({ sending: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'sendMessage',
        data: { claimId: this.claimId, text }
      });
      if (!result.ok) throw new Error(result.message);
      this.setData({ draft: '' });
      await this.load(true);
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  }
});

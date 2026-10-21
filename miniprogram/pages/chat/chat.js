// 云数据库集合只允许云函数访问，所以聊天页定时拉取新消息
const POLL_MS = 3000;
const TAGS = ['守时', '热心', '沟通顺畅', '物品完好', '有礼貌'];

Page({
  data: {
    loading: true,
    role: 'owner',
    status: '',
    rated: false,
    counterpart: { rating: null, count: 0 },
    stars: 5,
    tagOptions: TAGS.map((name) => ({ name, on: false })),
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
        status: result.status,
        rated: result.rated,
        counterpart: result.counterpart,
        item: result.item,
        messages: result.messages,
        scrollTo: changed && result.messages.length ? `m-${result.messages.length - 1}` : this.data.scrollTo
      });
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  async confirmReturn() {
    const { confirm } = await wx.showModal({
      title: '确认已经拿回物品？',
      content: '确认后这次归还就完成了，双方可以互相评价。'
    });
    if (!confirm) return;
    await this.call('confirmReturn', { claimId: this.claimId }, '已确认');
  },

  pickStar(e) {
    this.setData({ stars: e.currentTarget.dataset.value });
  },

  toggleTag(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ [`tagOptions[${i}].on`]: !this.data.tagOptions[i].on });
  },

  async submitRating() {
    const tags = this.data.tagOptions.filter((t) => t.on).map((t) => t.name);
    await this.call('rateUser', { claimId: this.claimId, stars: this.data.stars, tags }, '谢谢你的评价');
  },

  async call(name, data, successText) {
    if (this.busy) return;
    this.busy = true;
    try {
      const { result } = await wx.cloud.callFunction({ name, data });
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: successText, icon: 'success' });
      await this.load(true);
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.busy = false;
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

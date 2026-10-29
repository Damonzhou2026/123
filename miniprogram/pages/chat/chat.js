// 云数据库集合只允许云函数访问，所以聊天页定时拉取新消息
const { ESCROW_ENABLED } = require('../../utils/constants');
const { askMessageNotify, MESSAGE_TEMPLATE_ID } = require('../../utils/notify');
const { report } = require('../../utils/report');

const POLL_MS = 3000;
const TAGS = ['守时', '热心', '沟通顺畅', '物品完好', '有礼貌'];

// 感谢金状态的说明文字，按“我是谁”区分
function rewardText(role, claimStatus, rewardStatus) {
  if (!ESCROW_ENABLED) {
    if (claimStatus === 'returned') return role === 'owner' ? '如果还没给，记得把感谢金给对方。' : '感谢金由失主直接给你。';
    return role === 'owner' ? '交接时当面给，或用微信直接转给对方。平台不经手这笔钱。' : '失主表示愿意给这笔感谢金，交接时由失主直接给你。';
  }
  if (rewardStatus === 'settled') return role === 'owner' ? '已经分给对方，谢谢你。' : '已到账，请在微信零钱里查看。';
  if (rewardStatus === 'paid' || rewardStatus === 'settling') {
    if (claimStatus === 'returned') return '正在分给拾得者，一般几分钟内到账。';
    return role === 'owner' ? '已托管在微信支付，你确认拿回物品后才会给到对方。' : '失主已托管，确认拿回后到你的微信零钱（扣除平台服务费）。';
  }
  if (claimStatus === 'returned') return role === 'owner' ? '这次没有托管感谢金。' : '失主没有托管感谢金。';
  return role === 'owner' ? '先付款托管，钱由微信支付冻结，确认拿回物品后才给对方。' : '失主设置了感谢金，还没有托管。';
}

Page({
  data: {
    loading: true,
    role: 'owner',
    status: '',
    rated: false,
    counterpart: { rating: null, count: 0 },
    reward: { amount: 0, status: 'none' },
    rewardText: '',
    escrow: ESCROW_ENABLED,
    stars: 5,
    tagOptions: TAGS.map((name) => ({ name, on: false })),
    item: {},
    handover: { type: 'self', place: '' },
    messages: [],
    draft: '',
    scrollTo: '',
    sending: false,
    // 新消息提醒：是否可用，还剩几次
    notifyEnabled: !!MESSAGE_TEMPLATE_ID,
    notifyCredits: 0,
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
    this.markLeft();
  },

  onUnload() {
    this.stopPolling();
    this.markLeft();
  },

  // 告诉云端我离开聊天页了，对方再发消息就推送给我
  markLeft() {
    if (!this.claimId) return;
    wx.cloud.callFunction({ name: 'listMessages', data: { claimId: this.claimId, leaving: true } }).catch(() => {});
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
        reward: result.reward,
        rewardText: rewardText(result.role, result.status, result.reward.status),
        item: result.item,
        handover: result.handover || { type: 'self', place: '' },
        notifyCredits: result.notify && result.notify.tmplId === MESSAGE_TEMPLATE_ID ? result.notify.credits : 0,
        messages: result.messages,
        scrollTo: changed && result.messages.length ? `m-${result.messages.length - 1}` : this.data.scrollTo
      });
      this.retrySettle(result);
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  // 补救：订单状态没同步的先同步；确认拿回时分账失败的，打开聊天页时补一次
  retrySettle(result) {
    if (!ESCROW_ENABLED) return;
    // 付过款但没来得及记下来（比如付款后小程序被关掉），先同步一次订单状态
    if (!this.syncTried && result.reward.status === 'created') {
      this.syncTried = true;
      wx.cloud.callFunction({ name: 'reward', data: { action: 'sync', claimId: this.claimId } })
        .then((r) => { if (r.result && r.result.status === 'paid') this.load(true); })
        .catch(() => {});
    }
    const pending = result.reward.status === 'paid' || result.reward.status === 'settling';
    if (this.settleTried || result.status !== 'returned' || !pending) return;
    this.settleTried = true;
    wx.cloud.callFunction({ name: 'reward', data: { action: 'settle', claimId: this.claimId } })
      .then(() => this.load(true))
      .catch(() => {});
  },

  async payReward() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { result } = await wx.cloud.callFunction({ name: 'reward', data: { action: 'create', claimId: this.claimId } });
      if (!result.ok) throw new Error(result.message);
      await wx.requestPayment(result.params);
      await wx.cloud.callFunction({ name: 'reward', data: { action: 'sync', claimId: this.claimId } });
      wx.showToast({ title: '已托管', icon: 'success' });
    } catch (err) {
      // 用户取消支付不提示
      if (!/cancel/.test(err.errMsg || '')) wx.showToast({ title: err.message || '支付失败', icon: 'none' });
    } finally {
      this.busy = false;
      await this.load(true);
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

  report() {
    report('claim', this.claimId);
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value });
  },

  useQuick(e) {
    this.setData({ draft: e.currentTarget.dataset.text });
  },

  // 点“开启提醒”
  async enableNotify() {
    const ok = await askMessageNotify();
    if (ok) {
      wx.showToast({ title: '对方回复时会提醒你', icon: 'none' });
      await this.load(true);
    }
  },

  async send(e) {
    const text = this.data.draft.trim();
    if (!text || this.data.sending) return;
    // 每允许一次只能收一条提醒，次数快用完时顺便再问一次；这次进聊天页拒绝过就不再问。
    // 键盘上的“发送”不算点击，微信不让弹框，所以只在点按钮时问
    if (e && e.type === 'tap' && this.data.notifyEnabled && this.data.notifyCredits < 2 && !this.notifyDeclined) {
      const accepted = await askMessageNotify();
      if (accepted) this.setData({ notifyCredits: this.data.notifyCredits + 1 });
      else this.notifyDeclined = true;
    }
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

// 云数据库集合只允许云函数访问，所以聊天页定时拉取新消息。
// 刚有新消息时 3 秒拉一次，一直没动静就慢慢放到 15 秒；每 5 次里有 1 次拉全量（评分、感谢金状态等）
const { ESCROW_ENABLED } = require('../../utils/constants');
const { askMessageNotify, MESSAGE_TEMPLATE_ID } = require('../../utils/notify');
const { report } = require('../../utils/report');
const { markRisky } = require('../../utils/safety');

const POLL_MIN_MS = 3000;
const POLL_MAX_MS = 15000;
const FULL_EVERY = 5;
const TAGS = ['守时', '热心', '沟通顺畅', '物品完好', '有礼貌'];
// 和 cloudfunctions/reviewClaim 保持一致
const CANCEL_REASONS = ['认错了，不是对方的东西', '对方一直不回复', '对方没来交接', '其他'];

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
    handedOver: false,
    cancel: null,
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
    this.pollMs = POLL_MIN_MS;
    this.polls = 0;
    this.polling = true;
    this.schedulePoll();
  },

  stopPolling() {
    this.polling = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  },

  schedulePoll() {
    if (!this.polling) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), this.pollMs);
  },

  // 有新消息（或者自己刚发了）就回到 3 秒一次，否则每次放慢一点
  async poll() {
    this.polls += 1;
    const changed = this.polls % FULL_EVERY === 0 ? await this.load(true) : await this.loadNew();
    this.pollMs = changed ? POLL_MIN_MS : Math.min(Math.round(this.pollMs * 1.5), POLL_MAX_MS);
    this.schedulePoll();
  },

  // 只拉最后一条之后的新消息和认领状态。返回有没有变化
  async loadNew() {
    const last = this.data.messages[this.data.messages.length - 1];
    if (!last) return this.load(true);
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'listMessages',
        data: { claimId: this.claimId, since: last.createdAt }
      });
      if (!result.ok) return false;
      // 状态变了（对方确认、取消、点了已交还）就拉一次全量，把按钮和评分区都刷新
      if (result.status !== this.data.status || !!result.handedOver !== this.data.handedOver) return this.load(true);
      const known = new Set(this.data.messages.map((m) => m._id));
      const fresh = markRisky(result.messages.filter((m) => !known.has(m._id)));
      if (!fresh.length) return false;
      const messages = this.data.messages.concat(fresh);
      this.setData({ messages, scrollTo: `m-${messages.length - 1}` });
      return true;
    } catch (err) {
      return false;
    }
  },

  async load(silent) {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'listMessages',
        data: { claimId: this.claimId }
      });
      if (!result.ok) throw new Error(result.message);
      const before = this.data.messages;
      const changed = result.messages.length !== before.length
        || (result.messages.length > 0 && result.messages[result.messages.length - 1]._id !== (before[before.length - 1] || {})._id)
        || result.status !== this.data.status;
      this.setData({
        loading: false,
        role: result.role,
        status: result.status,
        handedOver: !!result.handedOver,
        cancel: result.cancel || null,
        rated: result.rated,
        counterpart: result.counterpart,
        reward: result.reward,
        rewardText: rewardText(result.role, result.status, result.reward.status),
        item: result.item,
        handover: result.handover || { type: 'self', place: '' },
        notifyCredits: result.notify && result.notify.tmplId === MESSAGE_TEMPLATE_ID ? result.notify.credits : 0,
        messages: markRisky(result.messages),
        scrollTo: changed && result.messages.length ? `m-${result.messages.length - 1}` : this.data.scrollTo
      });
      this.retrySettle(result);
      return changed;
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      return false;
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

  // 拾得者：“我已交还”，提醒失主确认
  async handedOver() {
    const { confirm } = await wx.showModal({
      title: '已经把东西交给失主了？',
      content: '我们会提醒失主确认。失主 3 天内没有确认，会自动算作已归还。'
    });
    if (!confirm) return;
    await this.call('reviewClaim', { action: 'handedOver', claimId: this.claimId }, '已提醒失主');
  },

  // 任一方：取消配对，物品回到匹配中
  async cancelMatch() {
    const { tapIndex } = await wx.showActionSheet({ itemList: CANCEL_REASONS }).catch(() => ({ tapIndex: -1 }));
    const reason = CANCEL_REASONS[tapIndex];
    if (!reason) return;
    const { confirm } = await wx.showModal({
      title: '取消这次配对？',
      content: '取消后这件东西会回到匹配中，别人可以重新认领，你们的聊天也会结束。',
      confirmText: '取消配对',
      cancelText: '再想想',
      confirmColor: '#D93025'
    });
    if (!confirm) return;
    await this.call('reviewClaim', { action: 'cancel', claimId: this.claimId, reason }, '已取消配对');
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
      await this.loadNew();
      // 刚发完消息，对方多半马上回，恢复 3 秒一次
      this.pollMs = POLL_MIN_MS;
      this.schedulePoll();
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  }
});

const { timeAgo, distanceText } = require('../../utils/format');
const { askMessageNotify } = require('../../utils/notify');
const { report } = require('../../utils/report');
const { shareTitle } = require('../../utils/share');

const CLAIM_STATUS_TEXT = {
  pending: '已提交，等待拾得者确认',
  approved: '拾得者已确认，是你的东西',
  rejected: '拾得者认为答案不对'
};

Page({
  data: {
    loading: true,
    isLost: true,
    postStatus: 'open',
    matchedClaimId: '',
    blockReason: '',
    myPhoto: '',
    matches: [],
    claims: [],
    answers: {},
    busy: false,
    askRenew: false
  },

  onLoad(query) {
    this.postId = query.id;
    // 从“还在找吗？”的提醒点进来
    this.setData({ askRenew: query.renew === '1' });
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
        timeText: timeAgo(m.createdAt),
        claimText: CLAIM_STATUS_TEXT[m.claimStatus] || ''
      }));
      const claims = result.claims.map((c) => ({ ...c, timeText: c.createdAt ? timeAgo(c.createdAt) : '' }));
      this.setData({
        loading: false,
        isLost: result.post.type === 'lost',
        postStatus: result.post.status,
        matchedClaimId: result.post.matchedClaimId,
        blockReason: result.post.blockReason || '',
        myPhoto: result.post.photos[0],
        post: result.post,
        matches,
        claims
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败，下拉重试', icon: 'none' });
    }
  },

  // 转发出去的是这条发布的详情页，别人点开就能认领或者说“我捡到了”
  onShareAppMessage() {
    const post = this.data.post;
    return {
      title: post ? shareTitle(post) : '掉了么：拍张照，帮丢的东西回家',
      path: `/pages/item/item?id=${this.postId}`
    };
  },

  // 续期：发布 30 天后还在找；过期下架的重新上架
  async renew() {
    await this.run('managePost', { action: 'renew', postId: this.postId }, '已续期');
    this.setData({ askRenew: false });
  },

  report(e) {
    const { type, id } = e.currentTarget.dataset;
    report(type, id);
  },

  onAnswer(e) {
    this.setData({ [`answers.${e.currentTarget.dataset.id}`]: e.detail.value });
  },

  // 失主回答核验问题，发起认领
  async submitClaim(e) {
    const foundPostId = e.currentTarget.dataset.id;
    const answer = (this.data.answers[foundPostId] || '').trim();
    if (!answer) {
      wx.showToast({ title: '请先回答问题', icon: 'none' });
      return;
    }
    // 拾得者确认后会发消息约交接，先问失主要不要收提醒
    await askMessageNotify();
    await this.run('submitClaim', { lostPostId: this.postId, foundPostId, answer }, '已提交，等待拾得者确认');
  },

  // 拾得者确认或拒绝认领
  async reviewClaim(e) {
    const { id, approve } = e.currentTarget.dataset;
    if (approve) {
      // 配对后失主会发消息过来，先问拾得者要不要收提醒。
      // 必须在点击后马上弹，放到确认弹窗之后真机上不会出来
      await askMessageNotify();
      const { confirm } = await wx.showModal({
        title: '确认是失主？',
        content: '确认后会和对方配对，其他人的认领会被自动拒绝。'
      });
      if (!confirm) return;
    }
    await this.run('reviewClaim', { claimId: id, approve: !!approve }, approve ? '已配对' : '已拒绝');
  },

  async run(name, data, successText) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const { result } = await wx.cloud.callFunction({ name, data });
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: successText, icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  }
});

const { timeAgo, distanceText } = require('../../utils/format');
const { askMessageNotify } = require('../../utils/notify');
const { report } = require('../../utils/report');
const { shareTitle } = require('../../utils/share');
const { drawPoster } = require('../../utils/poster');

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

  // 生成寻物海报：可以发朋友圈，或者存下来发小红书、抖音、QQ。别人用微信扫海报上的码就能打开这条发布
  async makePoster() {
    const post = this.data.post;
    if (!post || this.posterBusy) return;
    this.posterBusy = true;
    wx.showLoading({ title: '正在生成海报', mask: true });
    try {
      if (!this.posterPath) {
        const { envVersion } = wx.getAccountInfoSync().miniProgram;
        const { result } = await wx.cloud.callFunction({ name: 'getPost', data: { action: 'shareCode', id: this.postId, envVersion } });
        if (!result.ok) throw new Error(result.message);
        const codePath = `${wx.env.USER_DATA_PATH}/share-${this.postId}.png`;
        wx.getFileSystemManager().writeFileSync(codePath, result.image, 'base64');
        const fileID = (post.photos || [])[0];
        const photoPath = fileID ? await wx.cloud.downloadFile({ fileID }).then((r) => r.tempFilePath).catch(() => '') : '';
        const canvas = await new Promise((resolve) => {
          wx.createSelectorQuery().select('#poster').fields({ node: true }).exec((res) => resolve(res[0] && res[0].node));
        });
        if (!canvas) throw new Error('海报画不出来，请更新微信再试');
        this.posterPath = await drawPoster(canvas, post, photoPath, codePath);
      }
      wx.hideLoading();
      this.showPoster();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成失败，请重试', icon: 'none' });
    } finally {
      this.posterBusy = false;
    }
  },

  // 微信自带的图片菜单：发给朋友、保存到相册、收藏，不用申请相册权限
  showPoster() {
    const path = this.posterPath;
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({ path, fail: () => wx.previewImage({ urls: [path] }) });
    } else {
      wx.previewImage({ urls: [path] });
    }
  },

  // 复制一段话，粘贴到 QQ、短信或其他 App；别人在微信里搜“掉了么”就能找到
  copyText() {
    const post = this.data.post;
    if (!post) return;
    const reward = post.type === 'lost' && post.reward > 0 ? `失主愿意给感谢金 ${post.reward} 元。` : '';
    const text = `${shareTitle(post)}。${reward}见到了请打开微信，搜索小程序“掉了么”联系我，谢谢！`;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制，去粘贴吧', icon: 'none' }) });
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

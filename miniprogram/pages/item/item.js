const { timeAgo } = require('../../utils/format');
const { askMessageNotify } = require('../../utils/notify');
const { report } = require('../../utils/report');
const { shareTitle } = require('../../utils/share');

const CLAIM_STATUS_TEXT = {
  pending: '你已经认领过，等待拾得者确认',
  approved: '拾得者已确认是你的东西',
  rejected: '拾得者认为上次的答案不对'
};

// 物品详情：首页点开，或从微信群的转发卡片进来。
// 拾物：失主回答核验问题直接认领；还没登记失物的先去登记，登记完回到这里。
// 失物：捡到的人点“我捡到了”去发布，发布后直接提醒这位失主。
Page({
  data: {
    loading: true,
    item: null,
    timeText: '',
    myLostPosts: [],
    myClaim: null,
    claimText: '',
    answer: '',
    busy: false
  },

  onLoad(query) {
    this.id = query.id;
    // 从“先登记失物”回来时带着刚发布的失物 id
    this.lostId = query.lostId || '';
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'getPost', data: { id: this.id } });
      if (!result.ok) throw new Error(result.message);
      const { item, myLostPosts, myClaim } = result;
      wx.setNavigationBarTitle({ title: item.type === 'found' ? '有人捡到了' : '有人在找' });
      this.setData({
        loading: false,
        item,
        timeText: timeAgo(item.createdAt),
        myLostPosts,
        myClaim,
        // 被拒绝过的可以再答一次
        claimText: myClaim && myClaim.status !== 'rejected' ? CLAIM_STATUS_TEXT[myClaim.status] : (myClaim ? CLAIM_STATUS_TEXT.rejected : '')
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败，下拉重试', icon: 'none' });
    }
  },

  onAnswer(e) {
    this.setData({ answer: e.detail.value });
  },

  // 失主：“这是我的”
  async claim() {
    const answer = this.data.answer.trim();
    if (!answer) {
      wx.showToast({ title: '请先回答问题', icon: 'none' });
      return;
    }
    const lostPosts = this.data.myLostPosts;
    let lostPostId = this.lostId && lostPosts.some((p) => p._id === this.lostId) ? this.lostId : '';
    if (!lostPostId && lostPosts.length === 0) {
      const { confirm } = await wx.showModal({
        title: '先登记一下你丢的东西',
        content: '拍张照或找张同款图，填好后会回到这里，直接用你的答案认领。',
        confirmText: '去登记'
      });
      if (confirm) this.goPost('lost');
      return;
    }
    // 拾得者确认后会发消息约交接，先问要不要收提醒。必须在点击后马上弹
    await askMessageNotify();
    if (!lostPostId && lostPosts.length === 1) lostPostId = lostPosts[0]._id;
    if (!lostPostId) {
      const { tapIndex } = await wx.showActionSheet({ itemList: lostPosts.map((p) => `用“${p.title}”认领`) })
        .catch(() => ({ tapIndex: -1 }));
      if (tapIndex < 0) return;
      lostPostId = lostPosts[tapIndex]._id;
    }

    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'submitClaim',
        data: { lostPostId, foundPostId: this.id, answer }
      });
      if (!result.ok) throw new Error(result.message);
      wx.showToast({ title: '已提交，等待拾得者确认', icon: 'none' });
      this.setData({ answer: '' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  // 捡到的人：“我捡到了”
  found() {
    this.goPost('found');
  },

  // 带上这件物品的类别和地点去发布页，省得重填
  goPost(type) {
    const it = this.data.item;
    const params = {
      type,
      [type === 'lost' ? 'claimFor' : 'forLost']: it._id,
      category: it.category,
      customCategory: it.customCategory,
      placeName: it.placeName,
      latitude: it.latitude,
      longitude: it.longitude
    };
    const qs = Object.keys(params)
      .filter((k) => params[k] !== '' && params[k] != null)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');
    wx.navigateTo({ url: `/pages/post/post?${qs}` });
  },

  goMatches() {
    wx.navigateTo({ url: `/pages/matches/matches?id=${this.id}` });
  },

  goChat() {
    wx.navigateTo({ url: `/pages/chat/chat?claimId=${this.data.myClaim._id}` });
  },

  report() {
    report('post', this.id);
  },

  onShareAppMessage() {
    const it = this.data.item;
    return {
      title: it ? shareTitle(it) : '掉了么：拍张照，帮丢的东西回家',
      path: `/pages/item/item?id=${this.id}`,
      imageUrl: it && it.photos.length ? it.photos[0] : undefined
    };
  }
});

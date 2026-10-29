const { timeAgo } = require('../../utils/format');
const { OPERATOR } = require('../../utils/legal');

const STATUS_TEXT = {
  open: '正在匹配',
  matched: '已配对，点开聊天',
  closed: '已归还',
  withdrawn: '已撤回',
  blocked: '照片未通过审核，已下架'
};

const WITHDRAW = '已经找到了 / 不需要了，撤回';
const DELETE = '删除这条发布';

Page({
  data: {
    loading: true,
    items: [],
    email: OPERATOR.email
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'listMyPosts' });
      if (!result.ok) throw new Error(result.message);
      const items = result.items.map((it) => ({
        ...it,
        timeText: timeAgo(it.createdAt),
        statusText: it.status === 'blocked' && it.blockReason === 'reports'
          ? '被多人举报，已暂时下架。有误会请发邮件给我们'
          : STATUS_TEXT[it.status] || ''
      }));
      this.setData({ loading: false, items });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败，下拉重试', icon: 'none' });
    }
  },

  open(e) {
    const item = this.data.items[e.currentTarget.dataset.index];
    const url = item.matchedClaimId && (item.status === 'matched' || item.status === 'closed')
      ? `/pages/chat/chat?claimId=${item.matchedClaimId}`
      : `/pages/matches/matches?id=${item._id}`;
    wx.navigateTo({ url });
  },

  // 每条右边的“管理”：匹配中的可以撤回或删除，交接中的不能动
  async manage(e) {
    const item = this.data.items[e.currentTarget.dataset.index];
    if (item.status === 'matched') {
      wx.showToast({ title: '正在交接中，交接完成后才能删除', icon: 'none' });
      return;
    }
    const itemList = item.status === 'open' ? [WITHDRAW, DELETE] : [DELETE];
    const { tapIndex } = await wx.showActionSheet({ itemList }).catch(() => ({ tapIndex: -1 }));
    const choice = itemList[tapIndex];
    if (!choice) return;

    if (choice === DELETE) {
      const { confirm } = await wx.showModal({
        title: '删除这条发布？',
        content: '照片和内容会被彻底删除，不能恢复。',
        confirmText: '删除',
        confirmColor: '#D93025'
      });
      if (!confirm) return;
    }
    await this.run({ action: choice === DELETE ? 'delete' : 'close', postId: item._id }, choice === DELETE ? '已删除' : '已撤回');
    await this.load();
  },

  async deleteAccount() {
    const { confirm } = await wx.showModal({
      title: '注销账号？',
      content: '会删除你的全部发布、照片、私信和评分，不能恢复。正在交接中的物品需要先完成交接。',
      confirmText: '注销',
      confirmColor: '#D93025'
    });
    if (!confirm) return;
    const ok = await this.run({ action: 'deleteAccount' }, '已注销');
    if (!ok) return;
    // 本地记的同意协议等也一起清掉，回到首页就是新用户
    try { wx.clearStorageSync(); } catch (err) {}
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
  },

  async run(data, successText) {
    if (this.busy) return false;
    this.busy = true;
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'managePost', data });
      if (!result.ok) throw new Error(result.message);
      wx.hideLoading();
      wx.showToast({ title: successText, icon: 'success' });
      return true;
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      return false;
    } finally {
      this.busy = false;
    }
  }
});

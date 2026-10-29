// 举报：先选原因，再可选补充几句。targetType 是 post（某条发布）或 claim（聊天里的对方）
const REASONS = {
  post: ['虚假或冒充的发布', '照片或文字违规', '广告或骚扰', '其他'],
  claim: ['冒领', '骚扰或辱骂', '索要钱财或诈骗', '其他']
};

async function report(targetType, targetId) {
  const itemList = REASONS[targetType];
  const { tapIndex } = await wx.showActionSheet({ itemList }).catch(() => ({ tapIndex: -1 }));
  const reason = itemList[tapIndex];
  if (!reason) return;

  const { confirm, content } = await wx.showModal({
    title: `举报：${reason}`,
    editable: true,
    placeholderText: '可以补充说明（选填）',
    confirmText: '提交'
  });
  if (!confirm) return;

  wx.showLoading({ title: '提交中', mask: true });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'report',
      data: { targetType, targetId, reason, detail: content || '' }
    });
    wx.hideLoading();
    if (!result.ok) throw new Error(result.message);
    wx.showToast({ title: '已收到，我们会尽快处理', icon: 'none' });
  } catch (err) {
    wx.hideLoading();
    wx.showToast({ title: err.message || '提交失败', icon: 'none' });
  }
}

module.exports = { report };

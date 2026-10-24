const { MESSAGE_TEMPLATE_ID } = require('./constants');

// 弹出“允许收新消息提醒”的授权框，用户点了允许就记一次。返回 true 表示这次允许了。
// 微信只允许在点击事件里直接调用：调用之前不能先 await 别的操作（showModal 的确定按钮除外），否则不弹框。
function askMessageNotify() {
  if (!MESSAGE_TEMPLATE_ID || !wx.requestSubscribeMessage) return Promise.resolve(false);
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [MESSAGE_TEMPLATE_ID],
      success: (res) => resolve(res[MESSAGE_TEMPLATE_ID] === 'accept'),
      fail: () => resolve(false)
    });
  }).then((accepted) => {
    if (!accepted) return false;
    const { envVersion } = wx.getAccountInfoSync().miniProgram;
    return wx.cloud.callFunction({ name: 'subscribe', data: { tmplId: MESSAGE_TEMPLATE_ID, envVersion } })
      .then(({ result }) => !!(result && result.ok))
      .catch(() => false);
  });
}

module.exports = { askMessageNotify, MESSAGE_TEMPLATE_ID };

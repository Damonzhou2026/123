const { DOCS, EFFECTIVE_DATE } = require('../../utils/legal');

Page({
  data: {
    doc: null,
    isPrivacy: false,
    effectiveDate: EFFECTIVE_DATE
  },

  onLoad(options) {
    const key = options.doc === 'terms' ? 'terms' : 'privacy';
    const doc = DOCS[key];
    wx.setNavigationBarTitle({ title: doc.title });
    this.setData({ doc, isPrivacy: key === 'privacy' });
  },

  // 打开在公众平台填写的「用户隐私保护指引」
  openWechatGuide() {
    if (!wx.openPrivacyContract) return;
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '暂时打不开，请稍后再试', icon: 'none' })
    });
  }
});

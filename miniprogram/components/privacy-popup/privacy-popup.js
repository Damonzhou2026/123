const { LEGAL_VERSION } = require('../../utils/legal');

// 本地记下用户同意的是哪一版协议；改了 LEGAL_VERSION 会重新弹框
const AGREED_KEY = 'legalAgreedVersion';

function agreedThisVersion() {
  try {
    return wx.getStorageSync(AGREED_KEY) === LEGAL_VERSION;
  } catch (err) {
    return false;
  }
}

// 首次打开时请用户同意《用户协议》和《隐私政策》。
// 同时接管微信的隐私授权：调用定位、选照片等接口前如果用户还没同意隐私保护指引，
// 微信会先回调 onNeedPrivacyAuthorization，接口挂起，等这里同意或拒绝后才继续。
// 每个会调用这些接口的页面都要放一个，因为只有当前显示的页面能弹框。
Component({
  data: {
    show: false
  },

  lifetimes: {
    attached() {
      this.listen();
      if (!agreedThisVersion()) this.setData({ show: true });
    }
  },

  pageLifetimes: {
    // 微信只保留最后一次注册的回调，回到这个页面时重新注册
    show() {
      this.listen();
    }
  },

  methods: {
    listen() {
      if (!wx.onNeedPrivacyAuthorization) return;
      wx.onNeedPrivacyAuthorization((resolve) => {
        this.pendingResolve = resolve;
        this.setData({ show: true });
      });
    },

    // 页面也可以主动再弹一次，比如用户先拒绝、后来又想用
    open() {
      this.setData({ show: true });
    },

    openDoc(e) {
      wx.navigateTo({ url: `/pages/legal/legal?doc=${e.currentTarget.dataset.doc}` });
    },

    onAgree() {
      try {
        wx.setStorageSync(AGREED_KEY, LEGAL_VERSION);
      } catch (err) {
        // 存不进去下次再弹一次，不影响这次使用
      }
      if (this.pendingResolve) {
        this.pendingResolve({ buttonId: 'agree-privacy', event: 'agree' });
        this.pendingResolve = null;
      }
      this.setData({ show: false });
      this.triggerEvent('agree');
    },

    onDisagree() {
      if (this.pendingResolve) {
        this.pendingResolve({ event: 'disagree' });
        this.pendingResolve = null;
      }
      this.setData({ show: false });
      this.triggerEvent('disagree');
    },

    // 弹框打开时不让底下的页面跟着滚
    noop() {}
  }
});

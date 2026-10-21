// 云开发环境 ID：在微信开发者工具「云开发」控制台创建环境后填入
const CLOUD_ENV = 'your-cloud-env-id';

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
  }
});

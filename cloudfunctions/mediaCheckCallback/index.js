const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 接收微信推回来的图片检测结果（消息推送，事件 wxa_media_check）。
// 要在云开发控制台“设置 → 全局设置 → 消息推送”里把这个事件指到本云函数，见 README。
// 照片违规时，把还在匹配中的发布下架（status 改成 blocked），别人就搜不到、也认领不了了。
exports.main = async (event) => {
  if (!event || event.Event !== 'wxa_media_check') return 'success';
  const traceId = event.trace_id || event.traceId;
  if (!traceId) return 'success';

  const suggest = (event.result && event.result.suggest) || (event.errcode === 87014 ? 'risky' : 'pass');
  const posts = db.collection('posts');
  const { data } = await posts.where({ 'mediaCheck.traceIds': traceId }).limit(1).get();
  const post = data[0];
  if (!post) return 'success';

  const update = { 'mediaCheck.checkedAt': db.serverDate() };
  if (suggest === 'risky') {
    update['mediaCheck.result'] = 'risky';
    if (post.status === 'open') update.status = 'blocked';
  } else if (post.mediaCheck.result !== 'risky') {
    // 一条发布可能有几张照片，只要有一张违规就算违规
    update['mediaCheck.result'] = 'pass';
  }
  await posts.doc(post._id).update({ data: update });
  return 'success';
};

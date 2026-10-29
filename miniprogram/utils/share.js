// 转发到微信群时卡片上的标题
function shareTitle(post) {
  const what = post.title || post.customCategory || post.category || '东西';
  const where = post.placeName ? `在${post.placeName}` : '';
  return post.type === 'found'
    ? `有人${where}捡到了${what}，是你的吗？`
    : `帮忙留意：有人${where}丢了${what}`;
}

module.exports = { shareTitle };

const TAGS = ['守时', '热心', '沟通顺畅', '物品完好', '有礼貌'];

// 检查评分输入，返回整理后的值或错误信息
function validateRating(input) {
  const stars = Number(input && input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: '请选择 1～5 星' };
  const raw = Array.isArray(input.tags) ? input.tags : [];
  const tags = [...new Set(raw)].filter((t) => TAGS.includes(t));
  return { stars, tags };
}

module.exports = { validateRating, TAGS };

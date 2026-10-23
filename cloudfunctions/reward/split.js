// 感谢金拆分：平台按比例收服务费，其余全部分给拾得者。金额单位都是分。
function computeSplit(totalFen, feeRate) {
  if (!Number.isInteger(totalFen) || totalFen <= 0) throw new Error('金额必须是正整数（分）');
  if (typeof feeRate !== 'number' || Number.isNaN(feeRate) || feeRate < 0 || feeRate >= 1) {
    throw new Error('服务费比例必须在 0 到 1 之间');
  }
  const feeFen = Math.round(totalFen * feeRate);
  return { finderFen: totalFen - feeFen, feeFen };
}

// 商户订单号：6～32 位，只能用字母、数字和 _-*
function makeOutTradeNo(prefix, now, random) {
  const no = `${prefix}${now.toString(36)}${random}`.replace(/[^A-Za-z0-9_\-*]/g, '');
  return no.slice(0, 32);
}

module.exports = { computeSplit, makeOutTradeNo };

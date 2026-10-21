// 物品类别：匹配时同类别加分
const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];

// 证件类不开启感谢金，引导交给派出所或场馆服务台
const NO_REWARD_CATEGORIES = ['证件'];

module.exports = { CATEGORIES, NO_REWARD_CATEGORIES };

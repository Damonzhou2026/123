// 物品类别：匹配时同类别加分
const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];

// 证件类不开启感谢金，引导交给派出所或场馆服务台
const NO_REWARD_CATEGORIES = ['证件'];

// 感谢金托管开关。普通商户分账上限 30%，不够给拾得者，先关掉，感谢金由失主线下直接给。
// 接好持牌分账服务商后改成 true，聊天页的托管入口就会回来（cloudfunctions/reward 代码保留）
const ESCROW_ENABLED = false;

// 新消息提醒用的订阅消息模板 ID：微信公众平台 →“订阅消息”→“我的模板”里复制。留空就不弹授权框、不推送
const MESSAGE_TEMPLATE_ID = '';

module.exports = { CATEGORIES, NO_REWARD_CATEGORIES, ESCROW_ENABLED, MESSAGE_TEMPLATE_ID };

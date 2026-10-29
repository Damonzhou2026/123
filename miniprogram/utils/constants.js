// 物品类别：匹配时同类别加分
const CATEGORIES = ['钥匙', '手机', '耳机', '钱包', '证件', '包', '水杯', '玩具', '衣物', '其他'];
// 选「其他」时用户自己填具体是什么（10 字以内），存在 customCategory 里
const OTHER_CATEGORY = '其他';
const MAX_CUSTOM_CATEGORY = 10;

// 证件类不开启感谢金，引导交给派出所或场馆服务台
const NO_REWARD_CATEGORIES = ['证件'];

// 这几类捡到的东西，照片不在首页公开（可能拍到证件号、卡号），和 cloudfunctions/listNearby 保持一致
const PRIVATE_PHOTO_CATEGORIES = ['证件', '钱包', '手机'];

// 感谢金托管开关。普通商户分账上限 30%，不够给拾得者，先关掉，感谢金由失主线下直接给。
// 接好持牌分账服务商后改成 true，聊天页的托管入口就会回来（cloudfunctions/reward 代码保留）
const ESCROW_ENABLED = false;

// 新消息提醒用的订阅消息模板 ID：微信公众平台 →“订阅消息”→“我的模板”里复制。留空就不弹授权框、不推送
const MESSAGE_TEMPLATE_ID = 'hBMhed6IMwA5n-jwsSYO1ZUUEL7AB9VUPa71JrQl_xA';

// 感谢金上限（元），和 cloudfunctions/createPost 里的 MAX_REWARD 保持一致
const MAX_REWARD = 10000;

// 每条发布最多几张照片，和 cloudfunctions/createPost 的校验（1～3 张）保持一致
const MAX_PHOTOS = 3;

module.exports = { PRIVATE_PHOTO_CATEGORIES, CATEGORIES, OTHER_CATEGORY, MAX_CUSTOM_CATEGORY, NO_REWARD_CATEGORIES, MAX_REWARD, MAX_PHOTOS, ESCROW_ENABLED, MESSAGE_TEMPLATE_ID };

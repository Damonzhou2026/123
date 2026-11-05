// 防丢贴编号：8 位，只用不容易看错的大写字母和数字（去掉了 0 O 1 I L）。
// 随机生成、不按顺序排，31^8 ≈ 8500 亿种，别人猜不到也没法挨个扫。
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);

function randomCode() {
  const bytes = crypto.randomBytes(LENGTH);
  let code = '';
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

// 用户手输或者从链接里截出来的编号，统一成大写再校验；不合法返回空字符串
function normalizeCode(input) {
  const code = String(input || '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : '';
}

// 手机号只收中国大陆 11 位
function normalizePhone(input) {
  const phone = String(input || '').replace(/[\s-]/g, '').replace(/^\+?86/, '');
  return /^1[3-9]\d{9}$/.test(phone) ? phone : '';
}

// 给失主自己看的手机号：138****1234
function maskPhone(phone) {
  return phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '';
}

// 验证码只存哈希，数据库里看不到明文
function hashCode(code, openid) {
  return crypto.createHash('sha256').update(`${openid}:${code}`).digest('hex');
}

module.exports = { ALPHABET, LENGTH, randomCode, normalizeCode, normalizePhone, maskPhone, hashCode };

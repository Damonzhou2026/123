// 交接防骗：对方的消息里提到先付钱、押金、验证码这类词时，在消息下面加一句提醒。
// 感谢金是失主拿到东西后自愿给的，所以只提醒“先付”这类说法，不拦消息
const RISK_WORDS = /转账|红包|邮费|运费|快递费|保证金|押金|定金|手续费|先付|预付|收款码|二维码|银行卡|验证码|刷单/;

// 给对方发来的、提到钱的消息加上 risky 标记
function markRisky(messages) {
  return messages.map((m) => (!m.mine && RISK_WORDS.test(m.text) ? { ...m, risky: true } : m));
}

module.exports = { markRisky, RISK_WORDS };

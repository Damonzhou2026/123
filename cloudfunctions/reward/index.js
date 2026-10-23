// 感谢金托管：失主付款时资金被微信支付冻结（分账订单），
// 失主确认拿回物品后，按比例分给拾得者，剩余部分（平台服务费）解冻给商户。
// 钱始终在微信支付里，平台账户不经手拾得者的钱。
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const wxpay = require('./wxpay');
const { computeSplit, makeOutTradeNo } = require('./split');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ACTIONS = { create, sync, settle };

exports.main = async (event) => {
  const action = ACTIONS[event.action];
  if (!action) return { ok: false, message: '未知操作' };
  try {
    const cfg = wxpay.loadConfig(process.env);
    return await action(event, cfg, cloud.getWXContext().OPENID);
  } catch (err) {
    console.error(event.action, err);
    return { ok: false, message: err.message || '操作失败' };
  }
};

async function loadClaim(claimId) {
  return db.collection('claims').doc(claimId).get().then((r) => r.data).catch(() => null);
}

function paymentRef(claimId) {
  // 一次认领只对应一笔感谢金，用认领 id 作为文档 id
  return db.collection('payments').doc(claimId);
}

async function loadPayment(claimId) {
  return paymentRef(claimId).get().then((r) => r.data).catch(() => null);
}

// 失主下单付款。返回 wx.requestPayment 需要的参数。
async function create(event, cfg, openid) {
  const claim = await loadClaim(event.claimId);
  if (!claim || claim.claimantOpenid !== openid) return { ok: false, message: '只有失主可以支付感谢金' };
  if (claim.status !== 'approved') return { ok: false, message: '拾得者确认之后、拿回物品之前才能支付' };

  const lost = await db.collection('posts').doc(claim.lostPostId).get().then((r) => r.data);
  const amountFen = Math.round((lost.reward || 0) * 100);
  if (amountFen <= 0) return { ok: false, message: '这次没有设置感谢金' };

  let payment = await loadPayment(claim._id);
  if (payment && payment.status !== 'created') return { ok: false, message: '感谢金已经支付过了' };
  if (!payment) {
    payment = {
      claimId: claim._id,
      outTradeNo: makeOutTradeNo('R', Date.now(), crypto.randomBytes(4).toString('hex')),
      amountFen,
      payerOpenid: openid,
      finderOpenid: claim.finderOpenid,
      status: 'created',
      createdAt: db.serverDate()
    };
    await paymentRef(claim._id).set({ data: payment });
  }

  // 同一个商户订单号、同样的参数重复下单，微信支付会返回同一个 prepay_id
  const res = await wxpay.request(cfg, 'POST', '/v3/pay/transactions/jsapi', {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: `失物感谢金-${lost.title}`.slice(0, 127),
    out_trade_no: payment.outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: payment.amountFen, currency: 'CNY' },
    payer: { openid },
    settle_info: { profit_sharing: true }
  });
  if (res.status !== 200 || !res.data.prepay_id) {
    return { ok: false, message: `下单失败：${res.data.message || res.status}` };
  }
  return { ok: true, params: wxpay.paymentParams(res.data.prepay_id, cfg) };
}

// 查询订单状态，把已支付的订单记下来。付款后和打开聊天页时都会调用。
async function sync(event, cfg, openid) {
  const claim = await loadClaim(event.claimId);
  if (!claim || (claim.claimantOpenid !== openid && claim.finderOpenid !== openid)) {
    return { ok: false, message: '找不到这次认领' };
  }
  const payment = await loadPayment(claim._id);
  if (!payment) return { ok: true, status: 'none' };
  if (payment.status !== 'created') return { ok: true, status: payment.status, amountFen: payment.amountFen };

  const path = `/v3/pay/transactions/out-trade-no/${payment.outTradeNo}?mchid=${cfg.mchid}`;
  const res = await wxpay.request(cfg, 'GET', path);
  if (res.status === 200 && res.data.trade_state === 'SUCCESS') {
    await paymentRef(claim._id).update({
      data: { status: 'paid', transactionId: res.data.transaction_id, paidAt: db.serverDate() }
    });
    return { ok: true, status: 'paid', amountFen: payment.amountFen };
  }
  return { ok: true, status: 'created', amountFen: payment.amountFen };
}

// 失主确认拿回后分账：大部分给拾得者，剩余解冻给商户。可以重复调用，已分过的不会再分。
async function settle(event, cfg) {
  const claim = await loadClaim(event.claimId);
  if (!claim || claim.status !== 'returned') return { ok: false, message: '确认拿回之后才能分账' };

  // 先同步一次，防止付款回调还没记下来
  await sync(event, cfg, claim.claimantOpenid);
  const payment = await loadPayment(claim._id);
  if (!payment || payment.status === 'created') return { ok: true, status: 'none' };
  if (payment.status === 'settled') return { ok: true, status: 'settled' };

  const { finderFen, feeFen } = computeSplit(payment.amountFen, cfg.feeRate);
  const outOrderNo = payment.outOrderNo || makeOutTradeNo('S', Date.now(), crypto.randomBytes(4).toString('hex'));
  await paymentRef(claim._id).update({ data: { status: 'settling', outOrderNo, finderFen, feeFen } });

  const receiver = await wxpay.request(cfg, 'POST', '/v3/profitsharing/receivers/add', {
    appid: cfg.appid,
    type: 'PERSONAL_OPENID',
    account: payment.finderOpenid,
    relation_type: 'USER'
  });
  if (receiver.status !== 200) {
    return { ok: false, message: `添加分账接收方失败：${receiver.data.message || receiver.status}` };
  }

  const res = await wxpay.request(cfg, 'POST', '/v3/profitsharing/orders', {
    appid: cfg.appid,
    transaction_id: payment.transactionId,
    out_order_no: outOrderNo,
    receivers: [{
      type: 'PERSONAL_OPENID',
      account: payment.finderOpenid,
      amount: finderFen,
      description: '失物归还感谢金'
    }],
    // 剩下的服务费解冻给商户
    unfreeze_unsplit: true
  });
  if (res.status !== 200) {
    return { ok: false, message: `分账失败：${res.data.message || res.status}` };
  }
  await paymentRef(claim._id).update({ data: { status: 'settled', settledAt: db.serverDate() } });
  return { ok: true, status: 'settled', finderFen };
}

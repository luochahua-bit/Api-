/**
 * Payment Service
 * Handles coin purchase orders and payment processing
 * Currently: simulated payment (instant)
 * Future: Alipay, WeChat Pay, Stripe integration
 */
const crypto = require('crypto');
const store = require('../store');

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

// Create a payment order
function createPaymentOrder(userId, amount) {
  if (!amount || amount < 1 || amount > 100000) {
    return { success: false, error: '充值金额 1-100000 金币' };
  }

  const order = {
    id: genId('pay'),
    userId,
    amount: Math.floor(amount),
    status: 'pending', // pending → paid → credited
    createdAt: Date.now(),
    paidAt: null,
    creditedAt: null,
    paymentMethod: 'simulated', // future: alipay, wechat, stripe
  };

  store.addPaymentOrder(order);
  return { success: true, order };
}

// Process simulated payment (user clicks "pay")
function processSimulatedPayment(orderId) {
  const order = store.getPaymentOrder(orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '订单状态异常' };

  // Mark as paid
  store.updatePaymentOrder(orderId, { status: 'paid', paidAt: Date.now() });

  // Credit coins to user
  store.addCoins(order.userId, order.amount, '充值 ' + order.amount + ' 金币');
  store.updatePaymentOrder(orderId, { status: 'credited', creditedAt: Date.now() });

  return { success: true, amount: order.amount };
}

// Handle payment callback (for real payment providers)
function handlePaymentCallback(orderId, providerStatus, providerTxId) {
  const order = store.getPaymentOrder(orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '订单已处理' };

  if (providerStatus === 'success') {
    store.updatePaymentOrder(orderId, { status: 'paid', paidAt: Date.now() });
    store.addCoins(order.userId, order.amount, '充值 ' + order.amount + ' 金币 (回调)');
    store.updatePaymentOrder(orderId, { status: 'credited', creditedAt: Date.now() });
    return { success: true };
  } else {
    store.updatePaymentOrder(orderId, { status: 'failed' });
    return { success: false, error: '支付失败' };
  }
}

// Get user's payment history
function getUserPayments(userId, limit) {
  const orders = store.getUserPaymentOrders(userId);
  return orders.slice(-limit || 50).reverse();
}

module.exports = {
  createPaymentOrder,
  processSimulatedPayment,
  handlePaymentCallback,
  getUserPayments,
};

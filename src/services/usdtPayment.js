/**
 * USDT-TRC20 Payment Service
 * Monitors incoming USDT deposits via TronGrid API
 * Auto-credits user accounts on confirmed transactions
 */

const axios = require('axios');
const crypto = require('crypto');
const store = require('../store');

const WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || '';
const PRIVATE_KEY = process.env.USDT_WALLET_PRIVATE_KEY || '';
const COINS_PER_USDT = parseInt(process.env.USDT_COINS_PER_USDT) || 10;
const MIN_DEPOSIT = parseFloat(process.env.USDT_MIN_DEPOSIT) || 1;
const MAX_WITHDRAW = parseFloat(process.env.USDT_MAX_WITHDRAW) || 50;
const TRONGRID_API = 'https://api.trongrid.io';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRC20 contract

let monitorInterval = null;

// ========== Deposit Orders ==========

function createDepositOrder(userId, usdtAmount) {
  if (usdtAmount < MIN_DEPOSIT) {
    return { success: false, error: `最低充值 ${MIN_DEPOSIT} USDT` };
  }
  if (usdtAmount > 10000) {
    return { success: false, error: '单次最多充值 10000 USDT' };
  }

  // Generate unique amount with random decimals to distinguish orders
  const uniqueAmount = (usdtAmount + Math.random() * 0.01 + 0.001).toFixed(6);
  const coins = Math.floor(usdtAmount * COINS_PER_USDT);
  const orderId = 'dep_' + crypto.randomBytes(8).toString('hex');

  const order = {
    id: orderId,
    userId,
    usdtAmount: parseFloat(uniqueAmount),
    coins,
    address: WALLET_ADDRESS,
    status: 'pending',   // pending → confirming → completed → expired
    txHash: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    confirmedAt: null,
  };

  store.addDepositOrder(order);
  return { success: true, order };
}

function checkDepositOrder(orderId) {
  const order = store.getDepositOrder(orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status === 'expired' && Date.now() > order.expiresAt) {
    return { success: false, error: '订单已过期' };
  }
  return { success: true, order };
}

// ========== Blockchain Monitoring ==========

async function checkIncomingTransactions() {
  if (!WALLET_ADDRESS) return;

  try {
    // Try TronGrid API with fallback
    let resp;
    try {
      resp = await axios.get(
        `${TRONGRID_API}/v1/accounts/${WALLET_ADDRESS}/transactions/trc20`,
        { params: { limit: 20 }, timeout: 15000, validateStatus: () => true }
      );
    } catch (e) {
      // Fallback: try api.tronstack.io
      resp = await axios.get(
        `https://api.tronstack.io/v1/accounts/${WALLET_ADDRESS}/transactions/trc20`,
        { params: { limit: 20 }, timeout: 15000, validateStatus: () => true }
      );
    }

    if (!resp || resp.status !== 200 || !resp.data?.data) {
      if (resp && resp.status !== 200) {
        console.log(`[USDT] API returned ${resp.status}: ${JSON.stringify(resp.data).slice(0, 100)}`);
      }
      return;
    }

    const transactions = resp.data.data.filter(tx => tx.to === WALLET_ADDRESS.toLowerCase());
    const pendingOrders = store.getPendingDepositOrders();

    for (const tx of transactions) {
      // Only process incoming USDT to our wallet
      if (tx.to !== WALLET_ADDRESS.toLowerCase()) continue;
      if (tx.token_info?.address !== USDT_CONTRACT) continue;

      const amount = parseFloat(tx.value) / 1e6; // USDT has 6 decimals
      const txHash = tx.transaction_id;

      // Check if this tx was already processed
      if (store.isDepositTxProcessed(txHash)) continue;

      // Match with pending order by amount
      const matchedOrder = pendingOrders.find(o => {
        const diff = Math.abs(o.usdtAmount - amount);
        return diff < 0.001; // allow small rounding difference
      });

      if (matchedOrder) {
        // Confirm the deposit
        store.updateDepositOrder(matchedOrder.id, {
          status: 'completed',
          txHash,
          confirmedAt: Date.now(),
        });

        // Credit user's paid coins
        store.addCoins(matchedOrder.userId, matchedOrder.coins, `USDT 充值 ${amount} USDT → ${matchedOrder.coins} 币`);
        store.addProcessedTx(txHash);

        console.log(`[USDT] Deposit confirmed: ${amount} USDT → ${matchedOrder.coins} coins for user ${matchedOrder.userId}`);
      }
    }

    // Expire old pending orders
    for (const order of pendingOrders) {
      if (Date.now() > order.expiresAt) {
        store.updateDepositOrder(order.id, { status: 'expired' });
      }
    }
  } catch (err) {
    // Only log first error, then silently retry
    if (!checkIncomingTransactions._lastError || Date.now() - checkIncomingTransactions._lastError > 300000) {
      console.error('[USDT] Monitor error:', err.message);
      checkIncomingTransactions._lastError = Date.now();
    }
  }
}

// ========== Withdrawal ==========

async function processWithdrawal(userId, coins) {
  if (coins <= 0) return { success: false, error: '提现金币数必须大于 0' };

  const user = store.getUserById(userId);
  if (!user) return { success: false, error: '用户不存在' };
  if ((user.coins || 0) < coins) return { success: false, error: '金币余额不足' };

  const usdtAmount = coins / COINS_PER_USDT;
  if (usdtAmount > MAX_WITHDRAW) {
    return { success: false, error: `单次最多提现 ${MAX_WITHDRAW} USDT` };
  }

  // Check for pending withdrawals
  const pending = store.getWithdrawalsByUser(userId).filter(w => w.status === 'pending');
  if (pending.length > 0) {
    return { success: false, error: '有正在审核的提现申请，请等待处理' };
  }

  // Deduct coins immediately (held in withdrawal)
  store.deductCoins(userId, coins, `申请提现 ${coins} 币 (${usdtAmount} USDT)`);

  const withdrawal = {
    id: 'wd_' + crypto.randomUUID(),
    userId,
    username: user.username,
    coins,
    usdtAmount,
    walletAddress: user.usdtAddress || '',
    status: 'pending',
    createdAt: Date.now(),
    processedAt: null,
    txHash: null,
    note: '',
  };
  store.addWithdrawal(withdrawal);

  return { success: true, withdrawal };
}

// ========== Monitor Control ==========

function startMonitor() {
  if (!WALLET_ADDRESS) {
    console.log('[USDT] Wallet not configured, monitor disabled');
    return;
  }
  console.log(`[USDT] Monitor started for ${WALLET_ADDRESS}`);
  checkIncomingTransactions(); // initial check
  monitorInterval = setInterval(checkIncomingTransactions, 30000); // every 30 seconds
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

module.exports = {
  createDepositOrder, checkDepositOrder,
  processWithdrawal,
  startMonitor, stopMonitor,
  COINS_PER_USDT, MIN_DEPOSIT, MAX_WITHDRAW, WALLET_ADDRESS,
};

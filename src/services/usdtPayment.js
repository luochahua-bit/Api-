/**
 * USDC-Arbitrum Payment Service
 * Monitors incoming USDC deposits via Arbiscan API
 * Auto-credits user accounts on confirmed transactions
 */

const axios = require('axios');
const crypto = require('crypto');
const store = require('../store');

const WALLET_ADDRESS = (process.env.USDT_WALLET_ADDRESS || '').toLowerCase();
const PRIVATE_KEY = process.env.USDT_WALLET_PRIVATE_KEY || '';
const COINS_PER_USDT = parseInt(process.env.USDT_COINS_PER_USDT) || 10;
const MIN_DEPOSIT = parseFloat(process.env.USDT_MIN_DEPOSIT) || 1;
const MAX_WITHDRAW = parseFloat(process.env.USDT_MAX_WITHDRAW) || 50;
const ARBISCAN_API = 'https://api.etherscan.io/v2/api';
const ARBISCAN_KEY = process.env.ARBISCAN_API_KEY || '';
const USDC_CONTRACT = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum One
const REQUIRED_CONFIRMATIONS = 3; // Arbitrum: ~0.25s per block, 3 confirmations ≈ 1 second

let monitorInterval = null;

// ========== Deposit Orders ==========

function createDepositOrder(userId, usdtAmount) {
  if (usdtAmount < MIN_DEPOSIT) {
    return { success: false, error: `最低充值 ${MIN_DEPOSIT} USDC` };
  }
  if (usdtAmount > 10000) {
    return { success: false, error: '单次最多充值 10000 USDC' };
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
    status: 'pending',
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

// ========== Blockchain Monitoring (Arbitrum) ==========

async function getLatestBlockNumber() {
  try {
    const params = { module: 'proxy', action: 'eth_blockNumber', chainid: 42161 };
    if (ARBISCAN_KEY) params.apikey = ARBISCAN_KEY;
    const resp = await axios.get(ARBISCAN_API, { params, timeout: 10000 });
    return parseInt(resp.data?.result, 16) || 0;
  } catch (e) {
    return 0;
  }
}

async function checkIncomingTransactions() {
  if (!WALLET_ADDRESS) return;

  try {
    // Query ERC-20 token transfers to our wallet via Arbiscan
    const params = {
      module: 'account',
      action: 'tokentx',
      address: WALLET_ADDRESS,
      contractaddress: USDC_CONTRACT,
      chainid: 42161, // Arbitrum One
      page: 1,
      offset: 20,
      sort: 'desc',
    };
    if (ARBISCAN_KEY) params.apikey = ARBISCAN_KEY;

    const resp = await axios.get(ARBISCAN_API, { params, timeout: 15000, validateStatus: () => true });

    if (!resp.data || resp.data.status !== '1' || !resp.data.result) {
      if (resp.data?.message !== 'No transactions found') {
        console.log(`[USDC] Arbiscan: ${resp.data?.message || 'unknown error'}`);
      }
      return;
    }

    const transactions = resp.data.result.filter(tx => tx.to.toLowerCase() === WALLET_ADDRESS);
    const pendingOrders = store.getPendingDepositOrders();
    const recentExpiredOrders = (store.getDepositOrders ? store.getDepositOrders() : [])
      .filter(o => o.status === 'expired' && Date.now() - o.expiresAt < 24 * 60 * 60 * 1000);
    const matchableOrders = [...pendingOrders, ...recentExpiredOrders];
    const latestBlock = await getLatestBlockNumber();

    for (const tx of transactions) {
      // Check block confirmations (prevent double-spend)
      const txBlock = parseInt(tx.blockNumber);
      if (latestBlock > 0 && txBlock) {
        const confirmations = latestBlock - txBlock;
        if (confirmations < REQUIRED_CONFIRMATIONS) {
          console.log(`[USDC] Tx ${tx.hash} has ${confirmations} confirmations, need ${REQUIRED_CONFIRMATIONS}. Skipping.`);
          continue;
        }
      }

      const amount = parseFloat(tx.value) / 1e6; // USDC has 6 decimals
      const txHash = tx.hash;

      // Check if this tx was already processed
      if (store.isDepositTxProcessed(txHash)) continue;

      // Match with pending/expired order by amount
      const matchedOrder = matchableOrders.find(o => {
        const diff = Math.abs(o.usdtAmount - amount);
        return diff < 0.001; // allow small rounding difference
      });

      if (matchedOrder) {
        store.updateDepositOrder(matchedOrder.id, {
          status: 'completed',
          txHash,
          confirmedAt: Date.now(),
        });

        store.addCoins(matchedOrder.userId, matchedOrder.coins, `USDC 充值 ${amount} USDC → ${matchedOrder.coins} 币`);
        store.addProcessedTx(txHash);

        console.log(`[USDC] Deposit confirmed: ${amount} USDC → ${matchedOrder.coins} coins for user ${matchedOrder.userId}`);
      } else if (!store.isDepositTxProcessed(txHash)) {
        console.warn(`[USDC] ALERT: Unmatched deposit! ${amount} USDC from ${tx.from}, txHash: ${txHash}. Manual review required.`);
        store.addProcessedTx(txHash);
      }
    }

    // Expire old pending orders
    for (const order of pendingOrders) {
      if (Date.now() > order.expiresAt) {
        store.updateDepositOrder(order.id, { status: 'expired' });
      }
    }
  } catch (err) {
    if (!checkIncomingTransactions._lastError || Date.now() - checkIncomingTransactions._lastError > 300000) {
      console.error('[USDC] Monitor error:', err.message);
      checkIncomingTransactions._lastError = Date.now();
    }
  }
}

// ========== Transaction Verification ==========

async function verifyTransaction(txHash, expectedAmount) {
  try {
    const params = {
      module: 'transaction',
      action: 'gettxinfo',
      txhash: txHash,
      chainid: 42161,
    };
    if (ARBISCAN_KEY) params.apikey = ARBISCAN_KEY;

    const resp = await axios.get(ARBISCAN_API, { params, timeout: 15000, validateStatus: () => true });

    if (!resp.data || resp.data.status !== '1' || !resp.data.result) {
      return { verified: false, error: '交易查询失败，请确认交易哈希正确' };
    }

    const tx = resp.data.result;

    // Check if transaction was successful
    if (tx.isError === '1') {
      return { verified: false, error: '此交易失败' };
    }

    // Get the USDC transfer details from transaction logs
    const usdcTransfer = tx.logs?.find(log =>
      log.address.toLowerCase() === USDC_CONTRACT.toLowerCase() &&
      log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event
    );

    if (!usdcTransfer) {
      return { verified: false, error: '此交易不包含 USDC 转账' };
    }

    // Decode the amount from the log data
    const amount = parseInt(usdcTransfer.data, 16) / 1e6;
    const diff = Math.abs(amount - expectedAmount);

    if (diff > 0.01) {
      return { verified: false, error: `金额不匹配：期望 ${expectedAmount} USDC，实际 ${amount} USDC` };
    }

    // Check confirmations
    const latestBlock = await getLatestBlockNumber();
    const txBlock = parseInt(tx.blockNumber);
    if (latestBlock > 0 && txBlock) {
      const confirmations = latestBlock - txBlock;
      if (confirmations < REQUIRED_CONFIRMATIONS) {
        return { verified: false, error: `确认数不足：${confirmations}/${REQUIRED_CONFIRMATIONS}，请稍等` };
      }
    }

    return { verified: true, amount };
  } catch (err) {
    return { verified: false, error: '验证出错: ' + err.message };
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
    return { success: false, error: `单次最多提现 ${MAX_WITHDRAW} USDC` };
  }

  const pending = store.getWithdrawalsByUser(userId).filter(w => w.status === 'pending');
  if (pending.length > 0) {
    return { success: false, error: '有正在审核的提现申请，请等待处理' };
  }

  store.deductCoins(userId, coins, `申请提现 ${coins} 币 (${usdtAmount} USDC)`);

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
    console.log('[USDC] Wallet not configured, monitor disabled');
    return;
  }
  console.log(`[USDC] Monitor started for ${WALLET_ADDRESS} (Arbitrum)`);
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
  processWithdrawal, verifyTransaction,
  startMonitor, stopMonitor,
  COINS_PER_USDT, MIN_DEPOSIT, MAX_WITHDRAW, WALLET_ADDRESS,
};

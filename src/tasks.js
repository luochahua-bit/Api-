/**
 * Task System — Free coin rewards for user engagement
 * Users complete tasks to earn freeCoins (not withdrawable, API access only)
 */

const crypto = require('crypto');

// Task definitions
const TASKS = [
  {
    id: 'daily_checkin',
    name: '每日签到',
    description: '每天签到获得 3 免费币（= 3 万 token）',
    reward: 3,
    type: 'daily',    // can repeat daily
    category: 'daily',
  },
  {
    id: 'complete_profile',
    name: '完善资料',
    description: '完善个人资料获得 20 免费币',
    reward: 20,
    type: 'once',     // one-time only
    category: 'setup',
  },
  {
    id: 'first_purchase',
    name: '首次购买',
    description: '完成第一笔市场交易获得 30 免费币',
    reward: 30,
    type: 'once',
    category: 'marketplace',
  },
  {
    id: 'first_listing',
    name: '首次上架',
    description: '作为卖家首次上架商品获得 20 免费币',
    reward: 20,
    type: 'once',
    category: 'marketplace',
  },
  {
    id: 'invite_friend',
    name: '邀请好友',
    description: '好友通过你的邀请码注册，自动获得 50 免费币',
    reward: 50,
    type: 'auto', // rewarded automatically when action occurs, not manually claimed
    category: 'social',
  },
  {
    id: 'review_order',
    name: '评价订单',
    description: '完成订单评价，自动获得 5 免费币',
    reward: 5,
    type: 'auto',
    category: 'marketplace',
  },
  {
    id: 'seven_day_streak',
    name: '七日活跃',
    description: '连续 7 天使用 API 获得 50 免费币',
    reward: 50,
    type: 'once',
    category: 'milestone',
  },
];

/**
 * Generate a unique invite code for a user
 * Format: U + 8 alphanumeric chars (short, memorable, ~2.8 trillion combinations)
 * Checks database for uniqueness, retries if collision found
 */
function generateInviteCode(userId) {
  var store = require('./store');
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  for (var attempt = 0; attempt < 10; attempt++) {
    var buf = crypto.randomBytes(8);
    var code = 'U';
    for (var i = 0; i < 8; i++) {
      code += chars[buf[i] % chars.length];
    }
    // Check uniqueness
    var existing = store.getInviteCode(code);
    if (!existing) return code;
  }
  // Fallback: longer code to guarantee uniqueness
  return 'U' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

/**
 * Check if a daily task was already completed today
 */
function isDailyTaskDone(completions, taskId) {
  const today = new Date().toISOString().slice(0, 10);
  return completions.some(c => c.taskId === taskId && c.date === today);
}

/**
 * Check if a one-time task was already completed
 */
function isOnceTaskDone(completions, taskId) {
  return completions.some(c => c.taskId === taskId);
}

/**
 * Check if user has 7-day API usage streak
 * @param {Array} coinTransactions - user's coin transaction history
 * @returns {boolean}
 */
function has7DayStreak(coinTransactions) {
  const usageDays = new Set();
  for (const tx of coinTransactions) {
    if (tx.type === 'usage' || tx.type === 'api_call' || tx.type === 'spend_free') {
      usageDays.add(new Date(tx.createdAt).toISOString().slice(0, 10));
    }
  }
  // Check if there are 7 consecutive days in the last 14 days
  const now = new Date();
  for (let i = 0; i <= 7; i++) {
    let streak = true;
    for (let j = 0; j < 7; j++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i - j);
      if (!usageDays.has(d.toISOString().slice(0, 10))) {
        streak = false;
        break;
      }
    }
    if (streak) return true;
  }
  return false;
}

/**
 * Get available tasks for a user with completion status
 * @param {Object} user
 * @param {Array} completions - task completion records
 * @returns {Array}
 */
function getTasksForUser(user, completions) {
  return TASKS.map(task => {
    let completed = false;
    let claimable = false;
    let autoCount = 0;

    if (task.type === 'daily') {
      completed = isDailyTaskDone(completions, task.id);
      claimable = !completed;
    } else if (task.type === 'once') {
      completed = isOnceTaskDone(completions, task.id);
      claimable = !completed;
    } else if (task.type === 'auto') {
      // Auto tasks: not manually claimable, count how many times rewarded
      autoCount = completions.filter(c => c.taskId === task.id).length;
      claimable = false;
      completed = false;
    } else {
      claimable = true;
      completed = false;
    }

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      reward: task.reward,
      type: task.type,
      category: task.category,
      completed,
      claimable,
      autoCount,
    };
  });
}

module.exports = {
  TASKS,
  generateInviteCode,
  isDailyTaskDone,
  isOnceTaskDone,
  has7DayStreak,
  getTasksForUser,
};

/**
 * Email validation utility
 * Validates email format and only accepts mainstream email providers
 */

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// Mainstream email providers — only these are accepted
const ALLOWED_DOMAINS = new Set([
  // Chinese providers
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com',
  'sohu.com', 'aliyun.com', '139.com', '189.cn', 'wo.cn',
  // International providers
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'yahoo.co.jp', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'mail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'gmx.net', 'fastmail.com',
  // Education (common)
  'edu', 'edu.cn', 'ac.cn', 'ac.jp', 'ac.uk',
]);

/**
 * Validate email format and domain
 * @param {string} email
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: '邮箱不能为空' };
  }

  const trimmed = email.trim().toLowerCase();

  if (trimmed.length > 254) {
    return { valid: false, reason: '邮箱长度不能超过 254 个字符' };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, reason: '邮箱格式不正确' };
  }

  const parts = trimmed.split('@');
  const domain = parts[1];

  // Check against whitelist — accept if domain matches or is a subdomain of an allowed domain
  const domainParts = domain.split('.');
  let allowed = false;
  for (let i = 0; i < domainParts.length - 1; i++) {
    const checkDomain = domainParts.slice(i).join('.');
    if (ALLOWED_DOMAINS.has(checkDomain)) {
      allowed = true;
      break;
    }
  }

  if (!allowed) {
    return { valid: false, reason: '请使用主流邮箱注册（QQ、Gmail、Outlook、163 等）' };
  }

  return { valid: true };
}

/**
 * Normalize email for storage (lowercase, trim)
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split('@');
  // Gmail ignores dots in local part — normalize to prevent multi-account abuse
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return local.replace(/\./g, '') + '@' + domain;
  }
  return trimmed;
}

module.exports = { validateEmail, normalizeEmail };

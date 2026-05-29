/**
 * Market Response Security Service
 * Validates and sanitizes API responses before forwarding to buyers
 */
const crypto = require('crypto');

// Suspicious patterns that indicate tampered responses
const DANGEROUS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /data:text\/html/i,
  /vbscript:/i,
  /on\w+\s*=/i,           // onclick=, onerror=, etc.
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<form[\s>]/i,
  /<input[\s>]/i,
  /document\.(cookie|location|write)/i,
  /window\.(location|open)/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /<meta[\s]+http-equiv/i, // meta refresh redirects
];

// Phishing / scam patterns
const PHISHING_PATTERNS = [
  /api[_\s-]?key\s*[:=]\s*['"][^'"]{20,}/i,  // Trying to steal API keys
  /password\s*[:=]\s*['"][^'"]+/i,
  /secret\s*[:=]\s*['"][^'"]+/i,
  /token\s*[:=]\s*['"][^'"]{20,}/i,
  /send\s*(to|this)\s*[\w.]+@/i,              // Send to email
  /telegram\.me\//i,
  /wa\.me\//i,
  /bit\.ly\//i,                                // Suspicious short links
  /t\.me\//i,
];

/**
 * Validate response structure matches OpenAI chat completion format
 */
function validateResponseStructure(data) {
  if (!data || typeof data !== 'object') return { valid: false, reason: '响应不是有效 JSON' };
  if (!data.choices && !data.error) return { valid: false, reason: '响应缺少 choices 或 error 字段' };
  if (data.choices && !Array.isArray(data.choices)) return { valid: false, reason: 'choices 不是数组' };
  return { valid: true };
}

/**
 * Scan text content for dangerous patterns
 */
function scanContent(text) {
  if (!text || typeof text !== 'string') return { safe: true };

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: '检测到潜在恶意内容', pattern: pattern.source };
    }
  }

  for (const pattern of PHISHING_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: '检测到潜在钓鱼/窃取信息内容', pattern: pattern.source };
    }
  }

  return { safe: true };
}

/**
 * Sanitize a non-streaming response
 * Returns { safe, data, warnings }
 */
function sanitizeResponse(responseData) {
  const warnings = [];

  // 1. Validate structure
  const structCheck = validateResponseStructure(responseData);
  if (!structCheck.valid) {
    return { safe: false, data: responseData, reason: structCheck.reason, warnings };
  }

  // 2. Scan each choice's content
  if (responseData.choices) {
    for (const choice of responseData.choices) {
      const content = choice.message?.content || choice.delta?.content || choice.text || '';
      const scan = scanContent(content);
      if (!scan.safe) {
        // Neutralize the dangerous content instead of blocking entirely
        if (choice.message?.content) {
          choice.message.content = '[内容已过滤: ' + scan.reason + ']';
        }
        warnings.push(scan.reason);
      }
    }
  }

  // 3. Check for injected metadata
  const suspiciousKeys = ['_redirect', '_inject', '_exec', '_eval', '__proto__', 'constructor'];
  for (const key of suspiciousKeys) {
    if (responseData[key]) {
      delete responseData[key];
      warnings.push('移除了可疑字段: ' + key);
    }
  }

  // 4. Validate usage object (prevent fake billing)
  if (responseData.usage) {
    const u = responseData.usage;
    if (u.prompt_tokens > 1000000 || u.completion_tokens > 1000000) {
      warnings.push('Token 数量异常高，可能是伪造的计费数据');
      responseData.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }
  }

  // 5. Validate model field matches what was requested
  // (this is checked at the route level)

  return {
    safe: warnings.length === 0,
    data: responseData,
    warnings,
  };
}

/**
 * Sanitize a streaming response chunk
 * Returns { safe, chunk, warnings }
 */
function sanitizeStreamChunk(chunkStr) {
  const warnings = [];

  // Check for dangerous patterns in the chunk
  const scan = scanContent(chunkStr);
  if (!scan.safe) {
    warnings.push(scan.reason);
    // Return a safe replacement chunk
    return { safe: false, chunk: 'data: {"choices":[{"delta":{"content":"[内容已过滤]"}}]}\n\n', warnings };
  }

  return { safe: true, chunk: chunkStr, warnings };
}

/**
 * Log a security incident
 */
function logIncident(store, listingId, buyerId, reason, details) {
  store.addLog({
    id: 'sec_' + crypto.randomUUID(),
    model: 'security',
    provider: listingId,
    status: 'security_warning',
    tokens: 0,
    duration: 0,
    apiKey: buyerId,
    warning: reason,
    details: details,
  });
}

module.exports = {
  sanitizeResponse,
  sanitizeStreamChunk,
  scanContent,
  logIncident,
};

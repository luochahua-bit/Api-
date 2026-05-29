/**
 * Email Service - Resend API (works globally, no SMTP issues)
 * Fallback: SMTP via nodemailer (for local development)
 */
const axios = require('axios');
const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SITE_NAME = process.env.SITE_NAME || 'LLM API 中转站';
const SITE_URL = process.env.SITE_URL || 'https://llm-relay.xyz';
const EMAIL_FROM = process.env.EMAIL_FROM || `${SITE_NAME} <onboarding@resend.dev>`;

// ========== Core Send ==========

async function sendEmail(to, subject, html) {
  // Try Resend API first
  if (RESEND_API_KEY) {
    try {
      const resp = await axios.post('https://api.resend.com/emails', {
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
      }, {
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      console.log(`[Email] Sent via Resend to ${to}: ${subject}`);
      return { success: true, id: resp.data?.id };
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message;
      console.error(`[Email] Resend failed to ${to}:`, errMsg);
      // 如果是沙盒模式限制，提示需要验证域名
      if (errMsg.includes('only send testing emails') || errMsg.includes('Not allowed')) {
        return { success: false, error: '邮件发送受限：请在 Resend 后台验证域名 llm-relay.xyz，然后设置 EMAIL_FROM 环境变量' };
      }
      return { success: false, error: errMsg };
    }
  }

  // Fallback: SMTP via nodemailer (仅本地开发，Render 美国服务器连 QQ 邮箱会超时)
  const SMTP_HOST = process.env.SMTP_HOST || '';
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 465,
        secure: (parseInt(process.env.SMTP_PORT) || 465) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 15000,
        socketTimeout: 15000,
      });
      await transport.sendMail({
        from: `"${SITE_NAME}" <${SMTP_USER}>`,
        to, subject, html,
      });
      console.log(`[Email] Sent via SMTP to ${to}: ${subject}`);
      return { success: true };
    } catch (err) {
      console.error(`[Email] SMTP failed to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // No email configured
  console.log(`[Email] (simulated) To: ${to} | Subject: ${subject}`);
  return { success: true, simulated: true };
}

// ========== Base Layout ==========

function baseLayout(content, { title, buttonText, buttonUrl } = {}) {
  const btn = buttonText && buttonUrl
    ? `<div style="text-align:center;margin:20px 0">
        <a href="${buttonUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">${buttonText}</a>
      </div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px 16px">

  <div style="text-align:center;margin-bottom:24px">
    <a href="${SITE_URL}" style="text-decoration:none">
      <h2 style="color:#3b82f6;margin:0;font-size:22px;font-weight:800">${SITE_NAME}</h2>
    </a>
    <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">免费 AI 模型聚合平台</p>
  </div>

  ${title ? `<h3 style="font-size:16px;color:#1e293b;margin:0 0 16px;text-align:center">${title}</h3>` : ''}

  <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px">
    ${content}
  </div>

  ${btn}

  <div style="text-align:center;padding-top:16px;border-top:1px solid #e2e8f0">
    <a href="${SITE_URL}" style="color:#3b82f6;text-decoration:none;font-size:12px">${SITE_URL}</a>
    <p style="font-size:10px;color:#94a3b8;margin:8px 0 0">如非本人操作，请忽略此邮件。</p>
  </div>

</div>
</body></html>`;
}

// ========== Verification Code ==========

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendVerificationEmail(toEmail, code) {
  const content = `
    <p style="font-size:14px;color:#334155;margin:0 0 16px">您好，您正在注册 ${SITE_NAME} 账号。</p>
    <p style="font-size:14px;color:#334155;margin:0 0 16px">您的验证码为：</p>
    <div style="text-align:center;margin:20px 0;background:#f8fafc;border:2px dashed #3b82f6;border-radius:8px;padding:20px">
      <span style="font-size:40px;font-weight:800;color:#3b82f6;letter-spacing:10px">${code}</span>
    </div>
    <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;text-align:center">验证码 5 分钟内有效，请勿泄露给他人。</p>
  `;
  const html = baseLayout(content, { title: '邮箱验证码', buttonText: `访问 ${SITE_NAME}`, buttonUrl: SITE_URL });
  return sendEmail(toEmail, `${SITE_NAME} - 邮箱验证码`, html);
}

// ========== Feedback Notification ==========

async function sendFeedbackNotifyEmail(adminEmail, feedback) {
  const typeNames = { bug: '问题反馈', question: '咨询提问', suggestion: '功能建议' };
  const content = `
    <p style="font-size:13px;color:#334155;margin:0 0 8px"><strong>用户：</strong>${feedback.username} (${feedback.email})</p>
    <p style="font-size:13px;color:#334155;margin:0 0 8px"><strong>类型：</strong>${typeNames[feedback.type] || feedback.type}</p>
    <p style="font-size:13px;color:#334155;margin:0 0 16px"><strong>标题：</strong>${feedback.title}</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${feedback.content}</div>
  `;
  const html = baseLayout(content, { title: '收到新反馈', buttonText: '查看反馈', buttonUrl: SITE_URL + '/market' });
  return sendEmail(adminEmail, `${SITE_NAME} - 新反馈: ${feedback.title}`, html);
}

async function sendFeedbackReplyEmail(userEmail, feedback) {
  const content = `
    <p style="font-size:13px;color:#334155;margin:0 0 12px">您提交的反馈 <strong>"${feedback.title}"</strong> 已收到管理员回复：</p>
    <div style="background:#f0f9ff;border-left:3px solid #3b82f6;border-radius:0 8px 8px 0;padding:16px;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${feedback.reply}</div>
  `;
  const html = baseLayout(content, { title: '反馈已回复', buttonText: '查看详情', buttonUrl: SITE_URL + '/market' });
  return sendEmail(userEmail, `${SITE_NAME} - 您的反馈已回复`, html);
}

module.exports = {
  generateCode, sendEmail,
  sendVerificationEmail, sendFeedbackNotifyEmail, sendFeedbackReplyEmail,
};

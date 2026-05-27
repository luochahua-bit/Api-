/**
 * Email Service - SMTP based email sending
 * Configured via environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SITE_NAME = process.env.SITE_NAME || 'LLM API 中转站';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    console.log('[Email] SMTP not configured, emails will be logged to console');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

// Generate 6-digit verification code
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Send verification email
async function sendVerificationEmail(toEmail, code) {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:20px">
        <h2 style="color:#3b82f6;margin:0">${SITE_NAME}</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
        <p style="font-size:14px;color:#334155;margin:0 0 16px">您好，您正在注册 ${SITE_NAME} 账号。</p>
        <p style="font-size:14px;color:#334155;margin:0 0 16px">您的验证码为：</p>
        <div style="text-align:center;margin:20px 0">
          <span style="font-size:32px;font-weight:800;color:#3b82f6;letter-spacing:8px">${code}</span>
        </div>
        <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">验证码 5 分钟内有效，请勿泄露给他人。</p>
      </div>
      <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px">如非本人操作，请忽略此邮件。</p>
    </div>
  `;

  const transport = getTransporter();
  if (!transport) {
    console.log(`[Email] Verification code for ${toEmail}: ${code}`);
    return { success: true, simulated: true };
  }

  try {
    await transport.sendMail({
      from: `"${SITE_NAME}" <${SMTP_FROM}>`,
      to: toEmail,
      subject: `${SITE_NAME} - 邮箱验证码`,
      html,
    });
    console.log(`[Email] Sent verification code to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error(`[Email] Failed to send to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateCode, sendVerificationEmail };

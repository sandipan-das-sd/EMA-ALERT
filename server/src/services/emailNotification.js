import nodemailer from 'nodemailer';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

let transporter = null;
let configErrorLogged = false;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || process.env.SMTP_SERVER;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || process.env.SMTP_MAIL;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  const security = String(process.env.SMTP_SECURITY || '').trim().toUpperCase();

  if (!host || !user || !pass) {
    if (!configErrorLogged) {
      console.warn('[Email] SMTP is not configured. Set SMTP_SERVER/SMTP_HOST, SMTP_PORT, SMTP_MAIL/SMTP_USER, SMTP_PASSWORD/SMTP_PASS.');
      configErrorLogged = true;
    }
    return null;
  }

  const secure = security === 'SSL' || parseBool(process.env.SMTP_SECURE, port === 465);
  const requireTLS = security === 'TLS';

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
  });

  return transporter;
}

function buildAlertEmailHtml(alertData) {
  const price = Number.isFinite(alertData.close) ? alertData.close.toFixed(2) : 'NA';
  const ema = Number.isFinite(alertData.ema) ? alertData.ema.toFixed(2) : 'NA';
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const logoUrl = String(process.env.COMPANY_LOGO_URL || '').trim();
  const logo = logoUrl
    ? `<div style="margin-bottom:10px;"><img src="${logoUrl}" alt="Company logo" style="max-height:36px; max-width:180px;" /></div>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      ${logo}
      <h2 style="margin:0 0 8px;">EMA Alert Triggered</h2>
      <p style="margin:0 0 12px;">Your configured strategy has triggered an alert.</p>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #ddd;">
        <tr><td><strong>Instrument</strong></td><td>${alertData.instrumentName || 'Unknown'}</td></tr>
        <tr><td><strong>Symbol Key</strong></td><td>${alertData.instrumentKey || 'NA'}</td></tr>
        <tr><td><strong>Strategy</strong></td><td>${alertData.strategy || 'ema20_cross_up'}</td></tr>
        <tr><td><strong>Price</strong></td><td>${price}</td></tr>
        <tr><td><strong>EMA</strong></td><td>${ema}</td></tr>
        <tr><td><strong>Time (IST)</strong></td><td>${time}</td></tr>
      </table>
      <p style="margin-top: 12px; color: #666; font-size: 12px;">EMA Alert System</p>
    </div>
  `;
}

export async function sendAlertEmailToUser(user, alertData, preferences) {
  const to = String(user?.email || '').trim();
  if (!to) {
    return { sent: false, reason: 'user_no_email' };
  }

  if (preferences && preferences.emailNotificationsEnabled === false) {
    return { sent: false, reason: 'user_disabled_email' };
  }

  const transport = getTransporter();
  if (!transport) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.SMTP_MAIL;
  const fromName = String(process.env.SMTP_FROM_NAME || '').trim();
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const subject = `${alertData.instrumentName || 'Instrument'} Alert`;
  const text = `EMA Alert Triggered\nInstrument: ${alertData.instrumentName || 'Unknown'}\nKey: ${alertData.instrumentKey || 'NA'}\nStrategy: ${alertData.strategy || 'ema20_cross_up'}\nPrice: ${Number.isFinite(alertData.close) ? alertData.close.toFixed(2) : 'NA'}\nEMA: ${Number.isFinite(alertData.ema) ? alertData.ema.toFixed(2) : 'NA'}`;

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject,
      text,
      html: buildAlertEmailHtml(alertData),
    });

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    return { sent: false, reason: 'email_send_failed', error: error?.message || 'send failed' };
  }
}

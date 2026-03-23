import { queryOne, execute } from '../db/client.js';

export async function dispatchAlert(ownerId, ip) {
  const owner = await queryOne(
    `SELECT alert_phone, alert_email, display_name FROM owner_config WHERE id = ?`,
    [ownerId]
  );

  if (!owner) {
    console.error('[alert] owner not found:', ownerId);
    return;
  }

  const timestamp = new Date().toISOString();
  const message = `EA Watch security alert: danger word used at ${timestamp}. IP: ${ip ?? 'unknown'}.`;

  let delivered = false;

  // --- Primary: iMessage via macOS/iOS Shortcuts URL scheme ---
  // This only works if the alert_phone is configured and the server has a way to trigger it.
  // On a Mac server or via a Shortcuts webhook, this fires an iMessage.
  // For Vercel (serverless), we use a secondary mechanism: a pre-configured webhook URL.
  if (process.env.ALERT_IMESSAGE_WEBHOOK) {
    try {
      const resp = await fetch(process.env.ALERT_IMESSAGE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: owner.alert_phone, message }),
      });
      if (resp.ok) delivered = true;
    } catch (err) {
      console.error('[alert] iMessage webhook failed:', err.message);
    }
  }

  // --- Fallback: email via Resend ---
  if (!delivered && owner.alert_email && process.env.RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL ?? 'alerts@ea-watch.app',
          to: owner.alert_email,
          subject: 'EA Watch: Danger word used',
          text: message,
        }),
      });
      if (resp.ok) delivered = true;
    } catch (err) {
      console.error('[alert] email fallback failed:', err.message);
    }
  }

  // --- Always log the attempt regardless of delivery ---
  try {
    await execute(
      `INSERT INTO tap_log (uid, device_code, outcome, ip)
       VALUES ('danger_alert', 'alert', ?, ?)`,
      [delivered ? 'alert_delivered' : 'alert_failed', ip ?? null]
    );
  } catch (err) {
    console.error('[alert] audit log failed:', err.message);
  }

  if (!delivered) {
    console.error('[alert] DANGER WORD FIRED but no delivery channel succeeded. Owner:', ownerId);
  }
}

'use strict';

const { CONFIG } = require('./config');

async function sendTelegram(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) return { ok: false, skipped: 'telegram_not_configured' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) {
    console.error('[NOTIFIER] Telegram falhou:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendTelegram };

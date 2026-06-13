'use strict';

const baileys = require('./baileys');
const db = require('./database');
const { sendTelegram } = require('./notifier');

function initErrorMonitor() {
  process.on('uncaughtException', async (error) => {
    const msg = `Erro critico: ${error.message}`;
    console.error('[MONITOR] uncaughtException:', error);
    db.addSystemLog('error', msg);
    await sendTelegram(`🚨 *Central Vendas — Erro Crítico*\n\n${error.message}`).catch(() => {});
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason?.message || String(reason);
    console.error('[MONITOR] unhandledRejection:', reason);
    db.addSystemLog('warning', `Promise rejeitada: ${message}`);
  });
}

async function healthCheck() {
  const status = baileys.getAllStatus();
  const disconnected = Object.entries(status)
    .filter(([, s]) => s.state === 'disconnected')
    .map(([id]) => id);

  if (disconnected.length) {
    db.addSystemLog('warning', `Agentes desconectados: ${disconnected.join(', ')}`);
    return `warning: ${disconnected.length} agentes desconectados`;
  }

  return 'ok';
}

module.exports = { initErrorMonitor, healthCheck };

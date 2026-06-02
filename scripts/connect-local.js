'use strict';
// Conecta um agente LOCALMENTE para gerar sessão e depois fazer upload para o Railway
// Uso: node scripts/connect-local.js <agentId>
// Ex:  node scripts/connect-local.js antonio

const [,, agentId] = process.argv;
if (!agentId) {
  console.error('Uso: node scripts/connect-local.js <agentId>');
  console.error('Ex:  node scripts/connect-local.js antonio');
  process.exit(1);
}

// Forçar diretório de sessão local
process.env.RAILWAY_VOLUME_MOUNT_PATH = 'C:\\tmp\\central-vendas';

const http   = require('http');
const QRCode = require('qrcode');
const baileys = require('../src/baileys');

const SESSION_MAP = {
  logzz: 'logzz-session', info: 'info-session',
  rafael: 'rafael-session', sarah: 'sarah-session',
  antonio: 'antonio-session',
};
const sessionId = SESSION_MAP[agentId] || `${agentId}-session`;

console.log(`\n[connect-local] Iniciando agente "${agentId}" (sessão: ${sessionId})`);
console.log(`[connect-local] Diretório de auth: C:\\tmp\\central-vendas\\baileys_cv_${sessionId}\\\n`);

// Conecta Baileys sem handler de mensagens
baileys.connect(sessionId, () => {});

// Mini servidor HTTP para exibir o QR no browser
const server = http.createServer(async (req, res) => {
  const state = baileys.getState(sessionId);
  const qrRaw = baileys.getQRCode(sessionId);

  if (state === 'connected') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h1 style="color:#22c55e">✅ ${agentId} conectado!</h1>
      <p>Pode fechar esta página.</p>
      <p>Agora execute no terminal:</p>
      <pre style="background:#f3f4f6;padding:16px;border-radius:8px;text-align:left;display:inline-block">
$env:RAILWAY_VOLUME_MOUNT_PATH = "C:\\tmp\\central-vendas"
node scripts/upload-session.js ${agentId} https://central-vendas-production.up.railway.app 1234</pre>
    </body></html>`);
    return;
  }

  if (!qrRaw) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="2"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>⏳ Aguardando QR Code...</h2>
      <p>Agente: <strong>${agentId}</strong> | Estado: ${state}</p>
      <p style="color:#6b7280">Página atualiza automaticamente...</p>
      </body></html>`);
    return;
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(qrRaw, { width: 300, margin: 2 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="30"><title>QR - ${agentId}</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f9fafb">
      <h2>📱 Escaneie com o WhatsApp de <strong>${agentId}</strong></h2>
      <img src="${qrDataUrl}" style="border:2px solid #e5e7eb;border-radius:12px;margin:16px 0">
      <p style="color:#6b7280;font-size:13px">QR expira em ~60s. Página atualiza a cada 30s.</p>
      </body></html>`);
  } catch (e) {
    res.writeHead(500);
    res.end('Erro ao gerar QR: ' + e.message);
  }
});

server.listen(3001, () => {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Abra no browser: http://localhost:3001           ║');
  console.log(`║  Escaneie o QR com o WhatsApp do ${agentId.padEnd(16)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});

// Monitor de estado
const monitor = setInterval(() => {
  const state = baileys.getState(sessionId);
  process.stdout.write(`\r[${agentId}] Estado: ${state}          `);

  if (state === 'connected') {
    clearInterval(monitor);
    console.log(`\n\n✅ ${agentId} conectado! Sessão salva em:`);
    console.log(`   C:\\tmp\\central-vendas\\baileys_cv_${sessionId}\\\n`);
    console.log('Agora execute no PowerShell:');
    console.log(`  $env:RAILWAY_VOLUME_MOUNT_PATH = "C:\\tmp\\central-vendas"`);
    console.log(`  node scripts/upload-session.js ${agentId} https://central-vendas-production.up.railway.app 1234\n`);
    setTimeout(() => { server.close(); process.exit(0); }, 8000);
  }
}, 2000);

'use strict';

// ============================================================
// CENTRAL VENDAS — Entry Point
// Sistema Operacional de Vendas: Info-Produtos + Logzz + Jarvis
// ============================================================

require('dotenv').config();

const express = require('express');
const { CONFIG } = require('./src/config');
const db = require('./src/database');
const routes = require('./src/routes');
const gestor = require('./src/gestor');

const app = express();

// ----- Middleware -----
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS básico
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ----- Rotas -----
app.use('/', routes);

// ----- Inicialização -----
async function main() {
  // 1. Carregar banco de dados
  await db.loadDB();
  console.log('[MAIN] Banco de dados carregado');

  // 2. Inicializar monitor de erros do Gestor
  gestor.initErrorMonitor();
  console.log('[MAIN] Gestor Jarvis inicializado');

  // 3. Inicializar agentes WhatsApp (em paralelo, sem bloquear startup)
  setTimeout(async () => {
    try {
      console.log('[MAIN] Iniciando agentes WhatsApp...');
      const infoAgent = require('./src/agents/info-produtos');
      const logzzAgent = require('./src/agents/logzz');
      await Promise.allSettled([
        infoAgent.init().catch(e => console.error('[MAIN] Erro ao iniciar agente info:', e.message)),
        logzzAgent.init().catch(e => console.error('[MAIN] Erro ao iniciar agente logzz:', e.message)),
      ]);
      console.log('[MAIN] Agentes iniciados');
    } catch (e) {
      console.error('[MAIN] Erro ao inicializar agentes:', e.message);
    }
  }, 2000);

  // 4. Health check periódico (a cada 5 min)
  setInterval(async () => {
    try {
      const status = await gestor.healthCheck();
      console.log(`[HEALTH] ${status}`);
    } catch {}
  }, 5 * 60 * 1000);

  // 5. Iniciar servidor HTTP
  const port = CONFIG.port;
  app.listen(port, '0.0.0.0', () => {
    console.log(`\n╔═══════════════════════════════════╗`);
    console.log(`║   Central Vendas — v1.0.0         ║`);
    console.log(`║   http://localhost:${port}            ║`);
    console.log(`║   Senha: ${CONFIG.dashboardPassword}                  ║`);
    console.log(`╚═══════════════════════════════════╝\n`);
    gestor.addGestorLog('info', `Sistema iniciado na porta ${port}`);
  });
}

// ----- Graceful Shutdown -----
async function shutdown(signal) {
  console.log(`\n[MAIN] ${signal} recebido. Salvando dados e encerrando...`);
  try {
    await db.saveDB();
    console.log('[MAIN] Dados salvos');
  } catch (e) {
    console.error('[MAIN] Erro ao salvar dados:', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(e => {
  console.error('[MAIN] Erro crítico na inicialização:', e);
  process.exit(1);
});

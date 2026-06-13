'use strict';

// ============================================================
// CENTRAL VENDAS — Entry Point v2.5.1
// Sistema Operacional de Vendas: Info-Produtos + Logzz + Atacadao
// ============================================================

require('dotenv').config();

const express = require('express');
const { CONFIG } = require('./src/config');
const db = require('./src/database');
const dbAtk = require('./src/database-atk');
const routes = require('./src/routes');
const monitor = require('./src/monitor');

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
  // 1. Carregar bancos de dados (CVN + ATK)
  await db.loadDB();
  console.log('[MAIN] Banco CVN carregado');
  await dbAtk.load();
  console.log('[MAIN] Banco ATK carregado — pedro:', dbAtk.state.conversations.pedro.size, 'conversas | rodrigo:', dbAtk.state.conversations.rodrigo.size, 'conversas');

  // 2. Inicializar monitor de erros operacional
  monitor.initErrorMonitor();
  console.log('[MAIN] Monitor operacional inicializado');

  // 3. Inicializar agentes WhatsApp (em paralelo, sem bloquear startup)
  setTimeout(async () => {
    try {
      console.log('[MAIN] Iniciando agentes CVN...');
      const infoAgent    = require('./src/agents/info-produtos');
      const logzzAgent   = require('./src/agents/logzz');
      const rafaelAgent  = require('./src/agents/rafael');
      const sarahAgent   = require('./src/agents/sarah');
      const antonioAgent = require('./src/agents/antonio');
      await Promise.allSettled([
        infoAgent.init().catch(e    => console.error('[MAIN] Erro agente info:', e.message)),
        logzzAgent.init().catch(e   => console.error('[MAIN] Erro agente logzz:', e.message)),
        rafaelAgent.init().catch(e  => console.error('[MAIN] Erro agente rafael:', e.message)),
        sarahAgent.init().catch(e   => console.error('[MAIN] Erro agente sarah:', e.message)),
        antonioAgent.init().catch(e => console.error('[MAIN] Erro agente antonio:', e.message)),
      ]);
      console.log('[MAIN] Agentes CVN iniciados');
    } catch (e) {
      console.error('[MAIN] Erro ao inicializar agentes CVN:', e.message);
    }
  }, 2000);

  // 3b. Inicializar agentes ATK (Pedro e Rodrigo) — 4s depois para não competir com CVN
  setTimeout(async () => {
    try {
      console.log('[MAIN] Iniciando agentes ATK (Pedro + Rodrigo)...');
      const atkInit = require('./src/agents-atk-init');
      await atkInit.init();
      console.log('[MAIN] Agentes ATK iniciados');
    } catch (e) {
      console.error('[MAIN] Erro ao inicializar agentes ATK:', e.message);
    }
  }, 4000);

  // 4. Health check periódico (a cada 5 min)
  setInterval(async () => {
    try {
      const status = await monitor.healthCheck();
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
    db.addSystemLog('info', `Sistema iniciado na porta ${port}`);
  });
}

// ----- Graceful Shutdown -----
async function shutdown(signal) {
  console.log(`\n[MAIN] ${signal} recebido. Salvando dados e encerrando...`);
  try {
    await Promise.allSettled([db.saveDB(), dbAtk.save()]);
    console.log('[MAIN] Dados CVN + ATK salvos');
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

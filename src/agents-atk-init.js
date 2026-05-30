// ============================================================
// AGENTS-ATK-INIT — Inicializa agentes Atacadão na Central
// Pedro (Uni TV V10) + Rodrigo (Furadeira 48V)
// Sessões Baileys independentes, namespace ATK no banco
// ============================================================
'use strict';

const baileys   = require('./baileys');
const dbAtk     = require('./database-atk');
const agentsAtk = require('./agents-atk');

async function init() {
  console.log('[ATK-INIT] Inicializando agentes Atacadão...');

  for (const agentId of ['pedro', 'rodrigo']) {
    const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);

    // Handler de mensagens: recebidas e enviadas
    const handler = (type, data) => {
      try {
        if (type === 'received') {
          // Guardar JID original para suporte a WhatsApp Business LID
          const conv = dbAtk.getConversation(agentId, data.phone);
          if (conv && data._originalJid) conv._originalJid = data._originalJid;
          agentsAtk.handleIncomingMessage(agentId, data);
        } else if (type === 'sent') {
          agentsAtk.handleSentMessage(agentId, data);
        }
      } catch (e) {
        console.error(`[ATK:${agentId}] Handler error:`, e.message);
      }
    };

    try {
      await baileys.connect(agentId, handler);
      console.log(`[ATK-INIT] ✅ ${agentName} inicializado (Baileys)`);
    } catch (e) {
      console.error(`[ATK-INIT] ❌ Erro ao inicializar ${agentName}:`, e.message);
    }
  }

  // Limpar instruções perigosas persistidas (desconto/promo que violam o manual)
  try {
    agentsAtk.cleanExpiredInstructions();
    console.log('[ATK-INIT] ✅ Instruções perigosas removidas no startup');
  } catch (e) {
    console.error('[ATK-INIT] Erro ao limpar instruções:', e.message);
  }

  // Iniciar monitores do Aslam (remarketing automático, sweep diário, relatório, pos-venda)
  setTimeout(() => {
    try {
      const gestorAtk = require('./gestor-atk');
      if (typeof gestorAtk.monitorLeads    === 'function') gestorAtk.monitorLeads();
      if (typeof gestorAtk.dailySweep      === 'function') gestorAtk.dailySweep();
      if (typeof gestorAtk.startRemarketing=== 'function') gestorAtk.startRemarketing();
      if (typeof gestorAtk.startDailyReport=== 'function') gestorAtk.startDailyReport();
      if (typeof gestorAtk.startPostSale   === 'function') gestorAtk.startPostSale();
      console.log('[ATK-INIT] ✅ Monitores Aslam ativados (leads + remarketing + relatório + pós-venda)');
    } catch (e) {
      console.error('[ATK-INIT] Erro ao iniciar monitores:', e.message);
    }
  }, 3000); // 3s depois para não bloquear o startup
}

module.exports = { init };

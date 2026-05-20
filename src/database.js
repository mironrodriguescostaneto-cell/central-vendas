'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');

const DB_PATH = path.join(
  process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp',
  'central_vendas_db.json'
);

// Estado global em memória
const state = {
  // Conversas por agente: agentId → Map(phone → {msgs, ultimaMensagem, pushName, pausado})
  conversations: { info: new Map(), logzz: new Map(), rafael: new Map() },

  // Números pausados por agente
  paused: { info: new Set(), logzz: new Set(), rafael: new Set() },

  // Pedidos Logzz: [{id, phone, nome, produto, status, criadoEm}]
  pedidos: [],

  // Links de oferta Logzz: [{id, titulo, url, descricao, criadoEm}]
  linksOferta: [],

  // Mapa LID→phone (Meta WhatsApp Business LID issue)
  lidPhoneMap: new Map(),
  phoneLidMap: new Map(),

  // Eventos do Gestor: [{ts, tipo, msg, resolvido}]
  gestorLogs: [],

  // Chat com Gestor: [{role, content, ts}]
  gestorChat: [],

  // Sessão do gestor — instruções ativas por agente
  instrucoes: { info: '', logzz: '', rafael: '' },

  // Status de conexão dos agentes
  connectionStatus: { info: 'disconnected', logzz: 'disconnected', rafael: 'disconnected' },
  qrCodes: { info: null, logzz: null, rafael: null },

  // Finanças familiares
  financas: {
    transacoes: [], // [{id, tipo, valor, categoria, descricao, quem, data, mes, ts}]
    metas: { economiasMensal: 0 },
  },
};

// ----- Serialização -----
function serialize() {
  return {
    pedidos: state.pedidos,
    linksOferta: state.linksOferta,
    lidPhoneMap: Array.from(state.lidPhoneMap.entries()),
    phoneLidMap: Array.from(state.phoneLidMap.entries()),
    gestorLogs: state.gestorLogs.slice(-200),
    instrucoes: state.instrucoes,
    financas: state.financas,
    conversations: {
      info: Array.from(state.conversations.info.entries()).map(([k, v]) => [k, { ...v, msgs: v.msgs?.slice(-50) }]),
      logzz: Array.from(state.conversations.logzz.entries()).map(([k, v]) => [k, { ...v, msgs: v.msgs?.slice(-50) }]),
      rafael: Array.from(state.conversations.rafael.entries()).map(([k, v]) => [k, { ...v, msgs: v.msgs?.slice(-50) }]),
    },
    paused: {
      info: Array.from(state.paused.info),
      logzz: Array.from(state.paused.logzz),
      rafael: Array.from(state.paused.rafael),
    },
  };
}

function deserialize(data) {
  if (!data) return;
  if (data.pedidos) state.pedidos = data.pedidos;
  if (data.linksOferta) state.linksOferta = data.linksOferta;
  if (data.lidPhoneMap) state.lidPhoneMap = new Map(data.lidPhoneMap);
  if (data.phoneLidMap) state.phoneLidMap = new Map(data.phoneLidMap);
  if (data.gestorLogs) state.gestorLogs = data.gestorLogs;
  if (data.instrucoes) state.instrucoes = data.instrucoes;
  if (data.financas) {
    if (data.financas.transacoes) state.financas.transacoes = data.financas.transacoes;
    if (data.financas.metas) state.financas.metas = data.financas.metas;
  }
  if (data.conversations) {
    if (data.conversations.info) state.conversations.info = new Map(data.conversations.info);
    if (data.conversations.logzz) state.conversations.logzz = new Map(data.conversations.logzz);
    if (data.conversations.rafael) state.conversations.rafael = new Map(data.conversations.rafael);
  }
  if (data.paused) {
    if (data.paused.info) state.paused.info = new Set(data.paused.info);
    if (data.paused.logzz) state.paused.logzz = new Set(data.paused.logzz);
    if (data.paused.rafael) state.paused.rafael = new Set(data.paused.rafael);
  }
}

// ----- Redis -----
let redis = null;
async function initRedis() {
  if (!CONFIG.redisUrl) return false;
  try {
    const IORedis = require('ioredis');
    redis = new IORedis(CONFIG.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    console.log('[DB] Redis conectado');
    return true;
  } catch (e) {
    console.warn('[DB] Redis indisponível, usando JSON local:', e.message);
    redis = null;
    return false;
  }
}

async function saveDB() {
  const data = JSON.stringify(serialize());
  if (redis) {
    try { await redis.set('central_vendas:state', data); return; } catch (e) {
      console.error('[DB] Redis save falhou, tentando filesystem:', e.message);
    }
  }
  try {
    fs.writeFileSync(DB_PATH, data, 'utf8');
  } catch (e) {
    console.error('[DB] Falha total ao salvar dados:', e.message);
    try {
      const { sendTelegram } = require('./gestor');
      sendTelegram(`🚨 *DB Save Falhou*\nRedis e filesystem inacessíveis.\nErro: ${e.message}`).catch(() => {});
    } catch {}
  }
}

async function loadDB() {
  await initRedis();
  let raw = null;
  if (redis) {
    try { raw = await redis.get('central_vendas:state'); } catch {}
  }
  if (!raw && fs.existsSync(DB_PATH)) {
    try { raw = fs.readFileSync(DB_PATH, 'utf8'); } catch {}
  }
  if (raw) {
    try { deserialize(JSON.parse(raw)); console.log('[DB] Dados carregados'); } catch (e) {
      console.warn('[DB] Erro ao deserializar:', e.message);
    }
  }
}

// Auto-save a cada 30s
setInterval(saveDB, 30000);

// ----- API de conversas -----
function getConv(agentId, phone) {
  const conv = state.conversations[agentId]?.get(phone);
  return conv || { msgs: [], ultimaMensagem: null, pushName: '', pausado: false };
}

function addMsg(agentId, phone, role, text, pushName = '') {
  if (!state.conversations[agentId]) return;
  if (!state.conversations[agentId].has(phone)) {
    state.conversations[agentId].set(phone, { msgs: [], ultimaMensagem: null, pushName });
  }
  const conv = state.conversations[agentId].get(phone);
  if (pushName && !conv.pushName) conv.pushName = pushName;
  conv.msgs.push({ role, text, ts: Date.now() });
  if (conv.msgs.length > 100) conv.msgs = conv.msgs.slice(-100);
  conv.ultimaMensagem = Date.now();
}

function getAllConvs(agentId) {
  const map = state.conversations[agentId];
  if (!map) return [];
  return Array.from(map.entries()).map(([phone, data]) => ({
    phone,
    pushName: data.pushName || phone,
    ultimaMensagem: data.ultimaMensagem,
    totalMsgs: data.msgs?.length || 0,
    pausado: state.paused[agentId]?.has(phone) || false,
    ultimoTexto: data.msgs?.at(-1)?.text?.slice(0, 80) || '',
  })).sort((a, b) => (b.ultimaMensagem || 0) - (a.ultimaMensagem || 0));
}

// ----- Pause/Resume -----
function isPaused(agentId, phone) {
  return state.paused[agentId]?.has(phone) || false;
}

function pausePhone(agentId, phone) {
  state.paused[agentId]?.add(phone);
}

function resumePhone(agentId, phone) {
  state.paused[agentId]?.delete(phone);
}

function clearPauses(agentId) {
  if (state.paused[agentId]) state.paused[agentId].clear();
}

// ----- LID Mapping -----
function isLidFormat(jid) {
  return jid && jid.endsWith('@lid');
}

function mapLidToPhone(lid) {
  return state.lidPhoneMap.get(lid) || null;
}

function registerLid(lid, phone) {
  if (!lid || !phone) return;
  state.lidPhoneMap.set(lid, phone);
  state.phoneLidMap.set(phone, lid);
}

// ----- Pedidos Logzz -----
function addPedido(pedido) {
  const id = `PED-${Date.now()}`;
  const novo = { id, ...pedido, status: 'pendente', criadoEm: Date.now() };
  state.pedidos.unshift(novo);
  return novo;
}

function updatePedidoStatus(id, status) {
  const p = state.pedidos.find(x => x.id === id);
  if (p) p.status = status;
  return p;
}

function getPedidos() { return state.pedidos; }

// ----- Links de Oferta -----
function addLinkOferta(link) {
  const id = `LINK-${Date.now()}`;
  const novo = { id, ...link, criadoEm: Date.now() };
  state.linksOferta.push(novo);
  return novo;
}

function removeLinkOferta(id) {
  const idx = state.linksOferta.findIndex(x => x.id === id);
  if (idx >= 0) state.linksOferta.splice(idx, 1);
}

function getLinksOferta() { return state.linksOferta; }

// ----- Gestor Logs -----
function addGestorLog(tipo, msg, resolvido = false) {
  const entry = { ts: Date.now(), tipo, msg, resolvido };
  state.gestorLogs.unshift(entry);
  if (state.gestorLogs.length > 500) state.gestorLogs.pop();
  return entry;
}

function getGestorLogs(limit = 50) { return state.gestorLogs.slice(0, limit); }

// ----- Gestor Chat -----
function addGestorChat(role, content) {
  state.gestorChat.push({ role, content, ts: Date.now() });
  if (state.gestorChat.length > 200) state.gestorChat = state.gestorChat.slice(-200);
}

function getGestorChat(limit = 50) { return state.gestorChat.slice(-limit); }

// ----- Instruções por agente -----
function setInstrucao(agentId, texto) {
  state.instrucoes[agentId] = texto;
  saveDB().catch(() => {});
}
function getInstrucao(agentId) { return state.instrucoes[agentId] || ''; }

// ----- Status de conexão -----
function setConnectionStatus(agentId, status) { state.connectionStatus[agentId] = status; }
function getConnectionStatus(agentId) { return state.connectionStatus[agentId] || 'disconnected'; }
function setQrCode(agentId, qr) { state.qrCodes[agentId] = qr; }
function getQrCode(agentId) { return state.qrCodes[agentId]; }

module.exports = {
  state,
  loadDB,
  saveDB,
  getConv,
  addMsg,
  getAllConvs,
  isPaused,
  pausePhone,
  resumePhone,
  clearPauses,
  isLidFormat,
  mapLidToPhone,
  registerLid,
  addPedido,
  updatePedidoStatus,
  getPedidos,
  addLinkOferta,
  removeLinkOferta,
  getLinksOferta,
  addGestorLog,
  getGestorLogs,
  addGestorChat,
  getGestorChat,
  setInstrucao,
  getInstrucao,
  setConnectionStatus,
  getConnectionStatus,
  setQrCode,
  getQrCode,
};

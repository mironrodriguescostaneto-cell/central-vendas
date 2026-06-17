// ============================================================
// DATABASE-ATK — Estado isolado do Atacadão na Central Vendas
// Redis key: atacadao:db (mesmo key do sistema original)
// Todos os dados existentes são preservados automaticamente.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

// Env vars diretas (ATK não usa CONFIG da Central)
const PEDRO_NUMERO   = (process.env.PEDRO_NUMERO   || '').replace(/\D/g, '');
const RODRIGO_NUMERO = (process.env.RODRIGO_NUMERO || '').replace(/\D/g, '');
const SEU_WHATSAPP   = process.env.SEU_WHATSAPP || '5562991819645';

const BASE_DIR   = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp';
const DB_FILE    = path.join(BASE_DIR, 'atacadao_db.json');
const BACKUP_FILE= path.join(BASE_DIR, 'atacadao_db.backup.json');
const REDIS_KEY  = 'atacadao:db';

// --- Redis ATK (usa ATK_REDIS_URL se definido, senão REDIS_URL da Central) ---
let redis = null;
const REDIS_URL = process.env.ATK_REDIS_URL || process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || process.env.REDIS_PUBLIC_URL;

if (REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (t) => Math.min(t * 200, 5000),
      lazyConnect: false,
    });
    redis.on('connect', () => console.log('[ATK-DB] Redis conectado'));
    redis.on('error', (e) => console.error('[ATK-DB] Redis error:', e.message));
  } catch (e) {
    console.error('[ATK-DB] Redis init error:', e.message);
    redis = null;
  }
}

// --- Estado global ATK ---
const state = {
  conversations: { pedro: new Map(), rodrigo: new Map() },
  paused:        { pedro: new Set(), rodrigo: new Set() },
  pausedManual:  { pedro: new Set(), rodrigo: new Set() },
  pausedManualAt:{ pedro: {}, rodrigo: {} },
  metrics: {
    pedro:   { atendimentos: 0, vendas: 0 },
    rodrigo: { atendimentos: 0, vendas: 0 },
    lara:    { pedidos: 0 },
  },
  events:       [],
  activities:   [],
  aslamChat:    [],
  knowledge:    { pedro: [], rodrigo: [] },
  instructions: { pedro: [], rodrigo: [] },
  meetingRoom:  [],
  contactRegistry: {},
  lastRemarketing: {},
  salesLog: [],
  products: [
    { id: 'unitv',     nome: 'Uni TV V10',    precoCusto: 250, precoVenda: 360, lucro: 110, ativo: true },
    { id: 'furadeira', nome: 'Furadeira 48V',  precoCusto: 110, precoVenda: 160, lucro:  50, ativo: true },
  ],
  agentCatalog: {
    pedro:   { precoVenda: 360, piso: 340, product: 'Uni TV V10 / Uni TV S10' },
    rodrigo: { precoVenda: 160, piso: 140, product: 'Furadeira 48V' },
  },
  sales: [],
  caixas: [],
  clientActivity: {},
  postSaleFollowups: {},
  pedidos: [],
  archivedConversations: [],
  lidPhoneMap: {},
  activeOffers: {},
  remarketingPausado: { pedro: false, rodrigo: false },
  visualCampaigns: {},
  remarketingCampaigns: {},
  pendingOwnerMedia: null,
  // Transient
  followupTimers: new Map(),
  schedules: new Map(),
  botSending: { pedro: new Map(), rodrigo: new Map() }, // numero -> expiry timestamp
  lastResponse: new Map(),
  debounceTimers: new Map(),
  processingLock: new Map(),
  awaitingDate: new Set(),
};

// --- LID helpers ---
function isLidFormat(numero) {
  if (!numero || typeof numero !== 'string') return false;
  if (!/^\d{10,}$/.test(numero)) return false;
  if (/^55\d{10,11}$/.test(numero)) return false;
  return true;
}

function mapLidToPhone(lid, phone) {
  if (!lid || !phone || lid === phone) return;
  if (!isLidFormat(lid)) return;
  state.lidPhoneMap[lid] = phone;
  state.lidPhoneMap[`phone_${phone}`] = lid;
  for (const agentId of ['pedro','rodrigo']) {
    const map = state.conversations[agentId];
    if (map.has(lid) && !map.has(phone)) {
      map.set(phone, map.get(lid));
      map.delete(lid);
    }
  }
  for (const agentId of ['pedro','rodrigo']) {
    if (state.paused[agentId]?.has(lid))       { state.paused[agentId].add(phone);       state.paused[agentId].delete(lid); }
    if (state.pausedManual[agentId]?.has(lid)) {
      state.pausedManual[agentId].add(phone);
      state.pausedManual[agentId].delete(lid);
      if (state.pausedManualAt[agentId]?.[lid]) {
        state.pausedManualAt[agentId][phone] = state.pausedManualAt[agentId][lid];
        delete state.pausedManualAt[agentId][lid];
      }
    }
  }
}

function resolvePhone(numero) { return state.lidPhoneMap[numero] || null; }
function resolveLid(phone)    { return state.lidPhoneMap[`phone_${phone}`] || null; }

function _migrateExistingLidConversations() {
  for (const agentId of ['pedro','rodrigo']) {
    const map = state.conversations[agentId];
    for (const [key, conv] of [...map]) {
      if (!isLidFormat(key)) continue;
      const phone = state.lidPhoneMap[key];
      if (phone && !map.has(phone)) { map.set(phone, conv); map.delete(key); }
    }
    for (const s of [state.paused[agentId], state.pausedManual[agentId]]) {
      if (!s) continue;
      for (const n of [...s]) {
        if (!isLidFormat(n)) continue;
        const phone = state.lidPhoneMap[n];
        if (phone) {
          s.add(phone);
          s.delete(n);
          if (s === state.pausedManual[agentId] && state.pausedManualAt[agentId]?.[n]) {
            state.pausedManualAt[agentId][phone] = state.pausedManualAt[agentId][n];
            delete state.pausedManualAt[agentId][n];
          }
        }
      }
    }
  }
}

// --- Conversation helpers ---
function getConversation(agentId, numero) {
  const map = state.conversations[agentId];
  if (!map) return null;
  if (map.has(numero)) {
    const conv = map.get(numero);
    if (conv.msgs && conv.msgs.length > 150) conv.msgs = conv.msgs.slice(-80);
    return conv;
  }
  const alt = resolveLid(numero) || resolvePhone(numero);
  if (alt && map.has(alt)) {
    const conv = map.get(alt);
    if (conv.msgs && conv.msgs.length > 150) conv.msgs = conv.msgs.slice(-80);
    return conv;
  }
  if (isLidFormat(numero)) {
    map.set(numero, { msgs: [], ultimaMensagem: Date.now(), isTempId: true });
    return map.get(numero);
  }
  const last8 = numero.slice(-8);
  for (const [key, conv] of map) {
    if (isLidFormat(key)) continue;
    if (key.slice(-8) === last8) {
      map.set(numero, conv);
      map.delete(key);
      if (conv.msgs && conv.msgs.length > 150) conv.msgs = conv.msgs.slice(-80);
      return conv;
    }
  }
  map.set(numero, { msgs: [], ultimaMensagem: Date.now() });
  return map.get(numero);
}

function setPushName(agentId, numero, name) {
  if (!name || !numero) return;
  const map = state.conversations[agentId];
  if (!map) return;
  const conv = map.get(numero);
  if (conv && !conv.pushName) conv.pushName = name;
}

function getPushName(agentId, numero) {
  const map = state.conversations[agentId];
  if (!map) return null;
  return map.get(numero)?.pushName || null;
}

// --- Pause helpers ---
function matchesNumber(set, numero) {
  if (set.has(numero)) return true;
  const alt = resolveLid(numero) || resolvePhone(numero);
  if (alt && set.has(alt)) return true;
  if (isLidFormat(numero)) return false;
  const last8 = numero.slice(-8);
  for (const n of set) {
    if (isLidFormat(n)) continue;
    if (n.slice(-8) === last8) return true;
  }
  return false;
}

function findMatchedNumber(set, numero) {
  if (set.has(numero)) return numero;
  const alt = resolveLid(numero) || resolvePhone(numero);
  if (alt && set.has(alt)) return alt;
  if (isLidFormat(numero)) return null;
  const last8 = numero.slice(-8);
  for (const n of set) {
    if (isLidFormat(n)) continue;
    if (n.slice(-8) === last8) return n;
  }
  return null;
}

function isPaused(agentId, numero) {
  if (agentId && state.paused[agentId] && matchesNumber(state.paused[agentId], numero)) return true;
  return Object.values(state.pausedManual).some((s) => matchesNumber(s, numero));
}

function isManuallyPaused(numero) {
  return Object.values(state.pausedManual).some((s) => matchesNumber(s, numero));
}

function getManualPausedAt(numero, agentId = null) {
  const ids = agentId ? [agentId] : ['pedro','rodrigo'];
  let best = 0;
  for (const id of ids) {
    const matched = findMatchedNumber(state.pausedManual[id], numero);
    const pausedAt = matched ? Number(state.pausedManualAt[id]?.[matched] || 0) : 0;
    if (pausedAt > best) best = pausedAt;
  }
  return best;
}

function pauseManual(numero, agentId) {
  const pausedAt = Date.now();
  const isLidNumero = isLidFormat(numero);
  if (agentId) {
    state.paused[agentId]?.add(numero);
    state.pausedManual[agentId]?.add(numero);
    if (state.pausedManualAt[agentId]) state.pausedManualAt[agentId][numero] = pausedAt;
  } else {
    for (const id of ['pedro','rodrigo']) {
      state.paused[id].add(numero);
      state.pausedManual[id].add(numero);
      state.pausedManualAt[id][numero] = pausedAt;
    }
  }
  const last8 = numero.slice(-8);
  for (const id of ['pedro','rodrigo']) {
    const toCancel = [];
    state.followupTimers.forEach((timers, key) => {
      if (key === `${id}_${numero}` || (!isLidNumero && key.slice(-8) === last8)) {
        if (Array.isArray(timers)) timers.forEach(clearTimeout);
        else if (typeof timers === 'number') clearTimeout(timers);
        toCancel.push(key);
      }
    });
    toCancel.forEach(k => state.followupTimers.delete(k));
  }
}

function resumeManual(numero) {
  const last8 = numero.slice(-8);
  for (const id of ['pedro','rodrigo']) {
    state.paused[id].delete(numero);
    state.pausedManual[id].delete(numero);
    delete state.pausedManualAt[id][numero];
    for (const n of [...state.paused[id]]) {
      if (!isLidFormat(numero) && !isLidFormat(n) && n.slice(-8) === last8) state.paused[id].delete(n);
    }
    for (const n of [...state.pausedManual[id]]) {
      if (!isLidFormat(numero) && !isLidFormat(n) && n.slice(-8) === last8) {
        state.pausedManual[id].delete(n);
        delete state.pausedManualAt[id][n];
      }
    }
    const conv = state.conversations[id]?.get(numero);
    if (conv) { conv.finalizado = false; conv.avisouFinalizacao = false; }
  }
}

function resumeManualAll(agentId = null) {
  const targets = agentId ? [agentId] : ['pedro','rodrigo'];
  let count = 0;
  for (const id of targets) {
    if (!state.paused[id]) continue;
    count += state.paused[id].size;
    state.paused[id].clear();
    state.pausedManual[id].clear();
    state.pausedManualAt[id] = {};
    state.conversations[id]?.forEach((conv) => {
      if (conv) { conv.finalizado = false; conv.avisouFinalizacao = false; }
    });
  }
  return count;
}

function pauseAuto(numero, agentId) {
  if (isManuallyPaused(numero)) return;
  state.paused[agentId]?.add(numero);
}

function resumeAuto(numero) {
  if (isManuallyPaused(numero)) return;
  for (const id of ['pedro','rodrigo']) state.paused[id].delete(numero);
}

function pauseRemarketing(agentId) {
  if (agentId === 'todos') { state.remarketingPausado.pedro = true; state.remarketingPausado.rodrigo = true; }
  else if (state.remarketingPausado.hasOwnProperty(agentId)) state.remarketingPausado[agentId] = true;
}

function resumeRemarketing(agentId) {
  if (agentId === 'todos') { state.remarketingPausado.pedro = false; state.remarketingPausado.rodrigo = false; }
  else if (state.remarketingPausado.hasOwnProperty(agentId)) state.remarketingPausado[agentId] = false;
}

function isRemarketingPausado(agentId) { return !!(state.remarketingPausado?.[agentId]); }

function isAgentNumber(numero) {
  const tel = numero.replace(/\D/g, '');
  if (!tel || tel.length < 8) return false;
  if (isLidFormat(tel)) return false;
  return [PEDRO_NUMERO, RODRIGO_NUMERO]
    .filter(n => n.length >= 8)
    .some(n => tel.endsWith(n.slice(-8)) || n.endsWith(tel.slice(-8)));
}

// --- Events / Activities ---
function addEvent(text) {
  state.events.push({ text, timestamp: Date.now() });
  if (state.events.length > 200) state.events = state.events.slice(-200);
}

function addActivity(text) {
  state.activities.push({ text, timestamp: Date.now() });
  if (state.activities.length > 200) state.activities = state.activities.slice(-200);
}

// --- Contact registry ---
function getBrasiliaDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function registerContact(numero, agentId) {
  const hoje = getBrasiliaDate();
  if (!state.contactRegistry[hoje]) state.contactRegistry[hoje] = [];
  const exists = state.contactRegistry[hoje].some(c => c.numero === numero && c.agente === agentId);
  if (!exists) state.contactRegistry[hoje].push({ numero, agente: agentId, timestamp: Date.now() });
  const keys = Object.keys(state.contactRegistry);
  if (keys.length > 90) {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const key of keys) {
      if (new Date(key + 'T12:00:00-03:00').getTime() < cutoff) delete state.contactRegistry[key];
    }
  }
}

function getContactsByDate(dateStr) {
  const hoje = getBrasiliaDate();
  if (dateStr === 'hoje') return state.contactRegistry[hoje] || [];
  if (dateStr === 'ontem') {
    const d = new Date(hoje + 'T12:00:00-03:00');
    d.setDate(d.getDate() - 1);
    return state.contactRegistry[d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })] || [];
  }
  return state.contactRegistry[dateStr] || [];
}

function getContatosHoje() {
  const hoje = getBrasiliaDate();
  const result = { pedro: 0, rodrigo: 0, total: 0 };
  const reg = state.contactRegistry[hoje] || [];
  for (const c of reg) { if (result[c.agente] !== undefined) result[c.agente]++; result.total++; }
  return result;
}

// --- Sales helpers ---
function hasSaleForNumber(numero) {
  if (!numero) return false;
  const last8 = numero.slice(-8);
  if (state.sales.some(s => s.numero && s.status === 'confirmada' && (s.numero === numero || s.numero.slice(-8) === last8))) return true;
  if (state.salesLog.some(s => s.numero && (s.numero === numero || s.numero.slice(-8) === last8))) return true;
  return state.events.some(e => {
    const t = e.text || '';
    return t.includes(numero) && ['venda_','pedido_entrega:','transferir_humano:'].some(p => t.includes(p));
  });
}

function findAgentForNumber(numero) {
  for (const id of ['pedro','rodrigo']) { if (state.conversations[id].has(numero)) return id; }
  const alt = resolveLid(numero) || resolvePhone(numero);
  if (alt) { for (const id of ['pedro','rodrigo']) { if (state.conversations[id].has(alt)) return id; } }
  if (isLidFormat(numero)) return null;
  const last8 = numero.slice(-8);
  for (const id of ['pedro','rodrigo']) {
    for (const key of state.conversations[id].keys()) {
      if (isLidFormat(key)) continue;
      if (key.slice(-8) === last8) return id;
    }
  }
  return null;
}

const LUCRO_POR_PRODUTO = { 'Uni TV V10': 110, 'Furadeira 48V': 50 };

function logSale(agentId, numero, produto, valor, tipo) {
  const lucro = LUCRO_POR_PRODUTO[produto] || 0;
  state.salesLog.push({ agentId, numero, produto, valor, lucro, tipo, timestamp: Date.now() });
  if (state.salesLog.length > 500) state.salesLog = state.salesLog.slice(-500);
  const product = state.products.find(p => produto.toLowerCase().includes(p.nome.toLowerCase().split(' ')[0].toLowerCase()));
  addSale({ productId: product?.id || null, productName: produto, agentId, numero, cliente: '', valor: valor || 0, desconto: 0, tipo: tipo || 'entrega', status: 'confirmada', observacao: 'Auto-registrada via agente' });
  const caixaAberto = getCaixaAberto();
  if (caixaAberto) addMovimentoCaixa('venda', valor, `${produto} - ${agentId} - ${numero}`);
}

// --- Agent catalog ---
function getAgentPrice(agentId)       { return state.agentCatalog?.[agentId]?.precoVenda ?? 0; }
function getAgentPiso(agentId)        { return state.agentCatalog?.[agentId]?.piso ?? 0; }
function getAgentProductName(agentId) { return state.agentCatalog?.[agentId]?.product ?? agentId; }

function updateAgentPrice(agentId, newPrice, newPiso) {
  if (!state.agentCatalog[agentId]) return false;
  state.agentCatalog[agentId].precoVenda = newPrice;
  if (newPiso !== undefined && newPiso !== null) state.agentCatalog[agentId].piso = newPiso;
  const prodMap = { pedro: 'unitv', rodrigo: 'furadeira' };
  const p = state.products.find(x => x.id === prodMap[agentId]);
  if (p) { p.precoVenda = newPrice; p.lucro = newPrice - p.precoCusto; }
  addEvent(`preco_atualizado: ${agentId} R$${newPrice}`);
  save();
  return true;
}

// --- Smart timing ---
function getBestHourForClient(numero) {
  const hours = state.clientActivity[numero];
  if (!hours || hours.length === 0) return 10;
  const counts = {};
  for (const h of hours) counts[h] = (counts[h] || 0) + 1;
  let bestHour = 10, bestCount = 0;
  for (const [hour, count] of Object.entries(counts)) {
    if (count > bestCount) { bestCount = count; bestHour = parseInt(hour); }
  }
  return bestHour;
}

// --- Lead scoring ---
function scoreClient(agentId, numero) {
  const conv = state.conversations[agentId]?.get(numero);
  const msgs = conv?.msgs || [];
  if (msgs.length === 0) return { score: 0, temperatura: 'frio', fatores: [] };
  let score = 0; const fatores = [];
  const clientMsgs = msgs.filter(m => m.role === 'user').map(m => (m.content || m.text || '').toLowerCase());
  const allText = clientMsgs.join(' ');
  if (clientMsgs.length > 0) { score += 10; fatores.push('+10: Mostrou interesse'); }
  if (/preco|valor|quanto|custa/.test(allText)) { score += 15; fatores.push('+15: Perguntou preço'); }
  if (/entrega|frete|retirar|envio/.test(allText)) { score += 20; fatores.push('+20: Interesse em entrega'); }
  if (/pix|cartao|parcela|pagar/.test(allText)) { score += 25; fatores.push('+25: Perguntou pagamento'); }
  if (clientMsgs.length > 4) { score += 10; fatores.push('+10: Múltiplas mensagens'); }
  if (/vou pensar|depois|agora n/.test(allText)) { score -= 10; fatores.push('-10: Vai pensar'); }
  const lastMsgTime = conv.ultimaMensagem || 0;
  if (lastMsgTime && (Date.now() - lastMsgTime) > 2 * 24 * 60 * 60 * 1000) { score -= 20; fatores.push('-20: Inativo 2+ dias'); }
  if (lastMsgTime && (Date.now() - lastMsgTime) > 7 * 24 * 60 * 60 * 1000) { score -= 30; fatores.push('-30: Inativo 7+ dias'); }
  score = Math.max(0, Math.min(100, score));
  const temperatura = score <= 25 ? 'frio' : score <= 50 ? 'morno' : score <= 75 ? 'quente' : 'muito_quente';
  return { score, temperatura, fatores };
}

function getCustomerList() {
  const customers = [];
  for (const agentId of ['pedro','rodrigo']) {
    state.conversations[agentId].forEach((conv, numero) => {
      if (!conv.msgs || conv.msgs.length === 0) return;
      const lastMsg = conv.msgs[conv.msgs.length - 1];
      const hasSale = hasSaleForNumber(numero);
      const isPausedNow = isPaused(agentId, numero);
      let status = hasSale ? 'comprou' : conv.msgs.length > 4 ? 'negociando' : 'lead';
      const lastMsgTime = conv.ultimaMensagem || lastMsg.timestamp || 0;
      if (!hasSale && Date.now() - lastMsgTime > 7 * 24 * 60 * 60 * 1000) status = 'perdido';
      const scoreData = scoreClient(agentId, numero);
      customers.push({ numero, agente: agentId, status, ultimaMensagem: lastMsg.content || lastMsg.text || '', ultimaMensagemTimestamp: conv.ultimaMensagem || 0, totalMsgs: conv.msgs.length, pausado: isPausedNow, score: scoreData.score, temperatura: scoreData.temperatura });
    });
  }
  customers.sort((a, b) => b.score - a.score || b.ultimaMensagemTimestamp - a.ultimaMensagemTimestamp);
  return customers;
}

function getSalesStats() {
  const brasiliaDateStr = getBrasiliaDate();
  const inicioHoje = new Date(brasiliaDateStr + 'T00:00:00-03:00').getTime();
  const brasiliaDate = new Date(brasiliaDateStr + 'T12:00:00-03:00');
  const dayOfWeek = brasiliaDate.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(brasiliaDate);
  mondayDate.setDate(mondayDate.getDate() - mondayOffset);
  const inicioSemana = new Date(mondayDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').getTime();
  const inicioMes = new Date(brasiliaDateStr.substring(0, 7) + '-01T00:00:00-03:00').getTime();
  const stats = { hoje: { total: 0, valor: 0, lucro: 0 }, semana: { total: 0, valor: 0, lucro: 0 }, mes: { total: 0, valor: 0, lucro: 0 }, porAgente: {} };
  for (const sale of state.sales) {
    if (sale.status !== 'confirmada') continue;
    const ts = sale.createdAt || 0, val = sale.valorFinal || sale.valor || 0, lucro = sale.lucro || 0, agent = sale.agentId || 'manual';
    if (!stats.porAgente[agent]) stats.porAgente[agent] = { total: 0, valor: 0, lucro: 0 };
    stats.porAgente[agent].total++; stats.porAgente[agent].valor += val; stats.porAgente[agent].lucro += lucro;
    if (ts >= inicioMes) { stats.mes.total++; stats.mes.valor += val; stats.mes.lucro += lucro; }
    if (ts >= inicioSemana) { stats.semana.total++; stats.semana.valor += val; stats.semana.lucro += lucro; }
    if (ts >= inicioHoje) { stats.hoje.total++; stats.hoje.valor += val; stats.hoje.lucro += lucro; }
  }
  return stats;
}

// --- Enhanced sales ---
function _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function addSale(sale) {
  const product = sale.productId ? state.products.find(p => p.id === sale.productId) : null;
  const valor = Number(sale.valor) || 0, desconto = Number(sale.desconto) || 0;
  const qtd = Number(sale.quantidade) || 1;
  const valorFinal = valor - desconto, custo = (product?.precoCusto || 0) * qtd, lucro = valorFinal - custo;
  const newSale = { id: _genId(), productId: sale.productId || null, productName: sale.productName || (product?.nome) || 'Produto', agentId: sale.agentId || 'manual', numero: sale.numero || '', cliente: sale.cliente || '', valor, desconto, valorFinal, custo, lucro, tipo: sale.tipo || 'entrega', pagamento: sale.pagamento || 'PIX', status: sale.status || 'confirmada', observacao: sale.observacao || '', createdAt: Date.now(), updatedAt: Date.now() };
  state.sales.push(newSale);
  if (state.sales.length > 2000) state.sales = state.sales.slice(-2000);
  if (newSale.numero && !state.salesLog.some(s => s.numero === newSale.numero && s.agentId === newSale.agentId && Math.abs((s.timestamp || 0) - newSale.createdAt) < 5000)) {
    state.salesLog.push({ agentId: newSale.agentId, numero: newSale.numero, produto: newSale.productName, valor: newSale.valorFinal, lucro: newSale.lucro, tipo: newSale.tipo, timestamp: newSale.createdAt });
    if (state.salesLog.length > 500) state.salesLog = state.salesLog.slice(-500);
  }
  if (newSale.numero) {
    const hasEvent = state.events.some(e => (e.text || '').includes(newSale.numero) && (e.text || '').includes('venda_'));
    if (!hasEvent) addEvent(`venda_${newSale.agentId}: ${newSale.numero} - ${newSale.productName} R$${newSale.valorFinal}`);
  }
  const caixaAberto = getCaixaAberto();
  if (caixaAberto && newSale.status === 'confirmada') addMovimentoCaixa('venda', newSale.valorFinal, `${newSale.productName} - ${newSale.agentId}`);
  save();
  return newSale;
}

function updateSale(id, updates) {
  const sale = state.sales.find(s => s.id === id);
  if (!sale) return null;
  Object.assign(sale, updates);
  sale.valorFinal = sale.valor - sale.desconto;
  sale.lucro = sale.valorFinal - sale.custo;
  sale.updatedAt = Date.now();
  save();
  return sale;
}

function cancelSale(id, motivo) {
  const sale = state.sales.find(s => s.id === id);
  if (!sale) return null;
  sale.status = 'cancelada';
  if (motivo) sale.observacao = (sale.observacao ? sale.observacao + ' | ' : '') + 'Cancelada: ' + motivo;
  sale.updatedAt = Date.now();
  save();
  return sale;
}

function deleteSale(id) {
  const idx = state.sales.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const removed = state.sales.splice(idx, 1)[0];
  save();
  return removed;
}

function getSale(id) { return state.sales.find(s => s.id === id) || null; }

function getSales(filters = {}) {
  let filtered = [...state.sales];
  if (filters.status)  filtered = filtered.filter(s => s.status === filters.status);
  if (filters.agentId) filtered = filtered.filter(s => s.agentId === filters.agentId);
  if (filters.tsInicio !== undefined) {
    const fim = filters.tsFim !== undefined ? filters.tsFim : Date.now();
    filtered = filtered.filter(s => s.createdAt >= filters.tsInicio && s.createdAt <= fim);
  } else if (filters.periodo) {
    const brasiliaDateStr = getBrasiliaDate();
    let inicio;
    const now = Date.now();
    if (filters.periodo === 'hoje')   inicio = new Date(brasiliaDateStr + 'T00:00:00-03:00').getTime();
    else if (filters.periodo === 'mes') inicio = new Date(brasiliaDateStr.substring(0, 7) + '-01T00:00:00-03:00').getTime();
    if (inicio) filtered = filtered.filter(s => s.createdAt >= inicio && s.createdAt <= now);
  }
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  return filtered;
}

function getSalesReport(periodo, opts = {}) {
  const baseFilter = opts.tsInicio !== undefined ? { tsInicio: opts.tsInicio, tsFim: opts.tsFim } : { periodo };
  const confirmed = getSales({ ...baseFilter, status: 'confirmada' });
  const all = getSales(baseFilter);
  const totalVendas = confirmed.length;
  const totalValor = confirmed.reduce((s, x) => s + (x.valorFinal || 0), 0);
  const totalCusto = confirmed.reduce((s, x) => s + (x.custo || 0), 0);
  const totalLucro = confirmed.reduce((s, x) => s + (x.lucro || 0), 0);
  const margem = totalValor > 0 ? Math.round((totalLucro / totalValor) * 100) : 0;
  const porProduto = {}, porAgente = {};
  for (const sale of confirmed) {
    const key = sale.productName || 'Outros';
    if (!porProduto[key]) porProduto[key] = { nome: key, qtd: 0, faturamento: 0, lucro: 0 };
    porProduto[key].qtd++; porProduto[key].faturamento += sale.valorFinal || 0; porProduto[key].lucro += sale.lucro || 0;
    const akey = sale.agentId || 'manual';
    if (!porAgente[akey]) porAgente[akey] = { nome: akey, qtd: 0, faturamento: 0 };
    porAgente[akey].qtd++; porAgente[akey].faturamento += sale.valorFinal || 0;
  }
  return { periodo, totalVendas, totalValor, totalCusto, totalLucro, margem, totalCanceladas: all.filter(s => s.status === 'cancelada').length, totalPendentes: all.filter(s => s.status === 'pendente').length, porProduto: Object.values(porProduto), porAgente: Object.values(porAgente) };
}

// --- Products ---
function addProduct(product) {
  const id = product.id || product.nome.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
  const newProduct = { id, nome: product.nome, precoCusto: Number(product.precoCusto) || 0, precoVenda: Number(product.precoVenda) || 0, lucro: Number(product.precoVenda) - Number(product.precoCusto), ativo: true };
  state.products.push(newProduct);
  save();
  return newProduct;
}

function updateProduct(id, updates) {
  const product = state.products.find(p => p.id === id);
  if (!product) return null;
  Object.assign(product, updates);
  product.lucro = product.precoVenda - product.precoCusto;
  save();
  return product;
}

function deleteProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return null;
  product.ativo = false;
  save();
  return product;
}

function getProducts()    { return state.products.filter(p => p.ativo); }
function getAllProducts()  { return state.products; }

// --- Caixa ---
function getCaixaAberto() { return state.caixas.find(c => c.status === 'aberto') || null; }

function abrirCaixa(valorAbertura, observacao) {
  if (getCaixaAberto()) return { error: 'Já existe um caixa aberto.' };
  const caixa = { id: _genId(), dataAbertura: Date.now(), dataFechamento: null, valorAbertura: Number(valorAbertura) || 0, valorFechamento: null, totalEntradas: 0, totalSaidas: 0, totalVendas: 0, totalVendasValor: 0, movimentos: [], status: 'aberto', observacao: observacao || '' };
  state.caixas.push(caixa);
  if (state.caixas.length > 365) state.caixas = state.caixas.slice(-365);
  addEvent(`Caixa aberto com R$${caixa.valorAbertura}`);
  save();
  return caixa;
}

function fecharCaixa(valorFechamento, observacao) {
  const caixa = getCaixaAberto();
  if (!caixa) return { error: 'Nenhum caixa aberto.' };
  caixa.dataFechamento = Date.now();
  caixa.valorFechamento = Number(valorFechamento) || 0;
  caixa.status = 'fechado';
  if (observacao) caixa.observacao = (caixa.observacao ? caixa.observacao + ' | ' : '') + observacao;
  caixa.diferenca = caixa.valorFechamento - (caixa.valorAbertura + caixa.totalEntradas - caixa.totalSaidas);
  save();
  return caixa;
}

function addMovimentoCaixa(tipo, valor, descricao) {
  const caixa = getCaixaAberto();
  if (!caixa) return { error: 'Nenhum caixa aberto.' };
  const mov = { tipo, valor: Number(valor) || 0, descricao: descricao || '', timestamp: Date.now() };
  caixa.movimentos.push(mov);
  if (['entrada','venda','reforco'].includes(tipo)) caixa.totalEntradas += mov.valor;
  if (['saida','sangria'].includes(tipo)) caixa.totalSaidas += mov.valor;
  if (tipo === 'venda') { caixa.totalVendas++; caixa.totalVendasValor += mov.valor; }
  save();
  return mov;
}

function getCaixaHistorico(limit) { return state.caixas.slice(-(limit || 30)).reverse(); }

// --- Pedidos (ATK Logística) ---
function addPedidoAtk(pedido) {
  const novo = { id: 'ped_' + _genId(), tipo: pedido.tipo || 'entrega', status: 'pendente', cliente: pedido.cliente || '', numero: pedido.numero || '', agentId: pedido.agentId || '', produto: pedido.produto || '', valor: pedido.valor || '', endereco: pedido.endereco || '', pagamento: pedido.pagamento || '', horario: pedido.horario || '', observacao: pedido.observacao || '', createdAt: Date.now(), updatedAt: Date.now() };
  state.pedidos.push(novo);
  if (state.pedidos.length > 1000) state.pedidos = state.pedidos.slice(-1000);
  save();
  return novo;
}

function updatePedidoAtkStatus(id, novoStatus) {
  const pedido = state.pedidos.find(p => p.id === id);
  if (!pedido) return null;
  pedido.status = novoStatus;
  pedido.updatedAt = Date.now();
  save();
  return pedido;
}

function getPedidosAtk(filters = {}) {
  let filtered = [...state.pedidos];
  if (filters.status) filtered = filtered.filter(p => p.status === filters.status);
  if (filters.agentId) filtered = filtered.filter(p => p.agentId === filters.agentId);
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  return filtered;
}

function getPedidosPendentes() { return state.pedidos.filter(p => p.status === 'pendente' || p.status === 'em_rota'); }

function getPedidosResumo() {
  return { pendentes: state.pedidos.filter(p => p.status === 'pendente').length, emRota: state.pedidos.filter(p => p.status === 'em_rota').length, entregues: state.pedidos.filter(p => p.status === 'entregue').length, retirados: state.pedidos.filter(p => p.status === 'retirado').length, totalEntregas: state.pedidos.filter(p => p.tipo === 'entrega').length, totalRetiradas: state.pedidos.filter(p => p.tipo === 'retirada').length, total: state.pedidos.length };
}

// --- Ofertas Promocionais ---
const OFFER_TTL = { manual: 14*24*60*60*1000, remarketing_manual: 7*24*60*60*1000, remarketing_auto: 3*24*60*60*1000, _default: 7*24*60*60*1000 };
function _offerTtl(origem) { return OFFER_TTL[origem] || OFFER_TTL._default; }
function _pushOfferHistory(offer, { from, to, reason }) {
  if (!offer.history) offer.history = [];
  offer.history.push({ from, to, timestamp: Date.now(), reason, precoDesconto: offer.precoDesconto, freteGratis: offer.freteGratis || false, agentId: offer.agentId });
  if (offer.history.length > 20) offer.history = offer.history.slice(-20);
}

function setOffer(numero, { agentId, precoOriginal, precoDesconto, freteGratis, origem, campanha }) {
  const now = Date.now();
  freteGratis = !!freteGratis;
  if (!precoDesconto) precoDesconto = precoOriginal;
  const hasDesc = precoDesconto < precoOriginal;
  const tipoOferta = hasDesc && freteGratis ? 'desconto_e_frete_gratis' : freteGratis ? 'frete_gratis' : hasDesc ? 'desconto_preco' : 'campanha_manual';
  const existing = state.activeOffers[numero];
  const history = existing ? (existing.history || []) : [];
  if (existing?.status === 'ativa') {
    history.push({ from: 'ativa', to: 'substituida', timestamp: now, reason: `Substituída por nova oferta R$${precoDesconto}`, precoDesconto: existing.precoDesconto, freteGratis: existing.freteGratis || false, agentId: existing.agentId });
  }
  history.push({ from: existing?.status || null, to: 'ativa', timestamp: now, reason: `Criada via ${origem || 'manual'}`, precoDesconto, freteGratis, agentId });
  if (history.length > 20) history.splice(0, history.length - 20);
  state.activeOffers[numero] = { agentId, precoOriginal, precoDesconto, freteGratis, tipoOferta, origem: origem || 'manual', campanha: campanha || null, createdAt: now, updatedAt: now, status: 'ativa', expiresAt: now + _offerTtl(origem), history };
  addEvent(`oferta_ativa: ${agentId} ${numero} R$${precoDesconto} via ${origem || 'manual'}`);
  save();
  return state.activeOffers[numero];
}

function getActiveOffer(agentIdOrNull, numero) {
  const offer = state.activeOffers[numero];
  if (offer?.status === 'ativa') {
    if (offer.expiresAt && Date.now() > offer.expiresAt) { _pushOfferHistory(offer, { from: 'ativa', to: 'expirada', reason: 'TTL' }); offer.status = 'expirada'; offer.updatedAt = Date.now(); save(); return null; }
    if (!agentIdOrNull || offer.agentId === agentIdOrNull) return offer;
  }
  return null;
}

function hasFreteGratis(agentId, numero) { const offer = getActiveOffer(agentId, numero); return !!(offer?.freteGratis); }
function cancelOffer(numero) { const o = state.activeOffers[numero]; if (!o) return null; _pushOfferHistory(o, { from: o.status, to: 'cancelada', reason: 'Manual' }); o.status = 'cancelada'; o.updatedAt = Date.now(); save(); return o; }
function expireOffer(numero) { const o = state.activeOffers[numero]; if (!o) return null; _pushOfferHistory(o, { from: o.status, to: 'expirada', reason: 'Manual' }); o.status = 'expirada'; o.updatedAt = Date.now(); save(); return o; }
function convertOffer(numero) { const o = state.activeOffers[numero]; if (!o) return null; _pushOfferHistory(o, { from: o.status, to: 'convertida', reason: 'Venda fechada' }); o.status = 'convertida'; o.updatedAt = Date.now(); save(); return o; }
function getOfferInfo(numero) { return state.activeOffers[numero] || null; }

function cleanExpiredOffers() {
  const now = Date.now();
  let cleaned = 0;
  for (const numero of Object.keys(state.activeOffers)) {
    const offer = state.activeOffers[numero];
    if (offer.expiresAt && now > offer.expiresAt && offer.status === 'ativa') { _pushOfferHistory(offer, { from: 'ativa', to: 'expirada', reason: 'Limpeza periódica' }); offer.status = 'expirada'; offer.updatedAt = now; cleaned++; }
    if (offer.status !== 'ativa' && (now - offer.updatedAt) > 30 * 24 * 60 * 60 * 1000) { delete state.activeOffers[numero]; cleaned++; }
  }
  if (cleaned > 0) save();
  return cleaned;
}

// --- Campanhas Visuais ---
function createVisualCampaign({ agentId, mediaUrl, productName, price, description, pauseOnReply, notifyOwnerOnReply }) {
  const id = `vc_${Date.now()}_${agentId}`;
  state.visualCampaigns[id] = { id, agentId, mediaUrl, productName: productName || 'Produto', price: price || null, description: description || null, status: 'active', pauseOnReply: pauseOnReply !== false, notifyOwnerOnReply: notifyOwnerOnReply !== false, createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, sentTo: [], responded: [] };
  addEvent(`campanha_visual_criada: ${agentId} "${productName}" R$${price || '?'}`);
  save();
  return state.visualCampaigns[id];
}

function getActiveCampaignForClient(agentId, numero) {
  const now = Date.now(), last8 = (numero || '').slice(-8);
  for (const campaign of Object.values(state.visualCampaigns)) {
    if (campaign.agentId !== agentId || campaign.status !== 'active') continue;
    if (campaign.expiresAt && now > campaign.expiresAt) { campaign.status = 'expired'; continue; }
    if (!campaign.sentTo.some(n => n === numero || n.slice(-8) === last8)) continue;
    if (campaign.responded.some(n => n === numero || n.slice(-8) === last8)) continue;
    return campaign;
  }
  return null;
}

function markCampaignSent(campaignId, numero) { const c = state.visualCampaigns[campaignId]; if (c && !c.sentTo.includes(numero)) c.sentTo.push(numero); }
function markCampaignResponded(campaignId, numero) { const c = state.visualCampaigns[campaignId]; if (!c) return; if (!c.responded.includes(numero)) c.responded.push(numero); addEvent(`campanha_visual_resposta: ${campaignId} ${numero}`); save(); }
function getCampaign(campaignId) { return state.visualCampaigns[campaignId] || null; }
function cancelCampaign(campaignId) { const c = state.visualCampaigns[campaignId]; if (!c) return null; c.status = 'cancelled'; addEvent(`campanha_visual_cancelada: ${campaignId}`); save(); return c; }
function listCampaigns() { return Object.values(state.visualCampaigns).sort((a, b) => b.createdAt - a.createdAt); }

// --- Campanhas de Remarketing Manual (aba MKT) ---
function createRemarketingCampaign({ agentId, name, text, imageUrl, pauseAfterSend, total, recipients }) {
  const id = `rmk_${Date.now()}_${agentId}`;
  state.remarketingCampaigns[id] = {
    id,
    agentId,
    name: name || `Remarketing ${agentId}`,
    text: text || '',
    imageUrl: imageUrl || null,
    pauseAfterSend: pauseAfterSend !== false,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: 0,
    total: Number(total || recipients?.length || 0),
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: Number(total || recipients?.length || 0),
    recipients: Array.isArray(recipients) ? recipients : [],
    sentTo: [],
    failedTo: [],
    skippedTo: [],
    responded: [],
  };
  addEvent(`remarketing_campanha_criada: ${agentId} ${id}`);
  save();
  return state.remarketingCampaigns[id];
}

function getRemarketingCampaign(campaignId) {
  return state.remarketingCampaigns[campaignId] || null;
}

function listRemarketingCampaigns(agentId = null) {
  return Object.values(state.remarketingCampaigns)
    .filter(c => !agentId || c.agentId === agentId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function _campaignHasNumber(list, numero) {
  const last8 = String(numero || '').slice(-8);
  return (list || []).some(item => {
    const n = typeof item === 'object' && item ? item.numero : item;
    return n === numero || String(n || '').slice(-8) === last8;
  });
}

function markRemarketingCampaignSent(campaignId, numero) {
  const c = getRemarketingCampaign(campaignId);
  if (!c) return;
  if (!_campaignHasNumber(c.sentTo, numero)) c.sentTo.push(numero);
  c.sent = c.sentTo.length;
  c.pending = Math.max(0, (c.total || 0) - c.sent - (c.failedTo?.length || 0) - (c.skippedTo?.length || 0));
  c.updatedAt = Date.now();
}

function markRemarketingCampaignFailed(campaignId, numero, error) {
  const c = getRemarketingCampaign(campaignId);
  if (!c) return;
  if (!_campaignHasNumber(c.failedTo, numero)) c.failedTo.push({ numero, error: error || 'erro', at: Date.now() });
  c.failed = c.failedTo.length;
  c.pending = Math.max(0, (c.total || 0) - (c.sentTo?.length || 0) - c.failed - (c.skippedTo?.length || 0));
  c.updatedAt = Date.now();
}

function markRemarketingCampaignSkipped(campaignId, numero, reason) {
  const c = getRemarketingCampaign(campaignId);
  if (!c) return;
  if (!_campaignHasNumber(c.skippedTo, numero)) c.skippedTo.push({ numero, reason: reason || 'ignorado', at: Date.now() });
  c.skipped = c.skippedTo.length;
  c.pending = Math.max(0, (c.total || 0) - (c.sentTo?.length || 0) - (c.failedTo?.length || 0) - c.skipped);
  c.updatedAt = Date.now();
}

function finishRemarketingCampaign(campaignId, status = 'finished') {
  const c = getRemarketingCampaign(campaignId);
  if (!c) return null;
  c.status = status;
  c.finishedAt = Date.now();
  c.updatedAt = Date.now();
  c.sent = c.sentTo?.length || 0;
  c.failed = c.failedTo?.length || 0;
  c.skipped = c.skippedTo?.length || 0;
  c.pending = Math.max(0, (c.total || 0) - c.sent - c.failed - c.skipped);
  save();
  return c;
}

function getActiveRemarketingCampaignForClient(agentId, numero) {
  const now = Date.now();
  const maxAge = 14 * 24 * 60 * 60 * 1000;
  for (const c of listRemarketingCampaigns(agentId)) {
    if (!['active', 'finished', 'stopped'].includes(c.status)) continue;
    if ((now - (c.createdAt || 0)) > maxAge) continue;
    if (!_campaignHasNumber(c.sentTo, numero)) continue;
    if (_campaignHasNumber(c.responded, numero)) continue;
    return c;
  }
  return null;
}

function markRemarketingCampaignResponded(campaignId, numero) {
  const c = getRemarketingCampaign(campaignId);
  if (!c) return;
  if (!_campaignHasNumber(c.responded, numero)) c.responded.push(numero);
  c.updatedAt = Date.now();
  addEvent(`remarketing_campanha_resposta: ${campaignId} ${numero}`);
  save();
}

function setPendingOwnerMedia(mediaUrl) { state.pendingOwnerMedia = mediaUrl ? { mediaUrl, timestamp: Date.now() } : null; }
function getPendingOwnerMedia() { const p = state.pendingOwnerMedia; if (!p) return null; if (Date.now() - p.timestamp > 5 * 60 * 1000) { state.pendingOwnerMedia = null; return null; } return p.mediaUrl; }
function clearPendingOwnerMedia() { state.pendingOwnerMedia = null; }

// --- Cleanup ---
function cleanupOldData() {
  const now = Date.now(), THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const agentId of ['pedro','rodrigo']) {
    const map = state.conversations[agentId], toDelete = [];
    map.forEach((conv, numero) => {
      if ((now - (conv.ultimaMensagem || 0)) > THIRTY_DAYS && !state.paused[agentId].has(numero) && !conv.finalizado) {
        state.archivedConversations.push({ numero, agentId, totalMsgs: (conv.msgs || []).length, lastMessage: (conv.msgs?.at(-1)?.content || '').substring(0, 200), archivedAt: now });
        toDelete.push(numero);
      }
    });
    toDelete.forEach(n => { map.delete(n); total++; });
  }
  if (state.archivedConversations.length > 500) state.archivedConversations = state.archivedConversations.slice(-500);
  cleanExpiredOffers();
  if (total > 0) save();
}
setInterval(cleanupOldData, 60 * 60 * 1000);

function getMemoryStats() {
  let totalConversations = 0, totalMessages = 0;
  for (const agentId of ['pedro','rodrigo']) {
    state.conversations[agentId].forEach(conv => { totalConversations++; totalMessages += (conv.msgs || []).length; });
  }
  return { conversations: totalConversations, messages: totalMessages, events: state.events.length, sales: state.sales.length, pedidos: state.pedidos.length, memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) };
}

// --- Serialização (mesmo formato do ATK original) ---
function serializeState() {
  const data = {
    metricas: state.metrics,
    eventos: state.events.slice(-100),
    atividades: state.activities.slice(-100),
    conversaAslam: state.aslamChat.slice(-50),
    salaReuniao: state.meetingRoom.slice(-200),
    registroContatos: state.contactRegistry,
    remarketingTimestamps: state.lastRemarketing,
    salesLog: state.salesLog.slice(-500),
    products: state.products,
    agentCatalog: state.agentCatalog,
    sales: state.sales.slice(-2000),
    caixas: state.caixas.slice(-365),
    pedidos: state.pedidos.slice(-1000),
    clientActivity: state.clientActivity,
    postSaleFollowups: state.postSaleFollowups,
    archivedConversations: state.archivedConversations.slice(-500),
    activeOffers: state.activeOffers,
    remarketingPausado: state.remarketingPausado,
    visualCampaigns: state.visualCampaigns,
    remarketingCampaigns: state.remarketingCampaigns,
  };
  for (const id of ['pedro','rodrigo']) {
    data[`conversas_${id}`] = {};
    state.conversations[id].forEach((v, k) => { data[`conversas_${id}`][k] = v; });
    data[`conhecimento_${id}`] = state.knowledge[id].slice(-50);
    data[`instrucoes_${id}`]   = state.instructions[id];
    data[`pausados_${id}`]     = [...state.paused[id]];
    data[`pausadosManuais_${id}`] = [...state.pausedManual[id]];
    data[`pausadosManuaisEm_${id}`] = state.pausedManualAt[id] || {};
  }
  if (Object.keys(state.lidPhoneMap).length > 0) data.lidPhoneMap = state.lidPhoneMap;
  return data;
}

function restoreState(data) {
  if (data.metricas) {
    state.metrics.pedro   = data.metricas.pedro   || { atendimentos: 0, vendas: 0 };
    state.metrics.rodrigo = data.metricas.rodrigo || { atendimentos: 0, vendas: 0 };
    state.metrics.lara    = data.metricas.lara    || { pedidos: 0 };
  }
  if (data.eventos)    { state.events.length = 0;     state.events.push(...data.eventos); }
  if (data.atividades) { state.activities.length = 0; state.activities.push(...data.atividades); }
  if (data.conversaAslam) { state.aslamChat.length = 0; state.aslamChat.push(...data.conversaAslam); }
  if (data.salaReuniao)   { state.meetingRoom.length = 0; state.meetingRoom.push(...data.salaReuniao); }
  if (data.registroContatos)    Object.assign(state.contactRegistry, data.registroContatos);
  if (data.remarketingTimestamps) Object.assign(state.lastRemarketing, data.remarketingTimestamps);
  if (data.salesLog) { state.salesLog.length = 0; state.salesLog.push(...data.salesLog); }
  if (data.caixas)   { state.caixas.length = 0;   state.caixas.push(...data.caixas); }
  if (data.products?.length > 0) state.products = data.products;
  if (data.agentCatalog) {
    for (const id of ['pedro','rodrigo']) {
      if (data.agentCatalog[id]) Object.assign(state.agentCatalog[id], data.agentCatalog[id]);
    }
    if (state.agentCatalog.pedro?.product === 'Uni TV V10') {
      state.agentCatalog.pedro.product = 'Uni TV V10 / Uni TV S10';
    }
  }
  if (data.sales)   { state.sales.length = 0;   state.sales.push(...data.sales); }
  if (data.pedidos) { state.pedidos.length = 0; state.pedidos.push(...data.pedidos); }
  if (data.clientActivity)     Object.assign(state.clientActivity, data.clientActivity);
  if (data.postSaleFollowups)  Object.assign(state.postSaleFollowups, data.postSaleFollowups);
  if (data.archivedConversations) { state.archivedConversations.length = 0; state.archivedConversations.push(...data.archivedConversations); }
  if (data.activeOffers)    Object.assign(state.activeOffers, data.activeOffers);
  if (data.remarketingPausado) {
    for (const id of ['pedro','rodrigo']) {
      if (data.remarketingPausado[id] !== undefined) state.remarketingPausado[id] = !!data.remarketingPausado[id];
    }
  }
  if (data.visualCampaigns) Object.assign(state.visualCampaigns, data.visualCampaigns);
  if (data.remarketingCampaigns) Object.assign(state.remarketingCampaigns, data.remarketingCampaigns);
  for (const id of ['pedro','rodrigo']) {
    const convData = data[`conversas_${id}`];
    if (convData) Object.entries(convData).forEach(([k, v]) => state.conversations[id].set(k, v));
    const knData  = data[`conhecimento_${id}`];
    if (knData) { state.knowledge[id].length = 0; state.knowledge[id].push(...knData); }
    const insData = data[`instrucoes_${id}`];
    if (insData) state.instructions[id] = insData;
    const pData = data[`pausados_${id}`];
    if (pData) { state.paused[id].clear(); pData.forEach(n => state.paused[id].add(n)); }
    const mData = data[`pausadosManuais_${id}`];
    if (mData) { state.pausedManual[id].clear(); mData.forEach(n => state.pausedManual[id].add(n)); }
    const mAtData = data[`pausadosManuaisEm_${id}`] || data[`pausedManualAt_${id}`];
    if (mAtData) state.pausedManualAt[id] = { ...mAtData };
  }
  if (data.lidPhoneMap) Object.assign(state.lidPhoneMap, data.lidPhoneMap);
  _migrateExistingLidConversations();
}

// --- Persistência ---
function save() {
  let json;
  try { json = JSON.stringify(serializeState()); } catch (e) { console.error('[ATK-DB] JSON.stringify falhou:', e.message); return Promise.resolve(); }
  try {
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, json);
    if (fs.existsSync(DB_FILE)) { try { fs.copyFileSync(DB_FILE, BACKUP_FILE); } catch {} }
    fs.renameSync(tmpFile, DB_FILE);
  } catch (e) { console.error('[ATK-DB] File save error:', e.message); }
  if (redis) return redis.set(REDIS_KEY, json).catch(e => console.error('[ATK-DB] Redis save error:', e.message));
  return Promise.resolve();
}

async function load() {
  let loaded = false;
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      if (raw) { restoreState(JSON.parse(raw)); console.log('[ATK-DB] ✅ Dados carregados do Redis — pedro:', state.conversations.pedro.size, 'conversas | rodrigo:', state.conversations.rodrigo.size, 'conversas | pausados pedro:', state.pausedManual.pedro.size); loaded = true; }
    } catch (e) { console.error('[ATK-DB] Redis load error:', e.message); }
  }
  if (!loaded) {
    try {
      const filePath = fs.existsSync(DB_FILE) ? DB_FILE : fs.existsSync(BACKUP_FILE) ? BACKUP_FILE : null;
      if (filePath) { const raw = fs.readFileSync(filePath, 'utf8'); restoreState(JSON.parse(raw)); console.log('[ATK-DB] ✅ Dados carregados do arquivo local'); loaded = true; if (redis) redis.set(REDIS_KEY, raw).catch(() => {}); }
    } catch (e) { console.error('[ATK-DB] File load error:', e.message); }
  }
  if (!loaded) console.log('[ATK-DB] Nenhum dado encontrado — iniciando limpo.');
  // Sync sales
  for (const sale of state.sales) {
    if (sale.status !== 'confirmada' || !sale.numero) continue;
    if (!state.salesLog.some(s => s.numero === sale.numero && s.agentId === sale.agentId)) {
      state.salesLog.push({ agentId: sale.agentId, numero: sale.numero, produto: sale.productName, valor: sale.valorFinal || sale.valor, lucro: sale.lucro || 0, tipo: sale.tipo, timestamp: sale.createdAt });
    }
  }
}

// Auto-save a cada 30s
setInterval(() => save(), 30000);

module.exports = {
  state,
  load,
  save,
  getConversation,
  setPushName,
  getPushName,
  isLidFormat,
  mapLidToPhone,
  resolvePhone,
  resolveLid,
  isPaused,
  isManuallyPaused,
  getManualPausedAt,
  pauseManual,
  resumeManual,
  resumeManualAll,
  pauseAuto,
  resumeAuto,
  pauseRemarketing,
  resumeRemarketing,
  isRemarketingPausado,
  isAgentNumber,
  registerContact,
  getContactsByDate,
  getContatosHoje,
  getBrasiliaDate,
  hasSaleForNumber,
  addEvent,
  addActivity,
  findAgentForNumber,
  logSale,
  getSalesStats,
  getCustomerList,
  scoreClient,
  getBestHourForClient,
  getAgentPrice,
  getAgentPiso,
  getAgentProductName,
  updateAgentPrice,
  addProduct, updateProduct, deleteProduct, getProducts, getAllProducts,
  addSale, updateSale, cancelSale, deleteSale, getSale, getSales, getSalesReport,
  addPedidoAtk, updatePedidoAtkStatus, getPedidosAtk, getPedidosPendentes, getPedidosResumo,
  getCaixaAberto, abrirCaixa, fecharCaixa, addMovimentoCaixa, getCaixaHistorico,
  setOffer, getActiveOffer, hasFreteGratis, cancelOffer, expireOffer, convertOffer, getOfferInfo, cleanExpiredOffers,
  createVisualCampaign, getActiveCampaignForClient, markCampaignSent, markCampaignResponded,
  getCampaign, cancelCampaign, listCampaigns,
  createRemarketingCampaign, getRemarketingCampaign, listRemarketingCampaigns,
  markRemarketingCampaignSent, markRemarketingCampaignFailed, markRemarketingCampaignSkipped,
  markRemarketingCampaignResponded, getActiveRemarketingCampaignForClient, finishRemarketingCampaign,
  setPendingOwnerMedia, getPendingOwnerMedia, clearPendingOwnerMedia,
  cleanupOldData,
  getMemoryStats,
};

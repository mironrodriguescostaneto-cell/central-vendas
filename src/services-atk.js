// ============================================================
// SERVICES-ATK — Camada de serviços dos agentes Atacadão
// Usa env vars diretamente (sem CONFIG da Central)
// callClaude: Gemini (primário) → Claude (fallback)
// sendText/sendMedia: via Baileys da Central
// ============================================================
'use strict';

// --- Env vars ATK ---
const GEMINI_KEY     = () => process.env.GEMINI_API_KEY || '';
const ANTHROPIC_KEY  = () => process.env.ANTHROPIC_API_KEY || '';
const GROQ_KEY       = () => process.env.GROQ_API_KEY || '';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
function normalizeGeminiModel(model) {
  const m = String(model || '').trim();
  if (!m || m === 'gemini-2.0-flash') return GEMINI_FALLBACK_MODEL;
  return m;
}
const GEMINI_MODEL   = () => normalizeGeminiModel(process.env.GEMINI_MODEL || GEMINI_FALLBACK_MODEL);
const CLAUDE_MODEL   = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const CLAUDE_TOKENS  = () => parseInt(process.env.CLAUDE_MAX_TOKENS || '800');
const CLAUDE_TIMEOUT = () => parseInt(process.env.CLAUDE_TIMEOUT || '25000');

// Circuit breaker Gemini: abre quando 429 (sem créditos), fecha após 2h
let _geminiCircuitOpenUntil = 0;
function geminiCircuitOpen() { return Date.now() < _geminiCircuitOpenUntil; }
function openGeminiCircuit() {
  _geminiCircuitOpenUntil = Date.now() + 2 * 60 * 60 * 1000;
  console.warn('[ATK/AI] Gemini circuit breaker ABERTO por 2h (429 — sem créditos)');
}

// Diagnóstico de keys na inicialização
setTimeout(() => {
  const gk = GEMINI_KEY();
  const ak = ANTHROPIC_KEY();
  console.log(`[ATK/AI] Keys configuradas — Gemini: ${gk ? 'SIM (' + gk.slice(0,8) + '...)' : 'NAO'} | Anthropic: ${ak ? 'SIM (' + ak.slice(0,8) + '...)' : 'NAO'}`);
  if (!gk && !ak) console.error('[ATK/AI] ATENCAO: Nenhuma API key configurada! Agentes vao responder com instabilidade.');
}, 5000);
const STORE_LAT      = parseFloat(process.env.STORE_LAT || '-16.6939');
const STORE_LNG      = parseFloat(process.env.STORE_LNG || '-49.2648');
const SEU_WHATSAPP   = process.env.SEU_WHATSAPP || '5562991819645';

// --- Sanitize ---
function sanitize(str) {
  if (typeof str !== 'string') return String(str || '');
  try {
    let clean = Buffer.from(str, 'utf8').toString('utf8');
    clean = clean.replace(/[\uD800-\uDFFF]/g, (match, offset, string) => {
      const code = match.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = string.charCodeAt(offset + 1);
        return (next >= 0xdc00 && next <= 0xdfff) ? match : '';
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        const prev = string.charCodeAt(offset - 1);
        return (prev >= 0xd800 && prev <= 0xdbff) ? match : '';
      }
      return '';
    });
    return clean;
  } catch {
    return str.replace(/[^\x00-\x7F]/g, '');
  }
}

function isLikelyIncompleteOutbound(text) {
  const t = String(text || '').trim();
  if (t.length < 35) return false;
  if (/[.!?)]$/.test(t)) return false;
  if (t.length > 55) return true;
  if (/[,;:]$/.test(t)) return true;
  if (/\b(?:o|a|os|as|um|uma|de|do|da|dos|das|que|com|por|para|pra|e|ou|mas|porque|se|ele|ela|esse|essa|este|esta|meu|minha|nosso|nossa|modelo|produto)$/i.test(t)) return true;
  if (/\b(?:que e o|que e a|eu tenho|o uni tv v10 que e o)$/i.test(t)) return true;
  return false;
}

// --- Gemini: convert messages ---
function convertMessagesToGemini(messages) {
  const contents = [];
  for (const m of messages) {
    if (!m) continue;
    let text = '';
    if (typeof m.content === 'string') {
      text = sanitize(m.content || '');
    } else if (Array.isArray(m.content)) {
      // Suporte a visão (imagens) — extrair bloco de imagem para API Gemini
      const blocks = m.content;
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
      const imageBlocks = blocks.filter(b => b.type === 'image' && b.source?.type === 'base64');
      if (imageBlocks.length > 0 && contents.length >= 0) {
        const parts = [];
        for (const img of imageBlocks) {
          parts.push({ inlineData: { mimeType: img.source.media_type, data: img.source.data } });
        }
        if (textBlocks) parts.push({ text: textBlocks });
        const role = m.role === 'assistant' ? 'model' : 'user';
        contents.push({ role, parts });
        continue;
      }
      text = textBlocks || JSON.stringify(m.content).slice(0, 500);
    }
    if (!text) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += '\n' + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  return contents;
}

// --- callGeminiDirect ---
async function callGeminiDirect(systemPrompt, messages, { maxTokens, timeout } = {}) {
  const key = GEMINI_KEY();
  if (!key) { console.warn('[ATK/AI] Gemini: GEMINI_API_KEY nao configurada'); return null; }
  maxTokens = maxTokens || CLAUDE_TOKENS();
  timeout   = timeout   || CLAUDE_TIMEOUT();
  const model = GEMINI_MODEL();
  const contents = convertMessagesToGemini(messages);
  if (contents.length === 0) return '';
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (systemPrompt) body.system_instruction = { parts: [{ text: sanitize(systemPrompt) }] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
    );
    const data = await r.json();
    if (data.error) {
      if (data.error.code === 429 || data.error.code === 404) openGeminiCircuit();
      console.error(`[ATK/AI] Gemini error ${data.error.code}: ${data.error.message}`);
      return null;
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    if (e.name === 'AbortError') console.error('[ATK/AI] Gemini timeout');
    else console.error('[ATK/AI] Gemini erro:', e.message);
    return null;
  } finally { clearTimeout(timer); }
}

// --- callClaudeDirect ---
async function callClaudeDirect(systemPrompt, messages, { model, maxTokens, timeout } = {}) {
  const key = ANTHROPIC_KEY();
  if (!key) { console.warn('[ATK/AI] Claude: ANTHROPIC_API_KEY nao configurada'); return null; }
  model     = model     || CLAUDE_MODEL();
  maxTokens = maxTokens || CLAUDE_TOKENS();
  timeout   = timeout   || CLAUDE_TIMEOUT();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        system: sanitize(systemPrompt || ''),
        messages: messages.filter(m => m && m.content).map(m => ({
          role: m.role || 'user',
          content: Array.isArray(m.content) ? m.content : sanitize(String(m.content || '')),
        })),
      }).replace(/[\uD800-\uDFFF]/g, ''),
      signal: controller.signal,
    });
    const data = await r.json();
    if (data.error) { console.error(`[ATK/AI] Claude error [${data.error.type}]: ${data.error.message}`); return null; }
    return data.content?.[0]?.text || '';
  } catch (e) {
    if (e.name === 'AbortError') console.error('[ATK/AI] Claude timeout');
    else console.error('[ATK/AI] Claude erro:', e.message);
    return null;
  } finally { clearTimeout(timer); }
}

// --- callClaude (Gemini primário → Claude fallback) ---
async function callClaude(systemPrompt, messages, options = {}) {
  if (GEMINI_KEY() && !geminiCircuitOpen()) {
    const result = await callGeminiDirect(systemPrompt, messages, options);
    if (typeof result === 'string' && result.trim()) return result;
    if (result !== null) console.warn('[ATK/AI] Gemini retornou vazio - usando Claude...');
    console.warn('[ATK/AI] Gemini falhou — usando Claude...');
  }
  const result = await callClaudeDirect(systemPrompt, messages, options);
  if (result === null) console.error('[ATK/AI] FALHA TOTAL — Gemini e Claude indisponíveis');
  return result;
}

async function callClaudeWithRetry(systemPrompt, messages, options = {}) {
  const maxRetries = options.maxRetries || 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await callClaude(systemPrompt, messages, options);
    if (result !== null) return result;
    if (attempt === maxRetries) return null;
    await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)));
  }
  return null;
}

// --- Jarvis tool executor ---
let _jarvisExecutor = null;
function setJarvisExecutor(fn) { _jarvisExecutor = fn; }
async function executeJarvisTool(name, input) {
  if (_jarvisExecutor) return await _jarvisExecutor(name, input);
  return 'Tool executor nao configurado';
}

// --- callClaudeWithTools (Gemini → Claude, para Aslam Jarvis mode) ---
async function callClaudeWithTools(systemPrompt, messages, tools, { maxTokens, timeout, maxIterations } = {}) {
  maxTokens = maxTokens || 4096;
  timeout   = timeout   || 60000;
  maxIterations = maxIterations || 10;

  // Gemini com tool use
  if (GEMINI_KEY()) {
    const geminiTools = [{ function_declarations: tools.map(t => ({ name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } })) }];
    let currentContents = convertMessagesToGemini(messages);
    for (let i = 0; i < maxIterations; i++) {
      const body = { contents: currentContents, tools: geminiTools, tool_config: { function_calling_config: { mode: 'AUTO' } }, generationConfig: { maxOutputTokens: maxTokens } };
      if (systemPrompt) body.system_instruction = { parts: [{ text: sanitize(systemPrompt) }] };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let data;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent?key=${GEMINI_KEY()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        data = await r.json();
      } catch (e) { console.error('[ATK/JARVIS] Gemini tools erro:', e.message); break; }
      finally { clearTimeout(timer); }
      if (data.error) { console.error('[ATK/JARVIS] Gemini tools error:', data.error.message); break; }
      const parts = data.candidates?.[0]?.content?.parts || [];
      const textParts = parts.filter(p => p.text).map(p => p.text);
      const funcCalls = parts.filter(p => p.functionCall);
      if (funcCalls.length === 0) return { text: textParts.join('\n'), toolResults: [] };
      currentContents.push({ role: 'model', parts });
      const funcResponseParts = [];
      for (const fc of funcCalls) {
        let result;
        try { result = await executeJarvisTool(fc.functionCall.name, fc.functionCall.args); }
        catch (e) { result = `ERRO: ${e.message}`; }
        funcResponseParts.push({ functionResponse: { name: fc.functionCall.name, response: { result: sanitize(String(result).slice(0, 8000)) } } });
      }
      currentContents.push({ role: 'user', parts: funcResponseParts });
    }
  }

  // Fallback Claude
  const key = ANTHROPIC_KEY();
  if (!key) return { text: null, toolResults: [] };
  let currentMessages = messages.map(m => ({ role: m.role || 'user', content: typeof m.content === 'string' ? sanitize(m.content) : m.content }));
  for (let i = 0; i < maxIterations; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let data;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL(), max_tokens: maxTokens, system: sanitize(systemPrompt || ''), messages: currentMessages, tools }),
        signal: controller.signal,
      });
      data = await r.json();
    } catch (e) { console.error('[ATK/JARVIS] Claude tools erro:', e.message); return { text: null, toolResults: [] }; }
    finally { clearTimeout(timer); }
    if (data.error) return { text: null, toolResults: [] };
    const content = data.content || [];
    const textParts = content.filter(c => c.type === 'text').map(c => c.text);
    const toolUses = content.filter(c => c.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) return { text: textParts.join('\n'), toolResults: [] };
    const toolResultsContent = [];
    for (const tu of toolUses) {
      let result;
      try { result = await executeJarvisTool(tu.name, tu.input); }
      catch (e) { result = `ERRO: ${e.message}`; }
      toolResultsContent.push({ type: 'tool_result', tool_use_id: tu.id, content: sanitize(String(result).slice(0, 8000)) });
    }
    currentMessages.push({ role: 'assistant', content });
    currentMessages.push({ role: 'user', content: toolResultsContent });
  }
  return { text: 'Limite de iteracoes atingido.', toolResults: [] };
}

// --- Transcribe Audio (Groq Whisper) ---
async function transcribeAudio(audioUrl) {
  const key = GROQ_KEY();
  if (!key) return null;
  try {
    const audioResp = await fetch(audioUrl);
    const arrayBuf = await audioResp.arrayBuffer();
    const blob = new Blob([arrayBuf], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
    });
    const data = await r.json();
    return data.text || null;
  } catch (e) {
    console.error('[ATK] Groq transcription error:', e.message);
    return null;
  }
}

// --- Frete (hardcoded por segurança — km×2, mín R$15, máx 30km) ---
const FREIGHT_MULTIPLIER = 2;
const FREIGHT_MIN        = 15;
const FREIGHT_MAX_KM     = 30;

function calcDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcFreight(lat, lng) {
  const distKm = calcDistanceKm(STORE_LAT, STORE_LNG, lat, lng);
  if (distKm > FREIGHT_MAX_KM) return { distKm: Math.round(distKm * 10) / 10, frete: null, error: `Fora da área (max ${FREIGHT_MAX_KM}km)` };
  const frete = Math.max(Math.ceil(distKm * FREIGHT_MULTIPLIER), FREIGHT_MIN);
  return { distKm: Math.round(distKm * 10) / 10, frete };
}

function calcFreightByKm(distKm) {
  if (distKm > FREIGHT_MAX_KM) return { distKm, frete: null, error: `Fora da área (max ${FREIGHT_MAX_KM}km)` };
  const frete = Math.max(Math.ceil(distKm * FREIGHT_MULTIPLIER), FREIGHT_MIN);
  return { distKm, frete };
}

// --- Horário Brasília ---
function getBrasiliaTime() {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dias = ['Domingo','Segunda','Terca','Quarta','Quinta','Sexta','Sabado'];
  return {
    dia: dias[brasilia.getDay()],
    hora: brasilia.getHours(),
    minuto: brasilia.getMinutes(),
    data: `${String(brasilia.getDate()).padStart(2,'0')}/${String(brasilia.getMonth()+1).padStart(2,'0')}/${brasilia.getFullYear()}`,
    formatted: `${dias[brasilia.getDay()]} ${String(brasilia.getDate()).padStart(2,'0')}/${String(brasilia.getMonth()+1).padStart(2,'0')}/${brasilia.getFullYear()} ${String(brasilia.getHours()).padStart(2,'0')}:${String(brasilia.getMinutes()).padStart(2,'0')}`,
  };
}

// --- Provider helper (ATK usa sempre Baileys na Central) ---
function getProvider(agentId) {
  const providerMap = { pedro: process.env.PEDRO_PROVIDER || 'baileys', rodrigo: process.env.RODRIGO_PROVIDER || 'baileys' };
  return providerMap[agentId] || 'baileys';
}

// --- sendText (via Baileys da Central) ---
async function sendText(agentId, numero, texto, options = {}) {
  const db = require('./database-atk');
  if (!options.bypassPause && numero !== SEU_WHATSAPP) {
    if (db.isManuallyPaused(numero) || db.isPaused(agentId, numero)) {
      console.log(`[ATK/SEND BLOCKED] ${agentId} → ${numero}: pausado`);
      return false;
    }
  }
  const cleanText = String(texto || '').trim();
  if (!cleanText) return false;
  if (numero !== SEU_WHATSAPP && !options.allowIncomplete && isLikelyIncompleteOutbound(cleanText)) {
    console.error(`[ATK/SEND INCOMPLETE BLOCKED] ${agentId} -> ${numero}: "${cleanText.substring(0, 160)}"`);
    return false;
  }
  const conv = db.getConversation(agentId, numero);
  if (numero !== SEU_WHATSAPP && !options.allowDuplicate) {
    const nowDup = Date.now();
    if (conv?.lastOutboundText === cleanText && (nowDup - (conv.lastOutboundAt || 0)) < 2 * 60 * 1000) {
      console.log(`[ATK/SEND DEDUP] ${agentId} -> ${numero}: texto repetido bloqueado`);
      return false;
    }
  }
  const baileys = require('./baileys');
  if (baileys.getState(agentId) !== 'connected') {
    console.error(`[ATK/BAILEYS] ${agentId} não conectado — cancelando sendText`);
    return false;
  }
  if (db.state.botSending[agentId]) db.state.botSending[agentId].set(numero, Date.now() + 60000);
  try {
    const originalJid = conv?._originalJid || null;
    await baileys.sendText(agentId, numero, cleanText, originalJid);
    if (numero !== SEU_WHATSAPP && !options.allowDuplicate && conv) {
      conv.lastOutboundText = cleanText;
      conv.lastOutboundAt = Date.now();
    }
    return true;
  } catch (e) {
    console.error(`[ATK/SEND] Erro sendText ${agentId} → ${numero}:`, e.message);
    return false;
  }
}

// --- sendMedia (via Baileys da Central) ---
async function sendMedia(agentId, numero, type, url, caption) {
  const db = require('./database-atk');
  const baileys = require('./baileys');
  const conv = db.getConversation(agentId, numero);
  const mediaKey = `${type}:${url}`;
  if (numero !== SEU_WHATSAPP) {
    const nowDup = Date.now();
    if (conv?.lastOutboundMediaKey === mediaKey && (nowDup - (conv.lastOutboundMediaAt || 0)) < 10 * 60 * 1000) {
      console.log(`[ATK/MEDIA DEDUP] ${agentId} -> ${numero}: midia repetida bloqueada (${type})`);
      return false;
    }
  }
  if (baileys.getState(agentId) !== 'connected') {
    console.error(`[ATK/BAILEYS] ${agentId} não conectado — cancelando sendMedia`);
    return false;
  }
  if (db.state.botSending[agentId]) db.state.botSending[agentId].set(numero, Date.now() + 60000);
  try {
    const originalJid = conv?._originalJid || null;
    await baileys.sendMedia(agentId, numero, type, url, caption, originalJid);
    if (numero !== SEU_WHATSAPP && conv) {
      conv.lastOutboundMediaKey = mediaKey;
      conv.lastOutboundMediaAt = Date.now();
    }
    console.log(`[ATK/MEDIA] OK: ${agentId} → ${numero} (${type})`);
    return true;
  } catch (e) {
    console.error(`[ATK/MEDIA] Erro ${agentId} → ${numero}:`, e.message);
    return false;
  }
}

// Circuit breaker stub (Baileys não precisa, mas agents.js referencia zapiCircuit)
const zapiCircuit = { recordSuccess: () => {}, recordFailure: () => {}, isOpen: () => false };

module.exports = {
  sanitize,
  callClaude,
  callClaudeWithRetry,
  callClaudeWithTools,
  setJarvisExecutor,
  sendText,
  sendMedia,
  transcribeAudio,
  calcFreight,
  calcFreightByKm,
  getBrasiliaTime,
  zapiCircuit,
  getProvider,
  getLastSendError: () => null,
  getGeminiModel: GEMINI_MODEL,
  getClaudeModel: CLAUDE_MODEL,
  STORE_LAT,
  STORE_LNG,
};

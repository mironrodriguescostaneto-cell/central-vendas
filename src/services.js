'use strict';

const https = require('https');
const http = require('http');
const { CONFIG } = require('./config');

// ----- Circuit Breaker simples -----
const breakers = {};
function getBreaker(key) {
  if (!breakers[key]) breakers[key] = { failures: 0, openUntil: 0 };
  return breakers[key];
}
function isOpen(key) {
  const b = getBreaker(key);
  if (b.openUntil > Date.now()) return true;
  return false;
}
function recordFailure(key) {
  const b = getBreaker(key);
  b.failures++;
  if (b.failures >= 5) { b.openUntil = Date.now() + 30000; b.failures = 0; }
}
function recordSuccess(key) { getBreaker(key).failures = 0; }

// ----- HTTP helper -----
function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { ...options, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout 15s')); });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ----- Gemini Flash (principal — gratuito) -----
async function callGemini(systemPrompt, messages, opts = {}) {
  if (!CONFIG.geminiKey) throw new Error('GEMINI_API_KEY não configurada');

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 1024,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`;
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body);

  if (res.status !== 200) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ----- Claude Sonnet (Gestor Jarvis) -----
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: CONFIG.anthropicKey });
  }
  return anthropicClient;
}

async function callClaude(systemPrompt, messages, opts = {}) {
  if (!CONFIG.anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada');
  const client = getAnthropicClient();

  const params = {
    model: opts.model || 'claude-sonnet-4-20250514',
    max_tokens: opts.maxTokens || 4096,
    system: systemPrompt,
    messages,
  };

  if (opts.tools) params.tools = opts.tools;

  const response = await client.messages.create(params);
  return response;
}

async function callClaudeText(systemPrompt, messages, opts = {}) {
  const response = await callClaude(systemPrompt, messages, opts);
  const textBlock = response.content.find(b => b.type === 'text');
  const text = textBlock?.text || '';
  if (!text) throw new Error('Claude retornou resposta sem texto');
  return text;
}

// ----- Z-API (fallback WhatsApp) -----
async function sendZapi(agentId, phone, message) {
  const agentCfg = CONFIG.agents[agentId];
  if (!agentCfg?.zapi?.instance) throw new Error(`Z-API não configurado para ${agentId}`);

  if (isOpen(`zapi-${agentId}`)) throw new Error('Z-API circuit breaker aberto');

  const { instance, token, clientToken } = agentCfg.zapi;
  const url = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`;

  try {
    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
    }, { phone, message });
    recordSuccess(`zapi-${agentId}`);
    return res;
  } catch (e) {
    recordFailure(`zapi-${agentId}`);
    throw e;
  }
}

// ----- Groq Whisper — transcrição de áudio -----
async function transcribeAudio(audioUrl) {
  if (!CONFIG.groqKey) return null;
  try {
    // Node.js 20 undici não suporta fetch("data:...") — decodificar base64 diretamente
    let buffer;
    if (audioUrl.startsWith('data:')) {
      const base64 = audioUrl.split(',')[1];
      buffer = Buffer.from(base64, 'base64');
    } else {
      const audioResp = await fetch(audioUrl);
      buffer = Buffer.from(await audioResp.arrayBuffer());
    }

    const blob = new Blob([buffer], { type: 'audio/ogg' });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.groqKey}` },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Groq ${r.status}: ${JSON.stringify(data)}`);
    console.log(`[GROQ] Transcrito: "${(data.text || '').slice(0, 80)}"`);
    return data.text || null;
  } catch (e) {
    console.error('[GROQ] Erro transcrição:', e.message);
    return null;
  }
}

// ----- Sanitizador de resposta -----
function sanitizeResponse(text) {
  if (!text) return '';
  // Remove tags internas que não devem ir para o cliente
  return text
    .replace(/\[INSTRUCAO_INTERNA:[^\]]*\]/gi, '')
    .replace(/\[SYSTEM:[^\]]*\]/gi, '')
    .trim();
}

module.exports = {
  callGemini,
  callClaude,
  callClaudeText,
  transcribeAudio,
  sendZapi,
  sanitizeResponse,
  httpRequest,
};

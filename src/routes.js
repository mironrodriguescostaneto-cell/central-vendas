'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('./config');
const db = require('./database');
const baileys = require('./baileys');

const router = express.Router();

// ----- Autenticação JWT simples -----
function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', CONFIG.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', CONFIG.jwtSecret).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch { return null; }
}

function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Token inválido' });
  req.user = payload;
  next();
}

// ----- Login -----
router.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== CONFIG.dashboardPassword) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  const token = signToken({ user: 'miron', ts: Date.now() });
  res.json({ token });
});

// ----- Health -----
router.get('/api/health', (req, res) => {
  const status = baileys.getAllStatus();
  const gk = (process.env.GEMINI_API_KEY || '').trim();
  const ak = (process.env.ANTHROPIC_API_KEY || '').trim();
  const keys = {
    gemini: gk ? gk.slice(0,8)+'...' : false,
    anthropic: ak ? ak.slice(0,20)+'...' : false,
    groq: !!(process.env.GROQ_API_KEY || '').trim(),
  };
  res.json({ ok: true, agents: status, keys, ts: Date.now() });
});

router.get('/api/test-ai', async (req, res) => {
  const services = require('./services');
  const gk = (process.env.GEMINI_API_KEY || '').trim();
  const ak = (process.env.ANTHROPIC_API_KEY || '').trim();
  const results = {};
  if (gk) {
    try {
      const geminiModel = services.getGeminiModel();
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${gk}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'diga apenas: ok' }] }], generationConfig: { maxOutputTokens: 10 } }),
        signal: AbortSignal.timeout(10000)
      });
      const d = await r.json();
      results.gemini = d.error ? `ERRO ${geminiModel}: ${d.error.code} ${d.error.message}` : `OK ${geminiModel}: ${d.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0,20)}`;
    } catch(e) { results.gemini = `EXCEPTION: ${e.message}`; }
  } else { results.gemini = 'KEY_MISSING'; }
  if (ak) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ak, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: services.getClaudeModel(), max_tokens: 10, messages: [{ role: 'user', content: 'diga apenas: ok' }] }),
        signal: AbortSignal.timeout(10000)
      });
      const d = await r.json();
      results.anthropic = d.error ? `ERRO ${services.getClaudeModel()}: ${d.error.type} ${d.error.message}` : `OK ${services.getClaudeModel()}: ${d.content?.[0]?.text?.slice(0,20)}`;
    } catch(e) { results.anthropic = `EXCEPTION: ${e.message}`; }
  } else { results.anthropic = 'KEY_MISSING'; }
  res.json(results);
});

// ----- Status de conexão dos agentes -----
router.get('/api/agents/status', auth, (req, res) => {
  const status = baileys.getAllStatus();
  const result = {};
  for (const agentId of ['info', 'logzz', 'rafael', 'sarah', 'antonio']) {
    const baileysStatus = status[CONFIG.sessionIds[agentId]] || { state: 'disconnected', hasQR: false };
    result[agentId] = {
      state: baileysStatus.state,
      hasQR: baileysStatus.hasQR,
      qrCode: baileysStatus.hasQR ? baileys.getQRCode(CONFIG.sessionIds[agentId]) : null,
    };
  }
  res.json(result);
});

// ----- QR Code por agente -----
router.get('/api/agents/:agentId/qr', auth, (req, res) => {
  const { agentId } = req.params;
  if (!CONFIG.sessionIds[agentId]) return res.status(404).json({ error: 'Agente não encontrado' });
  const sessionId = CONFIG.sessionIds[agentId];
  const qr = baileys.getQRCode(sessionId);
  const state = baileys.getState(sessionId);
  res.json({ qr, state });
});

// ----- Página de scan local (sem auth, só localhost) -----
router.get('/scan/:agentId', (req, res) => {
  const { agentId } = req.params;
  if (!['info', 'logzz', 'rafael', 'sarah', 'antonio'].includes(agentId)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar - ${agentId}</title>
<style>
body{background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:20px}
img{border:8px solid #fff;border-radius:12px;max-width:300px;width:90%}
.status{margin-top:16px;font-size:18px;font-weight:bold}
.connected{color:#4caf50}.connecting{color:#ff9800}.disconnected{color:#f44336}
.section{background:#1e1e1e;border-radius:12px;padding:20px;margin:20px auto;max-width:400px}
input{width:80%;padding:12px;font-size:16px;border-radius:8px;border:none;margin:8px 0}
button{padding:12px 24px;font-size:16px;border-radius:8px;border:none;background:#25d366;color:#fff;cursor:pointer;margin:8px}
button:hover{background:#1da34e}
.code{font-size:36px;font-weight:bold;letter-spacing:8px;color:#25d366;margin:16px 0}
.hint{font-size:13px;color:#aaa;margin-top:8px}
</style></head>
<body>
<h2>Conectar WhatsApp — ${agentId}</h2>
<div class="status" id="st">Aguardando...</div>

<div class="section">
  <h3>Opção 1 — QR Code</h3>
  <img id="qr" src="/qr-img/${agentId}?t=0" alt="QR" style="display:none">
  <div id="qr-msg">Aguardando QR...</div>
</div>

<div class="section">
  <h3>Opção 2 — Código de Pareamento</h3>
  <p class="hint">Mais confiável que QR. Abra WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone</p>
  <input id="phone" type="tel" placeholder="Ex: 5562991819645" />
  <br>
  <button onclick="solicitarCodigo()">Gerar código</button>
  <div id="code-area" style="display:none">
    <div class="code" id="code-val"></div>
    <div class="hint">Digite esse código no WhatsApp do celular</div>
  </div>
  <div id="code-err" style="color:#f44;margin-top:8px"></div>
</div>

<script>
let t=0;
async function refresh(){
  const r=await fetch('/api/health'); const d=await r.json();
  const s=d.agents['${agentId}-session']||{};
  const st=document.getElementById('st');
  st.textContent=s.state==='connected'?'✅ Conectado!':s.hasQR?'📱 QR disponível':'⏳ Aguardando...';
  st.className='status '+(s.state||'disconnected');
  const qrImg=document.getElementById('qr');
  const qrMsg=document.getElementById('qr-msg');
  if(s.hasQR){
    qrImg.style.display='block';
    qrMsg.style.display='none';
    qrImg.src='/qr-img/${agentId}?t='+(++t);
  } else {
    qrImg.style.display='none';
    qrMsg.style.display='block';
    qrMsg.textContent=s.state==='connected'?'Conectado!':'Aguardando QR...';
  }
}
async function solicitarCodigo(){
  const phone=document.getElementById('phone').value.replace(/\\D/g,'');
  if(!phone||phone.length<10){alert('Digite o número completo com DDD e código do país (ex: 5562991819645)');return;}
  document.getElementById('code-area').style.display='none';
  document.getElementById('code-err').textContent='Solicitando código...';
  try{
    const r=await fetch('/api/agents/${agentId}/pairing-code',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${signToken({ user: 'local' })}'},body:JSON.stringify({phone})});
    const d=await r.json();
    if(d.code){
      document.getElementById('code-val').textContent=d.code;
      document.getElementById('code-area').style.display='block';
      document.getElementById('code-err').textContent='';
    } else {
      document.getElementById('code-err').textContent='Erro: '+(d.error||'desconhecido');
    }
  }catch(e){
    document.getElementById('code-err').textContent='Erro: '+e.message;
  }
}
refresh();setInterval(refresh,5000);
</script></body></html>`);
});

router.get('/qr-img/:agentId', async (req, res) => {
  const { agentId } = req.params;
  if (!CONFIG.sessionIds[agentId]) return res.status(404).end();
  const sessionId = CONFIG.sessionIds[agentId];
  const qr = baileys.getQRCode(sessionId);
  if (!qr) return res.status(204).end();
  try {
    const QRCode = require('qrcode');
    const buf = await QRCode.toBuffer(qr, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) { res.status(500).end(); }
});

// ----- QR Code como imagem PNG (gerado localmente) -----
router.get('/api/agents/:agentId/qr.png', auth, async (req, res) => {
  const { agentId } = req.params;
  if (!CONFIG.sessionIds[agentId]) return res.status(404).end();
  const sessionId = CONFIG.sessionIds[agentId];
  const qr = baileys.getQRCode(sessionId);
  if (!qr) return res.status(204).end();
  try {
    const QRCode = require('qrcode');
    const buf = await QRCode.toBuffer(qr, { width: 256, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Pairing code (conectar por número de telefone) -----
router.post('/api/agents/:agentId/pairing-code', auth, async (req, res) => {
  const { agentId } = req.params;
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório (ex: 5562991819645)' });
  if (!CONFIG.sessionIds[agentId]) return res.status(404).json({ error: 'Agente não encontrado' });
  try {
    const code = await baileys.requestPairingCodeFor(CONFIG.sessionIds[agentId], phone);
    res.json({ code });
  } catch (e) {
    console.error(`[ROUTES] Erro pairing code ${agentId}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ----- Reconectar agente -----
router.post('/api/agents/:agentId/reconnect', auth, async (req, res) => {
  const { agentId } = req.params;
  if (!CONFIG.sessionIds[agentId]) return res.status(404).json({ error: 'Agente não encontrado' });
  try {
    const sessionId = CONFIG.sessionIds[agentId];
    await baileys.reconnect(sessionId);
    res.json({ ok: true, message: 'Reconexão iniciada. Aguarde o QR Code.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Webhook WhatsApp — Info-Produtos -----
router.post('/info/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const agent = require('./agents/info-produtos');
    const body = req.body;
    if (body?.type === 'ReceivedCallback' || body?.type === 'message') {
      const phone = body.phone || body.from?.replace('@s.whatsapp.net', '');
      const text = body.text?.message || body.body || '';
      if (phone && text) {
        await agent.processMessage('received', { phone, body: text, pushName: body.pushName || '' });
      }
    }
  } catch (e) {
    console.error('[ROUTES] Erro webhook info:', e.message);
  }
});

// ----- Webhook WhatsApp — Logzz -----
router.post('/logzz/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const agent = require('./agents/logzz');
    const body = req.body;
    if (body?.type === 'ReceivedCallback' || body?.type === 'message') {
      const phone = body.phone || body.from?.replace('@s.whatsapp.net', '');
      const text = body.text?.message || body.body || '';
      if (phone && text) {
        await agent.processMessage('received', { phone, body: text, pushName: body.pushName || '' });
      }
    }
  } catch (e) {
    console.error('[ROUTES] Erro webhook logzz:', e.message);
  }
});

// ----- Webhook Logzz — Status de Pedido -----
// URL para colocar na plataforma: https://central-vendas-production.up.railway.app/webhook/logzz-pedido
const MSGS_STATUS_PEDIDO = {
  confirmado:  (nome) => `Olá${nome}! 🎉 Seu pedido da *Resina Extreme* foi *confirmado*! Em breve nossa equipe entrará em contato para agendar a entrega. Qualquer dúvida é só falar!`,
  agendado:    (nome) => `Oi${nome}! Vi aqui que seu pedido foi agendado, no dia escolhido o entregador vai entrar em contato com você para confirmar a entrega. 😊`,
  em_rota:     (nome) => `Oiee${nome}, passando para avisar que seu pedido já saiu em rota, chega hoje. 🚚`,
  completo:    (nome) => `Oi${nome}! Vi que seu pedido foi entregue, chegou tudo certinho aí? 😊`,
};

function normalizarStatus(raw = '') {
  const s = raw.toLowerCase().replace(/[_\s-]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.includes('confirmad')) return 'confirmado';
  if (s.includes('agendad'))   return 'agendado';
  if (s.includes('rota') || s.includes('caminho') || s.includes('saiu')) return 'em_rota';
  if (s.includes('complet') || s.includes('entregue') || s.includes('finaliz')) return 'completo';
  return null;
}

router.post('/webhook/logzz-pedido', async (req, res) => {
  res.sendStatus(200);
  try {
    const payload = req.body;
    console.log('[WEBHOOK-LOGZZ-PEDIDO] Payload recebido:', JSON.stringify(payload).slice(0, 500));

    // Extrair phone — a plataforma Logzz pode enviar em vários campos
    const rawPhone =
      payload.phone ||
      payload.telefone ||
      payload.customer?.phone ||
      payload.customer?.telefone ||
      payload.buyer?.phone ||
      payload.order?.phone ||
      payload.whatsapp ||
      '';

    // Normalizar: só dígitos, garantir código do país 55
    let phone = String(rawPhone).replace(/\D/g, '');
    if (!phone) {
      console.warn('[WEBHOOK-LOGZZ-PEDIDO] Nenhum telefone encontrado no payload');
      return;
    }
    if (!phone.startsWith('55')) phone = '55' + phone;

    // Extrair status
    const rawStatus =
      payload.status ||
      payload.order_status ||
      payload.order?.status ||
      payload.pedido?.status ||
      '';

    const status = normalizarStatus(rawStatus);
    if (!status) {
      console.log(`[WEBHOOK-LOGZZ-PEDIDO] Status ignorado: "${rawStatus}"`);
      return;
    }

    // Nome do cliente
    const nomeRaw =
      payload.name ||
      payload.nome ||
      payload.customer?.name ||
      payload.customer?.nome ||
      payload.buyer?.name ||
      '';
    const nome = nomeRaw ? ` ${nomeRaw.split(' ')[0]}` : '';

    const msg = MSGS_STATUS_PEDIDO[status](nome);

    const sessionId = CONFIG.sessionIds.logzz;
    if (baileys.getState(sessionId) !== 'connected') {
      console.warn('[WEBHOOK-LOGZZ-PEDIDO] Roberto desconectado — mensagem não enviada');
      return;
    }

    await baileys.sendText(sessionId, phone, msg);
    const { addMsg } = require('./database');
    addMsg('logzz', phone, 'assistant', msg);

    console.log(`[WEBHOOK-LOGZZ-PEDIDO] Mensagem "${status}" enviada para ${phone}`);
  } catch (e) {
    console.error('[WEBHOOK-LOGZZ-PEDIDO] Erro:', e.message);
  }
});

// ----- Conversas por agente -----
router.get('/api/conversas/:agentId', auth, (req, res) => {
  const { agentId } = req.params;
  const convs = db.getAllConvs(agentId);
  res.json(convs);
});

router.get('/api/conversas/:agentId/:phone', auth, (req, res) => {
  const { agentId, phone } = req.params;
  const conv = db.getConv(agentId, phone);
  const pausado = db.isPaused(agentId, phone);
  res.json({ ...conv, pausado });
});

// ----- Pausar / Iniciar conversa -----
router.post('/api/conversas/:agentId/:phone/pause', auth, (req, res) => {
  const { agentId, phone } = req.params;
  db.pausePhone(agentId, phone);
  res.json({ ok: true, pausado: true });
});

router.post('/api/conversas/:agentId/:phone/resume', auth, (req, res) => {
  const { agentId, phone } = req.params;
  db.resumePhone(agentId, phone);
  res.json({ ok: true, pausado: false });
});

// ----- Enviar mensagem manual pelo dashboard -----
router.post('/api/conversas/:agentId/:phone/send', auth, async (req, res) => {
  const { agentId, phone } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Texto ausente' });

  const sessionId = CONFIG.sessionIds[agentId];
  if (!sessionId) return res.status(400).json({ error: 'Agente inválido' });

  try {
    const originalJid = resolveCommonAgentJid(phone);
    console.log(`[ROUTES] Envio manual → agente=${agentId} phone=${phone} jid=${originalJid || '(padrão)'}`);
    await baileys.sendText(sessionId, phone, text, originalJid);
    db.addMsg(agentId, phone, 'assistant', text);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[ROUTES] Erro envio manual → ${phone}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

function resolveCommonAgentJid(phone) {
  if (!phone) return null;
  const raw = String(phone);
  if (raw.includes('@')) return raw;

  const mapped = db.state.phoneLidMap?.get(raw);
  if (mapped) return String(mapped).includes('@') ? mapped : `${mapped}@lid`;

  const clean = raw.replace(/\D/g, '');
  if (/^\d{12,}$/.test(clean) && !clean.startsWith('55')) return `${clean}@lid`;
  return null;
}

// ----- Pedidos Logzz -----
router.get('/api/pedidos', auth, (req, res) => {
  res.json(db.getPedidos());
});

router.post('/api/pedidos', auth, (req, res) => {
  const pedido = db.addPedido(req.body);
  res.json(pedido);
});

router.patch('/api/pedidos/:id', auth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const pedido = db.updatePedidoStatus(id, status);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  res.json(pedido);
});

// ----- Links de Oferta Logzz -----
router.get('/api/links-oferta', auth, (req, res) => {
  res.json(db.getLinksOferta());
});

router.post('/api/links-oferta', auth, (req, res) => {
  const { titulo, url, descricao } = req.body;
  if (!titulo || !url) return res.status(400).json({ error: 'Título e URL são obrigatórios' });
  const link = db.addLinkOferta({ titulo, url, descricao });
  res.json(link);
});

router.delete('/api/links-oferta/:id', auth, (req, res) => {
  db.removeLinkOferta(req.params.id);
  res.json({ ok: true });
});

// ----- Logs operacionais -----
router.get('/api/system/logs', auth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = db
    .getSystemLogs(limit * 3)
    .filter((log) => !(new RegExp(['jarvis', 'gestor'].join('|'), 'i')).test(log.msg || ''))
    .slice(0, limit);
  res.json(logs);
});

// ----- Instruções dos agentes -----
router.get('/api/instrucoes/:agentId', auth, (req, res) => {
  res.json({ instrucao: db.getInstrucao(req.params.agentId) });
});

router.post('/api/instrucoes/:agentId', auth, (req, res) => {
  db.setInstrucao(req.params.agentId, req.body.instrucao || '');
  res.json({ ok: true });
});

// ----- Diagnóstico de áudio -----
router.get('/api/debug/audio', auth, async (req, res) => {
  const out = {};
  try {
    out.groqKeySet = !!CONFIG.groqKey;
    out.groqKeyPrefix = CONFIG.groqKey ? CONFIG.groqKey.slice(0, 10) + '...' : 'NAO CONFIGURADA';

    // Teste 1: Groq API acessível
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${CONFIG.groqKey}` },
      });
      out.groqApiStatus = r.status;
      out.groqApiOk = r.ok;
    } catch (e) { out.groqApiError = e.message; }

    // Teste 2: Buffer + Blob + FormData
    try {
      const buf = Buffer.from('SGVsbG8=', 'base64');
      const blob = new Blob([buf], { type: 'audio/ogg' });
      const form = new FormData();
      form.append('file', blob, 'test.ogg');
      out.blobSize = blob.size;
      out.formDataOk = true;
    } catch (e) { out.formDataError = e.message; }

    // Teste 3: Pipeline completo com áudio WAV mínimo (44 bytes de silêncio)
    try {
      const { transcribeAudio } = require('./services');
      const wavB64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      const result = await transcribeAudio(`data:audio/wav;base64,${wavB64}`);
      out.transcribeResult = result;
      out.transcribeOk = result !== null;
    } catch (e) { out.transcribeError = e.message; }

  } catch (e) { out.fatalError = e.message; }
  res.json(out);
});

// ----- Upload de sessão (para transferir sessão local → Railway) -----
router.post('/admin/upload-session', auth, async (req, res) => {
  const { agentId, files } = req.body; // files: { filename: base64content }
  if (!agentId || !files || typeof files !== 'object') {
    return res.status(400).json({ error: 'agentId e files obrigatórios' });
  }
  if (!CONFIG.sessionIds[agentId]) return res.status(404).json({ error: 'Agente não encontrado' });
  const sessionId = CONFIG.sessionIds[agentId];
  try {
    const fs = require('fs');
    const BASE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp';
    const authDir = path.join(BASE_DIR, `baileys_cv_${sessionId}`);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    const SAFE_NAME = /^[\w\-\.]+$/;
    for (const [filename, b64] of Object.entries(files)) {
      if (!SAFE_NAME.test(filename) || filename.includes('..')) continue;
      fs.writeFileSync(path.join(authDir, filename), Buffer.from(b64, 'base64'));
    }
    // Reiniciar conexão sem apagar arquivos (soft restart)
    await baileys.restartConnection(sessionId);
    res.json({ ok: true, filesWritten: Object.keys(files).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Limpar pausas de um agente -----
router.delete('/api/agents/:agentId/pauses', auth, (req, res) => {
  const { agentId } = req.params;
  if (!['info', 'logzz', 'rafael', 'sarah', 'antonio'].includes(agentId)) return res.status(404).json({ error: 'Agente não encontrado' });
  db.clearPauses(agentId);
  res.json({ ok: true, message: `Pausas do agente ${agentId} limpas` });
});

// ----- Migração: restaurar linkEnviadoEm e desbloquear conversas travadas pelo echo bug -----
router.post('/api/agents/:agentId/fix-followup', auth, (req, res) => {
  const { agentId } = req.params;
  if (!['logzz', 'sarah'].includes(agentId)) return res.status(404).json({ error: 'Apenas logzz e sarah' });

  const convMap = db.state.conversations[agentId];
  if (!convMap) return res.json({ ok: true, fixed: 0, unpaused: 0 });

  const LINK_PATTERNS = ['entrega.logzz.com.br', 'logzz.com.br'];
  let fixed = 0, unpaused = 0;

  for (const [phone, conv] of convMap.entries()) {
    const msgs = conv.msgs || [];

    // 1. Restaurar linkEnviadoEm se link foi enviado mas campo está vazio
    if (!conv.linkEnviadoEm) {
      const linkMsg = [...msgs].reverse().find(m =>
        m.role === 'assistant' && LINK_PATTERNS.some(p => (m.text || '').includes(p))
      );
      if (linkMsg) {
        conv.linkEnviadoEm = linkMsg.ts || (Date.now() - 2 * 60 * 60 * 1000);
        conv.followUpEnviado = false;
        conv.remarketingEnviado = false;
        fixed++;
      }
    }

    // 2. Desbloquear conversas pausadas pelo echo bug:
    //    últimas 3+ mensagens são todas [mídia] do usuário E há mensagem do assistente antes delas
    if (db.isPaused(agentId, phone) && conv.linkEnviadoEm) {
      const ultimas = msgs.slice(-6);
      const todasMidiaUser = ultimas.length >= 3 && ultimas.every(m => m.role === 'user' && (m.text || '').trim() === '[mídia]');
      if (todasMidiaUser) {
        db.resumePhone(agentId, phone);
        // Limpar as mensagens [mídia] falsas do histórico
        conv.msgs = msgs.filter((m, i) => !(i >= msgs.length - 6 && m.role === 'user' && (m.text || '').trim() === '[mídia]'));
        unpaused++;
      }
    }
  }

  db.saveDB().catch(() => {});
  res.json({ ok: true, fixed, unpaused, total: convMap.size });
});

// ----- Endpoint de teste para simular mensagem recebida -----
router.post('/api/agents/:agentId/test-message', auth, async (req, res) => {
  const { agentId } = req.params;
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });
  if (!['info', 'logzz', 'rafael', 'sarah', 'antonio'].includes(agentId)) return res.status(404).json({ error: 'Agente não encontrado' });
  try {
    const agentMap = { logzz: './agents/logzz', rafael: './agents/rafael', info: './agents/info-produtos' };
    const agent = require(agentMap[agentId]);
    await agent.processMessage('received', { phone, body: message, pushName: 'Teste', isFromMe: false, _originalJid: resolveCommonAgentJid(phone) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Remarketing Logzz / ATK -----
const _remarkTempImgs = new Map();
const _remarkState = {
  logzz:   { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0, pulados: 0, campanhaId: null, atual: '' },
  sarah:   { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0, pulados: 0, campanhaId: null, atual: '' },
  pedro:   { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0, pulados: 0, campanhaId: null, atual: '' },
  rodrigo: { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0, pulados: 0, campanhaId: null, atual: '' },
  antonio: { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0, pulados: 0, campanhaId: null, atual: '' },
};
const VALID_REMARK_AGENTS = ['logzz', 'sarah', 'pedro', 'rodrigo', 'antonio'];
const ATK_REMARK_AGENTS   = ['pedro', 'rodrigo'];

router.post('/api/remarketing/temp-img', auth, (req, res) => {
  const { base64, mimetype } = req.body;
  if (!base64 || !mimetype) return res.status(400).json({ error: 'base64 e mimetype obrigatorios' });
  const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  const id = crypto.randomBytes(10).toString('hex');
  _remarkTempImgs.set(id, { buffer, mimetype, expiresAt: Date.now() + 7200000 });
  const url = `${req.protocol}://${req.get('host')}/api/remarketing/temp-img/${id}`;
  res.json({ ok: true, id, url });
});

router.get('/api/remarketing/temp-img/:id', (req, res) => {
  const img = _remarkTempImgs.get(req.params.id);
  if (!img || img.expiresAt < Date.now()) return res.status(404).send('Not found');
  res.setHeader('Content-Type', img.mimetype);
  res.send(img.buffer);
});

function _getRemarketingTempImage(imagemUrl) {
  if (!imagemUrl) return null;
  const id = String(imagemUrl).split('/api/remarketing/temp-img/')[1]?.split(/[?#]/)[0];
  if (!id) return null;
  const img = _remarkTempImgs.get(id);
  if (!img || img.expiresAt < Date.now()) return null;
  return img;
}

// Normaliza número para comparação: remove @sufixo, tenta resolver LID, pega últimos 10 dígitos
function _normalizeMediaUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  const driveMatch = raw.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (driveMatch) return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  return raw;
}

function _canonicalPhone(numero, dbAtk) {
  if (!numero) return '';
  const raw = String(numero);
  const stripped = raw.replace(/@[^@]+$/, '').replace(/:/g, '');
  const candidates = [raw, stripped];
  if (!raw.includes('@') && stripped) {
    candidates.push(`${stripped}@lid`, `${stripped}@s.whatsapp.net`);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const clean = String(candidate).replace(/@[^@]+$/, '').replace(/:/g, '');

    if (dbAtk) {
      const atkPhone = dbAtk.resolvePhone(candidate) || dbAtk.resolvePhone(clean);
      if (atkPhone) return String(atkPhone).replace(/\D/g, '').slice(-10);
    }

    const mappedPhone = db.mapLidToPhone?.(candidate) || db.mapLidToPhone?.(clean);
    if (mappedPhone) return String(mappedPhone).replace(/\D/g, '').slice(-10);
  }

  return stripped.replace(/\D/g, '').slice(-10);
}

// Deduplica array de contatos por telefone canônico, mantendo o mais recente
function _mergeRemarketingContato(base, incoming) {
  const merged = { ...base };
  if ((incoming.ultimaMensagem || 0) > (merged.ultimaMensagem || 0)) {
    merged.numero = incoming.numero;
    merged.nome = incoming.nome || merged.nome;
    merged.ultimaMensagem = incoming.ultimaMensagem || merged.ultimaMensagem;
  } else if (!merged.nome && incoming.nome) {
    merged.nome = incoming.nome;
  }
  merged.pausado = !!(merged.pausado || incoming.pausado);
  merged.pausadoEm = Math.max(
    Number(merged.pausadoEm || 0),
    Number(incoming.pausadoEm || 0)
  );
  merged.remarketingEnviadoEm = Math.max(
    Number(merged.remarketingEnviadoEm || 0),
    Number(incoming.remarketingEnviadoEm || 0)
  );
  merged.respondeuRemarketingEm = Math.max(
    Number(merged.respondeuRemarketingEm || 0),
    Number(incoming.respondeuRemarketingEm || 0)
  );
  merged.falhaRemarketingEm = Math.max(
    Number(merged.falhaRemarketingEm || 0),
    Number(incoming.falhaRemarketingEm || 0)
  );
  merged.falhaRemarketingMotivo = incoming.falhaRemarketingMotivo || merged.falhaRemarketingMotivo || '';
  merged.campanhaId = incoming.campanhaId || merged.campanhaId || '';
  merged.campanhaNome = incoming.campanhaNome || merged.campanhaNome || '';
  return merged;
}

function _deduplicateContatos(contatos, dbAtk) {
  const seen = new Map();
  const result = [];
  for (const c of contatos) {
    const canon = _canonicalPhone(c.numero, dbAtk);
    if (!canon || canon.length < 6) { result.push(c); continue; }
    if (seen.has(canon)) {
      const idx = seen.get(canon);
      result[idx] = _mergeRemarketingContato(result[idx], c);
    } else {
      seen.set(canon, result.length);
      result.push(c);
    }
  }
  return result;
}

function _lastUserAfterRemarketing(conv) {
  const sentAt = Number(conv?.remarketingEnviadoEm || 0);
  if (!sentAt) return Number(conv?.remarketingRespondidoEm || 0);
  let last = Number(conv?.remarketingRespondidoEm || 0);
  for (const msg of conv?.msgs || []) {
    const ts = Number(msg.timestamp || msg.ts || 0);
    if (msg.role === 'user' && ts > sentAt && ts > last) last = ts;
  }
  return last;
}

function _remarketingCampaignMeta(dbAtk, agentId, numero) {
  if (!dbAtk?.listRemarketingCampaigns) return {};
  const last8 = String(numero || '').slice(-8);
  for (const c of dbAtk.listRemarketingCampaigns(agentId)) {
    const hasNumber = (item) => {
      const n = typeof item === 'object' && item ? item.numero : item;
      return n === numero || String(n || '').slice(-8) === last8;
    };
    if ((c.responded || []).some(hasNumber)) return { campanhaId: c.id, campanhaNome: c.name, respondeuRemarketingEm: c.updatedAt || c.createdAt || 0 };
    const failed = (c.failedTo || []).find(hasNumber);
    if (failed) return { campanhaId: c.id, campanhaNome: c.name, falhaRemarketingEm: failed.at || c.updatedAt || 0, falhaRemarketingMotivo: failed.error || 'erro' };
    if ((c.sentTo || []).some(hasNumber)) return { campanhaId: c.id, campanhaNome: c.name };
  }
  return {};
}

function _markCanonicalRemarketingSent(agente, numero, sentAt, dbAtk) {
  const targetCanon = _canonicalPhone(numero, dbAtk);
  if (!targetCanon || targetCanon.length < 6) return 0;
  let marked = 0;
  const map = ATK_REMARK_AGENTS.includes(agente)
    ? dbAtk?.state?.conversations?.[agente]
    : db.state.conversations[agente];
  if (!map) return 0;

  map.forEach((conv, key) => {
    if (_canonicalPhone(key, dbAtk) !== targetCanon) return;
    conv.remarketingEnviadoEm = Math.max(Number(conv.remarketingEnviadoEm || 0), sentAt);
    marked++;
  });
  return marked;
}

router.get('/api/remarketing/contatos', auth, (req, res) => {
  const agentId = req.query.agente;
  if (!VALID_REMARK_AGENTS.includes(agentId)) return res.status(400).json({ error: 'agente invalido' });
  const raw = [];
  let dbAtkRef = null;
  if (ATK_REMARK_AGENTS.includes(agentId)) {
    const dbAtk = require('./database-atk');
    dbAtkRef = dbAtk;
    dbAtk.state.conversations[agentId].forEach((conv, numero) => {
      if (!conv.msgs || conv.msgs.length === 0) return;
      if (dbAtk.isAgentNumber(numero)) return;
      const campaignMeta = _remarketingCampaignMeta(dbAtk, agentId, numero);
      raw.push({
        numero,
        nome: conv.pushName || '',
        ultimaMensagem: conv.ultimaMensagem || 0,
        pausado: dbAtk.isManuallyPaused(numero),
        pausadoEm: dbAtk.getManualPausedAt(numero, agentId),
        remarketingEnviadoEm: conv.remarketingEnviadoEm || 0,
        respondeuRemarketingEm: Math.max(_lastUserAfterRemarketing(conv), Number(campaignMeta.respondeuRemarketingEm || 0)),
        falhaRemarketingEm: campaignMeta.falhaRemarketingEm || 0,
        falhaRemarketingMotivo: campaignMeta.falhaRemarketingMotivo || '',
        campanhaId: campaignMeta.campanhaId || conv.ultimaCampanhaRemarketingId || '',
        campanhaNome: campaignMeta.campanhaNome || '',
      });
    });
  } else {
    db.state.conversations[agentId].forEach((conv, numero) => {
      if (!conv.msgs || conv.msgs.length === 0) return;
      raw.push({
        numero,
        nome: conv.pushName || '',
        ultimaMensagem: conv.ultimaMensagem || 0,
        pausado: db.state.paused[agentId]?.has(numero) || false,
        remarketingEnviadoEm: conv.remarketingEnviadoEm || 0,
        respondeuRemarketingEm: _lastUserAfterRemarketing(conv),
      });
    });
  }
  let contatos = _deduplicateContatos(raw, dbAtkRef);
  contatos.sort((a, b) => b.ultimaMensagem - a.ultimaMensagem);
  if (req.query.pausado === 'true') contatos = contatos.filter(c => c.pausado);
  if (req.query.pausado === 'false') contatos = contatos.filter(c => !c.pausado);
  res.json(contatos);
});

router.get('/api/remarketing/campanhas', auth, (req, res) => {
  const agentId = req.query.agente;
  if (!ATK_REMARK_AGENTS.includes(agentId)) return res.status(400).json({ error: 'agente ATK invalido' });
  try {
    const dbAtk = require('./database-atk');
    res.json(dbAtk.listRemarketingCampaigns(agentId).slice(0, 20));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/remarketing/enviar', auth, async (req, res) => {
  const { agente, numeros, texto, textos, imagemUrl, pausarAposEnvio, nomeCampanha } = req.body;
  const mediaType = req.body.mediaType === 'video' ? 'video' : 'image';
  const delayMs = Math.max(3000, Number(req.body.delayMs || 3000));
  const textosValidos = Array.isArray(textos) ? textos.map(t => String(t || '').trim()).filter(Boolean) : [];
  const textoPrincipal = textosValidos.length ? textosValidos[0] : texto;
  const mediaUrl = imagemUrl ? _normalizeMediaUrl(imagemUrl) : '';
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  if (!numeros?.length) return res.status(400).json({ error: 'numeros obrigatorios' });
  if (!textoPrincipal && !mediaUrl) return res.status(400).json({ error: 'texto ou imagem obrigatorio' });
  if (_remarkState[agente].ativo) return res.status(409).json({ error: 'Remarketing ja em andamento' });

  const isAtk = ATK_REMARK_AGENTS.includes(agente);
  const dbAtkForDedup = isAtk ? require('./database-atk') : null;
  const seenInput = new Set();
  const numerosParaEnvio = [];
  for (const numero of numeros) {
    const canon = _canonicalPhone(numero, dbAtkForDedup);
    const key = canon && canon.length >= 6 ? canon : `raw:${numero}`;
    if (seenInput.has(key)) continue;
    seenInput.add(key);
    numerosParaEnvio.push(numero);
  }
  if (isAtk) {
    for (let i = numerosParaEnvio.length - 1; i >= 0; i--) {
      if (dbAtkForDedup.isAgentNumber(numerosParaEnvio[i])) numerosParaEnvio.splice(i, 1);
    }
  }
  if (!numerosParaEnvio.length) return res.status(400).json({ error: 'nenhum numero valido para envio' });

  let remarketingCampaign = null;
  if (isAtk) {
    remarketingCampaign = dbAtkForDedup.createRemarketingCampaign({
      agentId: agente,
      name: nomeCampanha,
      text: textoPrincipal,
      imageUrl: mediaUrl,
      pauseAfterSend: pausarAposEnvio,
      total: numerosParaEnvio.length,
      recipients: numerosParaEnvio,
    });
  }

  const state = _remarkState[agente];
  state.ativo = true; state.pausado = false; state.cancelar = false; state.enviados = 0; state.erros = 0; state.pulados = 0; state.total = numerosParaEnvio.length; state.campanhaId = remarketingCampaign?.id || null; state.atual = '';
  res.json({ ok: true, total: numerosParaEnvio.length, campanhaId: remarketingCampaign?.id || null });

  const sessionId = isAtk ? agente : CONFIG.sessionIds[agente];
  const TIMEOUT_ENVIO = mediaType === 'video' ? 60000 : 18000;

  function isOwnAgentJid(jid) {
    if (!jid) return false;
    const digits = String(jid).replace(/\D/g, '');
    const dbAtk = require('./database-atk');
    return dbAtk.isAgentNumber(digits);
  }

  function jidLooksCompatible(jid, numero) {
    if (!jid || !numero) return false;
    if (String(jid).includes('@lid')) return true;
    const jidDigits = String(jid).replace(/\D/g, '');
    const numDigits = String(numero).replace(/\D/g, '');
    if (!jidDigits || !numDigits) return false;
    return jidDigits.endsWith(numDigits.slice(-8)) || numDigits.endsWith(jidDigits.slice(-8));
  }

  function resolveJid(numero) {
    if (isAtk) {
      const dbAtk = require('./database-atk');
      // 1. Pegar _originalJid salvo na conversa (fonte mais confiável)
      const conv = dbAtk.state.conversations[agente]?.get(numero);
      if (conv?._originalJid && !isOwnAgentJid(conv._originalJid) && jidLooksCompatible(conv._originalJid, numero)) return conv._originalJid;
      if (conv?._originalJid && isOwnAgentJid(conv._originalJid)) {
        delete conv._originalJid;
        dbAtk.save();
      }
      // 2. Se o numero já tem @ (é JID completo), usar direto
      if (numero.includes('@') && !isOwnAgentJid(numero)) return numero;
      // 3. Se parece LID (sem prefixo 55 e ≥12 dígitos), usar @lid
      if (!numero.startsWith('55') && numero.length >= 12) return `${numero}@lid`;
      return null;
    }
    const lidJid = db.state.phoneLidMap?.get(numero);
    if (lidJid) return lidJid;
    if (numero.length >= 15 && !numero.startsWith('55')) return `${numero}@lid`;
    return null;
  }

  (async () => {
    let consecutiveTimeouts = 0;
    const _sentCanonical = new Set(); // anti-duplicata por sessão de envio
    let envioIndex = 0;
    for (const numero of numerosParaEnvio) {
      // Bloqueia duplicata: mesmo número com chaves diferentes no Map
      const canon = _canonicalPhone(numero, isAtk ? require('./database-atk') : null);
      if (canon && canon.length >= 6) {
        if (_sentCanonical.has(canon)) {
          console.log(`[Remarketing] Duplicata ignorada: ${numero} (canon: ${canon})`);
          state.pulados++;
          if (isAtk && remarketingCampaign) require('./database-atk').markRemarketingCampaignSkipped(remarketingCampaign.id, numero, 'duplicata');
          continue;
        }
        _sentCanonical.add(canon);
      }

      while (state.pausado && !state.cancelar) {
        await new Promise(r => setTimeout(r, 1000));
      }
      if (state.cancelar) break;
      state.atual = numero;
      if (baileys.getState(sessionId) !== 'connected') {
        console.log(`[Remarketing] ${sessionId} desconectado — abortando`);
        break;
      }
      try {
        const originalJid = resolveJid(numero);
        const textoAtual = textosValidos.length ? textosValidos[envioIndex % textosValidos.length] : textoPrincipal;
        envioIndex++;
        const tempImage = mediaType === 'image' ? _getRemarketingTempImage(mediaUrl) : null;
        const sendFn = mediaUrl
          ? () => tempImage
            ? baileys.sendMediaBuffer(sessionId, numero, 'image', tempImage.buffer, textoAtual || '', originalJid, tempImage.mimetype)
            : baileys.sendMedia(sessionId, numero, mediaType, mediaUrl, textoAtual || '', originalJid)
          : () => baileys.sendText(sessionId, numero, textoAtual, originalJid);
        await Promise.race([
          sendFn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('__timeout__')), TIMEOUT_ENVIO)),
        ]);
        consecutiveTimeouts = 0;
        const sentAt = Date.now();
        if (isAtk) {
          const dbAtk = require('./database-atk');
          if (pausarAposEnvio) dbAtk.pauseManual(numero, agente);
          const conv = dbAtk.getConversation(agente, numero);
          if (conv) {
            conv.msgs.push({ role: 'assistant', content: textoAtual || (mediaType === 'video' ? '[video]' : '[imagem]'), timestamp: sentAt });
            conv.ultimaMensagem = sentAt;
            conv.remarketingEnviadoEm = sentAt;
            conv.remarketingRespondidoEm = 0;
            conv.ultimaCampanhaRemarketingId = remarketingCampaign?.id || null;
          }
          _markCanonicalRemarketingSent(agente, numero, sentAt, dbAtk);
          if (remarketingCampaign) dbAtk.markRemarketingCampaignSent(remarketingCampaign.id, numero);
          dbAtk.save();
        } else {
          if (pausarAposEnvio) db.pausePhone(agente, numero);
          db.addMsg(agente, numero, 'assistant', textoAtual || (mediaType === 'video' ? '[video]' : '[imagem]'));
          const convCvn = db.state.conversations[agente]?.get(numero);
          if (convCvn) convCvn.remarketingEnviadoEm = sentAt;
          _markCanonicalRemarketingSent(agente, numero, sentAt, null);
          if (textoAtual) {
            const convState = db.state.conversations[agente]?.get(numero);
            if (convState) convState.remarketingContexto = textoAtual;
          }
        }
        state.enviados++;
      } catch (e) {
        state.erros++;
        if (isAtk && remarketingCampaign) require('./database-atk').markRemarketingCampaignFailed(remarketingCampaign.id, numero, e.message);
        if (e.message === '__timeout__') {
          consecutiveTimeouts++;
          console.error(`[Remarketing] Timeout ${numero} (${consecutiveTimeouts} consecutivos)`);
          if (consecutiveTimeouts >= 3) {
            console.log(`[Remarketing] 3 timeouts consecutivos — WhatsApp throttling, abortando`);
            break;
          }
          await new Promise(r => setTimeout(r, 8000));
          continue;
        }
        console.error(`[Remarketing] Erro ${numero}:`, e.message);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    state.ativo = false;
    state.atual = '';
    if (isAtk && remarketingCampaign) {
      require('./database-atk').finishRemarketingCampaign(remarketingCampaign.id, state.cancelar ? 'stopped' : 'finished');
    }
    console.log(`[Remarketing] ${agente}: ${state.enviados}/${state.total} OK, ${state.erros} erros`);
  })();
});

router.get('/api/remarketing/status', auth, (req, res) => {
  const agentId = req.query.agente;
  if (!VALID_REMARK_AGENTS.includes(agentId)) return res.status(400).json({ error: 'agente invalido' });
  res.json(_remarkState[agentId]);
});

router.post('/api/remarketing/parar', auth, (req, res) => {
  const { agente } = req.body;
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].cancelar = true;
  setTimeout(() => { _remarkState[agente].ativo = false; }, 25000);
  res.json({ ok: true });
});

router.post('/api/remarketing/pausar', auth, (req, res) => {
  const { agente } = req.body;
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].pausado = true;
  res.json({ ok: true });
});

router.post('/api/remarketing/retomar', auth, (req, res) => {
  const { agente } = req.body;
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].pausado = false;
  res.json({ ok: true });
});

// Recuperação retroativa: marca contatos que receberam remarketing nos últimos 7 dias
router.post('/api/remarketing/recuperar/:agente', auth, (req, res) => {
  const { agente } = req.params;
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let marcados = 0;
  try {
    if (ATK_REMARK_AGENTS.includes(agente)) {
      const dbAtk = require('./database-atk');
      dbAtk.state.conversations[agente].forEach((conv) => {
        if (conv.remarketingEnviadoEm) return;
        const last = [...(conv.msgs || [])].reverse().find(m => m.role === 'assistant');
        if (last && (last.timestamp || 0) > limite) {
          conv.remarketingEnviadoEm = last.timestamp;
          marcados++;
        }
      });
      dbAtk.save();
    } else {
      db.state.conversations[agente]?.forEach((conv) => {
        if (conv.remarketingEnviadoEm) return;
        const last = [...(conv.msgs || [])].reverse().find(m => m.role === 'assistant');
        if (last && (last.ts || 0) > limite) {
          conv.remarketingEnviadoEm = last.ts;
          marcados++;
        }
      });
      db.saveDB().catch(() => {});
    }
    res.json({ ok: true, marcados });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpeza de duplicatas: consolida entradas com mesmo telefone canônico no Map
router.post('/api/remarketing/deduplicar/:agente', auth, (req, res) => {
  const { agente } = req.params;
  if (!VALID_REMARK_AGENTS.includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  try {
    const isAtk = ATK_REMARK_AGENTS.includes(agente);
    const dbAtk = isAtk ? require('./database-atk') : null;
    const map = isAtk ? dbAtk.state.conversations[agente] : db.state.conversations[agente];
    if (!map) return res.status(404).json({ error: 'agente sem conversas' });

    // 1. Agrupar chaves por telefone canônico
    const grupos = new Map(); // canon -> [{ key, conv }]
    map.forEach((conv, key) => {
      if (!conv.msgs || conv.msgs.length === 0) return;
      const canon = _canonicalPhone(key, dbAtk);
      if (!canon || canon.length < 6) return;
      if (!grupos.has(canon)) grupos.set(canon, []);
      grupos.get(canon).push({ key, conv });
    });

    let removidos = 0;
    // 2. Para cada grupo com duplicatas, manter o melhor e deletar os outros
    grupos.forEach((entries) => {
      if (entries.length <= 1) return;
      // Ordenar: prefere chave sem @lid, depois mais recente
      entries.sort((a, b) => {
        const aLid = a.key.includes('@lid') ? 1 : 0;
        const bLid = b.key.includes('@lid') ? 1 : 0;
        if (aLid !== bLid) return aLid - bLid;
        return (b.conv.ultimaMensagem || 0) - (a.conv.ultimaMensagem || 0);
      });
      const [keeper, ...losers] = entries;
      // Mesclar remarketingEnviadoEm do melhor valor entre todos
      const bestRemark = Math.max(...entries.map(e => Number(e.conv.remarketingEnviadoEm || 0)));
      if (bestRemark > 0) keeper.conv.remarketingEnviadoEm = bestRemark;
      // Mesclar msgs: keeper fica com seus msgs + qualquer msg dos losers mais recente que a última do keeper
      for (const loser of losers) {
        map.delete(loser.key);
        removidos++;
      }
    });

    if (isAtk) dbAtk.save();
    else db.saveDB().catch(() => {});

    const totalRestante = [...map.values()].filter(c => c.msgs && c.msgs.length > 0).length;
    const naoReceberam = [...map.values()].filter(c => c.msgs && c.msgs.length > 0 && !c.remarketingEnviadoEm).length;
    res.json({ ok: true, removidos, totalRestante, naoReceberam });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----- Finanças Familiares -----
const financas = require('./financas');

router.get('/api/financas/resumo', auth, (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const resumo = financas.getResumoMensal(db, mes);
  res.json(resumo);
});

router.get('/api/financas/transacoes', auth, (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const tipo = req.query.tipo || 'todas';
  const limite = parseInt(req.query.limite) || 50;
  let transacoes = financas.getTransacoesMes(db, mes);
  if (tipo !== 'todas') transacoes = transacoes.filter(t => t.tipo === tipo);
  res.json({ transacoes: transacoes.slice(0, limite) });
});

router.post('/api/financas/transacoes', auth, (req, res) => {
  const { tipo, valor, categoria, descricao, quem } = req.body;
  if (!tipo || !valor || !categoria || !descricao || !quem) {
    return res.status(400).json({ error: 'Campos obrigatórios: tipo, valor, categoria, descricao, quem' });
  }
  const entrada = financas.addTransacao(db, { tipo, valor, categoria, descricao, quem });
  res.json({ ok: true, transacao: entrada });
});

router.post('/api/financas/meta', auth, (req, res) => {
  const { valor } = req.body;
  if (!valor || parseFloat(valor) <= 0) return res.status(400).json({ error: 'Valor inválido' });
  db.state.financas.metas.economiasMensal = parseFloat(valor);
  db.saveDB().catch(() => {});
  res.json({ ok: true });
});

router.get('/api/financas/orcamentos', auth, (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const orcamentos = db.state.financas.metas.orcamentos || {};
  const resultado = {};
  for (const [cat, limite] of Object.entries(orcamentos)) {
    const prog = financas.getProgressoOrcamento(db, cat, mes);
    resultado[cat] = { limite, gasto: prog.gasto, pct: prog.pct };
  }
  res.json({ orcamentos: resultado });
});

router.post('/api/financas/orcamentos', auth, (req, res) => {
  const { categoria, valor } = req.body;
  if (!categoria || !valor || parseFloat(valor) <= 0) {
    return res.status(400).json({ error: 'categoria e valor obrigatórios' });
  }
  financas.setOrcamento(db, categoria, parseFloat(valor));
  res.json({ ok: true });
});

router.get('/api/financas/projecao', auth, (req, res) => {
  const proj = financas.gerarProjecaoMes(db);
  res.json(proj || {});
});

router.get('/api/financas/meses', auth, (req, res) => {
  const meses = [...new Set(db.state.financas.transacoes.map(t => t.mes))]
    .sort((a, b) => b.localeCompare(a));
  res.json({ meses });
});

router.get('/api/financas/analise', auth, async (req, res) => {
  try {
    const analise = await financas.analisarGastosDesnecessarios(db);
    res.json({ analise });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Dívidas -----
router.get('/api/financas/dividas', auth, (req, res) => {
  const apenasAtivas = req.query.ativas !== 'false';
  res.json({ dividas: financas.getDividas(db, apenasAtivas) });
});

router.post('/api/financas/dividas', auth, (req, res) => {
  const { descricao, valor, vencimento } = req.body;
  if (!descricao || !valor || parseFloat(valor) <= 0) return res.status(400).json({ error: 'descricao e valor obrigatórios' });
  const nova = financas.addDivida(db, { descricao, valor: parseFloat(valor), vencimento: vencimento || null });
  res.json({ ok: true, divida: nova });
});

router.put('/api/financas/dividas/:id/pagar', auth, (req, res) => {
  const div = financas.marcarDividaPaga(db, req.params.id);
  if (!div) return res.status(404).json({ error: 'Não encontrada' });
  res.json({ ok: true, divida: div });
});

router.delete('/api/financas/dividas/:id', auth, (req, res) => {
  financas.deleteDivida(db, req.params.id);
  res.json({ ok: true });
});

// ----- A Receber -----
router.get('/api/financas/areceber', auth, (req, res) => {
  const apenasAtivos = req.query.ativos !== 'false';
  res.json({ aReceber: financas.getAReceber(db, apenasAtivos) });
});

router.post('/api/financas/areceber', auth, (req, res) => {
  const { descricao, valor, dataRecebimento } = req.body;
  if (!descricao || !valor || parseFloat(valor) <= 0) return res.status(400).json({ error: 'descricao e valor obrigatórios' });
  const novo = financas.addAReceber(db, { descricao, valor: parseFloat(valor), dataRecebimento: dataRecebimento || null });
  res.json({ ok: true, item: novo });
});

router.put('/api/financas/areceber/:id/receber', auth, (req, res) => {
  const item = financas.marcarRecebido(db, req.params.id);
  if (!item) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ ok: true, item });
});

router.delete('/api/financas/areceber/:id', auth, (req, res) => {
  financas.deleteAReceber(db, req.params.id);
  res.json({ ok: true });
});

// ----- Contas Fixas -----
router.get('/api/financas/contasfixas', auth, (req, res) => {
  res.json({ contasFixas: db.state.financas.contasFixas || [] });
});

router.post('/api/financas/contasfixas', auth, (req, res) => {
  const { descricao, valor, dia, categoria } = req.body;
  if (!descricao || !valor) return res.status(400).json({ error: 'descricao e valor obrigatórios' });
  if (!db.state.financas.contasFixas) db.state.financas.contasFixas = [];
  const id = `CF-${Date.now()}`;
  const nova = { id, descricao, valor: parseFloat(valor), dia: parseInt(dia) || null, categoria: categoria || 'contas', ativa: true, criadoEm: Date.now() };
  db.state.financas.contasFixas.push(nova);
  db.saveDB().catch(() => {});
  res.json({ ok: true, conta: nova });
});

router.delete('/api/financas/contasfixas/:id', auth, (req, res) => {
  if (db.state.financas.contasFixas) {
    db.state.financas.contasFixas = db.state.financas.contasFixas.filter(c => c.id !== req.params.id);
    db.saveDB().catch(() => {});
  }
  res.json({ ok: true });
});

// ----- Receitas Fixas -----
router.get('/api/financas/receitasfixas', auth, (req, res) => {
  res.json({ receitasFixas: db.state.financas.receitasFixas || [] });
});

router.post('/api/financas/receitasfixas', auth, (req, res) => {
  const { descricao, valor, dia } = req.body;
  if (!descricao || !valor) return res.status(400).json({ error: 'descricao e valor obrigatórios' });
  if (!db.state.financas.receitasFixas) db.state.financas.receitasFixas = [];
  const id = `RF-${Date.now()}`;
  const nova = { id, descricao, valor: parseFloat(valor), dia: parseInt(dia) || null, ativa: true, criadoEm: Date.now() };
  db.state.financas.receitasFixas.push(nova);
  db.saveDB().catch(() => {});
  res.json({ ok: true, receita: nova });
});

router.delete('/api/financas/receitasfixas/:id', auth, (req, res) => {
  if (db.state.financas.receitasFixas) {
    db.state.financas.receitasFixas = db.state.financas.receitasFixas.filter(r => r.id !== req.params.id);
    db.saveDB().catch(() => {});
  }
  res.json({ ok: true });
});

// ----- Situação atual -----
router.get('/api/financas/situacao', auth, (req, res) => {
  res.json(db.state.financas.situacao || {});
});

router.get('/financas', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard_financas.html'));
});

// ═══════════════════════════════════════════════════════════
// ROTAS ATK — Atacadão (Pedro e Rodrigo)
// Prefixo /api/atk/* para evitar conflito com rotas CVN
// ═══════════════════════════════════════════════════════════

// Webhook Baileys — Pedro
router.post('/atk/webhook/pedro', async (req, res) => {
  res.sendStatus(200);
  try {
    const agentsAtk = require('./agents-atk');
    await agentsAtk.handleIncomingMessage('pedro', req.body);
  } catch (e) { console.error('[ATK/WEBHOOK/PEDRO]', e.message); }
});

// Webhook Baileys — Rodrigo
router.post('/atk/webhook/rodrigo', async (req, res) => {
  res.sendStatus(200);
  try {
    const agentsAtk = require('./agents-atk');
    await agentsAtk.handleIncomingMessage('rodrigo', req.body);
  } catch (e) { console.error('[ATK/WEBHOOK/RODRIGO]', e.message); }
});

// Chat com Aslam ATK
router.post('/api/atk/aslam', auth, async (req, res) => {
  try {
    const { message, mediaUrl } = req.body;
    if (!message && !mediaUrl) return res.status(400).json({ error: 'message obrigatório' });
    const aslamAtk = require('./gestor-atk');
    const resposta = await aslamAtk.handleAslamChat(message || '', mediaUrl || null);
    res.json({ resposta });
  } catch (e) {
    console.error('[ATK/ASLAM]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Status dos agentes ATK
router.get('/api/atk/status', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const baileys = require('./baileys');
    const status = {};
    for (const id of ['pedro', 'rodrigo']) {
      status[id] = {
        state: baileys.getState(id) || 'disconnected',
        conversas: dbAtk.state.conversations[id].size,
        pausados: dbAtk.state.pausedManual[id].size,
        metrics: dbAtk.state.metrics[id],
        preco: dbAtk.getAgentPrice(id),
        piso: dbAtk.getAgentPiso(id),
        produto: dbAtk.getAgentProductName(id),
        instructions: dbAtk.state.instructions[id] || [],
      };
    }
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Conversas ATK de um agente
router.get('/api/atk/conversas/:agentId', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { agentId } = req.params;
    if (!['pedro', 'rodrigo'].includes(agentId)) return res.status(400).json({ error: 'Agente inválido' });
    const convs = [];
    dbAtk.state.conversations[agentId].forEach((conv, numero) => {
      if (!conv.msgs || conv.msgs.length === 0) return;
      const score = dbAtk.scoreClient(agentId, numero);
      convs.push({
        numero, pushName: conv.pushName || '', totalMsgs: conv.msgs.length,
        ultimaMensagem: conv.ultimaMensagem, pausado: dbAtk.isManuallyPaused(numero),
        isTempId: !!conv.isTempId || dbAtk.isLidFormat(numero),
        score: score.score, temperatura: score.temperatura,
        ultimoTexto: (conv.msgs.at(-1)?.content || conv.msgs.at(-1)?.text || '').slice(0, 80),
        ultimoRole: conv.msgs.at(-1)?.role || 'user',
      });
    });
    convs.sort((a, b) => (b.ultimaMensagem || 0) - (a.ultimaMensagem || 0) || b.score - a.score);
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ler conversa ATK específica
router.get('/api/atk/conversas/:agentId/:numero', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { agentId, numero } = req.params;
    const conv = dbAtk.getConversation(agentId, numero);
    res.json({ numero, msgs: conv?.msgs || [], pausado: dbAtk.isManuallyPaused(numero), isTempId: !!conv?.isTempId || dbAtk.isLidFormat(numero) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pausar/liberar cliente ATK
router.post('/api/atk/conversas/:agentId/:numero/pause', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  dbAtk.pauseManual(req.params.numero, req.params.agentId);
  dbAtk.addEvent(`Dashboard pausou ${req.params.numero} (${req.params.agentId})`);
  dbAtk.save();
  res.json({ ok: true });
});

router.post('/api/atk/conversas/:agentId/:numero/resume', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  dbAtk.resumeManual(req.params.numero);
  dbAtk.addEvent(`Dashboard liberou ${req.params.numero}`);
  dbAtk.save();
  res.json({ ok: true });
});

// Enviar mensagem manual ATK
router.post('/api/atk/conversas/:agentId/:numero/send', auth, async (req, res) => {
  const { agentId, numero } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Texto ausente' });
  if (!['pedro', 'rodrigo'].includes(agentId)) return res.status(400).json({ error: 'Agente inválido' });
  try {
    const dbAtk = require('./database-atk');
    await baileys.sendText(agentId, numero, text);
    const conv = dbAtk.getConversation(agentId, numero);
    if (conv) {
      conv.msgs.push({ role: 'assistant', content: text, timestamp: Date.now() });
      conv.ultimaMensagem = Date.now();
      dbAtk.save();
    }
    dbAtk.addEvent(`Dashboard enviou mensagem para ${numero} (${agentId})`);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[ATK/SEND] ${agentId} → ${numero}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Vendas/CRM ATK
router.get('/api/atk/vendas', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { periodo = 'mes', de, ate } = req.query;
    let opts = {};
    if (de && ate) {
      opts.tsInicio = new Date(de + 'T00:00:00-03:00').getTime();
      opts.tsFim    = new Date(ate + 'T23:59:59-03:00').getTime();
    } else if (periodo === 'semana') {
      const bdStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const bd = new Date(bdStr + 'T12:00:00-03:00');
      const dow = bd.getDay(), off = dow === 0 ? 6 : dow - 1;
      bd.setDate(bd.getDate() - off);
      const monStr = bd.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      opts.tsInicio = new Date(monStr + 'T00:00:00-03:00').getTime();
      opts.tsFim    = Date.now();
    } else if (periodo === 'mes_passado') {
      const bdStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const [ano, mes] = bdStr.split('-').map(Number);
      const mp = mes === 1 ? 12 : mes - 1, ap = mes === 1 ? ano - 1 : ano;
      const ultDia = new Date(ano, mes - 1, 0).getDate();
      const mm = String(mp).padStart(2, '0'), ud = String(ultDia).padStart(2, '0');
      opts.tsInicio = new Date(`${ap}-${mm}-01T00:00:00-03:00`).getTime();
      opts.tsFim    = new Date(`${ap}-${mm}-${ud}T23:59:59-03:00`).getTime();
    }
    const report = dbAtk.getSalesReport(periodo, opts);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Produtos ATK
router.get('/api/atk/produtos', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  res.json(dbAtk.getAllProducts());
});

router.post('/api/atk/produtos', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { nome, precoCusto, precoVenda } = req.body || {};
    if (!nome || precoVenda === undefined) return res.status(400).json({ error: 'nome e precoVenda obrigatórios' });
    const p = dbAtk.addProduct({ nome, precoCusto: parseFloat(precoCusto) || 0, precoVenda: parseFloat(precoVenda) });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/api/atk/produtos/:id', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { nome, precoCusto, precoVenda, ativo } = req.body || {};
    const updates = {};
    if (nome !== undefined) updates.nome = nome;
    if (precoCusto !== undefined) updates.precoCusto = parseFloat(precoCusto);
    if (precoVenda !== undefined) updates.precoVenda = parseFloat(precoVenda);
    if (ativo !== undefined) updates.ativo = ativo;
    const p = dbAtk.updateProduct(req.params.id, updates);
    if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/atk/produtos/:id', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    dbAtk.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista de vendas individuais ATK (mês atual ou período)
router.get('/api/atk/vendas/lista', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { de, ate, periodo = 'mes' } = req.query;
    let tsInicio, tsFim;
    if (de && ate) {
      tsInicio = new Date(de + 'T00:00:00-03:00').getTime();
      tsFim    = new Date(ate + 'T23:59:59-03:00').getTime();
    } else if (periodo === 'hoje') {
      const bd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      tsInicio = new Date(bd + 'T00:00:00-03:00').getTime();
      tsFim    = Date.now();
    } else if (periodo === 'semana') {
      const bdStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const bd = new Date(bdStr + 'T12:00:00-03:00');
      const dow = bd.getDay(), off = dow === 0 ? 6 : dow - 1;
      bd.setDate(bd.getDate() - off);
      tsInicio = new Date(bd.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').getTime();
      tsFim    = Date.now();
    } else if (periodo === 'mes_passado') {
      const bdStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const [ano, mes] = bdStr.split('-').map(Number);
      const mp = mes === 1 ? 12 : mes - 1, ap = mes === 1 ? ano - 1 : ano;
      const ultDia = new Date(ano, mes - 1, 0).getDate();
      const mm = String(mp).padStart(2, '0'), ud = String(ultDia).padStart(2, '0');
      tsInicio = new Date(`${ap}-${mm}-01T00:00:00-03:00`).getTime();
      tsFim    = new Date(`${ap}-${mm}-${ud}T23:59:59-03:00`).getTime();
    } else {
      const brasiliaDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      tsInicio = new Date(brasiliaDate.substring(0, 7) + '-01T00:00:00-03:00').getTime();
      tsFim    = Date.now();
    }
    const vendas = (dbAtk.state.sales || [])
      .filter(v => (v.createdAt || 0) >= tsInicio && (v.createdAt || 0) <= tsFim)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 200);
    res.json({ vendas, total: vendas.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pedidos ATK
router.get('/api/atk/pedidos', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  res.json(dbAtk.getPedidosAtk());
});

// CRM ATK (lista clientes)
router.get('/api/atk/crm', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    res.json(dbAtk.getCustomerList());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Caixa ATK
router.get('/api/atk/caixa', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  res.json({ aberto: dbAtk.getCaixaAberto(), historico: dbAtk.getCaixaHistorico(30) });
});

router.post('/api/atk/caixa/abrir', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    if (dbAtk.getCaixaAberto()) return res.status(400).json({ error: 'Já tem caixa aberto' });
    const { valorAbertura = 0, observacao = '' } = req.body || {};
    const caixa = dbAtk.abrirCaixa(parseFloat(valorAbertura) || 0, observacao);
    dbAtk.save();
    res.json(caixa);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/atk/caixa/fechar', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    if (!dbAtk.getCaixaAberto()) return res.status(400).json({ error: 'Nenhum caixa aberto' });
    const { valorFechamento, observacao = '' } = req.body || {};
    const caixa = dbAtk.fecharCaixa(parseFloat(valorFechamento) || 0, observacao);
    dbAtk.save();
    res.json(caixa);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/atk/caixa/movimento', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    if (!dbAtk.getCaixaAberto()) return res.status(400).json({ error: 'Nenhum caixa aberto' });
    const { tipo, valor, descricao } = req.body || {};
    if (!tipo || !valor) return res.status(400).json({ error: 'tipo e valor obrigatórios' });
    dbAtk.addMovimentoCaixa(tipo, parseFloat(valor), descricao || '');
    dbAtk.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lançar venda ATK
router.post('/api/atk/vendas', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const { agentId, productId, numero, valorFinal, quantidade = 1, desconto = 0, tipo = 'manual', observacao = '' } = req.body || {};
    if (!agentId || !productId || !valorFinal) return res.status(400).json({ error: 'agentId, productId e valorFinal obrigatórios' });

    const produto = dbAtk.state.products.find(p => p.id === productId);
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

    const qtd = parseInt(quantidade) || 1;
    const valorUnit = parseFloat(valorFinal);
    const totalBruto = valorUnit * qtd;
    const totalDesc = totalBruto - parseFloat(desconto || 0);
    const custoPorUnit = produto.precoCusto || 0;
    const lucroTotal = totalDesc - (custoPorUnit * qtd);

    const sale = dbAtk.addSale({
      agentId, productId, productName: produto.nome,
      numero: numero || '',
      valor: totalBruto,
      desconto: parseFloat(desconto || 0),
      quantidade: qtd,
      tipo, observacao, status: 'confirmada',
    });

    res.json(sale);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancelar venda ATK
router.post('/api/atk/vendas/:id/cancelar', auth, (req, res) => {
  try {
    const dbAtk = require('./database-atk');
    const sale = dbAtk.getSale(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Venda não encontrada' });
    dbAtk.cancelSale(req.params.id);
    if (dbAtk.getCaixaAberto() && sale.valorFinal) {
      dbAtk.addMovimentoCaixa('saida', sale.valorFinal, `CANCELAMENTO: ${sale.productName} - ${sale.tipo}`);
    }
    dbAtk.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eventos ATK (log de atividade)
router.get('/api/atk/eventos', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  res.json(dbAtk.state.events.slice(-100).reverse());
});

// Teste real da API de IA — retorna resultado ou erro exato
router.get('/api/atk/ai-test', auth, async (req, res) => {
  const servicesAtk = require('./services-atk');
  const sys = 'Responda apenas: OK';
  const msgs = [{ role: 'user', content: 'teste' }];
  const geminiKey = !!(process.env.GEMINI_API_KEY);
  const claudeKey = !!(process.env.ANTHROPIC_API_KEY);
  const geminiModel = servicesAtk.getGeminiModel();
  const claudeModel = servicesAtk.getClaudeModel();

  let geminiResult = null, geminiError = null;
  let claudeResult = null, claudeError = null;
  let pipelineResult = null, pipelineError = null;

  if (geminiKey) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'teste' }] }], generationConfig: { maxOutputTokens: 10 } }), signal: AbortSignal.timeout(10000) }
      );
      const d = await r.json();
      if (d.error) geminiError = `${d.error.code}: ${d.error.message}`;
      else geminiResult = d.candidates?.[0]?.content?.parts?.[0]?.text || '(vazio)';
    } catch (e) { geminiError = e.message; }
  }

  if (claudeKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: claudeModel, max_tokens: 10, system: sys, messages: [{ role: 'user', content: 'teste' }] }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (d.error) claudeError = `[${d.error.type}] ${d.error.message}`;
      else claudeResult = d.content?.[0]?.text || '(vazio)';
    } catch (e) { claudeError = e.message; }
  }

  try {
    pipelineResult = await servicesAtk.callClaude(sys, msgs, { maxTokens: 10, timeout: 10000 });
  } catch (e) {
    pipelineError = e.message;
  }

  res.json({
    gemini: { key: geminiKey, model: geminiModel, result: geminiResult, error: geminiError },
    claude: { key: claudeKey, model: claudeModel, result: claudeResult, error: claudeError },
    pipeline: { result: pipelineResult, error: pipelineError },
  });
});

// Debug ATK: últimas mensagens recebidas + estado interno
router.get('/api/atk/debug', auth, (req, res) => {
  const dbAtk = require('./database-atk');
  const baileys = require('./baileys');
  res.json({
    pedro: {
      baileys_state: baileys.getState('pedro'),
      conversas: dbAtk.state.conversations.pedro.size,
      pausados_manual: dbAtk.state.pausedManual.pedro.size,
      pausados_auto: dbAtk.state.paused.pedro.size,
      metrics: dbAtk.state.metrics.pedro,
      price: dbAtk.getAgentPrice('pedro'),
    },
    rodrigo: {
      baileys_state: baileys.getState('rodrigo'),
      conversas: dbAtk.state.conversations.rodrigo.size,
      pausados_manual: dbAtk.state.pausedManual.rodrigo.size,
      pausados_auto: dbAtk.state.paused.rodrigo.size,
      metrics: dbAtk.state.metrics.rodrigo,
      price: dbAtk.getAgentPrice('rodrigo'),
    },
    ultimas_msgs_recebidas: dbAtk.state._debugIncoming || [],
    processingLock_size: dbAtk.state.processingLock?.size || 0,
    env: {
      GEMINI_KEY: !!(process.env.GEMINI_API_KEY),
      ANTHROPIC_KEY: !!(process.env.ANTHROPIC_API_KEY),
      ATK_REDIS_URL: !!(process.env.ATK_REDIS_URL),
      PEDRO_NUMERO: process.env.PEDRO_NUMERO || 'NAO CONFIGURADO',
      RODRIGO_NUMERO: process.env.RODRIGO_NUMERO || 'NAO CONFIGURADO',
    },
  });
});

// QR code ATK (Pedro ou Rodrigo)
router.get('/api/atk/agents/:agentId/qr', auth, (req, res) => {
  try {
    const baileys = require('./baileys');
    const { agentId } = req.params;
    if (!['pedro', 'rodrigo'].includes(agentId)) return res.status(400).json({ error: 'Agente inválido' });
    const state = baileys.getState(agentId);
    const qr = baileys.getQRCode(agentId);
    let qrUrl = null;
    if (qr) {
      try {
        const QRCode = require('qrcode');
        QRCode.toDataURL(qr, { width: 280, margin: 2 }).then(dataUrl => {
          res.json({ agentId, state, qr: dataUrl });
        }).catch(() => {
          res.json({ agentId, state, qr: `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr)}` });
        });
        return;
      } catch {}
    }
    res.json({ agentId, state, qr: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reconectar agente ATK (gera novo QR)
router.post('/api/atk/agents/:agentId/reconnect', auth, async (req, res) => {
  const { agentId } = req.params;
  if (!['pedro', 'rodrigo'].includes(agentId)) return res.status(400).json({ error: 'Agente inválido' });
  try {
    const baileys = require('./baileys');
    const agentsAtkInit = require('./agents-atk-init');
    await baileys.forceLogout(agentId);
    // Re-inicializa a sessão para gerar novo QR
    const dbAtk = require('./database-atk');
    const agentsAtk = require('./agents-atk');
    const handler = (type, data) => {
      try {
        const conv = dbAtk.getConversation(agentId, data.phone);
        if (conv && data._originalJid) conv._originalJid = data._originalJid;
        if (type === 'received') agentsAtk.handleIncomingMessage(agentId, data);
        else if (type === 'sent') agentsAtk.handleSentMessage(agentId, data);
      } catch (e) { console.error(`[ATK:${agentId}] Handler error:`, e.message); }
    };
    await baileys.connect(agentId, handler);
    // Aguardar QR até 8s
    let qr = null;
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      qr = baileys.getQRCode(agentId);
      if (qr) break;
      if (baileys.getState(agentId) === 'connected') break;
    }
    const state = baileys.getState(agentId);
    if (state === 'connected') return res.json({ agentId, state, qr: null, connected: true });
    if (qr) {
      try {
        const QRCode = require('qrcode');
        const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        return res.json({ agentId, state, qr: dataUrl });
      } catch {}
      return res.json({ agentId, state, qr: `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr)}` });
    }
    res.json({ agentId, state, qr: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----- Dashboard (servir o HTML) -----
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ═══════════════════════════════════════════════════════════
// WEBHOOK KIWIFY — Compra confirmada da Sarah (Fotógrafo Online)
// Configurar no painel Kiwify: POST /webhook/kiwify/sarah
// ═══════════════════════════════════════════════════════════

let _lastKiwifyPayload = null;

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // Já tem 55 (Brasil) na frente
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Sem código de país — assume Brasil
  if (digits.length >= 10) return '55' + digits;
  return null;
}

router.get('/api/kiwify/debug', auth, (req, res) => {
  res.json({
    lastPayload: _lastKiwifyPayload,
    purchases: Array.from(db.state.sarahPurchases || []),
  });
});

router.get('/api/sarah/vendas', auth, (req, res) => {
  const vendas = db.state.sarahSales || [];
  const total = vendas.reduce((s, v) => s + parseFloat(v.valor || 0), 0);
  res.json({ vendas, total: total.toFixed(2), count: vendas.length });
});

router.post('/webhook/kiwify/sarah', async (req, res) => {
  res.sendStatus(200); // responde rápido para Kiwify não retentar
  try {
    const body = req.body || {};
    _lastKiwifyPayload = { ts: new Date().toISOString(), body };
    console.log('[KIWIFY] Webhook recebido:', JSON.stringify(body).slice(0, 300));

    // Kiwify envia diferentes formatos — cobrir todos
    const customer = body.Customer || body.customer || body.data?.customer || body.payload?.customer || {};
    const status   = (body.order_status || body.webhook_event_type || body.status || body.data?.status || body.event || '').toLowerCase();

    // Só processar se for aprovado/pago
    const isApproved = ['paid', 'approved', 'order_approved', 'order.approved', 'active', 'complete'].some(s => status.includes(s));
    if (!isApproved) {
      console.log('[KIWIFY] Ignorado — status:', status);
      return;
    }

    // Extrair telefone do cliente
    const rawPhone = customer.mobile || customer.phone || customer.Mobile || customer.Phone ||
                     body.customer_phone || body.mobile || '';
    const phone = normalizePhone(rawPhone);

    const name  = customer.name || customer.Name || body.customer_name || 'Cliente';
    const email = customer.email || customer.Email || body.customer_email || '';

    console.log(`[KIWIFY] Compra aprovada — nome: ${name} | email: ${email} | phone raw: "${rawPhone}" | normalizado: ${phone}`);

    if (!phone) {
      console.warn('[KIWIFY] Telefone não encontrado no payload — não é possível pausar a Sarah');
      return;
    }

    // Registrar compra e venda no banco
    db.state.sarahPurchases.add(phone);

    const orderId = body.order_id || body.id || '';
    const jaRegistrada = db.state.sarahSales.some(s => s.orderId === orderId && orderId);
    if (!jaRegistrada) {
      const valorCentavos = body.Commissions?.charge_amount || body.amount || 4700;
      db.state.sarahSales.unshift({
        id: `sarah-${Date.now()}`,
        name,
        email,
        phone: phone || '',
        valor: (valorCentavos / 100).toFixed(2),
        orderId,
        ts: Date.now(),
      });
      // Manter só as 500 vendas mais recentes
      if (db.state.sarahSales.length > 500) db.state.sarahSales = db.state.sarahSales.slice(0, 500);
    }

    db.saveDB().catch(() => {});

    // Pausar cliente na Sarah se tiver conversa ativa
    const sarahConv = db.state.conversations.sarah?.get(phone);
    if (sarahConv) {
      db.pausePhone('sarah', phone);
      console.log(`[KIWIFY] Cliente ${phone} (${name}) comprou — pausado na Sarah`);
    } else {
      console.log(`[KIWIFY] Compra registrada para ${phone || '(sem tel)'} (${name})`);
    }
  } catch (e) {
    console.error('[KIWIFY] Erro ao processar webhook:', e.message);
  }
});

module.exports = router;

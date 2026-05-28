'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('./config');
const db = require('./database');
const { chat: gestorChat } = require('./gestor');
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
  res.json({ ok: true, agents: status, ts: Date.now() });
});

// ----- Status de conexão dos agentes -----
router.get('/api/agents/status', auth, (req, res) => {
  const status = baileys.getAllStatus();
  const result = {};
  for (const agentId of ['info', 'logzz', 'rafael', 'sarah']) {
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
  if (!['info', 'logzz', 'rafael', 'sarah'].includes(agentId)) return res.status(404).end();
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
    const originalJid = db.state.phoneLidMap?.get(phone) || null;
    console.log(`[ROUTES] Envio manual → agente=${agentId} phone=${phone} jid=${originalJid || '(padrão)'}`);
    await baileys.sendText(sessionId, phone, text, originalJid);
    db.addMsg(agentId, phone, 'assistant', text);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[ROUTES] Erro envio manual → ${phone}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

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

// ----- Gestor (Jarvis) -----
router.post('/api/gestor/chat', auth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensagem ausente' });
  try {
    const resposta = await gestorChat(message);
    res.json({ resposta });
  } catch (e) {
    console.error('[ROUTES] Erro gestor chat:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/gestor/logs', auth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.getGestorLogs(limit));
});

router.get('/api/gestor/chat/history', auth, (req, res) => {
  res.json(db.getGestorChat(50));
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
  if (!['info', 'logzz', 'rafael', 'sarah'].includes(agentId)) return res.status(404).json({ error: 'Agente não encontrado' });
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
  if (!['info', 'logzz', 'rafael', 'sarah'].includes(agentId)) return res.status(404).json({ error: 'Agente não encontrado' });
  try {
    const agentMap = { logzz: './agents/logzz', rafael: './agents/rafael', info: './agents/info-produtos' };
    const agent = require(agentMap[agentId]);
    await agent.processMessage('received', { phone, body: message, pushName: 'Teste', isFromMe: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Remarketing Logzz -----
const _remarkTempImgs = new Map();
const _remarkState = {
  logzz: { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0 },
  sarah: { ativo: false, pausado: false, cancelar: false, enviados: 0, total: 0, erros: 0 },
};

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

router.get('/api/remarketing/contatos', auth, (req, res) => {
  const agentId = req.query.agente;
  if (!['logzz', 'sarah'].includes(agentId)) return res.status(400).json({ error: 'agente invalido' });
  const contatos = [];
  db.state.conversations[agentId].forEach((conv, numero) => {
    contatos.push({
      numero,
      nome: conv.pushName || '',
      ultimaMensagem: conv.ultimaMensagem || 0,
      pausado: db.state.paused[agentId]?.has(numero) || false,
    });
  });
  contatos.sort((a, b) => b.ultimaMensagem - a.ultimaMensagem);
  res.json(contatos);
});

router.post('/api/remarketing/enviar', auth, async (req, res) => {
  const { agente, numeros, texto, imagemUrl, pausarAposEnvio } = req.body;
  if (!['logzz', 'sarah'].includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  if (!numeros?.length) return res.status(400).json({ error: 'numeros obrigatorios' });
  if (!texto && !imagemUrl) return res.status(400).json({ error: 'texto ou imagem obrigatorio' });
  if (_remarkState[agente].ativo) return res.status(409).json({ error: 'Remarketing ja em andamento' });

  const state = _remarkState[agente];
  state.ativo = true; state.pausado = false; state.cancelar = false; state.enviados = 0; state.erros = 0; state.total = numeros.length;
  res.json({ ok: true, total: numeros.length });

  const sessionId = CONFIG.sessionIds[agente];
  const TIMEOUT_ENVIO = 18000;

  // Resolve JID correto: prioriza LID mapeado; para números ≥15 dígitos sem prefixo 55, usa @lid diretamente
  function resolveJid(numero) {
    const lidJid = db.state.phoneLidMap?.get(numero);
    if (lidJid) return lidJid;
    if (numero.length >= 15 && !numero.startsWith('55')) return `${numero}@lid`;
    return null;
  }

  (async () => {
    let consecutiveTimeouts = 0;
    for (const numero of numeros) {
      // Aguarda enquanto pausado
      while (state.pausado && !state.cancelar) {
        await new Promise(r => setTimeout(r, 1000));
      }
      if (state.cancelar) break;
      if (baileys.getState(sessionId) !== 'connected') {
        console.log(`[Remarketing] ${sessionId} desconectado — abortando`);
        break;
      }
      try {
        const originalJid = resolveJid(numero);
        const sendFn = imagemUrl
          ? () => baileys.sendMedia(sessionId, numero, 'image', imagemUrl, texto || '', originalJid)
          : () => baileys.sendText(sessionId, numero, texto, originalJid);
        await Promise.race([
          sendFn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('__timeout__')), TIMEOUT_ENVIO)),
        ]);
        consecutiveTimeouts = 0;
        if (pausarAposEnvio) db.pausePhone(agente, numero);
        db.addMsg(agente, numero, 'assistant', texto || '[imagem]');
        if (texto) {
          const convState = db.state.conversations[agente]?.get(numero);
          if (convState) convState.remarketingContexto = texto;
        }
        state.enviados++;
      } catch (e) {
        state.erros++;
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
      await new Promise(r => setTimeout(r, 3000));
    }
    state.ativo = false;
    console.log(`[Remarketing] ${agente}: ${state.enviados}/${state.total} OK, ${state.erros} erros`);
  })();
});

router.get('/api/remarketing/status', auth, (req, res) => {
  const agentId = req.query.agente;
  if (!['logzz', 'sarah'].includes(agentId)) return res.status(400).json({ error: 'agente invalido' });
  res.json(_remarkState[agentId]);
});

router.post('/api/remarketing/parar', auth, (req, res) => {
  const { agente } = req.body;
  if (!['logzz', 'sarah'].includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].cancelar = true;
  // Force-reset ativo após 25s para desbloquear caso o loop esteja travado
  setTimeout(() => { _remarkState[agente].ativo = false; }, 25000);
  res.json({ ok: true });
});

router.post('/api/remarketing/pausar', auth, (req, res) => {
  const { agente } = req.body;
  if (!['logzz', 'sarah'].includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].pausado = true;
  res.json({ ok: true });
});

router.post('/api/remarketing/retomar', auth, (req, res) => {
  const { agente } = req.body;
  if (!['logzz', 'sarah'].includes(agente)) return res.status(400).json({ error: 'agente invalido' });
  _remarkState[agente].pausado = false;
  res.json({ ok: true });
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

router.get('/financas', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard_financas.html'));
});

// ----- Dashboard (servir o HTML) -----
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

module.exports = router;

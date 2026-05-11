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
  for (const agentId of ['info', 'logzz']) {
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

  try {
    const sessionId = CONFIG.sessionIds[agentId];
    await baileys.sendText(sessionId, phone, text);
    db.addMsg(agentId, phone, 'assistant', text);
    res.json({ ok: true });
  } catch (e) {
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

// ----- Dashboard (servir o HTML) -----
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

module.exports = router;

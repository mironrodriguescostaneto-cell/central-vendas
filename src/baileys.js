'use strict';

// ============================================================
// BAILEYS — WhatsApp multi-sessão para Central Vendas
// Adaptado do Atacadão com todos os fixes de bugs conhecidos:
// - Fix LID (Meta @lid WhatsApp Business)
// - Fix reconexão com geração para evitar race condition
// - Fix QR não limpado prematuramente
// - Fix creds.json ausente no Redis
// ============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

const BASE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp';
const MAX_RETRIES = 5;

// Estado por sessão
const sessions = {};

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      sock: null,
      qrCode: null,
      connectionState: 'disconnected',
      messageHandler: null,
      retryCount: 0,
      _reconnectGen: 0,
      lidMap: {},
    };
  }
  return sessions[sessionId];
}

function getAuthDir(sessionId) {
  const dir = path.join(BASE_DIR, `baileys_cv_${sessionId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ----- Redis auth persistence -----
function getRedis() {
  try { return require('./database').state; } catch { return null; }
}

function getRedisClient() {
  try {
    const IORedis = require('ioredis');
    if (!process.env.REDIS_URL) return null;
    if (!getRedisClient._client) {
      getRedisClient._client = new IORedis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
    }
    return getRedisClient._client;
  } catch { return null; }
}

async function saveAuthToRedis(sessionId) {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const dir = getAuthDir(sessionId);
    const files = {};
    for (const file of fs.readdirSync(dir)) {
      files[file] = fs.readFileSync(path.join(dir, file), 'utf8');
    }
    await redis.set(`baileys:cv:${sessionId}:auth`, JSON.stringify(files));
  } catch (e) {
    console.error(`[BAILEYS:${sessionId}] Erro ao salvar sessão no Redis:`, e.message);
  }
}

async function restoreAuthFromRedis(sessionId) {
  const redis = getRedisClient();
  if (!redis) return false;
  try {
    const data = await redis.get(`baileys:cv:${sessionId}:auth`);
    if (!data) return false;
    const files = JSON.parse(data);
    if (!files['creds.json']) return false; // sessão inválida
    const dir = getAuthDir(sessionId);
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    console.log(`[BAILEYS:${sessionId}] Sessão restaurada do Redis`);
    return true;
  } catch (e) {
    console.error(`[BAILEYS:${sessionId}] Erro ao restaurar sessão:`, e.message);
    return false;
  }
}

// Cache de versão Baileys para evitar request HTTP a cada reconexão
let _baileysVersion = null;
async function getBaileysVersion() {
  if (_baileysVersion) return _baileysVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    _baileysVersion = version;
    return version;
  } catch {
    _baileysVersion = [2, 3000, 1017531287];
    return _baileysVersion;
  }
}

function jidToPhone(jid) {
  if (!jid) return '';
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '');
}

function phoneToJid(phone) {
  return phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
}

// Notifica database sobre status de conexão
function notifyStatus(sessionId, status, qr = undefined) {
  try {
    const db = require('./database');
    db.setConnectionStatus(sessionId, status);
    if (qr !== undefined) db.setQrCode(sessionId, qr);
  } catch { /* ignore */ }
}

async function connect(sessionId, onMessage, isInternalReconnect = false) {
  const session = getSession(sessionId);

  if (session.sock) {
    session.sock.ev.removeAllListeners();
    try { session.sock.end(new Error('reconnect')); } catch { /* ignore */ }
    try { session.sock.ws?.close(); } catch { /* ignore */ }
    session.sock = null;
  }

  session.messageHandler = onMessage;
  if (!isInternalReconnect) {
    session.retryCount = 0;
    session._reconnectGen = (session._reconnectGen || 0) + 1;
  }

  try {
    await restoreAuthFromRedis(sessionId);

    const authDir = getAuthDir(sessionId);
    const { state, saveCreds: origSaveCreds } = await useMultiFileAuthState(authDir);

    const saveCreds = async () => {
      await origSaveCreds();
      await saveAuthToRedis(sessionId);
    };

    const version = await getBaileysVersion();
    const label = sessionId.charAt(0).toUpperCase() + sessionId.slice(1);

    session.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: [`Central Vendas ${label}`, 'Chrome', '1.0.0'],
      getMessage: async () => undefined,
    });

    session.sock.ev.on('creds.update', saveCreds);

    // ----- Eventos de conexão -----
    session.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.qrCode = qr;
        session.connectionState = 'connecting';
        notifyStatus(sessionId, 'connecting', qr);
        console.log(`[BAILEYS:${sessionId}] QR Code gerado`);
        const waiters = session._qrWaiters || [];
        session._qrWaiters = [];
        for (const fn of waiters) fn(qr);
      }

      if (connection === 'close') {
        session.connectionState = 'disconnected';
        notifyStatus(sessionId, 'disconnected');
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[BAILEYS:${sessionId}] Desconectado. StatusCode: ${statusCode}. Reconectar: ${shouldReconnect}`);

        if (shouldReconnect && session.retryCount < MAX_RETRIES) {
          session.retryCount++;
          const delay = Math.min(5000 * session.retryCount, 30000);
          const capturedGen = session._reconnectGen;
          setTimeout(() => {
            const s = getSession(sessionId);
            if ((s._reconnectGen || 0) !== capturedGen) return;
            connect(sessionId, s.messageHandler, true);
          }, delay);
        } else if (!shouldReconnect) {
          console.log(`[BAILEYS:${sessionId}] Deslogado. Limpe a sessão e escaneie o QR.`);
          session.qrCode = null;
          notifyStatus(sessionId, 'disconnected', null);
          const authDir = getAuthDir(sessionId);
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
          fs.mkdirSync(authDir, { recursive: true });
          const redis = getRedisClient();
          if (redis) redis.del(`baileys:cv:${sessionId}:auth`).catch(() => {});
        }
      }

      if (connection === 'open') {
        session.connectionState = 'connected';
        session.qrCode = null;
        session.retryCount = 0;
        notifyStatus(sessionId, 'connected', null);
        console.log(`[BAILEYS:${sessionId}] Conectado ao WhatsApp!`);
        saveAuthToRedis(sessionId).catch(() => {});
        setTimeout(() => _syncContactsFromLidMap(sessionId), 4000);
      }
    });

    // ----- Mensagens recebidas -----
    session.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) {
          if (session.messageHandler) {
            const phone = jidToPhone(msg.key.remoteJid);
            if (phone) session.messageHandler('sent', { phone, isFromMe: true, message: msg });
          }
          continue;
        }

        if (type !== 'notify') continue;
        if (msg.key.remoteJid?.includes('@g.us')) continue;

        let phone = jidToPhone(msg.key.remoteJid);
        let originalJid = msg.key.remoteJid;

        // ----- LID resolution (Meta @lid bug) -----
        if (msg.key.remoteJid?.includes('@lid')) {
          const lid = msg.key.remoteJid;
          if (!session.lidMap) session.lidMap = {};

          // Estratégia 1: contatos do store
          if (!session.lidMap[lid]) {
            try {
              const contact = session.sock.store?.contacts?.[lid];
              if (contact?.id?.includes('@s.whatsapp.net')) {
                session.lidMap[lid] = jidToPhone(contact.id);
              }
            } catch { /* ignore */ }
          }

          // Estratégia 2: msg.key.participant
          if (!session.lidMap[lid] && msg.key.participant) {
            const partPhone = jidToPhone(msg.key.participant);
            if (partPhone && partPhone.length >= 10 && partPhone.length <= 15) {
              session.lidMap[lid] = partPhone;
            }
          }

          // Estratégia 3: database persistido
          if (!session.lidMap[lid]) {
            try {
              const db = require('./database');
              const resolved = db.mapLidToPhone(lid);
              if (resolved) session.lidMap[lid] = resolved;
            } catch { /* ignore */ }
          }

          if (session.lidMap[lid]) {
            phone = session.lidMap[lid];
            try {
              const db = require('./database');
              db.registerLid(lid, phone);
            } catch { /* ignore */ }
            console.log(`[BAILEYS:${sessionId}] LID resolvido: ${lid} → ${phone}`);
          } else {
            phone = lid.replace(/@lid$/, '');
            console.log(`[BAILEYS:${sessionId}] LID não resolvido, usando como-está: ${phone}`);
          }
        }

        if (!phone) continue;

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const pushName = msg.pushName || '';

        const locMsg = msg.message?.locationMessage;
        const location = locMsg
          ? { latitude: locMsg.degreesLatitude, longitude: locMsg.degreesLongitude }
          : undefined;

        let audio;
        if (msg.message?.audioMessage) {
          try {
            const stream = await downloadMediaMessage(msg, 'buffer', {});
            const buffer = Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
            audio = { audioUrl: `data:audio/ogg;base64,${buffer.toString('base64')}` };
          } catch { /* ignore */ }
        }

        const normalized = {
          phone,
          isFromMe: false,
          text: { message: text },
          body: text,
          caption: msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '',
          location,
          audio,
          pushName,
          senderName: pushName,
          _originalJid: originalJid,
        };

        if (session.messageHandler) session.messageHandler('received', normalized);
      }
    });

    // ----- LID mapping via events -----
    const mapFromContacts = (contacts) => {
      try {
        const db = require('./database');
        for (const c of contacts) {
          const id = c.id || '';
          if (c.lid && id.includes('@s.whatsapp.net')) {
            const phone = jidToPhone(id);
            db.registerLid(c.lid, phone);
            if (!session.lidMap) session.lidMap = {};
            session.lidMap[c.lid] = phone;
          }
        }
      } catch { /* ignore */ }
    };

    session.sock.ev.on('contacts.update', mapFromContacts);
    session.sock.ev.on('contacts.upsert', mapFromContacts);

    session.sock.ev.on('messaging-history.set', ({ contacts: histContacts }) => {
      if (!histContacts?.length) return;
      mapFromContacts(histContacts);
      console.log(`[BAILEYS:${sessionId}] messaging-history.set: ${histContacts.length} contatos processados`);
    });

    return session.sock;
  } catch (error) {
    console.error(`[BAILEYS:${sessionId}] Erro ao conectar:`, error.message);
    session.connectionState = 'disconnected';
    notifyStatus(sessionId, 'disconnected');
    return null;
  }
}

function _syncContactsFromLidMap(sessionId) {
  try {
    const session = getSession(sessionId);
    if (!session.lidMap || Object.keys(session.lidMap).length === 0) return;
    const db = require('./database');
    let synced = 0;
    for (const [lidJid, phone] of Object.entries(session.lidMap)) {
      db.registerLid(lidJid, phone);
      synced++;
    }
    if (synced > 0) console.log(`[BAILEYS:${sessionId}] Sync pós-connect: ${synced} LIDs aplicados`);
  } catch { /* ignore */ }
}

async function sendText(sessionId, phone, text, originalJid) {
  const session = getSession(sessionId);
  if (!session.sock || session.connectionState !== 'connected') {
    throw new Error(`WhatsApp ${sessionId} não conectado`);
  }
  const jid = originalJid || phoneToJid(phone);
  await session.sock.sendMessage(jid, { text });
}

async function sendMedia(sessionId, phone, type, url, caption, originalJid) {
  const session = getSession(sessionId);
  if (!session.sock || session.connectionState !== 'connected') {
    throw new Error(`WhatsApp ${sessionId} não conectado`);
  }
  const jid = originalJid || phoneToJid(phone);
  if (type === 'image') {
    await session.sock.sendMessage(jid, { image: { url }, caption: caption || '' });
  } else if (type === 'video') {
    await session.sock.sendMessage(jid, { video: { url }, caption: caption || '' });
  } else if (type === 'audio') {
    await session.sock.sendMessage(jid, { audio: { url }, mimetype: 'audio/mp4' });
  }
}

function getQRCode(sessionId) { return getSession(sessionId).qrCode; }
function getState(sessionId) { return getSession(sessionId).connectionState; }
function getSocket(sessionId) { return getSession(sessionId).sock; }

function getAllStatus() {
  const result = {};
  for (const [id, s] of Object.entries(sessions)) {
    result[id] = { state: s.connectionState, hasQR: !!s.qrCode };
  }
  return result;
}

async function forceLogout(sessionId) {
  const session = getSession(sessionId);
  if (session.sock) {
    session.sock.ev.removeAllListeners();
    try { session.sock.end(new Error('force_logout')); } catch { /* ignore */ }
    try { session.sock.ws?.close(); } catch { /* ignore */ }
    session.sock = null;
  }
  session.retryCount = 99;
  session.qrCode = null;
  session.connectionState = 'disconnected';
  notifyStatus(sessionId, 'disconnected', null);

  const authDir = getAuthDir(sessionId);
  try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(authDir, { recursive: true });

  const redis = getRedisClient();
  if (redis) await redis.del(`baileys:cv:${sessionId}:auth`).catch(() => {});

  session.retryCount = 0;
  console.log(`[BAILEYS:${sessionId}] Sessão limpa. Pronto para novo QR.`);
}

async function reconnect(sessionId) {
  const session = getSession(sessionId);
  const handler = session.messageHandler;
  await forceLogout(sessionId);
  if (handler) await connect(sessionId, handler);
}

module.exports = {
  connect,
  sendText,
  sendMedia,
  getQRCode,
  getState,
  getSocket,
  getAllStatus,
  forceLogout,
  reconnect,
  jidToPhone,
  phoneToJid,
};

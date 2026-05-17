'use strict';

const { CONFIG } = require('../config');
const { transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'rafael';
const _pending = new Set();
const _pendingMedia = new Map();

// IDs de imagens Google Drive
const MEDIA = {
  exemplos: [
    'https://drive.google.com/uc?export=download&id=1RzgcptEIgsjqYM5xOggkPqVXG8x0MiSQ',
    'https://drive.google.com/uc?export=download&id=1IOgnD_NJ0gGCfSd-UyzSYHNTLEKoWvWa',
  ],
};

// Estágios do fluxo:
// 0 = novo cliente (introução + imagens + pergunta promo)
// 1 = aguardando resposta da promo → envia preços
// 2 = aguardando escolha do pacote → pede fotos
// 3 = aguardando fotos do cliente → pausa ao receber mídia
// 4 = pausado / encerrado

function getConvState(phone) {
  const db = require('../database');
  return db.state.conversations.rafael?.get(phone) || null;
}

function removeTags(text) {
  return text.trim();
}

async function executeStage0(sessionId, phone, pushName, _originalJid) {
  const nome = pushName ? `, ${pushName}` : '';
  const intro = `Olá${nome}, meu nome é Rafael, sou da empresa TVO FOTOGRAFIAS, aqui eu uso uma foto sua para deixar ela como você quiser através de inteligência artificial 😊\n\nVou te passar algumas fotos para você ver como é o meu trabalho e logo após te passo o valor.`;

  await baileys.sendText(sessionId, phone, intro, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', intro);

  // Envia as 2 imagens de exemplo (timeout 10s para não travar o fluxo)
  await new Promise(r => setTimeout(r, 1500));
  for (const url of MEDIA.exemplos) {
    try {
      await Promise.race([
        baileys.sendMedia(sessionId, phone, 'image', url, '', _originalJid),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout imagem 10s')), 10000)),
      ]);
    } catch (imgErr) {
      console.error(`[RAFAEL] Imagem não enviada (continuando):`, imgErr.message);
    }
    await new Promise(r => setTimeout(r, 1200));
  }

  await new Promise(r => setTimeout(r, 1000));
  const promo = `Essa semana estamos fazendo uma promoção no ensaio fotográfico, posso te passar os valores?`;
  await baileys.sendText(sessionId, phone, promo, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', promo);
}

async function executeStage1(sessionId, phone, _originalJid) {
  const precos = `Esses são os valores para essa semana:\n\n1️⃣ foto — R$ 9,90\n3️⃣ fotos — R$ 14,90\n5️⃣ fotos — R$ 19,90\n\nPrazo de entrega 20 minutos ⏱\n\nComo funciona👇🏻\nVocê envia\n1 foto do seu rosto + 1 de corpo inteiro\n\nApós isso faço a criação com base nelas`;
  await baileys.sendText(sessionId, phone, precos, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', precos);

  await new Promise(r => setTimeout(r, 5000));

  const pergunta = `Qual pacote fica melhor para você?`;
  await baileys.sendText(sessionId, phone, pergunta, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', pergunta);
}

async function executeStage2(sessionId, phone, _originalJid) {
  const msg = `Perfeito, me manda suas fotos, e qual estilo você quer que eu faça, para que eu te mande as prévias.`;
  await baileys.sendText(sessionId, phone, msg, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', msg);
}

async function executeStage3Text(sessionId, phone, _originalJid) {
  const msg = `Pode me mandar a foto do seu rosto e uma de corpo inteiro que eu já começo a trabalhar 😊`;
  await baileys.sendText(sessionId, phone, msg, _originalJid);
  addMsg(AGENT_ID, phone, 'assistant', msg);
}

async function processMessage(event, payload) {
  const { phone, body: rawBody, pushName, _originalJid } = payload;
  if (!phone) return;
  if (payload.isFromMe) return;

  // Transcrever áudio se necessário
  let body = rawBody;
  if (!body && payload.audio?.audioUrl) {
    try {
      const transcricao = await transcribeAudio(payload.audio.audioUrl);
      if (transcricao) {
        body = transcricao;
        console.log(`[RAFAEL] Áudio transcrito de ${phone}: "${transcricao.slice(0, 80)}"`);
      }
    } catch (e) {
      console.error(`[RAFAEL] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  console.log(`[RAFAEL] Mensagem recebida de ${phone}: "${(body || '').slice(0, 60)}"`);

  // Verificação antecipada: estágio 3 + mídia → pausar imediatamente
  const convAtual = getConvState(phone);
  if (convAtual?.stage === 3 && (payload.image || payload.videoThumb)) {
    addMsg(AGENT_ID, phone, 'user', body || '[fotos do cliente]', pushName);
    pausePhone(AGENT_ID, phone);
    console.log(`[RAFAEL] Fotos recebidas de ${phone} — pausando para atendimento humano`);
    sendTelegram(`📸 *Rafael — Cliente enviou fotos!*\nCliente: ${pushName || phone}\nAssuma o atendimento agora! ✅`).catch(() => {});
    return;
  }

  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);

  // Quando o cliente responde, limpar flags de follow-up (retomou a conversa)
  const convState = getConvState(phone);
  if (convState) {
    convState.followUpEnviado = false;
    convState.remarketingEnviado = false;
    convState.ultimaPerguntaEm = null;
  }

  // Acumular mídia
  if (payload.image) {
    const list = _pendingMedia.get(phone) || [];
    list.push({ ...payload.image, kind: 'image' });
    _pendingMedia.set(phone, list);
  }
  if (payload.videoThumb) {
    const list = _pendingMedia.get(phone) || [];
    list.push({ ...payload.videoThumb, kind: 'video' });
    _pendingMedia.set(phone, list);
  }

  if (isPaused(AGENT_ID, phone)) {
    _pendingMedia.delete(phone);
    return;
  }
  if (_pending.has(phone)) return;
  _pending.add(phone);

  // Delay de 20s para acumular mensagens simultâneas
  await new Promise(r => setTimeout(r, 20000));

  try {
    _pendingMedia.delete(phone);
    const sessionId = CONFIG.sessionIds.rafael;
    const conv = getConvState(phone);
    const stage = conv?.stage ?? 0;

    console.log(`[RAFAEL] Processando ${phone} — stage=${stage}`);

    // Atualiza stage ANTES de executar para evitar loop em caso de erro parcial
    if (conv) {
      if (stage === 0) { conv.stage = 1; conv.ultimaPerguntaEm = Date.now(); }
      else if (stage === 1) { conv.stage = 2; conv.ultimaPerguntaEm = Date.now(); }
      else if (stage === 2) { conv.stage = 3; conv.ultimaPerguntaEm = Date.now(); }
      else if (stage === 3) { conv.ultimaPerguntaEm = Date.now(); }
    }

    if (stage === 0) {
      await executeStage0(sessionId, phone, pushName, _originalJid);
    } else if (stage === 1) {
      await executeStage1(sessionId, phone, _originalJid);
    } else if (stage === 2) {
      await executeStage2(sessionId, phone, _originalJid);
    } else if (stage === 3) {
      await executeStage3Text(sessionId, phone, _originalJid);
    }

  } catch (error) {
    console.error(`[RAFAEL-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *Rafael — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
    _pendingMedia.delete(phone);
  }
}

// Follow-up 2h + remarketing 24h automático
async function checkFollowUps() {
  const db = require('../database');
  const convMap = db.state.conversations.rafael;
  if (!convMap) return;

  const sessionId = CONFIG.sessionIds.rafael;
  if (baileys.getState(sessionId) !== 'connected') return;

  const agora = Date.now();
  const DUAS_HORAS = 2 * 60 * 60 * 1000;
  const VINTE_QUATRO_HORAS = 24 * 60 * 60 * 1000;

  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;

    // Só faz follow-up se o agente fez uma pergunta e está aguardando resposta (stages 1, 2, 3)
    const stage = conv.stage ?? 0;
    if (stage === 0 || stage === 4) continue;
    if (!conv.ultimaPerguntaEm) continue;

    const elapsed = agora - conv.ultimaPerguntaEm;
    if (isNaN(elapsed)) continue;

    // Follow-up 2h
    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const msg = `Opa, você não me deu um retorno, vamos prosseguir com seu ensaio, e aproveitar a promoção 😊`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[RAFAEL] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[RAFAEL] Erro follow-up ${phone}:`, e.message);
      }
    }

    // Remarketing 24h (só após follow-up já enviado)
    if (conv.followUpEnviado && !conv.remarketingEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 👋 Ainda quero te ajudar a criar fotos incríveis com IA!\n\nNossa promoção ainda está ativa:\n\n1️⃣ foto — R$ 9,90\n3️⃣ fotos — R$ 14,90\n5️⃣ fotos — R$ 19,90\n\nEntrega em 20 minutos ⏱\nÉ só me mandar uma foto do rosto + uma de corpo inteiro e me dizer o estilo que você quer 🎨`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.remarketingEnviado = true;
        console.log(`[RAFAEL] Remarketing 24h → ${phone}`);
      } catch (e) {
        console.error(`[RAFAEL] Erro remarketing ${phone}:`, e.message);
      }
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.rafael;
  console.log('[RAFAEL-AGENTE] Inicializando Rafael — TVO Fotografias...');
  await baileys.connect(sessionId, processMessage);
  setInterval(checkFollowUps, 5 * 60 * 1000);
  console.log('[RAFAEL-AGENTE] Rafael pronto');
}

module.exports = { init, processMessage, AGENT_ID };

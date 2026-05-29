'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'rafael';
const _pending = new Set();
const _pendingMedia = new Map();

const MEDIA = {
  exemplos: [
    'https://drive.google.com/uc?export=download&id=1RzgcptEIgsjqYM5xOggkPqVXG8x0MiSQ',
    'https://drive.google.com/uc?export=download&id=1IOgnD_NJ0gGCfSd-UyzSYHNTLEKoWvWa',
  ],
};

function buildSystemPrompt(instrucaoManual = '') {
  return `Você é Rafael, da TVO FOTOGRAFIAS. Você usa IA para transformar fotos de clientes no estilo que eles quiserem.

## SERVIÇO
Você recebe 1 foto do rosto + 1 foto de corpo inteiro do cliente e cria ensaios fotográficos com IA no estilo desejado.
## TABELA DE PREÇOS
1 foto — R$ 14,90
3 fotos — R$ 19,90
5 fotos — R$ 25,90

## FLUXO DE ATENDIMENTO — SIGA EXATAMENTE

### Etapa 1 — ABERTURA (SEMPRE na 1ª mensagem)
Texto OBRIGATÓRIO (adapte o nome se souber):
"Olá! Meu nome é Rafael, sou da TVO FOTOGRAFIAS. Aqui eu uso uma foto sua para deixar ela como você quiser através de inteligência artificial 😊

Vou te passar algumas fotos para você ver como é o meu trabalho e logo após te passo o valor. [ENVIAR_FOTOS_EXEMPLO]

Essa semana estamos fazendo uma promoção no ensaio fotográfico, posso te passar os valores?"

REGRA CRÍTICA: [ENVIAR_FOTOS_EXEMPLO] é OBRIGATÓRIO na primeira resposta. NUNCA pule essa tag.

### Etapa 2 — PREÇOS (cliente disse sim/pode/claro/quero)
Mostre os valores e pergunte qual pacote:
"Esses são os valores para essa semana:

1️⃣ foto — R$ 14,90
3️⃣ fotos — R$ 19,90
5️⃣ fotos — R$ 25,90

Qual pacote fica melhor para você?"

### Etapa 3 — PEDIR FOTOS (cliente escolheu o pacote)
"Perfeito! Me manda uma foto do seu rosto e uma de corpo inteiro, e me diz qual estilo você quer que eu faça 😊"

### Etapa 4 — FOTOS RECEBIDAS (cliente enviou imagens — você vai ver)
"Estou finalizando as fotos de alguns clientes que estão na frente, mas já já eu começo a sua 😊 [PAUSAR_AGENTE]"

## REGRAS
- Máximo 3–4 linhas por mensagem
- Se o cliente enviar foto ou imagem, você consegue ver — reconheça e responda com contexto
- Nunca pule a etapa de mostrar os exemplos ([ENVIAR_FOTOS_EXEMPLO])
- CRÍTICO: Se já existe histórico de conversa, NUNCA reinicie do Etapa 1. Continue de onde parou. [ENVIAR_FOTOS_EXEMPLO] só na primeira mensagem — jamais repita.

## TAGS DE AÇÃO
[ENVIAR_FOTOS_EXEMPLO] — envia as fotos de exemplo do trabalho (use na abertura)
[PAUSAR_AGENTE] — pausa a conversa (use quando receber as fotos do cliente para fazer o serviço)
${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

function extractTags(text) {
  const tags = [];
  if (text.includes('[ENVIAR_FOTOS_EXEMPLO]')) tags.push('ENVIAR_FOTOS_EXEMPLO');
  if (text.includes('[PAUSAR_AGENTE]')) tags.push('PAUSAR_AGENTE');
  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[ENVIAR_FOTOS_EXEMPLO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
    .trim();
}

async function processMessage(event, payload) {
  const { phone, body: rawBody, pushName, _originalJid } = payload;
  if (!phone) return;
  if (payload.isFromMe) return;

  // Transcrever áudio
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

  console.log(`[RAFAEL] Mensagem de ${phone}: "${(body || '').slice(0, 60)}"`);

  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);

  // Acumular mídia ANTES do check de pausa/pending
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

  await new Promise(r => setTimeout(r, 20000));

  try {
    // Rebuild historico APÓS delay
    const conv = getConv(AGENT_ID, phone);
    const instrucao = getInstrucao(AGENT_ID);

    const historico = (conv.msgs || []).slice(-30).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    if (historico.length === 0 || historico.at(-1).role !== 'user') {
      historico.push({ role: 'user', content: body || 'oi' });
    }

    // Injetar visão na última mensagem do usuário
    const mediaList = _pendingMedia.get(phone) || [];
    _pendingMedia.delete(phone);

    if (mediaList.length > 0) {
      let lastUserIdx = -1;
      for (let i = historico.length - 1; i >= 0; i--) {
        if (historico[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) {
        const blocks = mediaList.map(m => ({
          type: 'image',
          source: { type: 'base64', media_type: m.mimetype, data: m.base64 },
        }));
        const hasVideo = mediaList.some(m => m.kind === 'video');
        const textoAtual = historico[lastUserIdx].content;
        const textoFinal = (textoAtual === '[mídia]' || !textoAtual)
          ? (hasVideo ? '[O cliente enviou um vídeo]' : '[O cliente enviou esta imagem — responda com contexto visual]')
          : textoAtual;
        blocks.push({ type: 'text', text: textoFinal });
        historico[lastUserIdx] = { role: 'user', content: blocks };
        console.log(`[RAFAEL] Vision: ${mediaList.length} mídia(s) injetada(s) para ${phone}`);
      }
    }

    // Detecta primeiro contato ANTES da chamada à IA
    const userMsgCount = (conv.msgs || []).filter(m => m.role === 'user').length;
    const isPrimeiroContato = userMsgCount <= 1;
    const jaRespondeu = (conv.msgs || []).some(m => m.role === 'assistant');

    const resposta = await Promise.race([
      callClaudeText(buildSystemPrompt(instrucao), historico, { temperature: 0.75, maxTokens: 500 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);

    const tags = extractTags(resposta);

    // Garante fotos de exemplo no primeiro contato
    if (isPrimeiroContato && !tags.includes('ENVIAR_FOTOS_EXEMPLO')) {
      tags.push('ENVIAR_FOTOS_EXEMPLO');
      console.log(`[RAFAEL] Primeiro contato de ${phone} — ENVIAR_FOTOS_EXEMPLO forçado`);
    }
    // Bloqueia reenvio das fotos de exemplo se já respondeu antes (evita loop)
    if (jaRespondeu && tags.includes('ENVIAR_FOTOS_EXEMPLO')) {
      tags.splice(tags.indexOf('ENVIAR_FOTOS_EXEMPLO'), 1);
      console.log(`[RAFAEL] ENVIAR_FOTOS_EXEMPLO bloqueado — conversa já iniciada para ${phone}`);
    }

    const textoLimpo = removeTags(resposta);
    const sessionId = CONFIG.sessionIds.rafael;

    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
      addMsg(AGENT_ID, phone, 'assistant', textoLimpo);
    }

    if (tags.includes('ENVIAR_FOTOS_EXEMPLO')) {
      await new Promise(r => setTimeout(r, 1000));
      for (const url of MEDIA.exemplos) {
        try {
          await Promise.race([
            baileys.sendMedia(sessionId, phone, 'image', url, '', _originalJid),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000)),
          ]);
        } catch (imgErr) {
          console.error(`[RAFAEL] Imagem de exemplo não enviada:`, imgErr.message);
        }
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    if (tags.includes('PAUSAR_AGENTE')) {
      pausePhone(AGENT_ID, phone);
      sendTelegram(`📸 *Rafael — Cliente enviou fotos!*\nCliente: ${pushName || phone}\nAssuma o atendimento agora! ✅`).catch(() => {});
      console.log(`[RAFAEL] Agente pausado para ${phone} — aguardando atendimento humano`);
    }

  } catch (error) {
    console.error(`[RAFAEL-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *Rafael — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
    _pendingMedia.delete(phone);
  }
}

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
    if (!conv.linkEnviadoEm && !conv.ultimaMensagem) continue;

    const ref = conv.linkEnviadoEm || conv.ultimaMensagem;
    const elapsed = agora - ref;
    if (isNaN(elapsed)) continue;

    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const msg = `Opa, você ainda quer fazer seu ensaio fotográfico com IA? A promoção ainda está ativa! 😊`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[RAFAEL] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[RAFAEL] Erro follow-up ${phone}:`, e.message);
      }
    }

    if (conv.followUpEnviado && !conv.remarketingEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 👋 Ainda dá pra fazer seu ensaio com IA hoje!\n\n1️⃣ foto — R$ 14,90\n3️⃣ fotos — R$ 19,90\n5️⃣ fotos — R$ 25,90\n\nÉ só mandar 1 foto do rosto + 1 de corpo inteiro e me dizer o estilo 🎨`;
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
  setInterval(checkFollowUps, 5 * 60 * 1000);
  await baileys.connect(sessionId, processMessage);
  console.log('[RAFAEL-AGENTE] Rafael pronto');
}

module.exports = { init, processMessage, AGENT_ID };

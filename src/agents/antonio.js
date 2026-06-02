'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'antonio';
const _pending = new Set();
const _pendingMedia = new Map();

// Mesmas fotos de exemplo do Rafael
const MEDIA = {
  exemplos: [
    'https://drive.google.com/uc?export=download&id=1RzgcptEIgsjqYM5xOggkPqVXG8x0MiSQ',
    'https://drive.google.com/uc?export=download&id=1IOgnD_NJ0gGCfSd-UyzSYHNTLEKoWvWa',
  ],
};

// Número MB WAY para pagamento
const MBWAY_NUMERO = '+351 913 183 229';

function buildSystemPrompt(instrucaoManual = '') {
  return `És o António, da TVO FOTOGRAFIAS. Usas inteligência artificial para transformar fotografias de clientes no estilo que desejarem.

## SERVIÇO
Recebes 1 fotografia do rosto + 1 fotografia de corpo inteiro do cliente e crias ensaios fotográficos com IA no estilo pretendido.

## TABELA DE PREÇOS — PADRÃO
1 fotografia — €14,90
3 fotografias — €19,90
5 fotografias — €25,90

## TABELA DE PREÇOS — FOTOGRAFIA SENSUAL
1 fotografia — €30,00
3 fotografias — €40,00
5 fotografias — €50,00

## PAGAMENTO — MB WAY
O pagamento é feito via MB WAY. Após o cliente escolher o pacote, informa:
"O pagamento é por MB WAY. O meu número é ${MBWAY_NUMERO} — assim que confirmares o pagamento, começo o teu ensaio 😊"

## FLUXO DE ATENDIMENTO — SEGUE EXATAMENTE

### Etapa 1 — ABERTURA (SEMPRE na 1ª mensagem)
Texto OBRIGATÓRIO (adapta o nome se souberes):
"Olá! O meu nome é António, sou da TVO FOTOGRAFIAS. Aqui uso uma fotografia tua para a transformar como quiseres através de inteligência artificial 😊

Vou mostrar-te alguns exemplos do meu trabalho e depois digo-te os valores. [ENVIAR_FOTOS_EXEMPLO]

Esta semana temos uma promoção no ensaio fotográfico, posso dizer-te os valores?"

REGRA CRÍTICA: [ENVIAR_FOTOS_EXEMPLO] é OBRIGATÓRIO na primeira resposta. NUNCA saltes essa tag.

### Etapa 2 — PREÇOS (cliente disse sim/pode/claro/quero)
Mostra os valores e pergunta qual pacote:
"Estes são os valores para esta semana:

1️⃣ fotografia — €14,90
3️⃣ fotografias — €19,90
5️⃣ fotografias — €25,90

Qual pacote preferes?"

### Etapa 3 — PEDIR FOTOS (cliente escolheu o pacote)
"Fixe! Manda-me uma fotografia do rosto e uma de corpo inteiro, e diz-me qual estilo queres que eu faça 😊"

### Etapa 4 — FOTOS RECEBIDAS (cliente enviou imagens — vês as fotos)
"Estou a terminar os ensaios de alguns clientes que estão à frente, mas já de seguida começo o teu 😊 [PAUSAR_AGENTE]"

## REGRA — CLIENTE PEDE PARA VER EXEMPLOS OU MODELOS (fora do 1º contacto)
Se o cliente pedir para ver exemplos, modelos ou como é o trabalho após o primeiro contacto, responde EXATAMENTE:
"Manda-me duas fotografias tuas para eu fazer uma prévia e veres como funciona o meu trabalho"

## REGRA — FOTOGRAFIA SENSUAL
Se o cliente pedir fotografias sensuais, de lingerie, íntimas, ousadas ou similar, mostra a tabela especial e acrescenta a frase:
"Para este estilo os valores são:

1️⃣ fotografia — €30,00
3️⃣ fotografias — €40,00
5️⃣ fotografias — €50,00

Neste modelo cobramos mais porque gastamos mais recursos daqui também.

Qual pacote preferes?"

## REGRAS GERAIS
- Fala sempre em português europeu (Portugal) — usa "tu", "tens", "queres", "estás", "podes"
- Usa expressões portuguesas: "fixe", "óptimo", "de certeza", "talvez", "mesmo assim"
- Cumprimenta pelo horário quando adequado: "Bom dia", "Boa tarde", "Boa noite"
- Máximo 3–4 linhas por mensagem
- Se o cliente enviar fotografia ou imagem, consegues ver — reconhece e responde com contexto visual
- Nunca saltes a etapa de mostrar os exemplos ([ENVIAR_FOTOS_EXEMPLO])
- CRÍTICO: Se já existe histórico de conversa, NUNCA recomeces do Etapa 1. Continua de onde paraste. [ENVIAR_FOTOS_EXEMPLO] só na primeira mensagem — jamais repitas.
- O serviço é entregue em até 24h após receberes as fotografias

## TAGS DE AÇÃO
[ENVIAR_FOTOS_EXEMPLO] — envia as fotografias de exemplo do trabalho (usa na abertura)
[PAUSAR_AGENTE] — pausa a conversa (usa quando receberes as fotografias do cliente para fazer o serviço)
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
        console.log(`[ANTONIO] Áudio transcrito de ${phone}: "${transcricao.slice(0, 80)}"`);
      }
    } catch (e) {
      console.error(`[ANTONIO] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  console.log(`[ANTONIO] Mensagem de ${phone}: "${(body || '').slice(0, 60)}"`);

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
    const conv = getConv(AGENT_ID, phone);
    const instrucao = getInstrucao(AGENT_ID);

    const historico = (conv.msgs || []).slice(-30).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    if (historico.length === 0 || historico.at(-1).role !== 'user') {
      historico.push({ role: 'user', content: body || 'olá' });
    }

    // Injetar visão na última mensagem do utilizador
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
          ? (hasVideo ? '[O cliente enviou um vídeo]' : '[O cliente enviou esta imagem — responde com contexto visual]')
          : textoAtual;
        blocks.push({ type: 'text', text: textoFinal });
        historico[lastUserIdx] = { role: 'user', content: blocks };
        console.log(`[ANTONIO] Vision: ${mediaList.length} mídia(s) injetada(s) para ${phone}`);
      }
    }

    // Detecta primeiro contacto ANTES da chamada à IA
    const userMsgCount = (conv.msgs || []).filter(m => m.role === 'user').length;
    const isPrimeiroContato = userMsgCount <= 1;
    const jaRespondeu = (conv.msgs || []).some(m => m.role === 'assistant');

    const resposta = await Promise.race([
      callClaudeText(buildSystemPrompt(instrucao), historico, { temperature: 0.75, maxTokens: 500 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);

    const tags = extractTags(resposta);

    // Garante fotos de exemplo no primeiro contacto
    if (isPrimeiroContato && !tags.includes('ENVIAR_FOTOS_EXEMPLO')) {
      tags.push('ENVIAR_FOTOS_EXEMPLO');
      console.log(`[ANTONIO] Primeiro contacto de ${phone} — ENVIAR_FOTOS_EXEMPLO forçado`);
    }
    // Bloqueia reenvio se já respondeu antes
    if (jaRespondeu && tags.includes('ENVIAR_FOTOS_EXEMPLO')) {
      tags.splice(tags.indexOf('ENVIAR_FOTOS_EXEMPLO'), 1);
      console.log(`[ANTONIO] ENVIAR_FOTOS_EXEMPLO bloqueado — conversa já iniciada para ${phone}`);
    }

    const textoLimpo = removeTags(resposta);
    const sessionId = CONFIG.sessionIds.antonio;

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
          console.error(`[ANTONIO] Imagem de exemplo não enviada:`, imgErr.message);
        }
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    if (tags.includes('PAUSAR_AGENTE')) {
      pausePhone(AGENT_ID, phone);
      sendTelegram(`📸🇵🇹 *António — Portugal — Cliente enviou fotos!*\nCliente: ${pushName || phone}\nAssuma o atendimento agora! ✅`).catch(() => {});
      console.log(`[ANTONIO] Agente pausado para ${phone} — aguardando atendimento humano`);
    }

  } catch (error) {
    console.error(`[ANTONIO-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *António — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
    _pendingMedia.delete(phone);
  }
}

async function checkFollowUps() {
  const db = require('../database');
  const convMap = db.state.conversations.antonio;
  if (!convMap) return;

  const sessionId = CONFIG.sessionIds.antonio;
  if (baileys.getState(sessionId) !== 'connected') return;

  const agora = Date.now();
  const DUAS_HORAS = 2 * 60 * 60 * 1000;
  const VINTE_QUATRO_HORAS = 24 * 60 * 60 * 1000;

  // Respeita fuso horário de Portugal (UTC/UTC+1) — só envia entre 09:00 e 21:00 hora local
  const horaPortugal = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', hour: 'numeric', hour12: false });
  const hora = parseInt(horaPortugal);
  if (hora < 9 || hora >= 21) return;

  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;
    if (!conv.linkEnviadoEm && !conv.ultimaMensagem) continue;

    const ref = conv.linkEnviadoEm || conv.ultimaMensagem;
    const elapsed = agora - ref;
    if (isNaN(elapsed)) continue;

    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const msg = `Olá! Ainda tens interesse em fazer o teu ensaio fotográfico com IA? A promoção ainda está ativa! 😊`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[ANTONIO] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[ANTONIO] Erro follow-up ${phone}:`, e.message);
      }
    }

    if (conv.followUpEnviado && !conv.remarketingEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Olá${nome}! 👋 Ainda podes fazer o teu ensaio com IA hoje!\n\n1️⃣ fotografia — €14,90\n3️⃣ fotografias — €19,90\n5️⃣ fotografias — €25,90\n\nÉ só mandar 1 foto do rosto + 1 de corpo inteiro e dizer o estilo que queres 🎨\nPagamento por MB WAY: ${MBWAY_NUMERO}`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.remarketingEnviado = true;
        console.log(`[ANTONIO] Remarketing 24h → ${phone}`);
      } catch (e) {
        console.error(`[ANTONIO] Erro remarketing ${phone}:`, e.message);
      }
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.antonio;
  console.log('[ANTONIO-AGENTE] Inicializando António — TVO Fotografias Portugal...');
  setInterval(checkFollowUps, 5 * 60 * 1000);
  await baileys.connect(sessionId, processMessage);
  console.log('[ANTONIO-AGENTE] António pronto 🇵🇹');
}

module.exports = { init, processMessage, AGENT_ID };

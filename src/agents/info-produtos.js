'use strict';

// ============================================================
// AGENTE INFO-PRODUTOS — Vendas de Cursos Digitais via WhatsApp
// Produto principal: https://kiwify.app/ncJcJee
// Downsell (se recusar principal ou "sem dinheiro"): https://kiwify.app/HJyLHa4
// ============================================================

const { CONFIG } = require('../config');
const { callGemini, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'info';
const _pending = new Set();

// ----- Prompt do sistema -----
function buildSystemPrompt(instrucaoManual = '') {
  const agentName = CONFIG.agents.info.name || 'Sofia';
  const prodPrincipal = CONFIG.agents.info.produtos.principal;
  const prodDownsell = CONFIG.agents.info.produtos.downsell;

  return `Você é ${agentName}, especialista em transformação digital e educação online.
Você vende cursos digitais que mudam a vida das pessoas.

## PRODUTO PRINCIPAL
Nome: ${prodPrincipal.nome}
Link de pagamento: ${prodPrincipal.link}
Preço: R$${prodPrincipal.preco}

## PRODUTO DOWNSELL
Nome: ${prodDownsell.nome}
Link de pagamento: ${prodDownsell.link}
Preço: R$${prodDownsell.preco}
QUANDO OFERECER: SOMENTE se o cliente recusar o produto principal OU disser explicitamente que está sem dinheiro / que está caro.

## FLUXO DE VENDAS
1. ABERTURA — Cumprimentar com o nome do cliente (se souber), apresentar-se como ${agentName}
2. CONEXÃO — Mostrar que entende o problema/desejo do cliente. Fazer 1-2 perguntas para engajar.
3. APRESENTAÇÃO — Apresentar o produto principal com benefícios concretos. ENVIAR_VIDEO se disponível.
4. PROVA SOCIAL — Citar resultados reais de alunos (genérico mas crível)
5. OFERTA — Apresentar o preço do produto principal. Link: ${prodPrincipal.link}
6. OBJEÇÕES — Contornar objeções com empatia e evidências
7. DOWNSELL — SE e SOMENTE SE cliente recusar ou disser "sem dinheiro/caro": oferecer ${prodDownsell.nome} por R$${prodDownsell.preco}. Link: ${prodDownsell.link}
8. FECHAMENTO — Confirmar interesse e enviar link de pagamento direto

## REGRAS INVIOLÁVEIS
- NUNCA inventar preços. Principal: R$${prodPrincipal.preco} | Downsell: R$${prodDownsell.preco}
- NUNCA oferecer o downsell primeiro. Sempre tentar o principal primeiro.
- NUNCA mencionar o downsell se o cliente já aceitou o principal
- Máximo 3 mensagens consecutivas sem resposta do cliente antes de parar (anti-spam)
- Mensagens curtas, conversacionais, com emojis moderados
- NUNCA prometer resultados que não pode garantir
- Ser empático e genuíno, não soar como robô

## TAGS DE AÇÃO (use quando necessário)
[ENVIAR_VIDEO] — para enviar o vídeo de apresentação do produto
[ENVIAR_FOTO] — para enviar foto/imagem do produto
[TRANSFERIR_HUMANO] — quando o cliente pedir para falar com pessoa real
[PAUSAR_AGENTE] — quando o cliente pedir para parar/não querer mais contato

## TOM E ESTILO
- Amigável, próximo, confiante mas sem pressão
- Use o nome do cliente sempre que souber
- Mensagens de no máximo 3-4 linhas por vez
- Linguagem informal mas profissional
${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

// ----- Detecta tags na resposta -----
function extractTags(text) {
  const tags = [];
  if (text.includes('[ENVIAR_VIDEO]')) tags.push('ENVIAR_VIDEO');
  if (text.includes('[ENVIAR_FOTO]')) tags.push('ENVIAR_FOTO');
  if (text.includes('[TRANSFERIR_HUMANO]')) tags.push('TRANSFERIR_HUMANO');
  if (text.includes('[PAUSAR_AGENTE]')) tags.push('PAUSAR_AGENTE');
  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[ENVIAR_VIDEO\]/gi, '')
    .replace(/\[ENVIAR_FOTO\]/gi, '')
    .replace(/\[TRANSFERIR_HUMANO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
    .trim();
}

// ----- Processa mensagem recebida -----
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
        console.log(`[INFO] Áudio transcrito de ${phone}: "${transcricao.slice(0, 80)}"`);
      }
    } catch (e) {
      console.error(`[INFO] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  // Registrar mensagem do cliente
  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);

  // Verificar se está pausado
  if (isPaused(AGENT_ID, phone)) return;
  if (_pending.has(phone)) return;
  _pending.add(phone);

  // Delay antes de responder — mensagens recebidas neste período acumulam no DB
  await new Promise(r => setTimeout(r, 20000));

  try {
    // Rebuild historico APÓS o delay para incluir todas as mensagens recebidas durante a espera
    const conv = getConv(AGENT_ID, phone);
    const instrucao = getInstrucao(AGENT_ID);

    const historico = (conv.msgs || []).slice(-20).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      content: m.text,
    }));

    if (historico.length === 0 || historico.at(-1).role !== 'user') {
      historico.push({ role: 'user', content: body || 'oi' });
    }

    const systemPrompt = buildSystemPrompt(instrucao);
    const resposta = await Promise.race([
      callGemini(systemPrompt, historico, { temperature: 0.8, maxTokens: 600 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);

    const tags = extractTags(resposta);
    const textoLimpo = removeTags(resposta);

    const sessionId = CONFIG.sessionIds.info;

    // Processar tags
    if (tags.includes('PAUSAR_AGENTE')) {
      pausePhone(AGENT_ID, phone);
      console.log(`[INFO-AGENTE] Agente pausado para ${phone} por solicitação do cliente`);
    }

    // Enviar resposta de texto — addMsg só após envio confirmado
    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
      addMsg(AGENT_ID, phone, 'assistant', textoLimpo);
    }

    // Enviar mídia se solicitado
    if (tags.includes('ENVIAR_VIDEO') && CONFIG.agents.info.media.video1) {
      await new Promise(r => setTimeout(r, 1500));
      await baileys.sendMedia(sessionId, phone, 'video', CONFIG.agents.info.media.video1, '', _originalJid);
    }

    if (tags.includes('ENVIAR_FOTO') && CONFIG.agents.info.media.foto1) {
      await new Promise(r => setTimeout(r, 1000));
      await baileys.sendMedia(sessionId, phone, 'image', CONFIG.agents.info.media.foto1, '', _originalJid);
    }

    if (tags.includes('TRANSFERIR_HUMANO')) {
      pausePhone(AGENT_ID, phone);
      console.log(`[INFO-AGENTE] Transferindo ${phone} para humano`);
    }

  } catch (error) {
    console.error(`[INFO-AGENTE] Erro ao processar mensagem de ${phone}:`, error.message);
    sendTelegram(`⚠️ *Info-Agente — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
  }
}

// ----- Inicializa o agente -----
async function init() {
  const sessionId = CONFIG.sessionIds.info;
  console.log('[INFO-AGENTE] Inicializando conexão WhatsApp...');
  await baileys.connect(sessionId, processMessage);
  console.log('[INFO-AGENTE] Agente info-produtos pronto');
}

module.exports = { init, processMessage, AGENT_ID };

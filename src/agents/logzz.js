'use strict';

// ============================================================
// AGENTE LOGZZ — Vendas de Produtos Físicos COD
// Produto a definir — estrutura base pronta
// ============================================================

const { CONFIG } = require('../config');
const { callGemini } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, addPedido, getInstrucao } = require('../database');
const baileys = require('../baileys');

const AGENT_ID = 'logzz';

function buildSystemPrompt(instrucaoManual = '') {
  const agentName = CONFIG.agents.logzz.name || 'Lucas';
  const produto = CONFIG.agents.logzz.produto;

  return `Você é ${agentName}, consultor de vendas especializado em produtos físicos via entrega Logzz.

## PRODUTO
Nome: ${produto.nome}
Preço: R$${produto.preco}
Piso: R$${produto.piso}
Forma de pagamento: SOMENTE na entrega (COD — Cash on Delivery)
Frete: GRÁTIS (Logzz cobre o frete)
Prazo de entrega: 5-10 dias úteis
Cobertura: todo o Brasil

## FLUXO DE VENDAS
1. ABERTURA — Cumprimentar o cliente, apresentar-se como ${agentName}
2. QUALIFICAÇÃO — Confirmar cidade/estado para verificar cobertura
3. APRESENTAÇÃO — Apresentar o produto com fotos e vídeo. ENVIAR_FOTO + ENVIAR_VIDEO
4. PROVA SOCIAL — Mostrar resultados e avaliações de clientes
5. OFERTA — Preço R$${produto.preco} + frete GRÁTIS + paga só na entrega
6. COLETA DE DADOS — SOMENTE após confirmação de interesse: Nome completo, Endereço completo (CEP, rua, número, bairro, cidade, estado), Telefone de contato
7. CONFIRMAÇÃO — Confirmar todos os dados e prazo
8. FINALIZAÇÃO — Informar que o pedido será agendado + [REGISTRAR_PEDIDO]

## REGRAS INVIOLÁVEIS
- NUNCA cobrar antecipado. SOMENTE na entrega.
- NUNCA inventar preço. R$${produto.preco} é o preço fixo. Piso: R$${produto.piso}
- NUNCA fazer desconto sem autorização explícita do dono
- Só coletar dados após o cliente confirmar interesse real
- NUNCA pressionar com urgência falsa

## TAGS DE AÇÃO
[ENVIAR_VIDEO] — enviar vídeo de apresentação
[ENVIAR_FOTO] — enviar foto do produto
[REGISTRAR_PEDIDO:nome|endereco|telefone] — registrar pedido para agendamento
[TRANSFERIR_HUMANO] — transferir para atendimento humano
[PAUSAR_AGENTE] — pausar agente para este cliente

## TOM
- Confiante, próximo, sem pressão
- Mensagens curtas (3-4 linhas)
- Linguagem informal e amigável
${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

function extractTags(text) {
  const tags = [];
  if (text.includes('[ENVIAR_VIDEO]')) tags.push('ENVIAR_VIDEO');
  if (text.includes('[ENVIAR_FOTO]')) tags.push('ENVIAR_FOTO');
  if (text.includes('[TRANSFERIR_HUMANO]')) tags.push('TRANSFERIR_HUMANO');
  if (text.includes('[PAUSAR_AGENTE]')) tags.push('PAUSAR_AGENTE');

  const pedidoMatch = text.match(/\[REGISTRAR_PEDIDO:([^\]]+)\]/i);
  if (pedidoMatch) {
    const parts = pedidoMatch[1].split('|');
    tags.push({ type: 'REGISTRAR_PEDIDO', nome: parts[0], endereco: parts[1], telefone: parts[2] });
  }

  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[ENVIAR_VIDEO\]/gi, '')
    .replace(/\[ENVIAR_FOTO\]/gi, '')
    .replace(/\[TRANSFERIR_HUMANO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
    .replace(/\[REGISTRAR_PEDIDO:[^\]]*\]/gi, '')
    .trim();
}

async function processMessage(event, payload) {
  const { phone, body, pushName, _originalJid } = payload;
  if (!phone) return;

  if (!payload.isFromMe) {
    addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);
  }

  if (payload.isFromMe) {
    pausePhone(AGENT_ID, phone);
    console.log(`[LOGZZ-AGENTE] Dono assumiu conversa com ${phone} → pausando`);
    return;
  }

  if (isPaused(AGENT_ID, phone)) return;

  const conv = getConv(AGENT_ID, phone);
  const instrucao = getInstrucao(AGENT_ID);

  const historico = (conv.msgs || []).slice(-20).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    content: m.text,
  }));

  if (historico.length === 0 || historico.at(-1).role !== 'user') {
    historico.push({ role: 'user', content: body || 'oi' });
  }

  try {
    const systemPrompt = buildSystemPrompt(instrucao);
    const resposta = await callGemini(systemPrompt, historico, { temperature: 0.8, maxTokens: 600 });

    const tags = extractTags(resposta);
    const textoLimpo = removeTags(resposta);

    addMsg(AGENT_ID, phone, 'assistant', textoLimpo);

    const sessionId = CONFIG.sessionIds.logzz;

    // Processar REGISTRAR_PEDIDO
    const pedidoTag = tags.find(t => t?.type === 'REGISTRAR_PEDIDO');
    if (pedidoTag) {
      addPedido({
        phone,
        nome: pedidoTag.nome || pushName || phone,
        produto: CONFIG.agents.logzz.produto.nome,
        preco: CONFIG.agents.logzz.produto.preco,
        endereco: pedidoTag.endereco || '',
        telefone: pedidoTag.telefone || phone,
      });
      console.log(`[LOGZZ-AGENTE] Pedido registrado para ${phone}`);
    }

    if (tags.includes('PAUSAR_AGENTE')) pausePhone(AGENT_ID, phone);

    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
    }

    if (tags.includes('ENVIAR_VIDEO') && CONFIG.agents.logzz.media.video1) {
      await new Promise(r => setTimeout(r, 1500));
      await baileys.sendMedia(sessionId, phone, 'video', CONFIG.agents.logzz.media.video1, '', _originalJid);
    }

    if (tags.includes('ENVIAR_FOTO') && CONFIG.agents.logzz.media.foto1) {
      await new Promise(r => setTimeout(r, 1000));
      await baileys.sendMedia(sessionId, phone, 'image', CONFIG.agents.logzz.media.foto1, '', _originalJid);
    }

    if (tags.includes('TRANSFERIR_HUMANO')) {
      pausePhone(AGENT_ID, phone);
    }

  } catch (error) {
    console.error(`[LOGZZ-AGENTE] Erro ao processar mensagem de ${phone}:`, error.message);
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.logzz;
  console.log('[LOGZZ-AGENTE] Inicializando conexão WhatsApp...');
  await baileys.connect(sessionId, processMessage);
  console.log('[LOGZZ-AGENTE] Agente Logzz pronto');
}

module.exports = { init, processMessage, AGENT_ID };

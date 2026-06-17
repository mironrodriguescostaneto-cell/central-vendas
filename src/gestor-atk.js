// ============================================
// ASLAM — Gerente IA de Operações
// Controla Pedro e Rodrigo via comandos
// ============================================
const CONFIG = require("./config-atk");
const db = require("./database-atk");
const { sanitize, callClaude, callClaudeWithTools, setJarvisExecutor, sendText, sendMedia, getBrasiliaTime } = require("./services-atk");
const engine = require("./followup-engine-atk");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const obsidianApi = require("./obsidian-api-atk");

// Gera o system prompt do Aslam com precos atuais de db.agentCatalog — fonte única persistida
function buildAslamSystemPrompt() {
  // Lê preços do banco (fonte única e persistida)
  const pedroPreco   = db.getAgentPrice("pedro");   const pedroPiso   = db.getAgentPiso("pedro");
  const rodrigoPreco = db.getAgentPrice("rodrigo"); const rodrigoPiso = db.getAgentPiso("rodrigo");
  // Nomes dos agentes vêm do CONFIG (não mudam)
  const pedro   = CONFIG.AGENTS.pedro;
  const rodrigo = CONFIG.AGENTS.rodrigo;
  return `Voce e Aslam, CEO de Operacoes da Atacadao Variedades. Braco direito do Miron (dono).
Voce PENSA e AGE como dono. Conhece: SPIN Selling, Challenger Sale, OKRs, metricas de conversao, psicologia do consumidor.

AUTORIDADE MAXIMA: Voce e o gerente direto de Pedro e Rodrigo. Suas instrucoes sao LEI. Quando voce instrui algo, eles OBEDECEM sem questionar.

REGRA CRITICA — USAR TAGS OBRIGATORIAMENTE:
Quando o Miron pedir para voce instruir, ensinar, treinar, falar para, mandar, avisar, ou dar qualquer ordem para os agentes, voce DEVE incluir a tag correspondente na sua resposta. SEM A TAG, A INSTRUCAO NAO CHEGA AO AGENTE.

SEUS PODERES (use tags invisiveis — OBRIGATORIO):
1. Pausar agente: [PAUSAR:numero] ou [PAUSAR:agente:numero]
2. Retomar agente: [RETOMAR:numero]
3. Pausar todos: [PAUSAR_TODOS]
4. Retomar/liberar TODOS: [RETOMAR_TODOS]
5. Ver ativos: responda com a lista
6. Ver pausados: responda com a lista
7. Enviar mensagem: [ENVIAR:numero:mensagem] ou [ENVIAR:agente:numero:mensagem]
8. Ver historico: responda com as mensagens
9. Limpar historico: [LIMPAR:numero]
10. Mudar preco: confirme a mudanca
11. Analisar cliente: faca analise detalhada
12. Relatorio executivo: gere analise completa
13. Treinar/instruir agente: [TREINAR_PEDRO:instrucao] ou [TREINAR_RODRIGO:instrucao] ou [TREINAR_TODOS:instrucao]

EXEMPLOS DE USO CORRETO DAS TAGS:
- Miron diz "fala pro pedro dar desconto de 10%"
  Voce responde: "Feito, chefe! Pedro ja recebeu a ordem. [TREINAR_PEDRO:Oferecer desconto de 10% para clientes que pedirem]"
- Miron diz "avisa todos pra nao vender fiado"
  Voce responde: "Ja avisei toda a equipe! [TREINAR_TODOS:NAO vender fiado em hipotese alguma. Apenas PIX, dinheiro ou cartao.]"
- Miron diz "manda o rodrigo parar de mandar audio"
  Voce responde: "Rodrigo ja sabe. [TREINAR_RODRIGO:NAO enviar audios para clientes. Apenas mensagens de texto.]"

IMPORTANTE: Se o Miron pedir qualquer coisa que envolva mudar o comportamento de um agente, SEMPRE use [TREINAR_AGENTE:instrucao]. Nunca apenas "diga" que vai fazer — USE A TAG para que a instrucao seja realmente salva e aplicada.

CATALOGO DE PRODUTOS — PRECOS ATUAIS (fonte: CONFIG em runtime):

== PRODUTO 1A: Uni TV V10 (Pedro vende) ==
- Aparelho streaming Android, transforma qualquer TV em smart TV
- Sem mensalidade, paga uma vez
- Netflix, Prime, HBO Max, Globoplay, Apple TV+, futebol ao vivo
- PRECO: R$${pedroPreco} (pago na entrega ao entregador) | PISO: R$${pedroPiso} (minimo absoluto)
- Parcelas: calculadas dinamicamente pelo sistema (cartao de credito, maquininha na entrega)
- Entrega: Goiania e regiao (frete = km x 2, min R$15 ate 7km, max 30km)

== PRODUTO 1B: Uni TV S10 preto (Pedro vende) ==
- Modelo mais recente, lancado em 2026
- Possui ESPN; o V10 nao possui ESPN
- Resolucao 8K e processador mais rapido
- PRECO: R$400 (pago na entrega ao entregador)
- Parcelas: calculadas dinamicamente pelo sistema (cartao de credito, maquininha na entrega)
- Entrega: mesma regra do V10

== PRODUTO 2: ${rodrigo.product} (Rodrigo vende) ==
- Furadeira profissional sem fio 48V, 2 baterias, maleta, acessorios
- ATENCAO: "48V" e VOLTAGEM, NAO preco. Preco e R$${rodrigoPreco}.
- PRECO: R$${rodrigoPreco} (pago na entrega ao entregador) | PISO: R$${rodrigoPiso} (minimo absoluto)
- Parcelas: calculadas dinamicamente pelo sistema
- Entrega: mesma regra do Pedro (km x 2)

REGRAS DE PRECO — INVIOLAVEIS:
- NUNCA passe um valor diferente dos listados acima
- NUNCA invente precos, descontos ou condicoes que nao existem
- Se nao souber o preco exato, diga "vou confirmar com o agente responsavel"
- Sem link de pagamento por cartao — entregador leva maquininha
- Frete Pedro/Rodrigo: distancia em km x 2 = valor do frete (20km = R$40, NAO R$20)

PAGAMENTO PEDRO/RODRIGO — REGRA ABSOLUTA INVIOLAVEL:
- Pagamento SOMENTE na entrega, diretamente ao entregador, quando o cliente recebe o produto
- NUNCA instruir Pedro/Rodrigo a pedir PIX adiantado
- NUNCA usar termos como "faz o PIX agora", "manda o PIX", "paga antes"
- Seguranca do cliente: ele paga so ao ver o produto nas maos
- Opcoes de pagamento (tudo na entrega): PIX, dinheiro, debito, cartao (maquininha)

HORARIO DE FUNCIONAMENTO (ENTREGAS):
- Seg-Sex: 10:00-16:30
- Sabado: 09:00-13:00
- Domingo: FECHADO — sem entrega
- Retirada NAO e oferecida — trabalhamos SOMENTE com entrega
- Fora do horario: nao prometer entrega no dia, orientar para proximo dia util

AGENTES E RESPONSABILIDADES:
- Pedro: ${pedro.product} (Goiania, R$${pedroPreco} na entrega)
- Rodrigo: ${rodrigo.product} (Goiania, R$${rodrigoPreco} na entrega)

MODO JARVIS (poderes de DEV):
Voce tem um modo especial chamado JARVIS que permite:
- Ler e editar qualquer arquivo de codigo do sistema
- Fazer deploy no Railway (git commit + push)
- Reiniciar o sistema
- Investigar bugs lendo o codigo fonte
- Buscar no codigo para encontrar problemas
Quando o Miron pedir algo que envolva mudar o codigo, corrigir bugs no sistema, ou fazer deploy, voce AUTOMATICAMENTE entra no modo Jarvis.
O Miron tambem pode digitar "jarvis" seguido do comando para forcar o modo.

Tom: direto, executivo, nunca diz "nao consigo". Sempre resolve.
Idioma: portugues brasileiro informal mas profissional.`;
}

const AGENT_IDS = ["pedro", "rodrigo"];

// Padroes de instrucoes TREINAR que conflitam com regras de preco/desconto do manual
// Espelhado de agents.js — nao importar diretamente para evitar dep circular
const _DANGEROUS_TREINAR = /descont[ao]|promo[cç][aã]|pre[cç]o\s*especial|mais\s+barato|ofereç[ae]\s+(?:por|um)|fa[cç][ae]\s+por|fecha\s+(?:hoje|agora)\s*(?:com|por)|v[aá]lido\s+s[oó]\s+hoje|oferta\s+(?:especial|relamp|flash)/i;
const _NEGATION_TREINAR = /\b(?:n[aã]o|nunca|jamais|proibido|bloqueado|sem\s+autoriza|apenas\s+com\s+autoriza)\b/i;
function _isDangerousTreinar(text) {
  const t = String(text || "");
  return _DANGEROUS_TREINAR.test(t) && !_NEGATION_TREINAR.test(t);
}

// Helper: retorna produto e preco atuais do agente (fonte: db.agentCatalog)
function getAgentProductInfo(agentId) {
  return { product: db.getAgentProductName(agentId), price: db.getAgentPrice(agentId) };
}

function detectPedroProductKeyFromText(text) {
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(?:s\s*10|s10|preto|espn|mais\s+recente|lancad[oa]\s+em\s+2026|2026|8k|processador)\b/.test(t)) return "s10";
  if (/\b(?:v\s*10|v10|branc[ao]|mais\s+barat[ao]|menor\s+valor)\b/.test(t)) return "v10";
  return null;
}

function getPedroProductKeyFromConversation(conv) {
  if (conv?.pedroProductKey) return conv.pedroProductKey;
  const userText = (conv?.msgs || [])
    .filter(m => m.role === "user")
    .slice(-12)
    .map(m => m.content || "")
    .join("\n");
  return detectPedroProductKeyFromText(userText) || "v10";
}

const leadCooldowns = new Map();

// Verificar se está dentro do horário comercial para remarketing/follow-up
// Seg-Sex 08:00-18:00 (horário de Brasília)
function isDentroHorarioComercial() {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hora = brasilia.getHours();
  const dia = brasilia.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
  // Seg(1) a Sex(5), 08:00-17:59
  if (dia === 0 || dia === 6) return false; // Sab/Dom
  if (hora < 8 || hora >= 18) return false;
  return true;
}

// Sanitizar mensagens de remarketing — remove headers, titulos, prefixos indesejaveis
function cleanRemarketingMsg(msg) {
  if (!msg) return msg;
  let clean = msg
    // Remover headers markdown (# ## ###)
    .replace(/^#+\s*.*\n?/gm, "")
    // Remover prefixos como "Mensagem de Remarketing para X" ou "Remarketing:"
    .replace(/^(?:mensagem\s+de\s+)?remarketing(?:\s+para\s+\w+)?[:\s]*/gi, "")
    // Remover linhas vazias no inicio
    .replace(/^\s*\n/gm, "")
    .trim();
  return clean || msg; // fallback para original se limpeza removeu tudo
}

function isBadRemarketingMsg(msg) {
  const t = String(msg || "").trim();
  if (!t) return true;
  const normalized = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").trim();
  if (/^(eai|oi|ola|opa|bom dia|boa tarde|boa noite|tudo bem|e ai)$/.test(normalized)) return true;
  if (normalized.length < 18) return true;
  if (t.length > 35 && !/[.!?)]$/.test(t)) return true;
  return false;
}

function fallbackRemarketingMsg(agentId, prodInfo) {
  if (agentId === "pedro") {
    if (/s10/i.test(prodInfo?.product || "")) {
      return "Oi! Ainda tenho o Uni TV S10 preto por R$400. Ele e o modelo 2026 com ESPN, 8K e processador mais rapido. Quer que eu separe um pra voce?";
    }
    return "Oi! Ainda tenho o Uni TV V10 por R$360, sem mensalidade e pago so na entrega. Quer que eu veja a entrega pra voce?";
  }
  if (agentId === "rodrigo") {
    return "Oi! Ainda tenho a Furadeira 48V por R$160, kit completo e pago so na entrega. Quer que eu veja a entrega pra voce?";
  }
  return `Oi! Ainda tenho ${prodInfo?.product || "o produto"} disponivel. Quer que eu te passe os detalhes?`;
}

// Mensagens fixas de remarketing 24h — determinísticas, sem IA
const PEDRO_RM_24H_V10 = "Opa, tudo bem? passando para te falar que consegui um super desconto no Uni TV V10 para voce fechar comigo hoje. Ontem te passei por R$360, mas para fechar hoje consigo fazer R$330 a vista no PIX ou dinheiro. Esse valor e somente hoje. Posso separar o seu?";
const PEDRO_RM_24H_S10 = "Opa, tudo bem? passando para te avisar que ainda tenho o Uni TV S10 preto, o modelo 2026 com ESPN, por R$400 a vista. Tambem parcela no cartao com a taxa da maquininha. Posso separar um pra voce?";
const RODRIGO_RM_24H = "Opa, tudo bem? passando para te falar que consegui um super desconto no aparelho para você fechar comigo hoje. ontem te passei o valor da furadeira por 160,00 mas para fechar comigo hoje, eu te faço a 130,00 a vista no pix ou dinheiro. Mas lembrando que esse valor consigo fazer somente hoje. posso separar o seu?";

// Retorna timestamp UTC correspondente a 23:59:59 de hoje no fuso Brasília
function endOfDayBrasiliaTs() {
  const now = new Date();
  const brStr = now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const brNow = new Date(brStr);
  const brEod = new Date(brStr);
  brEod.setHours(23, 59, 59, 999);
  return Date.now() + (brEod - brNow);
}

// ============================================
// CAMPANHA VISUAL PONTUAL — executeVisualCampaign
// Dispara imagem + legenda para clientes de um agente sem alterar produto principal.
// ============================================
async function executeVisualCampaign({ agentId, mediaUrl, productName, price, instrucao, contacts }) {
  const agentConfig = CONFIG.AGENTS[agentId];
  const priceText = price ? `R$${price}` : "";
  const prodLabel = productName || db.getAgentProductName(agentId);

  // Gera legenda vendedora via Claude (curta, WhatsApp-friendly)
  let caption = "";
  try {
    const captionRaw = await callClaude(
      `Voce e ${agentConfig.name} da Atacadao Variedades. Gere uma legenda CURTA e vendedora para WhatsApp anunciando produto que chegou hoje. PRODUTO: ${prodLabel}${priceText ? `. PRECO: ${priceText}` : ""}${instrucao ? `. CONTEXTO: ${instrucao}` : ""}. Maximo 3 linhas. Inclua preco se informado. CTA simples (ex: "Me chama aqui!"). SEM headers markdown. SEM emojis excessivos.`,
      [{ role: "user", content: "Gere a legenda da campanha:" }],
      { maxTokens: 120, timeout: 15000 }
    );
    caption = cleanRemarketingMsg(captionRaw || "");
  } catch (_) {}

  if (!caption) {
    caption = `Chegou hoje na Atacadão: ${prodLabel}${priceText ? ` por ${priceText}` : ""}.\nTenho poucas unidades. Se quiser, me chama que eu separo pra você!`;
  }

  // Criar registro da campanha antes de disparar
  const campaign = db.createVisualCampaign({ agentId, mediaUrl, productName: prodLabel, price, pauseOnReply: true, notifyOwnerOnReply: true });

  let sent = 0, skipped = 0, errors = 0;

  for (const { numero, conv } of contacts) {
    try {
      if (db.isManuallyPaused(numero)) { skipped++; continue; }
      if (db.hasSaleForNumber(numero)) { skipped++; continue; }

      // Envia imagem com legenda
      await sendMedia(agentId, numero, "image", mediaUrl, caption);

      // Registra no histórico da conversa com marcador de campanha
      if (conv) {
        conv.msgs.push({
          role: "assistant",
          content: `[CAMPANHA_VISUAL:${campaign.id}] ${caption}`,
          timestamp: Date.now(),
          _type: "campanha_visual",
          _campaignId: campaign.id,
        });
        conv.ultimaMensagem = Date.now();
      }

      db.markCampaignSent(campaign.id, numero);
      sent++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error(`[CampanhaVisual] erro ${numero}:`, e.message);
      errors++;
    }
  }

  // Salvar sentTo depois do loop (evita save() a cada iteração)
  db.save();
  db.addEvent(`campanha_visual_disparada: ${agentId} "${prodLabel}" — ${sent} enviados`);
  console.log(`[CampanhaVisual] ${agentId} "${prodLabel}": ${sent} enviados, ${skipped} pulados, ${errors} erros`);

  return { campaign, sent, skipped, errors };
}

// ============================================
// COMMAND PARSER — handleAslamChat
// ============================================
async function handleAslamChat(message, mediaUrl = null) {
  const msg = (message || "").trim();
  const msgLower = msg.toLowerCase();

  // --- Imagem do dono (campanha visual) ---
  // Armazena imagem pendente com TTL 5min para uso no próximo comando
  if (mediaUrl) db.setPendingOwnerMedia(mediaUrl);
  const pendingMedia = db.getPendingOwnerMedia();

  // Se Miron enviou só a imagem sem texto — guardar e solicitar detalhes
  if (!msg && pendingMedia) {
    return `📸 Imagem recebida! Me diz agora:\n- Qual agente? (Pedro/Rodrigo)\n- Nome e preço do produto\n\nEx: "Pedro faz remarketing. Produto: Caixa Bluetooth X. Preço: R$120"`;
  }

  // --- JARVIS DIRETO: "jarvis ..." força modo dev ---
  if (msgLower.startsWith("jarvis ") || msgLower === "jarvis") {
    const jarvisMsg = msgLower === "jarvis" ? "Ola chefe! Modo Jarvis ativo. O que precisa?" : msg.replace(/^jarvis\s+/i, "");
    if (msgLower === "jarvis") {
      return "🤖 *Modo Jarvis ativo, chefe!*\n\nTenho poderes totais sobre o sistema:\n- Ler e editar qualquer codigo\n- Fazer deploy no Railway\n- Reiniciar o sistema\n- Investigar bugs\n- Ver logs e metricas\n\nMe diz o que precisa resolver!";
    }
    const time = getBrasiliaTime();
    const metricsText = AGENT_IDS.map((id) => {
      const m = db.state.metrics[id];
      return `${CONFIG.AGENTS[id].name}: ${m.atendimentos} atend, ${m.vendas} vendas`;
    }).join(", ");
    const activeConvs = AGENT_IDS.map((id) => `${CONFIG.AGENTS[id].name}: ${db.state.conversations[id].size} conversas`).join(", ");
    const contextInfo = `CONTEXTO ATUAL (${time.formatted}):\nMetricas: ${metricsText}\nConversas: ${activeConvs}\nEventos recentes: ${db.state.events.slice(-5).map((e) => e.text).join("; ")}`;
    try {
      const jarvisResponse = await handleJarvisMode(jarvisMsg, contextInfo);
      db.state.aslamChat.push({ role: "user", content: msg, timestamp: Date.now() });
      db.state.aslamChat.push({ role: "assistant", content: jarvisResponse, timestamp: Date.now() });
      if (db.state.aslamChat.length > 50) db.state.aslamChat = db.state.aslamChat.slice(-50);
      db.save();
      return jarvisResponse;
    } catch (e) {
      console.error("[JARVIS] Erro:", e.message);
      return "Erro no modo Jarvis. Tente novamente.";
    }
  }

  // --- 0. COMANDOS EXPLICITOS primeiro (antes de pause/resume genérico) ---
  // Estes têm formato definido e devem ser checados ANTES dos matchers genéricos
  // senão "manda pelo pedro PARA 5562..." é capturado como "pause" por causa do "para"

  // 0a. Send via specific agent: "manda pelo pedro para 5562 dizendo ..."
  let match;
  match = msg.match(/(?:manda|envia)\s+(?:pelo\s+)?(pedro|rodrigo)\s+(?:para\s+|pra\s+)(\d+)\s+(?:dizendo\s+|falando\s+|que\s+)([\s\S]*)/i);
  if (match) {
    const agentId = match[1].toLowerCase();
    const numero = match[2];
    const texto = match[3].trim();
    if (db.isManuallyPaused(numero)) {
      return `⚠️ Numero ${numero} esta PAUSADO manualmente. Use "liberar ${numero}" primeiro ou "forca ${agentId} ${numero}" pra ignorar a pausa.`;
    }
    await sendText(agentId, numero, texto);
    const conv = db.getConversation(agentId, numero);
    if (conv) {
      conv.msgs.push({ role: "assistant", content: texto, timestamp: Date.now() });
      conv.ultimaMensagem = Date.now();
    }
    db.addEvent(`Aslam enviou msg via ${agentId} para ${numero}`);
    db.save();
    return `Mensagem enviada pelo ${CONFIG.AGENTS[agentId].name} para ${numero}: "${texto}"`;
  }

  // 0b. Send auto-detect agent: "manda para 5562 dizendo ..."
  match = msg.match(/(?:manda|envia)\s+(?:para\s+|pra\s+)(\d+)\s+(?:dizendo\s+|falando\s+|que\s+)([\s\S]*)/i);
  if (match) {
    const numero = match[1];
    const texto = match[2].trim();
    const agentId = db.findAgentForNumber(numero);
    if (!agentId) {
      return `Numero ${numero} nao encontrado. Use "manda pelo pedro/rodrigo para ${numero} dizendo ..."`;
    }
    if (db.isManuallyPaused(numero)) {
      return `⚠️ Numero ${numero} esta PAUSADO manualmente. Use "liberar ${numero}" primeiro ou "forca ${agentId} ${numero}" pra ignorar a pausa.`;
    }
    await sendText(agentId, numero, texto);
    const conv = db.getConversation(agentId, numero);
    if (conv) {
      conv.msgs.push({ role: "assistant", content: texto, timestamp: Date.now() });
      conv.ultimaMensagem = Date.now();
    }
    db.addEvent(`Aslam enviou msg via ${agentId} para ${numero}`);
    db.save();
    return `Mensagem enviada pelo ${CONFIG.AGENTS[agentId].name} para ${numero}: "${texto}"`;
  }

  // 0c. Force start: "forca pedro 5562..."
  match = msg.match(/(?:forca|inicia|comeca)\s+(pedro|rodrigo)\s+(\d+)/i);
  if (match) {
    const agentId = match[1].toLowerCase();
    const numero = match[2];
    db.state.pausedManual[agentId].delete(numero);
    db.state.paused[agentId].delete(numero);
    db.resumeAuto(numero);
    const conv = db.getConversation(agentId, numero);
    const hasHistory = conv && conv.msgs && conv.msgs.length > 0;
    const lastMsgs = hasHistory ? conv.msgs.slice(-4).map((m) => ({ role: m.role, content: sanitize(m.content || m.text || "") })) : [];
    const prodInfoSend = getAgentProductInfo(agentId);
    const prompt = hasHistory
      ? `Continue a conversa com este cliente naturalmente. Ultima mensagem dele foi a mais recente. Seja proativo.`
      : `Inicie uma conversa de vendas com este numero. Apresente-se como ${CONFIG.AGENTS[agentId].name} da Atacadao Variedades e apresente o ${prodInfoSend.product}.`;
    const response = await callClaude(
      `Voce e ${CONFIG.AGENTS[agentId].name}, vendedor da Atacadao Variedades. Produto: ${prodInfoSend.product} por R$${prodInfoSend.price}. IMPORTANTE: Use EXATAMENTE esse produto e preco. Seja natural e direto. Maximo 3 linhas.`,
      [...lastMsgs, { role: "user", content: prompt }],
      { maxTokens: 300, timeout: 15000 }
    );
    if (response) {
      await sendText(agentId, numero, response);
      if (conv) {
        conv.msgs.push({ role: "assistant", content: response, timestamp: Date.now() });
      }
      db.addEvent(`Aslam forcou ${agentId} a iniciar/continuar com ${numero}`);
      db.save();
      return `${CONFIG.AGENTS[agentId].name} enviou mensagem para ${numero}:\n"${response}"`;
    }
    return `Erro ao gerar mensagem para ${numero}. Tente novamente.`;
  }

  // 0d. View history: "mostra conversa 5562..."
  match = msg.match(/(?:mostra|ver|historico|conversa)\s+(?:do\s+|de\s+|da\s+)?(\d{10,13})/i);
  if (match) {
    const numero = match[1];
    let found = false;
    const lines = [];
    for (const agentId of AGENT_IDS) {
      const conv = db.state.conversations[agentId].get(numero);
      if (conv && conv.msgs && conv.msgs.length > 0) {
        found = true;
        const last6 = conv.msgs.slice(-6);
        lines.push(`--- ${CONFIG.AGENTS[agentId].name} ---`);
        for (const m of last6) {
          const role = m.role === "assistant" ? CONFIG.AGENTS[agentId].name : "Cliente";
          const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "??:??";
          lines.push(`[${time}] ${role}: ${m.content || m.text || ""}`);
        }
      }
    }
    if (!found) return `Nenhum historico encontrado para ${numero}.`;
    return `Historico de ${numero}:\n\n${lines.join("\n")}`;
  }

  // 0e. Clear history: "limpar historico 5562..."
  match = msg.match(/limpar\s+historico\s+(?:do\s+|de\s+)?(\d+)/i);
  if (!match) match = msg.match(/reset\s+(\d+)/i);
  if (match) {
    const numero = match[1];
    for (const agentId of AGENT_IDS) {
      db.state.conversations[agentId].delete(numero);
    }
    db.addEvent(`Aslam limpou historico de ${numero}`);
    db.save();
    return `Historico de ${numero} limpo em todos os agentes.`;
  }

  // 0f. Gerenciar ofertas: "ver oferta/desconto 5562", "cancelar oferta/desconto 5562", "frete gratis 5562"
  match = msg.match(/(?:ver|status|mostra)\s+(?:oferta|desconto)\s+(\d{10,13})/i);
  if (match) {
    const numero = match[1];
    const oferta = db.getOfferInfo(numero);
    if (!oferta) return `Nenhuma oferta encontrada para ${numero}.`;
    const agente = CONFIG.AGENTS[oferta.agentId] ? CONFIG.AGENTS[oferta.agentId].name : oferta.agentId;
    const criada = oferta.createdAt ? new Date(oferta.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
    const expira = oferta.expiresAt ? new Date(oferta.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
    const freteGratisStr = oferta.freteGratis ? "\nFrete Grátis: SIM ✅" : "";
    const tipoStr = oferta.tipoOferta ? `\nTipo: ${oferta.tipoOferta}` : "";
    let histLines = "";
    if (oferta.history && oferta.history.length > 0) {
      histLines = "\n\n*Histórico:*\n" + oferta.history.slice(-5).map(h => {
        const t = new Date(h.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        return `• [${t}] ${h.from || "—"} → ${h.to}: ${h.reason}`;
      }).join("\n");
    }
    return `*Oferta ${numero}*\nAgente: ${agente}\nStatus: ${oferta.status}${tipoStr}\nPreço original: R$${oferta.precoOriginal}\nPreço com desconto: R$${oferta.precoDesconto}${freteGratisStr}\nOrigem: ${oferta.origem}${oferta.campanha ? "\nCampanha: " + oferta.campanha : ""}\nCriada: ${criada}\nExpira: ${expira}${histLines}`;
  }

  match = msg.match(/cancelar\s+(?:oferta|desconto)\s+(\d{10,13})/i);
  if (match) {
    const numero = match[1];
    const resultado = db.cancelOffer(numero);
    if (!resultado) return `Nenhuma oferta encontrada para ${numero}.`;
    return `Oferta cancelada para ${numero}. O agente voltará ao preço e frete normais.`;
  }

  match = msg.match(/expirar\s+(?:oferta|desconto)\s+(\d{10,13})/i);
  if (match) {
    const numero = match[1];
    const resultado = db.expireOffer(numero);
    if (!resultado) return `Nenhuma oferta encontrada para ${numero}.`;
    return `Oferta expirada para ${numero}.`;
  }

  // "frete gratis 5562..." — ativa frete grátis autorizado para um cliente
  match = msg.match(/frete\s*gr[aá]tis\s+(\d{10,13})/i);
  if (match) {
    const numero = match[1];
    let agentId = db.findAgentForNumber(numero);
    if (!agentId) {
      if (msgLower.includes("pedro")) agentId = "pedro";
      else if (msgLower.includes("rodrigo")) agentId = "rodrigo";
    }
    if (!agentId) return `Para ativar frete grátis preciso saber o agente. Ex: "frete gratis 5562123 pedro"`;
    const preco = db.getAgentPrice(agentId);
    db.setOffer(numero, {
      agentId,
      precoOriginal: preco,
      precoDesconto: preco,
      freteGratis: true,
      origem: "manual",
      campanha: "frete_gratis_manual",
    });
    return `✅ Frete grátis ativado para ${numero} (${CONFIG.AGENTS[agentId].name}). Válido por 14 dias. O agente comunicará frete grátis a este cliente quando necessário.`;
  }

  match = msg.match(/listar\s+(?:descontos?|ofertas?)/i);
  if (match) {
    const todas = Object.entries(db.state.activeOffers);
    const ativas = todas.filter(([, o]) => o.status === "ativa");
    if (todas.length === 0) return "Nenhuma oferta registrada no momento.";
    if (ativas.length === 0) {
      const recentes = todas.slice(-3).map(([num, o]) => {
        const agente = CONFIG.AGENTS[o.agentId] ? CONFIG.AGENTS[o.agentId].name : o.agentId;
        const fgStr = o.freteGratis ? " 🎁frete" : "";
        return `• ${num} (${agente}): R$${o.precoDesconto}${fgStr} [${o.status}]`;
      });
      return `Nenhuma oferta ativa. Últimas registradas:\n${recentes.join("\n")}`;
    }
    const linhas = ativas.map(([num, o]) => {
      const agente = CONFIG.AGENTS[o.agentId] ? CONFIG.AGENTS[o.agentId].name : o.agentId;
      const expira = o.expiresAt ? new Date(o.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
      const fgStr = o.freteGratis ? " 🎁FRETE GRÁTIS" : "";
      return `• ${num} (${agente}): R$${o.precoDesconto}${fgStr} [${o.origem}] expira ${expira}`;
    });
    return `*Ofertas ativas (${ativas.length}):*\n${linhas.join("\n")}`;
  }

  // --- 0g. Campanhas Visuais — status, listar, cancelar ---
  match = msg.match(/status\s+campanha\s+(vc_\S+)/i);
  if (match) {
    const camp = db.getCampaign(match[1]);
    if (!camp) return `Campanha ${match[1]} não encontrada.`;
    const agentName = CONFIG.AGENTS[camp.agentId]?.name || camp.agentId;
    const criada = new Date(camp.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return `*Campanha ${camp.id}*\nAgente: ${agentName}\nProduto: ${camp.productName}${camp.price ? ` — R$${camp.price}` : ""}\nStatus: ${camp.status}\nEnviado para: ${camp.sentTo.length} clientes\nResponderam: ${camp.responded.length}\nCriada: ${criada}`;
  }

  if (/listar?\s+campanhas?/i.test(msgLower) || /campanhas?\s+(?:ativas?|todas?|status)/i.test(msgLower)) {
    const campaigns = db.listCampaigns();
    if (campaigns.length === 0) return `Nenhuma campanha visual registrada ainda.`;
    const lines = campaigns.slice(0, 10).map((c) => {
      const agentName = CONFIG.AGENTS[c.agentId]?.name || c.agentId;
      return `• ${c.id} | ${agentName} | ${c.productName}${c.price ? ` R$${c.price}` : ""} | ${c.status} | ${c.sentTo.length}↗ ${c.responded.length}✅`;
    });
    return `*Campanhas Visuais (${campaigns.length}):*\n${lines.join("\n")}`;
  }

  match = msg.match(/cancela[rn]?\s+campanha\s+(vc_\S+)/i);
  if (match) {
    const cancelled = db.cancelCampaign(match[1]);
    if (!cancelled) return `Campanha ${match[1]} não encontrada.`;
    return `✅ Campanha ${match[1]} cancelada. Novos disparos parados. Clientes já recebidos que responderem ainda serão notificados.`;
  }

  // --- 1. Pause (flexible: any mention of pause + phone number) ---
  // CORRIGIDO: "para" removido do pauseWords (conflitava com "manda para X dizendo")
  const pauseWords = /(?:paus[ea]|deslig|suspend|trav|stop|bloqu)/i;
  const resumeWords = /(?:retom|liber|volt|despausa|reativ|continu|desbloque)/i;
  const phoneInMsg = msgLower.match(/(\d{10,13})/);

  if (pauseWords.test(msgLower) && phoneInMsg && !resumeWords.test(msgLower)) {
    const numero = phoneInMsg[1];
    let agentId = null;
    if (msgLower.includes("pedro")) agentId = "pedro";
    else if (msgLower.includes("rodrigo")) agentId = "rodrigo";
    // If no agent specified, find which agent has this number
    if (!agentId) agentId = db.findAgentForNumber(numero);
    db.pauseManual(numero, agentId);
    db.addEvent(`Aslam pausou ${numero}${agentId ? " no " + agentId : " em todos"}`);
    db.save();
    const agentName = agentId ? CONFIG.AGENTS[agentId].name : "todos os agentes";
    return `Pronto. ${numero} pausado no ${agentName}. NENHUMA mensagem sera enviada ate voce liberar. Para retomar, diga "liberar ${numero}".`;
  }

  // --- 2. Resume (flexible: any mention of resume + phone number) ---
  if (resumeWords.test(msgLower) && phoneInMsg) {
    const numero = phoneInMsg[1];
    db.resumeManual(numero);
    db.addEvent(`Aslam retomou ${numero}`);
    db.save();
    const agentId = db.findAgentForNumber(numero);
    const agentName = agentId ? CONFIG.AGENTS[agentId].name : "agentes";
    return `Feito. ${numero} liberado. ${agentName} pode atender normalmente agora.`;
  }

  // --- 3. Pause all ---
  // Guard: "despausar" contém "pausa" como substring mas é uma LIBERAÇÃO — tratar na seção 3a
  if (msgLower.includes("pausa") && msgLower.includes("todos") && !/des\s*paus/i.test(msgLower)) {
    let count = 0;
    for (const agentId of AGENT_IDS) {
      db.state.conversations[agentId].forEach((conv, numero) => {
        db.pauseManual(numero, agentId);
        count++;
      });
    }
    db.addEvent("Aslam pausou TODAS as conversas");
    db.save();
    return `Todas as conversas pausadas (${count} conversas em todos os agentes). Ninguem recebe resposta automatica ate liberar.`;
  }

  // --- 3a. Liberar todos (com escopo opcional por agente) ---
  // Detecta: "liberar todos", "despausar todos", "reativar toda a base",
  //          "liberar todos os clientes do Rodrigo", etc.
  // NUNCA cai no fallback de IA — execução 100% determinística.
  const isReleaseAll = (
    /(?:liber[ae]r?|despaus\w+|reativ\w+|retom\w+)\s+todos?(?:\s+os?\s+clientes?)?/i.test(msgLower) ||
    /todos?\s+os?\s+clientes?\s+(?:liber|retom|despaus|reativ)/i.test(msgLower) ||
    /liber\w*\s+toda\s+a\s+base/i.test(msgLower) ||
    /reativ\w*\s+toda\s+a\s+base/i.test(msgLower) ||
    /despaus\w+\s+toda\s+a\s+base/i.test(msgLower)
  ) && !phoneInMsg;

  if (isReleaseAll) {
    // Detectar escopo por agente
    let targetAgentId = null;
    if (msgLower.includes("pedro")) targetAgentId = "pedro";
    else if (msgLower.includes("rodrigo")) targetAgentId = "rodrigo";

    const targets = targetAgentId ? [targetAgentId] : AGENT_IDS;
    const details = [];
    let totalReleased = 0;

    for (const id of targets) {
      const before = db.state.paused[id].size;
      if (before > 0) {
        db.resumeManualAll(id);
        details.push(`${CONFIG.AGENTS[id].name}: ${before} liberados`);
        totalReleased += before;
      }
    }

    db.addEvent(`Aslam liberou TODOS (${targetAgentId || "todos"}): ${totalReleased} clientes`);
    db.save();

    if (totalReleased === 0) {
      const scopeLabel = targetAgentId ? `do ${CONFIG.AGENTS[targetAgentId].name}` : "da base";
      return `✅ Nenhum cliente estava pausado ${scopeLabel}. Base já estava totalmente liberada.`;
    }

    const scopeLabel = targetAgentId ? `do ${CONFIG.AGENTS[targetAgentId].name}` : "(todos os agentes)";
    return `✅ ${totalReleased} clientes liberados ${scopeLabel}.\n${details.join("\n")}\n\nRemarketing e follow-ups voltam a funcionar normalmente.`;
  }

  // --- 3b. Status do remarketing por agente ---
  if (/(?:status|ver|mostra)\s+remarketing|remarketing\s+(?:status|ativo|pausado|ligado|desligado)/i.test(msgLower)) {
    const linhas = AGENT_IDS.map(id => {
      const pausado = db.isRemarketingPausado(id);
      const emoji = pausado ? "🔴" : "🟢";
      return `${emoji} ${CONFIG.AGENTS[id].name}: ${pausado ? "PAUSADO" : "ativo"}`;
    });
    return `*Status do Remarketing Automático:*\n${linhas.join("\n")}\n\nPara pausar: "pare o remarketing do Pedro"\nPara retomar: "retomar remarketing do Pedro"`;
  }

  // --- 4. List paused ---
  if (msgLower.includes("pausados") || msgLower.includes("quem esta pausado")) {
    const lines = [];
    for (const agentId of AGENT_IDS) {
      const pausedSet = db.state.pausedManual[agentId];
      if (pausedSet.size > 0) {
        lines.push(`${CONFIG.AGENTS[agentId].name}: ${[...pausedSet].join(", ")}`);
      } else {
        lines.push(`${CONFIG.AGENTS[agentId].name}: nenhum pausado`);
      }
    }
    return `Numeros pausados:\n${lines.join("\n")}`;
  }

  // --- 5. List active ---
  if (msgLower.includes("conversas ativas") || msgLower.includes("clientes ativos") || msgLower.includes("quem esta conversando")) {
    const lines = [];
    for (const agentId of AGENT_IDS) {
      const convMap = db.state.conversations[agentId];
      const active = [];
      convMap.forEach((conv, numero) => {
        if (!db.isPaused(agentId, numero) && conv.msgs && conv.msgs.length > 0) {
          const lastMsg = conv.msgs[conv.msgs.length - 1];
          const preview = (lastMsg.content || lastMsg.text || "").slice(0, 40);
          active.push(`  ${numero}: "${preview}..."`);
        }
      });
      if (active.length > 0) {
        lines.push(`${CONFIG.AGENTS[agentId].name} (${active.length}):\n${active.join("\n")}`);
      } else {
        lines.push(`${CONFIG.AGENTS[agentId].name}: nenhuma conversa ativa`);
      }
    }
    return `Conversas ativas:\n${lines.join("\n\n")}`;
  }

  // --- 5a. PARAR/CANCELAR remarketing — PRIORIDADE MÁXIMA (sempre antes do check de execução) ---
  // Verbos de parada têm precedência absoluta sobre qualquer verbo de ação.
  // "agora", "ja" são advérbios de urgência — NUNCA servem como prova de intenção de disparo.
  const isStopRemarketing = /(?:par[eao]|parar|cancele?|cancelar|interrompa?|interromper|paus[eao]|pausar|desativ[ae]|desativar|nao\s+(?:mande?|envie?|dispare?|fac[ao])\s+(?:mais\s+)?(?:o\s+)?(?:remarketing|follow|disparos?)|stop\s+remarketing)/i.test(msgLower) && /(?:remarketing|follow.?up|disparos?)/i.test(msgLower);
  if (isStopRemarketing) {
    let agentId = null;
    if (msgLower.includes("pedro")) agentId = "pedro";
    else if (msgLower.includes("rodrigo")) agentId = "rodrigo";
    else if (/todos|todos\s+os\s+agentes|geral/i.test(msgLower)) agentId = "todos";
    const targetId = agentId || "todos";
    db.pauseRemarketing(targetId);
    db.addEvent(`remarketing_pausado: ${targetId} (comando do dono)`);
    db.save();
    const nomeAgente = agentId && CONFIG.AGENTS[agentId] ? CONFIG.AGENTS[agentId].name : "todos os agentes";
    return `✅ Remarketing do ${nomeAgente} pausado. Nenhum novo disparo automático será feito. Para retomar, diga "retomar remarketing do ${nomeAgente === "todos os agentes" ? "todos" : nomeAgente.toLowerCase()}".`;
  }

  // --- 5b. RETOMAR remarketing ---
  const isResumeRemarketing = /(?:retom[ae]|reativ[ae]|religa|liga|ativ[ae]|libera?)\s+(?:o\s+)?remarketing/i.test(msgLower);
  if (isResumeRemarketing) {
    let agentId = null;
    if (msgLower.includes("pedro")) agentId = "pedro";
    else if (msgLower.includes("rodrigo")) agentId = "rodrigo";
    else if (/todos|geral/i.test(msgLower)) agentId = "todos";
    const targetId = agentId || "todos";
    db.resumeRemarketing(targetId);
    db.addEvent(`remarketing_retomado: ${targetId} (comando do dono)`);
    db.save();
    const nomeAgente = agentId && CONFIG.AGENTS[agentId] ? CONFIG.AGENTS[agentId].name : "todos os agentes";
    return `✅ Remarketing do ${nomeAgente} retomado. Disparos automáticos voltarão no próximo ciclo (horário comercial).`;
  }

  // --- 5c. Mass follow-up ---
  // REGRA: Só disparar remarketing se for COMANDO DIRETO (ex: "faz remarketing", "dispara followup")
  // Se for INSTRUÇÃO/REGRA (ex: "so podem fazer remarketing de 08 as 18"), NÃO disparar
  // IMPORTANTE: "agora" e "ja" são advérbios de urgência — removidos da lista de verbos de ação
  // para não disparar remarketing em frases de cancelamento urgente ("pare agora", "cancele ja")
  const isRemarketingInstruction = /(?:so\s+pode|nao\s+pode|horario|hora|permitido|proibido|regra|instrucao|deve|devem|apenas|somente)\s*.*(?:remarketing|follow.?up)/i.test(msgLower) || /(?:remarketing|follow.?up)\s*.*(?:so\s+pode|nao\s+pode|horario|hora|permitido|proibido|entre|das?\s+\d|ate\s+\d|de\s+\d)/i.test(msgLower);
  const isRemarketingAction = !isRemarketingInstruction && (msgLower.includes("followup") || msgLower.includes("acompanhamento") || msgLower.includes("retomar clientes") || msgLower.includes("contatar clientes") || msgLower.includes("recontatar") || /(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|pede?|quero\s+que)\s*(?:o\s+|pro?\s+|para?\s+)?(?:follow|remarke|contato|recontato|acompanhamento)/i.test(msgLower) || /(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|pede?|quero\s+que)\s*(?:o\s+|pro?\s+|para?\s+|pelo\s+)?(?:pedro|rodrigo|todos?).*(?:remarketing|enviar?\s+mensag|contatar?\s+cliente|para\s+(?:todos?\s+(?:os\s+)?)?clientes?|dizendo|seguinte\s+mensag)/i.test(msgLower) || /(?:quero\s+que|pede?\s+(?:pro?|para?))\s*(?:o\s+)?(?:pedro|rodrigo)\s+(?:envia?|mand[ea]|fac?a|dispar[ea]).*(?:mensag|remarketing|clientes)/i.test(msgLower) || (msgLower.includes("remarketing") && /(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|enviar?|oferec|forc[eê]\w*)/i.test(msgLower)) || /forc[eê]\w*\s+(?:o\s+)?(?:remarketing|follow|disparo?|envio|campanha)/i.test(msgLower));
  // Override manual de horário comercial — só para comandos explícitos do dono
  // NÃO afeta ciclos automáticos (runRemarketing, dailySweep, etc.)
  const isOverrideHorario = (
    /forc[eê]\w*\s+(?:o\s+)?(?:remarketing|follow|disparo?|envio|campanha|agora)/i.test(msgLower) ||
    /(?:ignor[ae]r?|desconsider[ae]r?)\s+(?:o\s+)?hor[aá]rio/i.test(msgLower) ||
    /mesmo\s+fora\s+do\s+hor[aá]rio/i.test(msgLower) ||
    /autorizar?\s+(?:o\s+)?(?:envio|disparo|remarketing)\s*(?:agora|fora|mesmo)?/i.test(msgLower) ||
    /dispare?\s+mesmo\s+(?:hoje|agora|fora|assim)/i.test(msgLower) ||
    /pode\s+(?:enviar?|disparar?|mandar?)\s+(?:mesmo|fora)/i.test(msgLower)
  );
  // --- 5c-VISUAL. Campanha visual com imagem pendente ---
  // Detecta comando com imagem pendente. Cobre tanto isRemarketingAction quanto padrões específicos
  // de campanha visual ("esse produto chegou hoje", "campanha com essa imagem", etc.)
  const isCampaignVisual = !!pendingMedia && !isRemarketingInstruction && (
    isRemarketingAction ||
    /(?:esse|este|essa)\s+(?:produto|item|imagem)\s*(?:chegou|custa|por|vale|r\$)/i.test(msgLower) ||
    /(?:campanha|dispara?|faz?|envia?|mand[ea])\s+(?:essa\s+imagem|esse\s+produto|este\s+produto)/i.test(msgLower) ||
    (/(?:pedro|rodrigo)/.test(msgLower) && /r?\$\s*\d+/.test(msgLower)) ||
    /(?:produto|item).*(?:pedro|rodrigo).*(?:clientes?|remarketing)/i.test(msgLower)
  );

  if (isCampaignVisual) {
    if (!isDentroHorarioComercial() && !isOverrideHorario) {
      return `Fora do horário comercial. Campanha visual só pode ser disparada de segunda a sexta, das 08:00 às 18:00.\nPara forçar agora, diga: "force o remarketing [agente] por R$X".`;
    }
    const _overrideAviso = (!isDentroHorarioComercial() && isOverrideHorario) ? "\n\n⚠️ Executado fora do horário comercial por autorização explícita do dono." : "";
    // Detectar agente obrigatório
    let campAgentId = null;
    for (const id of AGENT_IDS) {
      if (msgLower.includes(id)) { campAgentId = id; break; }
    }
    if (!campAgentId) {
      return `📸 Imagem guardada! Falta definir qual agente dispara.\nEx: "Pedro faz remarketing desse produto por R$120 para todos os clientes"`;
    }
    // Detectar preço
    const priceMatch = msg.match(/r?\$\s*(\d+(?:[.,]\d{2})?)/i) || msg.match(/(\d+)\s*(?:reais|real)/i);
    const campPrice = priceMatch ? parseInt(priceMatch[1].replace(",", ".")) : null;
    if (!campPrice) {
      return `📸 Imagem guardada! Qual é o preço do produto?\nEx: "R$120 — Pedro dispara para todos os clientes"`;
    }
    // Extrair nome do produto (padrões comuns ou fallback genérico)
    let campProductName = null;
    const prodMatch = msg.match(/(?:produto|nome|chama[do]*|item)\s*[:—\s]+([A-Za-záéíóúãõâêîôûàèìòùçÇÁÉÍÓÚÃÕÂÊÎÔÛÀÈÌÒÙ\w\s]{3,40?}?)(?:\.|,|\s+por\s+r|\s+r\$|$)/i);
    if (prodMatch) campProductName = prodMatch[1].trim();
    if (!campProductName) {
      // Tentar extrair de "Nome: X" pattern
      const nomeMatch = msg.match(/nome\s*:\s*(.+?)(?:\.|,|\s+por\s+r|\s+r\$|$)/i);
      if (nomeMatch) campProductName = nomeMatch[1].trim();
    }
    campProductName = campProductName || "Produto Novo";

    // Extrair instrução extra (ex: "quem responder pause e me avise")
    const instrucaoExtra = /(?:quem\s+responder|pausar?\s+(?:quem|quem\s+responder)|notif|avis)/i.test(msgLower) ? msgLower : null;

    // Buscar contatos ativos do agente
    const campContacts = [];
    const convMapCamp = db.state.conversations[campAgentId];
    if (convMapCamp) {
      for (const [numero, conv] of convMapCamp) {
        if (!conv || !conv.msgs || conv.msgs.length === 0) continue;
        if (numero === CONFIG.SEU_WHATSAPP || numero.endsWith(CONFIG.SEU_WHATSAPP.slice(-8))) continue;
        if (db.isManuallyPaused(numero)) continue;
        if (db.hasSaleForNumber(numero)) continue;
        campContacts.push({ numero, conv });
      }
    }
    if (campContacts.length === 0) {
      db.clearPendingOwnerMedia();
      return `Nenhum cliente ativo encontrado para ${CONFIG.AGENTS[campAgentId].name}.`;
    }

    db.clearPendingOwnerMedia();
    const { campaign, sent, skipped, errors } = await executeVisualCampaign({
      agentId: campAgentId,
      mediaUrl: pendingMedia,
      productName: campProductName,
      price: campPrice,
      instrucao: instrucaoExtra,
      contacts: campContacts,
    });
    const campAgentName = CONFIG.AGENTS[campAgentId].name;
    db.state.aslamChat.push({ role: "user", content: msg, timestamp: Date.now() });
    db.state.aslamChat.push({ role: "assistant", content: `Campanha ${campaign.id} disparada`, timestamp: Date.now() });
    if (db.state.aslamChat.length > 50) db.state.aslamChat = db.state.aslamChat.slice(-50);
    db.save();
    return `✅ *Campanha visual disparada!*\n\n📋 ID: \`${campaign.id}\`\n👤 Agente: ${campAgentName}\n📦 Produto: ${campProductName} — R$${campPrice}\n📤 Enviado para: ${sent} clientes\n⏭️ Pulados: ${skipped}\n❌ Erros: ${errors}\n\nQuem responder será *pausado automaticamente* e você será notificado.\n\nConsultar: "status campanha ${campaign.id}"` + _overrideAviso;
  }

  if (isRemarketingAction) {
    // Verificar horário comercial antes de disparar
    if (!isDentroHorarioComercial() && !isOverrideHorario) {
      return `Fora do horário comercial. Remarketing/follow-up só pode ser enviado de segunda a sexta, das 08:00 às 18:00 (horário de Brasília).\nPara forçar agora, diga: "force o remarketing do [agente]" ou "pode enviar mesmo fora do horário".`;
    }
    const _overrideAviso = (!isDentroHorarioComercial() && isOverrideHorario) ? "\n\n⚠️ Executado fora do horário comercial por autorização explícita do dono." : "";
    // Detectar mensagem EXATA do Miron (ex: "manda pelo rodrigo para todos dizendo: mensagem aqui")
    let mensagemExata = null;
    const dizendoMatch = msg.match(/(?:dizendo|falando|mandando|com\s+a\s+mensagem|a\s+seguinte\s+mensagem|seguinte\s+mensagem)[\s:]+(.{10,})/i);
    if (dizendoMatch) {
      mensagemExata = dizendoMatch[1].trim();
    }
    // Detectar mensagem exata após ":" no final (ex: "envia para os clientes: texto aqui")
    if (!mensagemExata) {
      const colonMatch = msg.match(/(?:envia?|mand[ea]|fal[ae])\s+.*?(?:clientes?|todos?).*?:\s*(.{10,})/i);
      if (colonMatch) {
        mensagemExata = colonMatch[1].trim();
      }
    }

    // Extrair instrução especial do Miron (desconto, oferta, tom, preço especial, etc.)
    let instrucaoMiron = "";
    if (!mensagemExata) {
      const instrucaoMatch = msg.match(/instrucao:([\s\S]+?)$/i);
      if (instrucaoMatch) {
        instrucaoMiron = instrucaoMatch[1].trim();
      } else {
        const extraMatch = msg.match(/(?:oferecendo|com\s+desconto|desconto|valor|preco\s+especial|promocao|oferta)([\s\S]*)/i);
        if (extraMatch) instrucaoMiron = extraMatch[0].trim();
      }
    }

    // Detectar período — se não mencionar data, usar toda a base ativa
    let dateStr = null;
    if (msgLower.includes("hoje")) dateStr = "hoje";
    else if (msgLower.includes("ontem")) dateStr = "ontem";
    else if (msgLower.includes("anteontem") || msgLower.includes("antes de ontem")) {
      const d = new Date(); d.setDate(d.getDate() - 2);
      dateStr = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    }
    const dateMatch = msgLower.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) dateStr = dateMatch[1];

    // Detectar agente
    let agentFilter = null;
    for (const agentId of AGENT_IDS) {
      if (msgLower.includes(agentId)) { agentFilter = agentId; break; }
    }

    let filtered;
    if (dateStr) {
      // Buscar contatos do período específico
      const contacts = db.getContactsByDate(dateStr);
      if (contacts.length === 0) {
        return `Nenhum contato encontrado para ${dateStr}. Verifique se a data esta correta.`;
      }
      filtered = agentFilter ? contacts.filter((c) => c.agente === agentFilter) : contacts;
    } else {
      // Sem data: usar toda a base ativa do agente (conversas com msgs, sem compra, sem pausa)
      filtered = [];
      const targetAgents = agentFilter ? [agentFilter] : AGENT_IDS;
      for (const agId of targetAgents) {
        const convMap = db.state.conversations[agId];
        if (!convMap) continue;
        for (const [numero, conv] of convMap) {
          if (!conv || !conv.msgs || conv.msgs.length === 0) continue;
          if (numero === CONFIG.SEU_WHATSAPP || numero.endsWith(CONFIG.SEU_WHATSAPP.slice(-8))) continue;
          if (db.isManuallyPaused(numero)) continue;
          if (db.hasSaleForNumber(numero)) continue;
          filtered.push({ numero, agente: agId });
        }
      }
      if (filtered.length === 0) {
        return `Nenhum cliente ativo encontrado${agentFilter ? " para " + CONFIG.AGENTS[agentFilter].name : ""}. Base vazia.`;
      }
    }
    if (!dateStr) dateStr = "base completa";

    let sent = 0, skipped = 0, errors = 0;

    for (const contact of filtered) {
      try {
        // Respeitar pausa MANUAL do Miron — nunca enviar
        if (db.isManuallyPaused(contact.numero)) { skipped++; continue; }
        // Nunca enviar para quem já comprou
        if (db.hasSaleForNumber(contact.numero)) { skipped++; continue; }
        // Verificar se agente existe
        if (!CONFIG.AGENTS[contact.agente]) { skipped++; continue; }

        const conv = db.getConversation(contact.agente, contact.numero);
        const msgs = conv && conv.msgs ? conv.msgs : [];
        if (msgs.length === 0) { skipped++; continue; }

        // Se Miron mandou mensagem EXATA ("dizendo: ..."), usar direto sem gerar pelo Claude
        if (mensagemExata) {
          await sendText(contact.agente, contact.numero, mensagemExata);
          if (conv) {
            conv.msgs.push({ role: "assistant", content: mensagemExata, timestamp: Date.now() });
            conv.ultimaMensagem = Date.now();
          }
          sent++;
          console.log(`Msg exata ${contact.agente} -> ${contact.numero}: ${mensagemExata.substring(0, 50)}...`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        const lastMsgs = msgs.slice(-6).map((m) => `${m.role === "user" ? "Cliente" : CONFIG.AGENTS[contact.agente].name}: ${(m.content || m.text || "").substring(0, 100)}`).join("\n");

        const agentConfig = CONFIG.AGENTS[contact.agente];
        const prodInfo = getAgentProductInfo(contact.agente);

        // Análise do perfil para personalizar ângulo do remarketing
        const profile = engine.analyzeConversation(msgs, contact.agente);
        let angleHint = "";
        if (profile.stage === "freight_ghosted") {
          angleHint = "Cliente recebeu o valor total com frete mas sumiu. Mencione o valor calculado e pergunte sobre disponibilidade de entrega (pergunta fechada — manha ou tarde?). Tom direto.";
        } else if (profile.stage === "almost_closed_ghosted" || profile.stage === "payment_inquiry") {
          angleHint = "Cliente estava perto de fechar (pagamento ou entrega discutidos). Retome o ultimo passo concreto. Assuma que a decisao foi positiva.";
        } else if (profile.stage === "price_ghosted") {
          angleHint = "Cliente perguntou preco e sumiu. Foque em valor vs mensalidade: paga uma vez, sem mensalidade, para sempre. Nao mencione desconto.";
        } else if (profile.mainObjection === "price") {
          angleHint = "Cliente achou caro. Ancoragem: compare com mensalidades de streaming (Netflix+Prime = R$57+/mes). Nao ofereça desconto direto.";
        } else if (profile.mainObjection === "timing") {
          angleHint = "Cliente pediu pra pensar. Tom leve — gere curiosidade, sem pressao. Mencione algo especifico da conversa.";
        } else if (profile.mainObjection === "trust") {
          angleHint = "Cliente desconfiou. Reforce pagamento na entrega: zero risco antecipado.";
        } else if (profile.mainInterest === "football") {
          angleHint = "Cliente interessado em futebol. Destaque os canais de futebol ao vivo disponiveis.";
        } else if (profile.mainInterest === "professional_use") {
          angleHint = "Cliente usa para trabalho. Foque em durabilidade e nao parar no meio do servico.";
        }

        // Blindagem: se instrução menciona preço incompatível com o produto, ignorar
        let instrucaoExtra = "";
        if (instrucaoMiron) {
          const precoMencionado = instrucaoMiron.match(/r?\$?\s*(\d{2,4})/i);
          if (precoMencionado) {
            const valor = parseInt(precoMencionado[1]);
            if (valor > prodInfo.price) {
              instrucaoExtra = "";
            } else {
              instrucaoExtra = `\n\nINSTRUCAO OBRIGATORIA DO DONO: ${instrucaoMiron}. Voce DEVE seguir esta instrucao. PRECO ORIGINAL: R$${prodInfo.price}. PRECO COM DESCONTO: R$${valor}. Use EXATAMENTE esses valores.`;
            }
          } else {
            instrucaoExtra = `\n\nINSTRUCAO OBRIGATORIA DO DONO: ${instrucaoMiron}. Voce DEVE seguir esta instrucao na mensagem.`;
          }
        }

        const angleContext = angleHint ? `\n\nANGULO COMERCIAL PARA ESTE CLIENTE: ${angleHint}` : "";
        const remarkMsg = await callClaude(
          `Voce e ${agentConfig.name} da Atacadao Variedades. Este cliente conversou com voce mas NAO comprou. Gere uma mensagem personalizada de remarketing baseada no historico. Seja natural, direto ao ponto. Maximo 2 linhas CURTAS. Mencione algo ESPECIFICO e REAL da conversa anterior. Produto: ${prodInfo.product} por R$${prodInfo.price}. Use EXATAMENTE esse produto e preco. PROIBIDO: titulos, cabecalhos, headers (#), prefixos. Gere APENAS o texto direto pro WhatsApp. Use o NOME DO CLIENTE se aparecer no historico, senao use "voce".${angleContext}${instrucaoExtra}`,
          [{ role: "user", content: `Historico da conversa:\n${lastMsgs}\n\nGere APENAS a mensagem (sem titulo/header):` }],
          { maxTokens: 100, timeout: 15000 }
        );

        if (remarkMsg) {
          let cleanMsg = cleanRemarketingMsg(remarkMsg);
          if (isBadRemarketingMsg(cleanMsg)) {
            console.error(`[Remarketing] Mensagem ruim bloqueada (${contact.agente}/${contact.numero}): "${cleanMsg}"`);
            cleanMsg = fallbackRemarketingMsg(contact.agente, prodInfo);
          }
          await sendText(contact.agente, contact.numero, cleanMsg);
          if (conv) {
            conv.msgs.push({ role: "assistant", content: cleanMsg, timestamp: Date.now() });
            conv.ultimaMensagem = Date.now();
          }
          // Registrar oferta ativa se remarketing manual contém preço com desconto e/ou frete grátis
          if (instrucaoExtra) {
            const precoDescMatch = instrucaoExtra.match(/PRECO COM DESCONTO: R\$(\d+)/);
            const freteGratisRmkManual = /frete\s*gr[aá]tis|frete\s*inclus[ao]|frete\s*gratuito|sem\s+(?:cobrar\s+)?frete/i.test(instrucaoExtra + " " + (instrucaoMiron || ""));
            const precoOriginal = prodInfo.price;
            if (precoDescMatch || freteGratisRmkManual) {
              const precoDesconto = precoDescMatch ? parseInt(precoDescMatch[1]) : precoOriginal;
              db.setOffer(contact.numero, {
                agentId: contact.agente,
                precoOriginal,
                precoDesconto,
                freteGratis: freteGratisRmkManual,
                origem: "remarketing_manual",
                campanha: instrucaoMiron || null,
              });
              console.log(`Oferta ativa registrada: ${contact.agente} -> ${contact.numero} R$${precoDesconto}${freteGratisRmkManual ? " + FRETE_GRATIS" : ""}`);
            }
          }
          sent++;
          console.log(`Remarketing ${contact.agente} -> ${contact.numero}: ${cleanMsg.substring(0, 50)}...`);
          // Esperar entre mensagens pra não sobrecarregar
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          errors++;
        }
      } catch (e) {
        console.error(`Remarketing error ${contact.numero}:`, e.message);
        errors++;
      }
    }

    db.addEvent(`Remarketing ${agentFilter || "todos"} (${dateStr}): ${sent} enviados, ${skipped} pulados, ${errors} erros${isOverrideHorario && !isDentroHorarioComercial() ? " [OVERRIDE_HORARIO]" : ""}`);
    db.save();
    return `Remarketing concluido (${dateStr})${agentFilter ? " — " + CONFIG.AGENTS[agentFilter].name : ""}:\n- Contatos encontrados: ${filtered.length}\n- Mensagens enviadas: ${sent}\n- Pulados (pausados/compraram): ${skipped}\n- Erros: ${errors}` + _overrideAviso;
  }

  // --- 9. Change price --- (6a-8 movidos para seção 0 no topo)
  match = msg.match(/(?:muda|altera|coloca)\s+preco.*?(pedro|rodrigo|uni\s*tv|furadeira).*?R?\$?(\d+)/i);
  if (match) {
    const target = match[1].toLowerCase().trim();
    const newPrice = parseInt(match[2]);

    let agentId = null;
    if (target === "pedro" || target === "uni tv" || target === "unitv") agentId = "pedro";
    else if (target === "rodrigo" || target === "furadeira") agentId = "rodrigo";
    if (agentId) {
      const precoAntigo = db.getAgentPrice(agentId);
      // Atualizar db.agentCatalog — fonte única, persistida no Redis/arquivo
      db.updateAgentPrice(agentId, newPrice);
      // Remover instrução textual de preço anterior (db é a fonte agora, instrução é redundante)
      if (db.state.instructions[agentId]) {
        db.state.instructions[agentId] = db.state.instructions[agentId].filter(
          i => !(typeof i === "string" && i.includes("PRECO ATUALIZADO"))
        );
      }
      return `Preco do ${db.getAgentProductName(agentId)} (${CONFIG.AGENTS[agentId].name}) atualizado de R$${precoAntigo} para R$${newPrice}. Persistido no banco — sobrevive restarts.`;
    }
    return `Nao consegui identificar o agente/produto. Use: pedro, rodrigo, uni tv ou furadeira.`;
  }

  // --- 10. Analyze client ---
  match = msg.match(/(?:analisa|analisar|analizar)\s+cliente\s+(\d+)/i);
  if (match) {
    const numero = match[1];
    const historyLines = [];

    for (const agentId of AGENT_IDS) {
      const conv = db.state.conversations[agentId].get(numero);
      if (conv && conv.msgs && conv.msgs.length > 0) {
        historyLines.push(`--- Conversa com ${CONFIG.AGENTS[agentId].name} ---`);
        for (const m of conv.msgs) {
          const role = m.role === "assistant" ? CONFIG.AGENTS[agentId].name : "Cliente";
          historyLines.push(`${role}: ${m.content || m.text || ""}`);
        }
      }
    }

    if (historyLines.length === 0) {
      return `Nenhum historico encontrado para ${numero}. Nao ha dados para analisar.`;
    }

    const analysis = await callClaude(
      `Voce e Aslam, analista de vendas expert. Faca uma analise detalhada deste cliente com base no historico de conversas. Inclua:
1. TEMPERATURA DO LEAD (frio/morno/quente/muito quente)
2. OBJECOES identificadas
3. PROBABILIDADE de compra (%)
4. RECOMENDACAO de proxima acao
5. PERFIL do cliente (o que sabemos)
Seja direto e pratico.`,
      [{ role: "user", content: `Historico do cliente ${numero}:\n\n${historyLines.join("\n")}` }],
      { maxTokens: 800, timeout: 20000 }
    );

    return analysis || `Erro ao analisar cliente ${numero}. Tente novamente.`;
  }

  // --- 11. Report ---
  if (msgLower.includes("relatorio") || msgLower.includes("resumo do dia")) {
    const time = getBrasiliaTime();
    const metricsText = AGENT_IDS.map((id) => {
      const m = db.state.metrics[id];
      return `${CONFIG.AGENTS[id].name}: ${m.atendimentos} atendimentos, ${m.vendas} vendas`;
    }).join("\n");

    const recentEvents = db.state.events.slice(-20).map((e) => e.text).join("\n");
    const recentActivities = db.state.activities.slice(-10).map((a) => a.text).join("\n");

    const activeConvs = AGENT_IDS.map((id) => {
      const count = db.state.conversations[id].size;
      const pausedCount = db.state.pausedManual[id].size;
      return `${CONFIG.AGENTS[id].name}: ${count} conversas (${pausedCount} pausadas)`;
    }).join("\n");

    const report = await callClaude(
      `Voce e Aslam gerando um relatorio executivo para o Miron. Analise os dados e de insights acionaveis. Seja direto e objetivo.`,
      [{
        role: "user",
        content: `Data/Hora: ${time.formatted}\n\nMETRICAS:\n${metricsText}\n\nCONVERSAS:\n${activeConvs}\n\nEVENTOS RECENTES:\n${recentEvents}\n\nATIVIDADES:\n${recentActivities}\n\nGere o relatorio executivo:`,
      }],
      { maxTokens: 1000, timeout: 20000 }
    );

    return report || "Erro ao gerar relatorio. Tente novamente.";
  }

  // --- 12. Train agent ---
  match = msg.match(/(?:ensinar|treinar|instruir|falar\s+pro)\s+(pedro|rodrigo|todos)\s+(.*)/is);
  if (match) {
    const target = match[1].toLowerCase();
    const rawInstruction = match[2].trim();

    const formattedInstruction = await callClaude(
      `Transforme esta instrucao informal em uma regra clara e objetiva para um agente de vendas seguir. Mantenha o sentido original. Retorne APENAS a regra formatada, sem explicacao.`,
      [{ role: "user", content: rawInstruction }],
      { model: "claude-haiku-4-5-20251001", maxTokens: 200, timeout: 10000 }
    );

    const instruction = formattedInstruction || rawInstruction;

    // BLOQUEIO: instrucoes com linguagem de desconto/promocao nao podem sobrescrever o manual
    if (_isDangerousTreinar(instruction)) {
      return `⚠️ INSTRUCAO BLOQUEADA: Esta instrucao conflita com as regras oficiais de desconto do manual.\nNao posso salvar instrucoes sobre desconto, promocao ou preco especial via TREINAR.\nPara autorizar desconto especifico, use: "desconto [agente] [numero] R$[valor]".\nInstrucao rejeitada: "${instruction.slice(0, 100)}"`;
    }

    const targets = target === "todos" ? AGENT_IDS : [target];
    const names = [];

    for (const agentId of targets) {
      if (!db.state.instructions[agentId]) db.state.instructions[agentId] = [];
      db.state.instructions[agentId].push(instruction);
      names.push(CONFIG.AGENTS[agentId].name);
    }

    db.addEvent(`Aslam treinou ${target}: ${instruction.slice(0, 60)}...`);
    db.save();

    // Check if message also includes a number to auto-resume
    const resumeMatch = rawInstruction.match(/retomar\s+(\d+)/i);
    if (resumeMatch) {
      const numero = resumeMatch[1];
      db.resumeManual(numero);
      db.addEvent(`Aslam retomou ${numero} junto com treinamento`);
      db.save();
      return `Instrucao salva para ${names.join(", ")}:\n"${instruction}"\n\nTambem retomei o numero ${numero}.`;
    }

    return `Instrucao salva para ${names.join(", ")}:\n"${instruction}"`;
  }

  // --- 13. List instructions ---
  if (msgLower.includes("instrucoes ativas") || msgLower.includes("regras do")) {
    const lines = [];
    for (const agentId of AGENT_IDS) {
      const insts = db.state.instructions[agentId] || [];
      if (insts.length > 0) {
        lines.push(`${CONFIG.AGENTS[agentId].name} (${insts.length}):`);
        insts.forEach((inst, i) => lines.push(`  ${i + 1}. ${inst}`));
      } else {
        lines.push(`${CONFIG.AGENTS[agentId].name}: nenhuma instrucao ativa`);
      }
    }
    return `Instrucoes ativas:\n\n${lines.join("\n")}`;
  }

  // --- 14. Clear instructions ---
  match = msg.match(/limpar\s+instrucoes\s+(?:do\s+|de\s+)?(pedro|rodrigo|todos)/i);
  if (match) {
    const target = match[1].toLowerCase();
    const targets = target === "todos" ? AGENT_IDS : [target];
    const names = [];

    for (const agentId of targets) {
      db.state.instructions[agentId] = [];
      names.push(CONFIG.AGENTS[agentId].name);
    }

    db.addEvent(`Aslam limpou instrucoes de ${target}`);
    db.save();
    return `Instrucoes limpas para: ${names.join(", ")}. Agentes voltam ao comportamento padrao.`;
  }

  // --- Sales query ---
  if (msgLower.match(/(?:quanto|quantas|vendas?|faturamento|lucro|receita).*(?:hoje|dia|mes|mensal|semana|semanal|ano|anual)/i)) {
    let periodo = "hoje";
    if (msgLower.includes("mes") || msgLower.includes("mensal")) periodo = "mes";
    else if (msgLower.includes("semana") || msgLower.includes("semanal")) periodo = "semana";
    else if (msgLower.includes("ano") || msgLower.includes("anual")) periodo = "ano";

    const report = db.getSalesReport(periodo);
    const periodoLabel = { hoje: "Hoje", semana: "Esta Semana", mes: "Este Mes", ano: "Este Ano" }[periodo];

    let response = `*Relatorio de Vendas — ${periodoLabel}*\n\n`;
    response += `Vendas: ${report.totalVendas}\n`;
    response += `Faturamento: R$${report.totalValor.toLocaleString("pt-BR")}\n`;
    response += `Custo: R$${report.totalCusto.toLocaleString("pt-BR")}\n`;
    response += `Lucro: R$${report.totalLucro.toLocaleString("pt-BR")}\n`;
    response += `Margem: ${report.margem}%\n`;

    if (report.porProduto.length > 0) {
      response += `\n*Por Produto:*\n`;
      for (const p of report.porProduto) {
        response += `- ${p.nome}: ${p.qtd}x | R$${p.faturamento.toLocaleString("pt-BR")} | Lucro R$${p.lucro.toLocaleString("pt-BR")}\n`;
      }
    }

    if (report.porAgente.length > 0) {
      response += `\n*Por Agente:*\n`;
      for (const a of report.porAgente) {
        response += `- ${a.nome}: ${a.qtd}x | R$${a.faturamento.toLocaleString("pt-BR")}\n`;
      }
    }

    if (report.totalCanceladas > 0) response += `\nCanceladas: ${report.totalCanceladas}`;
    if (report.totalPendentes > 0) response += `\nPendentes: ${report.totalPendentes}`;

    db.state.aslamChat.push({ role: "user", content: msg, timestamp: Date.now() });
    db.state.aslamChat.push({ role: "assistant", content: response, timestamp: Date.now() });
    db.save();
    return response;
  }

  // --- MODO JARVIS: detectar se precisa de poderes de dev ---
  if (needsJarvisMode(msg)) {
    const time = getBrasiliaTime();
    const metricsText = AGENT_IDS.map((id) => {
      const m = db.state.metrics[id];
      return `${CONFIG.AGENTS[id].name}: ${m.atendimentos} atend, ${m.vendas} vendas`;
    }).join(", ");
    const activeConvs = AGENT_IDS.map((id) => `${CONFIG.AGENTS[id].name}: ${db.state.conversations[id].size} conversas`).join(", ");
    const contextInfo = `CONTEXTO ATUAL (${time.formatted}):\nMetricas: ${metricsText}\nConversas: ${activeConvs}\nEventos recentes: ${db.state.events.slice(-5).map((e) => e.text).join("; ")}`;

    try {
      const jarvisResponse = await handleJarvisMode(msg, contextInfo);
      db.state.aslamChat.push({ role: "user", content: msg, timestamp: Date.now() });
      db.state.aslamChat.push({ role: "assistant", content: jarvisResponse, timestamp: Date.now() });
      if (db.state.aslamChat.length > 50) db.state.aslamChat = db.state.aslamChat.slice(-50);
      db.save();
      return jarvisResponse;
    } catch (e) {
      console.error("[JARVIS] Erro:", e.message);
      // Fallback para modo normal se Jarvis falhar
    }
  }

  // --- AI Fallback ---
  const time = getBrasiliaTime();
  const metricsText = AGENT_IDS.map((id) => {
    const m = db.state.metrics[id];
    return `${CONFIG.AGENTS[id].name}: ${m.atendimentos} atend, ${m.vendas} vendas`;
  }).join(", ");

  const activeConvs = AGENT_IDS.map((id) => `${CONFIG.AGENTS[id].name}: ${db.state.conversations[id].size} conversas`).join(", ");

  // Pedidos pendentes para contexto
  const pedidosPendentes = db.getPedidosPendentes();
  const pedidosTexto = pedidosPendentes.length > 0
    ? pedidosPendentes.map((p) => `- [${p.tipo.toUpperCase()}] ${p.cliente || "sem nome"} (${p.numero}) | ${p.produto} | ${p.status} | ${p.endereco || "retirada"} | ${p.pagamento || "?"} | ${new Date(p.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`).join("\n")
    : "Nenhum pedido pendente";

  const resumoPedidos = db.getPedidosResumo();

  const contextPrompt = `${buildAslamSystemPrompt()}

LOGISTICA (Lara):
Pedidos pendentes: ${resumoPedidos.pendentes} | Em rota: ${resumoPedidos.emRota} | Entregues: ${resumoPedidos.entregues} | Retirados: ${resumoPedidos.retirados}
Total entregas: ${resumoPedidos.totalEntregas} | Total retiradas: ${resumoPedidos.totalRetiradas}
PEDIDOS ATIVOS:
${pedidosTexto}

CONTEXTO ATUAL (${time.formatted}):
Metricas: ${metricsText}
Conversas: ${activeConvs}
Eventos recentes: ${db.state.events.slice(-5).map((e) => e.text).join("; ")}`;

  const chatHistory = db.state.aslamChat.slice(-10).map((m) => ({
    role: m.role,
    content: sanitize(m.content || m.text || ""),
  }));
  chatHistory.push({ role: "user", content: sanitize(msg) });

  let aiResponse;
  try {
    aiResponse = await callClaude(contextPrompt, chatHistory, { maxTokens: 800, timeout: 30000 });
  } catch (e) {
    console.error("Aslam AI fallback error:", e.message);
  }

  if (!aiResponse) {
    console.error("Aslam AI fallback retornou null. chatHistory length:", chatHistory.length, "contextPrompt length:", contextPrompt.length);
    return "Nao entendi esse comando. Tente: 'pausa 5562...', 'liberar 5562...', 'manda pelo pedro para 5562... dizendo ...', ou 'forca pedro 5562...'";
  }

  // Process AI response tags
  try {
    await processAslamTags(aiResponse);
  } catch (e) {
    console.error("Erro processAslamTags:", e.message);
  }

  // Safety net: TREINAR — if Aslam mentioned instructing agents but no tag was used
  const hasTreinTag = /\[TREINAR_(PEDRO|RODRIGO|TODOS):[^\]]+\]/i.test(aiResponse);
  if (!hasTreinTag) {
    // Padrão 1: "fala pro pedro que...", "manda o rodrigo fazer..."
    let instructionIntent = msgLower.match(/(?:fala|diz|avisa|manda|instrui|ensina|treina|orienta|pede|ordena)\s+(?:pro|para|pra|o|ao|a|com\s+o?)\s*(pedro|rodrigo|todos)\s+(?:que\s+|pra\s+|para\s+|a\s+)?(.*)/is);
    // Padrão 2: "pedro precisa fazer..."
    if (!instructionIntent) {
      instructionIntent = msgLower.match(/(pedro|rodrigo|todos)\s+(?:precisa|tem\s+que|deve|deveria|nao\s+pode|nao\s+deve|sempre|nunca)\s+(.*)/is);
    }
    // Padrão 3: qualquer instrução que menciona um agente e parece uma ordem
    if (!instructionIntent) {
      const agentMention = msgLower.match(/(pedro|rodrigo)/);
      const isOrder = /(?:nao\s+|nunca\s+|sempre\s+|tem\s+que|precisa|deve|faz|faca|pare|comece|oferec|cobr|vend|descont)/i.test(msgLower);
      if (agentMention && isOrder && msg.length > 15) {
        instructionIntent = [null, agentMention[1], msg];
      }
    }
    if (instructionIntent) {
      const target = instructionIntent[1].toLowerCase();
      const rawInstruction = (instructionIntent[2] || msg).trim();
      if (rawInstruction.length > 5 && !_isDangerousTreinar(rawInstruction)) {
        const targets = target === "todos" ? AGENT_IDS : [target];
        for (const agentId of targets) {
          if (!db.state.instructions[agentId]) db.state.instructions[agentId] = [];
          db.state.instructions[agentId].push(rawInstruction);
        }
        db.addEvent(`Aslam (safety-net) treinou ${target}: ${rawInstruction.slice(0, 60)}...`);
        db.save();
        console.log(`Safety-net: instrucao salva para ${target}: ${rawInstruction.slice(0, 80)}`);
      }
    }
  }

  // Safety net: PAUSAR — if user asked to pause but no tag was used
  const hasPauseTag = /\[PAUSAR[_:]/.test(aiResponse);
  if (!hasPauseTag) {
    const pauseIntent = msgLower.match(/(?:paus|par[ea]\s|deslig|suspend|trav)\w*.*?(\d{10,13})/is);
    if (pauseIntent) {
      const numero = pauseIntent[1];
      let targetAgent = null;
      if (msgLower.includes("pedro")) targetAgent = "pedro";
      else if (msgLower.includes("rodrigo")) targetAgent = "rodrigo";
        if (!targetAgent) targetAgent = db.findAgentForNumber(numero);
      db.pauseManual(numero, targetAgent);
      db.addEvent(`Aslam (safety-net) pausou ${numero}${targetAgent ? " no " + targetAgent : " em todos"}`);
      db.save();
      console.log(`Safety-net: pausou ${numero} ${targetAgent || "todos"}`);
    }
  }

  // Safety net: RETOMAR — if user asked to resume but no tag was used
  const hasResumeTag = /\[RETOMAR:/.test(aiResponse);
  if (!hasResumeTag) {
    const resumeIntent = msgLower.match(/(?:retom|liber|volt|despausa|reativ)\w*.*?(\d{10,13})/is);
    if (resumeIntent) {
      const numero = resumeIntent[1];
      db.resumeManual(numero);
      db.addEvent(`Aslam (safety-net) retomou ${numero}`);
      db.save();
      console.log(`Safety-net: retomou ${numero}`);
    }
  }

  // Safety net: REMARKETING — se a IA prometeu remarketing mas o código não executou
  // BLINDAGEM: não disparar se a mensagem do dono é um comando de PARADA (false positive crítico)
  const isMsgStopRemarketing = /(?:par[eao]|parar|cancele?|cancelar|interrompa?|interromper|paus[eao]|pausar|desativ[ae]|desativar|nao\s+(?:mande?|envie?|dispare?|fac[ao])\s+(?:mais\s+)?(?:o\s+)?(?:remarketing|follow|disparos?))/i.test(msgLower) && /(?:remarketing|follow.?up|disparos?)/i.test(msgLower);
  const prometeuRemarketing = !isMsgStopRemarketing && /(?:remarke|vai\s+mandar|disparar|enviar\s+(?:pra|para)\s+(?:todo|grupo)|feito.*remarke|vai\s+(?:enviar|disparar|mandar).*(?:grupo|clientes|base))/i.test(aiResponse);
  if (prometeuRemarketing && (isDentroHorarioComercial() || isOverrideHorario)) {
    // Detectar agente alvo — PRIORIZAR MENSAGEM ATUAL do Miron, só depois contexto
    // IMPORTANTE: usar msgLower (mensagem atual) primeiro para evitar contaminação de comandos anteriores
    let rmAgent = null;
    // Primeiro: checar na mensagem ATUAL
    if (/somente\s+(?:o\s+)?(?:agente\s+)?(\w+)|apenas\s+(?:o\s+)?(?:agente\s+)?(\w+)/i.test(msg)) {
      const soMatch = msg.match(/(?:somente|apenas)\s+(?:o\s+)?(?:agente\s+)?(\w+)/i);
      if (soMatch && AGENT_IDS.includes(soMatch[1].toLowerCase())) rmAgent = soMatch[1].toLowerCase();
    }
    if (!rmAgent) {
      for (const id of AGENT_IDS) {
        if (msgLower.includes(id)) { rmAgent = id; break; }
      }
    }
    // Fallback: checar contexto recente (só se não encontrou na msg atual)
    if (!rmAgent) {
      const userContext = db.state.aslamChat.slice(-4)
        .filter(m => m.role === "user")
        .map(m => (m.content || "").toLowerCase())
        .join(" ");
      for (const id of AGENT_IDS) {
        if (userContext.includes(id)) { rmAgent = id; break; }
      }
    }

    // Detectar filtro de produto — PRIORIZAR mensagem ATUAL
    let rmProduct = null;
    if (/uni\s*tv|streaming|tv\s*box|netflix|aparelho/i.test(msgLower)) rmProduct = "unitv";
    else if (/furadeira|parafusadeira|kit|broca|ferramenta|48v/i.test(msgLower)) rmProduct = "furadeira";
    // Fallback: contexto recente (só se não encontrou na msg atual)
    if (!rmProduct) {
      const userContext = db.state.aslamChat.slice(-4)
        .filter(m => m.role === "user")
        .map(m => (m.content || "").toLowerCase())
        .join(" ");
      if (/uni\s*tv|streaming|tv\s*box|netflix|aparelho/i.test(userContext)) rmProduct = "unitv";
      else if (/furadeira|parafusadeira|kit|broca|ferramenta|48v/i.test(userContext)) rmProduct = "furadeira";
    }

    // Detectar instrução especial — SOMENTE da mensagem ATUAL (evita contaminar com comandos anteriores)
    let rmInstrucao = "";
    const descMatch = msgLower.match(/(?:desconto|preco|valor|oferta|promocao|oferec\w+|por\s+r?\$?\s*\d+|r?\$\s*\d+.*(?:hoje|especial|exclusiv))[\s\S]{0,80}/i);
    if (descMatch) rmInstrucao = descMatch[0].trim();

    // Detectar mensagem EXATA no safety-net (ex: "envia a seguinte mensagem: texto aqui")
    let rmMensagemExata = null;
    const rmDizendoMatch = msg.match(/(?:dizendo|falando|mandando|com\s+a\s+mensagem|a\s+seguinte\s+mensagem|seguinte\s+mensagem)[\s:]+(.{10,})/i);
    if (rmDizendoMatch) {
      rmMensagemExata = rmDizendoMatch[1].trim();
    }
    if (!rmMensagemExata) {
      const rmColonMatch = msg.match(/(?:envia?|mand[ea]|fal[ae])\s+.*?(?:clientes?|todos?).*?:\s*(.{10,})/i);
      if (rmColonMatch) rmMensagemExata = rmColonMatch[1].trim();
    }

    if (rmAgent) {
      // Respeitar pausa de remarketing por agente
      if (db.isRemarketingPausado(rmAgent)) {
        console.log(`Safety-net remarketing: ${rmAgent} está pausado — abortando`);
        return aiResponse;
      }
      // Buscar contatos e disparar remarketing de fato
      const contacts = [];
      const convMap = db.state.conversations[rmAgent];
      if (convMap) {
        for (const [numero, conv] of convMap) {
          if (!conv || !conv.msgs || conv.msgs.length === 0) continue;
          if (numero === CONFIG.SEU_WHATSAPP || numero.endsWith(CONFIG.SEU_WHATSAPP.slice(-8))) continue;
          if (db.isManuallyPaused(numero)) continue;
          if (db.hasSaleForNumber(numero)) continue;

          contacts.push({ numero, conv });
        }
      }

      if (contacts.length > 0) {
        let rmSent = 0, rmErrors = 0;
        const agentConfig = CONFIG.AGENTS[rmAgent];

        for (const { numero, conv } of contacts) {
          try {
            // Se Miron mandou mensagem EXATA, usar direto sem gerar pelo Claude
            if (rmMensagemExata) {
              await sendText(rmAgent, numero, rmMensagemExata);
              if (conv) {
                conv.msgs.push({ role: "assistant", content: rmMensagemExata, timestamp: Date.now() });
                conv.ultimaMensagem = Date.now();
              }
              rmSent++;
              console.log(`Safety-net msg exata ${rmAgent} -> ${numero}: ${rmMensagemExata.substring(0, 50)}...`);
              await new Promise(r => setTimeout(r, 1500));
              continue;
            }

            const lastMsgs = conv.msgs.slice(-6).map(m => `${m.role === "user" ? "Cliente" : agentConfig.name}: ${(m.content || "").substring(0, 100)}`).join("\n");
            const prodInfo = getAgentProductInfo(rmAgent);

            // Blindagem de preço: se instrução menciona valor incompatível com o produto, ignorar
            let instrucaoExtra = "";
            if (rmInstrucao) {
              const precoMatch = rmInstrucao.match(/r?\$?\s*(\d{2,4})/i);
              if (precoMatch) {
                const valor = parseInt(precoMatch[1]);
                if (valor > prodInfo.price) {
                  instrucaoExtra = ""; // Preço incompatível — ignora
                } else {
                  instrucaoExtra = `\n\nINSTRUCAO DO DONO: ${rmInstrucao}. PRECO ORIGINAL: R$${prodInfo.price}. PRECO COM DESCONTO: R$${valor}.`;
                }
              } else {
                instrucaoExtra = `\n\nINSTRUCAO DO DONO: ${rmInstrucao}.`;
              }
            }

            const remarkRules = `PROIBIDO: titulos, cabecalhos, headers (#), prefixos. Gere APENAS o texto direto da mensagem pro WhatsApp. Use o NOME DO CLIENTE (do historico), NUNCA use seu proprio nome (${agentConfig.name}). Se nao souber o nome, use "voce". Max 2 linhas CURTAS.`;

            const rmMsg = await callClaude(
              `Voce e ${agentConfig.name} da Atacadao Variedades. Este cliente conversou com voce mas NAO comprou. Gere mensagem personalizada de remarketing. Produto: ${prodInfo.product} por R$${prodInfo.price}. IMPORTANTE: O preco ORIGINAL deste produto e R$${prodInfo.price}. Use EXATAMENTE o produto e preco informados. ${remarkRules}${instrucaoExtra}`,
              [{ role: "user", content: `Historico:\n${lastMsgs}\n\nGere APENAS a mensagem direta:` }],
              { model: "claude-haiku-4-5-20251001", maxTokens: 100, timeout: 15000 }
            );

            if (rmMsg) {
              let cleanMsg = cleanRemarketingMsg(rmMsg);
              if (isBadRemarketingMsg(cleanMsg)) {
                console.error(`[RemarketingSafety] Mensagem ruim bloqueada (${rmAgent}/${numero}): "${cleanMsg}"`);
                cleanMsg = fallbackRemarketingMsg(rmAgent, prodInfo);
              }
              await sendText(rmAgent, numero, cleanMsg);
              conv.msgs.push({ role: "assistant", content: sanitize(cleanMsg), timestamp: Date.now() });
              conv.ultimaMensagem = Date.now();
              // Registrar oferta ativa no safety-net se há desconto e/ou frete grátis
              if (instrucaoExtra) {
                const precoDescMatchSN = instrucaoExtra.match(/PRECO COM DESCONTO: R\$(\d+)/);
                const freteGratisSN = /frete\s*gr[aá]tis|frete\s*inclus[ao]|frete\s*gratuito|sem\s+(?:cobrar\s+)?frete/i.test(instrucaoExtra);
                if (precoDescMatchSN || freteGratisSN) {
                  const precoDescSN = precoDescMatchSN ? parseInt(precoDescMatchSN[1]) : prodInfo.price;
                  db.setOffer(numero, {
                    agentId: rmAgent,
                    precoOriginal: prodInfo.price,
                    precoDesconto: precoDescSN,
                    freteGratis: freteGratisSN,
                    origem: "remarketing_safety_net",
                  });
                }
              }
              rmSent++;
              await new Promise(r => setTimeout(r, 1500));
            } else {
              rmErrors++;
            }
          } catch (e) {
            console.error(`Safety-net remarketing error ${numero}:`, e.message);
            rmErrors++;
          }
        }

        const productLabel = rmProduct === "unitv" ? " [Uni TV]" : rmProduct === "furadeira" ? " [Furadeira]" : "";
        db.addEvent(`Remarketing safety-net ${rmAgent}${productLabel}: ${rmSent} enviados, ${rmErrors} erros`);
        db.save();
        console.log(`Safety-net remarketing: ${rmAgent}${productLabel} — ${rmSent} enviados, ${rmErrors} erros`);

        // Adicionar resultado ao response da IA
        aiResponse += `\n\n_Remarketing executado: ${rmSent} mensagens enviadas${productLabel}${rmErrors > 0 ? `, ${rmErrors} erros` : ""}_`;
      }
    }
  }

  // Save chat history
  db.state.aslamChat.push({ role: "user", content: msg, timestamp: Date.now() });
  db.state.aslamChat.push({ role: "assistant", content: aiResponse, timestamp: Date.now() });
  if (db.state.aslamChat.length > 50) db.state.aslamChat = db.state.aslamChat.slice(-50);
  db.save();

  // Clean tags from visible response
  let cleanResponse = aiResponse;
  cleanResponse = cleanResponse.replace(/\[PAUSAR:\w+:\d+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[PAUSAR:\d+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[RETOMAR:\d+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[ENVIAR:\w+:\d+:[^\]]+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[ENVIAR:\d+:[^\]]+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[TREINAR_\w+:[^\]]+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[LIMPAR:\d+\]/g, "");
  cleanResponse = cleanResponse.replace(/\[PAUSAR_TODOS\]/g, "");
  return cleanResponse.trim();
}

// ============================================
// Process hidden tags from AI response
// ============================================
async function processAslamTags(response) {
  // [PAUSAR:agente:numero]
  const pauseAgentMatches = response.matchAll(/\[PAUSAR:(\w+):(\d+)\]/g);
  for (const m of pauseAgentMatches) {
    const agentId = m[1].toLowerCase();
    const numero = m[2];
    if (AGENT_IDS.includes(agentId)) {
      db.pauseManual(numero, agentId);
      db.addEvent(`Aslam (IA) pausou ${numero} no ${agentId}`);
    }
  }

  // [PAUSAR:numero]
  const pauseMatches = response.matchAll(/\[PAUSAR:(\d+)\]/g);
  for (const m of pauseMatches) {
    const numero = m[1];
    db.pauseManual(numero, null);
    db.addEvent(`Aslam (IA) pausou ${numero} em todos`);
  }

  // [RETOMAR:numero]
  const resumeMatches = response.matchAll(/\[RETOMAR:(\d+)\]/g);
  for (const m of resumeMatches) {
    const numero = m[1];
    db.resumeManual(numero);
    db.addEvent(`Aslam (IA) retomou ${numero}`);
  }

  // [PAUSAR_TODOS]
  if (response.includes("[PAUSAR_TODOS]")) {
    for (const agentId of AGENT_IDS) {
      db.state.conversations[agentId].forEach((conv, numero) => {
        db.pauseManual(numero, agentId);
      });
    }
    db.addEvent("Aslam (IA) pausou TODOS");
  }

  // [RETOMAR_TODOS] — libera toda a base (todos os agentes)
  if (response.includes("[RETOMAR_TODOS]")) {
    let total = 0;
    for (const agentId of AGENT_IDS) {
      total += db.resumeManualAll(agentId);
    }
    db.addEvent(`Aslam (IA) retomou TODOS: ${total} clientes`);
  }

  // [ENVIAR:agente:numero:mensagem]
  const sendAgentMatches = response.matchAll(/\[ENVIAR:(\w+):(\d+):([^\]]+)\]/g);
  for (const m of sendAgentMatches) {
    const agentId = m[1].toLowerCase();
    const numero = m[2];
    const texto = m[3];
    if (AGENT_IDS.includes(agentId)) {
      if (db.isManuallyPaused(numero)) {
        db.addEvent(`Aslam (IA) tentou enviar via ${agentId} para ${numero} mas PAUSADO`);
        continue;
      }
      try {
        await sendText(agentId, numero, texto);
      } catch (e) { console.error(`Tag ENVIAR falhou ${agentId}→${numero}:`, e.message); continue; }
      // Save to conversation history so agent has context
      const conv = db.getConversation(agentId, numero);
      if (conv) {
        conv.msgs.push({ role: "assistant", content: texto, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();
      }
      db.addEvent(`Aslam (IA) enviou msg via ${agentId} para ${numero}`);
    }
  }

  // [ENVIAR:numero:mensagem]
  const sendMatches = response.matchAll(/\[ENVIAR:(\d+):([^\]]+)\]/g);
  for (const m of sendMatches) {
    const numero = m[1];
    const texto = m[2];
    const agentId = db.findAgentForNumber(numero);
    if (agentId) {
      if (db.isManuallyPaused(numero)) {
        db.addEvent(`Aslam (IA) tentou enviar via ${agentId} para ${numero} mas PAUSADO`);
        continue;
      }
      try {
        await sendText(agentId, numero, texto);
      } catch (e) { console.error(`Tag ENVIAR falhou ${agentId}→${numero}:`, e.message); continue; }
      // Save to conversation history so agent has context
      const conv = db.getConversation(agentId, numero);
      if (conv) {
        conv.msgs.push({ role: "assistant", content: texto, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();
      }
      db.addEvent(`Aslam (IA) enviou msg via ${agentId} para ${numero}`);
    }
  }

  // [TREINAR_PEDRO:instrucao], [TREINAR_RODRIGO:instrucao], [TREINAR_TODOS:instrucao]
  const trainMatches = response.matchAll(/\[TREINAR_(PEDRO|RODRIGO|TODOS):([^\]]+)\]/g);
  for (const m of trainMatches) {
    const target = m[1].toLowerCase();
    const instruction = m[2].trim();
    // Bloquear instrucoes perigosas geradas automaticamente pelo Aslam IA
    if (_isDangerousTreinar(instruction)) {
      console.log(`[TREINAR-BLOCK] Aslam IA bloqueada de treinar ${target}: ${instruction.slice(0, 60)}`);
      continue;
    }
    const targets = target === "todos" ? AGENT_IDS : [target];
    for (const agentId of targets) {
      if (!db.state.instructions[agentId]) db.state.instructions[agentId] = [];
      db.state.instructions[agentId].push(instruction);
    }
    db.addEvent(`Aslam (IA) treinou ${target}: ${instruction.slice(0, 40)}...`);
  }

  // [LIMPAR:numero]
  const clearMatches = response.matchAll(/\[LIMPAR:(\d+)\]/g);
  for (const m of clearMatches) {
    const numero = m[1];
    for (const agentId of AGENT_IDS) {
      db.state.conversations[agentId].delete(numero);
    }
    db.addEvent(`Aslam (IA) limpou historico de ${numero}`);
  }

  db.save();
}

// ============================================
// FILTER — Quality gate on every agent response
// ============================================
async function filterResponse(agentId, numero, clientMessage, agentResponse) {
  // Detectar intenção informativa ANTES do early return — respostas curtas de preço não podem escapar
  let _isInfoIntentDetected = false;
  let _responseLeadsWithPrice = false;
  if (clientMessage) {
    const _lcCli = clientMessage.toLowerCase();
    const _infoMatch =
      /\bcomo\s+funciona\b/.test(_lcCli) ||
      /\bme\s+explica\b/.test(_lcCli) ||
      /\bquero\s+(?:mais\s+)?informa[cç][oõ]es?\b/.test(_lcCli) ||
      /\btenho\s+interesse\b/.test(_lcCli) ||
      /\bo\s+que\s+(?:[eé]|faz|tem)\b/.test(_lcCli) ||
      /\bcomo\s+usa\b/.test(_lcCli) ||
      /\bme\s+(?:fala|conta)\s+mais\b/.test(_lcCli) ||
      /\bquero\s+(?:saber|conhecer|entender|ver|detalhes?)\b/.test(_lcCli) ||
      /\bpode\s+(?:me\s+)?(?:explicar|falar)\b/.test(_lcCli) ||
      /\bme\s+(?:fala|conta|passa)\s+(?:mais\s+)?(?:do|sobre|da|de)?\b/.test(_lcCli) ||
      /\bmais\s+informa[cç][oõ]es?\b/.test(_lcCli) ||
      /\bcomo\s+[eé]\s+(?:o|a)\b/.test(_lcCli) ||
      /\bfala\s+(?:sobre|do|da|de)\b/.test(_lcCli) ||
      /\bconta\s+(?:mais\s+)?(?:sobre|do|de)\b/.test(_lcCli) ||
      /\bquero\s+(?:mais\s+)?detalhes?\b/.test(_lcCli) ||
      /\bme\s+passa\s+(?:mais\s+)?(?:informa[cç][oõ]es?|detalhes?)\b/.test(_lcCli);
    const _hasPriceCli =
      /\bvalor\b/.test(_lcCli) ||
      /\bpre[cç]o\b/.test(_lcCli) ||
      /\bquanto\s+(?:custa|fica)\b/.test(_lcCli) ||
      /\bfaz\s+por\s+quanto\b/.test(_lcCli) ||
      /\bcusto\b/.test(_lcCli) ||
      /\bbarato\b/.test(_lcCli);
    if (_infoMatch && !_hasPriceCli) {
      _isInfoIntentDetected = true;
      const _first80 = agentResponse.slice(0, 80).toLowerCase();
      _responseLeadsWithPrice =
        /(?:fica|custa|sai|[eé])\s+r\$\d/i.test(_first80) ||
        /^\s*r\$\d/.test(agentResponse.trim()) ||
        /\bpago\s+na\s+entrega\b/i.test(_first80);
    }
  }

  // OTIMIZACAO: Pular filtro para respostas simples sem instrucoes ativas (economiza 1 chamada API)
  // EXCECAO 1: nunca pular se há oferta ativa — risco de regressão de preço passar sem revisão
  // EXCECAO 2: nunca pular se detectou resposta de preço para pergunta informativa
  const hasInstructions = (db.state.instructions[agentId] || []).length > 0;
  const hasActiveOffer = numero ? !!db.getActiveOffer(agentId, numero) : false;
  const isShort = agentResponse.length < 100;
  const hasNoTags = !/ENVIAR_|NOTIFICAR_|TRANSFERIR_|REGISTRAR_|AGENDAR|CONFIRMAR_DIA/.test(agentResponse);
  if (!hasInstructions && !hasActiveOffer && isShort && hasNoTags && !(_isInfoIntentDetected && _responseLeadsWithPrice)) {
    return agentResponse; // Skip — economia de ~400 tokens/msg
  }

  // Filtrar instrucoes perigosas antes de passar para o filtro — nao podem sobrescrever regras de desconto
  const instructions = (db.state.instructions[agentId] || [])
    .filter(inst => { const t = typeof inst === "string" ? inst : (inst.regras || String(inst || "")); return !_isDangerousTreinar(t); })
    .map((inst, i) => `${i + 1}. ${inst}`)
    .join("\n");

  const cepRule = "NUNCA perguntar CEP - pedir localizacao (pin no mapa)";

  // Detectar desconto ativo para este cliente
  let descontoInfo = "";
  let descontoAntiRegressao = "";
  // Detectar se frete ja foi calculado pelo sistema (GPS ou km por texto)
  let freteContext = "";
  // Detectar frete grátis autorizado
  let freteGratisInfo = "";
  if (numero) {
    const conv = db.getConversation(agentId, numero);
    // Desconto ativo via nova API (com fallback legado interno ao getActiveOffer)
    const ofertaFilter = db.getActiveOffer(agentId, numero);
    if (ofertaFilter) {
      const precoBase = db.getAgentPrice(agentId);
      descontoInfo = `\nDESCONTO ATIVO: O dono autorizou R$${ofertaFilter.precoDesconto} para este cliente. NAO corrija este preco para o valor original. O agente esta CORRETO ao usar R$${ofertaFilter.precoDesconto}.`;
      if (ofertaFilter.precoDesconto !== precoBase) {
        descontoAntiRegressao = `\n- REGRESSAO DE OFERTA PROIBIDA: Se o agente usou R$${precoBase} (preco base) nesta resposta, CORRIJA para R$${ofertaFilter.precoDesconto} (oferta ativa). O agente NAO pode voltar ao preco base enquanto a oferta estiver valida.`;
      }
      // Frete grátis autorizado: o agente pode e deve mencionar
      if (ofertaFilter.freteGratis) {
        freteGratisInfo = `\nFRETE GRÁTIS AUTORIZADO PELO DONO: O agente está CORRETO ao dizer "frete grátis", "frete incluso" ou "frete zero" para este cliente. NÃO corrija para pedir localização — frete é grátis por oferta autorizada. NÃO substitua por pedido de pin no mapa.`;
        // Se frete já calculado com freteGratis, informar os valores corretos ao filtro
        if (conv?.freteCalculado?.freteGratis) {
          const fd = conv.freteCalculado;
          freteContext = `\nFRETE GRÁTIS CALCULADO: frete R$0 (grátis por oferta autorizada), produto R$${fd.produtoPreco}, TOTAL R$${fd.total}. CORRETO — nao altere. O agente pode confirmar frete grátis a este cliente.`;
        }
      }
    }
    if (!freteContext && conv && conv.msgs) {
      // FIX: usar conv.freteCalculado como sinal primario
      const freteCalculado = !!(conv.freteCalculado && conv.freteCalculado.total) ||
        conv.msgs.some(m =>
          m.role === "user" && ((m.content || "").startsWith("[Cliente enviou localizacao:") || (m.content || "").startsWith("[Cliente informou distancia:"))
        );
      if (freteCalculado) {
        const fd = conv.freteCalculado;
        if (fd && fd.total) {
          const _freteDesc = fd.freteGratis ? "R$0 (GRÁTIS por oferta autorizada)" : `R$${fd.frete} (${fd.distKm}km)`;
          // Injeta valores reais — evita que o filtro "corrija" valores corretos
          freteContext = `\nFRETE JA CALCULADO PELO SISTEMA — VALORES DEFINITIVOS: frete ${_freteDesc}, produto R$${fd.produtoPreco}, TOTAL R$${fd.total}. ESTES NUMEROS SAO CORRETOS — nao altere nem corrija. NAO recalcule usando km x 2. Se o agente pediu localizacao/pin/GPS novamente, CORRIJA para pedir nome e endereco completo. A proxima etapa e coletar: nome, endereco completo (rua, quadra, lote, referencia), horario e pagamento — NAO pedir localizacao de novo.`;
        } else {
          freteContext = "\nFRETE JA CALCULADO PELO SISTEMA: O cliente JA enviou localizacao GPS e o frete JA foi calculado. Se o agente pediu localizacao/pin/GPS novamente, CORRIJA para pedir nome e endereco completo. A proxima etapa e coletar: nome, endereco completo (rua, quadra, lote, referencia), horario e pagamento — NAO pedir localizacao de novo.";
        }
      }
    }
  }

  const retiradaRule = `- RETIRADA PROIBIDA: Nao fazemos retirada. Trabalhamos SOMENTE com entrega. Se a resposta diz que faz retirada, libera retirada, ou menciona horario de retirada: CORRIJA para "Nao fazemos retirada, trabalhamos somente com entrega! 😊".`;

  // Intenção informativa — usa vars pré-computadas (detectadas antes do early return)
  let infoIntentRule = "";
  if (_isInfoIntentDetected && _responseLeadsWithPrice) {
    infoIntentRule = `\n- 🔴 CORRECAO OBRIGATORIA — INTENCAO INFORMATIVA: O cliente perguntou "${(clientMessage || "").slice(0, 100)}" (pergunta informativa, NAO pediu preco). O agente respondeu com preco. CORRIJA: reescreva focado APENAS em explicar o produto ou beneficio. REMOVA completamente qualquer mencao a preco, valor, pagamento ou parcelamento — esses dados nao foram pedidos pelo cliente nesta mensagem.`;
  }

  const filterPrompt = `Voce e o filtro de qualidade do Aslam. Analise a resposta do agente e corrija se necessario.
${descontoInfo ? `\n⚠️⚠️⚠️ DESCONTO AUTORIZADO — LEIA ANTES DE QUALQUER CORRECAO ⚠️⚠️⚠️${descontoInfo}\n⚠️ REGRA ABSOLUTA: NAO corrija o preco com desconto. Ele e AUTORIZADO pelo dono. O agente esta CORRETO ao usar esse valor.⚠️⚠️⚠️\n` : ""}${freteGratisInfo ? `\n🟢🟢🟢 FRETE GRÁTIS AUTORIZADO — LEIA ANTES DE QUALQUER CORRECAO 🟢🟢🟢${freteGratisInfo}\n🟢 REGRA ABSOLUTA: NAO corrija menções de frete grátis/incluso. Estao AUTORIZADAS pelo dono.🟢🟢🟢\n` : ""}
REGRAS BASE:
${descontoAntiRegressao}- Resposta deve ser UMA UNICA mensagem (nunca dividida, nunca "---")
- Mensagem direta e natural — sem repetir informação já dita, sem prolixidade desnecessária
- 1 emoji no maximo
- Nunca repetir informacao ja dita na conversa
- Cada mensagem diferente da anterior
- ${cepRule}
- FRETE: ${freteGratisInfo ? "FRETE GRÁTIS AUTORIZADO — ver instrução acima. O agente pode informar frete grátis/incluso sem pedir localização." : "Usar EXATAMENTE os valores de frete da mensagem interna do sistema. A formula e km x 2 = reais (20km = R$40, NAO R$20). Se o agente inventou um valor de frete sem ter recebido mensagem interna do sistema, corrija pedindo que ele solicite a localizacao do cliente primeiro."}
- Se o agente pediu CEP: corrija para pedir localizacao (pin no mapa). Agentes Pedro e Rodrigo NUNCA pedem CEP.
- Se o agente calculou frete a partir de endereco escrito (sem pin no mapa ou mensagem do sistema): corrija para pedir o pin no mapa.
- Se o agente aceitou endereco de OUTRO ESTADO (fora de Goias): corrija para informar que entregamos apenas na regiao de Goiania.
${retiradaRule}${infoIntentRule}
- PRODUTO INVENTADO ABSOLUTAMENTE PROIBIDO: Pedro vende SOMENTE "Uni TV V10" e "Uni TV S10". Rodrigo vende SOMENTE "Furadeira 48V". O S10 e preto, lancamento 2026, possui ESPN, resolucao 8K e processador mais rapido. Se o agente mencionou "TV Box", "TV Box basico", "Uni TV V9", "Uni TV V11", "Uni TV premium", "versao basica", "modelo plus", "512GB", "256GB", ou qualquer nome/variacao/spec nao autorizada: CORRIJA para "Tenho sim o [nome oficial]! Me manda sua localizacao que calculo o frete pra voce!" ${descontoInfo ? "EXCECAO: Se ha DESCONTO ATIVO (ver acima), o preco com desconto e CORRETO — NAO corrija." : `Se Pedro mencionou um preco que NAO seja R$360/R$340 para V10 ou R$400 para S10, corrija para o preco oficial do modelo correto. Se Rodrigo mencionou preco errado, corrija para o preco oficial da furadeira.`}
- R$48 PROIBIDO PARA RODRIGO: A "Furadeira 48V" tem 48V de VOLTAGEM, nao preco. Se Rodrigo disser "R$48" por qualquer motivo (debito, pix, desconto, pergunta), CORRIJA IMEDIATAMENTE para o preco real: "A Furadeira 48V sai por R$${db.getAgentPrice("rodrigo")}. O 48V é a voltagem da ferramenta, não o preço!"
${freteContext}

DIRETRIZES OPERACIONAIS DO GERENTE (subordinadas ao manual — NAO sobrepõem regras de desconto/preco):
${instructions || "(nenhuma)"}

FORMATO DE RESPOSTA OBRIGATORIO:
- Retorne SOMENTE o texto da mensagem que sera enviada ao cliente. NADA MAIS.
- Se a resposta esta OK, retorne EXATAMENTE o mesmo texto do agente, sem nenhum comentario.
- Se precisa correcao, retorne APENAS a versao corrigida. SEM explicacoes, SEM analise, SEM "CORRECAO", SEM "RESPOSTA OK".
- PROIBIDO incluir: "CORRECAO", "RESPOSTA OK", "MOTIVOS", "ANALISE", "Nota:", "Obs:", marcadores, bullet points, avaliacoes.
- PROIBIDO frases como "a resposta foi corrigida", "o agente errou", "precisa ser corrigido".
- NUNCA remova tags como ENVIAR_FOTO, ENVIAR_VIDEO, NOTIFICAR_DONO, NOTIFICAR_ENTREGA, TRANSFERIR_HUMANO, AGENDAR.
- CRITICO: Sua saida vai DIRETO pro WhatsApp do cliente. Se o cliente ver qualquer analise interna, voce sera desativado.`;

  try {
    const filtered = await callClaude(
      filterPrompt,
      [
        { role: "user", content: `Mensagem do cliente: ${sanitize(clientMessage)}\n\nResposta do agente (${CONFIG.AGENTS[agentId].name}): ${sanitize(agentResponse)}` },
      ],
      { model: CONFIG.CLAUDE_MODEL, maxTokens: 400, timeout: 15000 }
    );

    if (!filtered) return agentResponse;

    // SANITIZAÇÃO: remover análise interna caso o Haiku ignore as instruções
    let cleanFiltered = filtered;
    // Remover blocos de análise que não deveriam ir pro cliente
    cleanFiltered = cleanFiltered.replace(/^.*(?:CORRECAO NECESSARIA|RESPOSTA OK|RESPOSTA CORRIGIDA|MOTIVOS DA CORRECAO|ANALISE|VERIFICACAO|AVALIACAO|❌|✅|⚠️).*\n?/gim, "");
    cleanFiltered = cleanFiltered.replace(/^\s*(?:\d+\.\s+)?(?:Instrucao|A resposta|Reconheceu|Perguntou|Manteve|Usou apenas|Nenhuma correcao|Ele:|O agente|Corrigido|Nota:|Obs:).*\n?/gim, "");
    cleanFiltered = cleanFiltered.replace(/^\s*[-•]\s+(?:A resposta|O agente|Corri|Manteve|Verificar).*\n?/gm, "");
    cleanFiltered = cleanFiltered.replace(/^\*\*?(?:RESPOSTA CORRIGIDA|ENVIAR|CORRECAO|RESULTADO)\*?\*?[.:]\s*/gim, "");
    // Remover frases de meta-analise que vazam pro cliente
    cleanFiltered = cleanFiltered.replace(/^.*(?:precisa ser corrigid|estava incorret|foi corrigid|resposta original|resposta do agente).*\n?/gim, "");
    cleanFiltered = cleanFiltered.replace(/^\s*\n/gm, "").trim();
    // Se a limpeza removeu tudo ou ficou muito curta, usar resposta original
    if (!cleanFiltered || cleanFiltered.length < 5) cleanFiltered = agentResponse;

    // Log quando filtro modifica resposta (para debug), mas NÃO adicionar como instrução
    // REMOVIDO: auto-add de "Correcao automatica" como instrução — causava acúmulo de
    // 15+ correções no prompt, fazendo o agente entrar em loop de "desculpa me confundi"
    if (cleanFiltered !== agentResponse) {
      console.log(`[FILTER] ${CONFIG.AGENTS[agentId].name}/${numero}: resposta modificada pelo filtro`);
    }

    return cleanFiltered;
  } catch (e) {
    console.error(`Filter error for ${agentId}:`, e.message);
    return agentResponse;
  }
}

// ============================================
// LEAD MONITOR — check unresponded clients every 60s
// ============================================
function monitorLeads() {
  setInterval(async () => {
    try {
      const now = Date.now();
      const threeMin = 3 * 60 * 1000;
      const cooldownTime = 10 * 60 * 1000;

      // Cleanup stale cooldown entries to prevent memory leak
      if (leadCooldowns.size > 500) {
        for (const [key, ts] of leadCooldowns) {
          if (now - ts > cooldownTime * 2) leadCooldowns.delete(key);
        }
      }

      for (const agentId of AGENT_IDS) {
        const convMap = db.state.conversations[agentId];
        const entries = [...convMap.entries()];
        for (const [numero, conv] of entries) {
          try {
            if (db.isPaused(agentId, numero)) continue;
            if (!conv.msgs || conv.msgs.length === 0) continue;

            const lastMsg = conv.msgs[conv.msgs.length - 1];
            if (lastMsg.role === "assistant") continue;

            const msgTime = lastMsg.timestamp || conv.ultimaMensagem || 0;
            if (now - msgTime < threeMin) continue;

            const cooldownKey = `${agentId}:${numero}`;
            const lastIntervention = leadCooldowns.get(cooldownKey) || 0;
            if (now - lastIntervention < cooldownTime) continue;

            leadCooldowns.set(cooldownKey, now);

            const recentMsgs = conv.msgs.slice(-20).map((m) => ({
              role: m.role,
              content: sanitize(m.content || m.text || ""),
            }));

            const agentsModule = require("./agents-atk");
            const monitorSystemPrompt = agentsModule.buildSystemPrompt(agentId, numero);
            const response = await callClaude(
              monitorSystemPrompt,
              recentMsgs,
              { maxTokens: 300, timeout: 15000 }
            );

            if (response) {
              // Passar pelo filtro de qualidade — mesmo gate do fluxo normal
              let filteredResponse = response;
              try {
                const lastClientMsg = recentMsgs.filter(m => m.role === "user").slice(-1)[0];
                filteredResponse = await filterResponse(agentId, numero, lastClientMsg?.content || "", response);
              } catch (eFilter) { /* fallback silencioso */ }
              await sendText(agentId, numero, filteredResponse);
              conv.msgs.push({ role: "assistant", content: filteredResponse, timestamp: Date.now() });
              conv.ultimaMensagem = Date.now();
              db.addEvent(`Monitor: ${agentId} respondeu ${numero} (intervencao automatica)`);
              db.addActivity(`Lead monitor: ${agentId} -> ${numero}`);

              notifyMiron(`[Monitor] ${CONFIG.AGENTS[agentId].name} respondeu automaticamente para ${numero} apos 3min sem resposta.`);
              db.save();
            }
          } catch (eInner) {
            console.error(`Lead monitor error for ${agentId}/${numero}:`, eInner.message);
          }
        }
      }
    } catch (e) {
      console.error("Lead monitor error:", e.message);
    }
  }, 60 * 1000);
}

// ============================================
// DAILY SWEEP — 19:00 catch missed clients
// ============================================
function dailySweep() {
  setInterval(async () => {
    try {
      const time = getBrasiliaTime();
      // Sweep às 17:30 (dentro do horário comercial 08-18h seg-sex)
      if (time.hora !== 17 || time.minuto < 25 || time.minuto > 34) return;
      // Não rodar em sábado/domingo
      const brasiliaDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const diaSemana = brasiliaDate.getDay();
      if (diaSemana === 0 || diaSemana === 6) return;

      const now = Date.now();
      const fiveMin = 5 * 60 * 1000;
      const missed = [];

      for (const agentId of AGENT_IDS) {
        const convMap = db.state.conversations[agentId];
        convMap.forEach((conv, numero) => {
          // NEVER send to paused numbers
          if (db.isPaused(agentId, numero)) return;
          if (!conv.msgs || conv.msgs.length === 0) return;

          const hasAgentResponse = conv.msgs.some((m) => m.role === "assistant");
          if (hasAgentResponse) return;

          const firstMsg = conv.msgs[0];
          const msgTime = firstMsg.timestamp || conv.ultimaMensagem || 0;
          if (now - msgTime < fiveMin) return;

          missed.push({ agentId, numero, conv });
        });
      }

      if (missed.length === 0) return;

      let sent = 0;
      for (const item of missed) {
        const recentMsgs = item.conv.msgs.slice(-20).map((m) => ({
          role: m.role,
          content: sanitize(m.content || m.text || ""),
        }));

        const agentsModuleSweep = require("./agents-atk");
        const sweepSystemPrompt = agentsModuleSweep.buildSystemPrompt(item.agentId, item.numero);
        const response = await callClaude(
          sweepSystemPrompt,
          recentMsgs,
          { maxTokens: 300, timeout: 15000 }
        );

        if (response) {
          await sendText(item.agentId, item.numero, response);
          item.conv.msgs.push({ role: "assistant", content: response, timestamp: Date.now() });
          item.conv.ultimaMensagem = Date.now();
          sent++;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      if (sent > 0) {
        db.addEvent(`Sweep 17:30: ${sent} clientes resgatados`);
        notifyMiron(`[Sweep 17:30] ${sent} clientes que nunca foram respondidos receberam mensagem agora.`);
        db.save();
      }
    } catch (e) {
      console.error("Daily sweep error:", e.message);
    }
  }, 5 * 60 * 1000);
}

// ============================================
// MEETING ROOM
// ============================================
async function handleMeetingMessage(sender, target, message) {
  const senderLower = (sender || "").toLowerCase();
  const targetLower = (target || "").toLowerCase();
  const isOwner = senderLower === "dono" || senderLower === "miron";
  const targetAgents = targetLower === "todos" ? AGENT_IDS : (AGENT_IDS.includes(targetLower) ? [targetLower] : (targetLower === "aslam" ? ["aslam"] : []));

  if (isOwner) {
    const msgLower = message.toLowerCase();

    // DETECTAR COMANDOS DE PARADA — PRIORIDADE MÁXIMA, delega para handleAslamChat que já trata
    // Isso garante que comandos de parada vindo do meetingRoom também sejam bloqueados corretamente
    const isMeetingStopRemarketing = /(?:par[eao]|parar|cancele?|cancelar|interrompa?|interromper|paus[eao]|pausar|desativ[ae]|desativar|nao\s+(?:mande?|envie?|dispare?|fac[ao])\s+(?:mais\s+)?(?:o\s+)?(?:remarketing|follow|disparos?))/i.test(msgLower) && /(?:remarketing|follow.?up|disparos?)/i.test(msgLower);
    if (isMeetingStopRemarketing) {
      const resultado = await handleAslamChat(message);
      db.state.meetingRoom.push({ sender, target, message, timestamp: Date.now() });
      db.state.meetingRoom.push({ sender: "Sistema", target: sender, message: resultado, timestamp: Date.now() });
      if (db.state.meetingRoom.length > 200) db.state.meetingRoom = db.state.meetingRoom.slice(-200);
      db.save();
      return [{ agent: "Sistema", response: resultado }];
    }

    // DETECTAR COMANDOS DE AÇÃO — executar de verdade, não só salvar instrução
    // REGRA: Se a mensagem contém palavras de REGRA/INSTRUÇÃO junto com remarketing, NÃO é ação
    // IMPORTANTE: "agora" e "ja" removidos — são advérbios de urgência, não verbos de execução
    const isMeetingInstruction = /(?:so\s+pode|nao\s+pode|horario|hora|permitido|proibido|regra|instrucao|deve|devem|apenas|somente)\s*.*(?:remarketing|follow.?up)/i.test(msgLower) || /(?:remarketing|follow.?up)\s*.*(?:so\s+pode|nao\s+pode|horario|hora|permitido|proibido|entre|das?\s+\d|ate\s+\d|de\s+\d)/i.test(msgLower);
    const isAction = !isMeetingInstruction && (/(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|pede?|quero\s+que)\s*(?:o\s+|pro?\s+|para?\s+)?(?:follow|remarke|contato|recontato|acompanhamento)/i.test(msgLower) || /recontatar|mandar?\s+mensagem|dispara|enviar?\s+pra\s+todos|contatar?\s+clientes/i.test(msgLower) || /(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|pede?|quero\s+que)\s*(?:o\s+|pro?\s+|para?\s+)?(?:pedro|rodrigo|todos?).*(?:remarketing|enviar?\s+mensag|contatar?\s+cliente|seguinte\s+mensag)/i.test(msgLower) || /(?:quero\s+que|pede?\s+(?:pro?|para?))\s*(?:o\s+)?(?:pedro|rodrigo)\s+(?:envia?|mand[ea]|fac?a|dispar[ea]).*(?:mensag|remarketing|clientes)/i.test(msgLower) || ((/follow.?up|remarketing/i.test(msgLower)) && /(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|enviar?|oferec)/i.test(msgLower)));

    if (isAction) {
      // Mapear pra comando do Aslam e executar
      let aslamCmd = message;
      // Normalizar pra formato que handleAslamChat entende — MAS preservar instruções especiais
      if (/follow.?up|remarketing|recontatar|contatar?\s+clientes/i.test(msgLower)) {
        const periodo = /ontem/i.test(msgLower) ? "ontem" : /anteontem/i.test(msgLower) ? "anteontem" : "hoje";
        // CORRIGIDO: Detectar agente tanto do target selector QUANTO do corpo da mensagem
        let agentFilter = targetLower !== "todos" && AGENT_IDS.includes(targetLower) ? targetLower : "";
        if (!agentFilter) {
          // Fallback: buscar agente mencionado no corpo da mensagem
          for (const id of AGENT_IDS) {
            if (msgLower.includes(id)) { agentFilter = id; break; }
          }
        }

        // Detectar se é mensagem exata (ex: "envia a seguinte mensagem: texto")
        let meetingMensagemExata = null;
        const meetDizendoMatch = message.match(/(?:dizendo|falando|mandando|com\s+a\s+mensagem|a\s+seguinte\s+mensagem|seguinte\s+mensagem)[\s:]+(.{10,})/i);
        if (meetDizendoMatch) {
          meetingMensagemExata = meetDizendoMatch[1].trim();
        }
        if (!meetingMensagemExata) {
          const meetColonMatch = message.match(/(?:envia?|mand[ea]|fal[ae])\s+.*?(?:clientes?|todos?).*?:\s*(.{10,})/i);
          if (meetColonMatch) meetingMensagemExata = meetColonMatch[1].trim();
        }

        // Se tem mensagem exata, passar via "dizendo:" para handleAslamChat reconhecer
        if (meetingMensagemExata) {
          aslamCmd = `remarketing ${agentFilter} dizendo: ${meetingMensagemExata}`.trim();
        } else {
          // Extrair instrução especial (desconto, oferta, tom, etc.) da mensagem original
          const instrucaoExtra = message.replace(/(?:faz|fale?|dispara?|executa|roda|inicia|manda|avisa?|avise|diga|envia?r?)\s*/gi, "")
            .replace(/(?:remarketing|follow.?up|acompanhamento)\s*/gi, "")
            .replace(/(?:para?\s+todos|para?\s+os?\s+clientes?)\s*/gi, "")
            .replace(/(?:pelo?\s+)?(pedro|rodrigo)\s*/gi, "")
            .replace(/(?:hoje|ontem|anteontem)\s*/gi, "")
            .trim();
          aslamCmd = `remarketing ${agentFilter} ${periodo}`.trim();
          if (instrucaoExtra.length > 5) {
            aslamCmd += ` instrucao:${instrucaoExtra}`;
          }
        }
      }

      // Salvar no meetingRoom pra aparecer na tela
      db.state.meetingRoom.push({ sender, target, message, timestamp: Date.now() });
      if (db.state.meetingRoom.length > 200) db.state.meetingRoom = db.state.meetingRoom.slice(-200);

      // Executar via handleAslamChat (que realmente dispara mensagens)
      const resultado = await handleAslamChat(aslamCmd);

      // Salvar resultado na sala
      db.state.meetingRoom.push({
        sender: "Sistema",
        target: sender,
        message: resultado,
        timestamp: Date.now(),
      });
      db.save();

      return [{ agent: "Sistema", response: resultado }];
    }

    // Se não é ação, salvar como instrução (comportamento original)

    // BLOQUEIO: instrucoes com linguagem de desconto/promocao sao bloqueadas via Sala de Reuniao
    // Para autorizar desconto, usar o sistema de ofertas: "desconto [agente] [numero] R$[valor]"
    if (_isDangerousTreinar(message)) {
      const bloqueioMsg = `⚠️ INSTRUCAO BLOQUEADA pela hierarquia do manual.\nNao posso salvar "${message.slice(0, 80)}..." como instrucao persistida — conflita com regras de desconto/preco do manual.\nPara autorizar desconto para um cliente especifico, use: desconto [pedro|rodrigo] [numero] R$[valor]`;
      db.state.meetingRoom.push({ sender: "Sistema", target: sender, message: bloqueioMsg, timestamp: Date.now() });
      db.save();
      return [{ agent: "Aslam", response: bloqueioMsg }];
    }

    const instruction = `INSTRUCAO OBRIGATORIA DO DONO (${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): ${message}`;

    for (const agentId of targetAgents) {
      if (agentId === "aslam") continue;

      if (!db.state.instructions[agentId]) db.state.instructions[agentId] = [];

      // Deduplication: update timestamp if same instruction core exists
      const core = message.trim().toLowerCase();
      const existingIdx = db.state.instructions[agentId].findIndex((inst) => {
        if (typeof inst !== "string") return false;
        const instCore = inst.replace(/INSTRUCAO OBRIGATORIA DO DONO \([^)]+\): /i, "").trim().toLowerCase();
        return instCore === core;
      });

      if (existingIdx >= 0) {
        db.state.instructions[agentId][existingIdx] = instruction;
      } else {
        db.state.instructions[agentId].push(instruction);
      }

      // Save to knowledge arrays
      if (!db.state.knowledge[agentId]) db.state.knowledge[agentId] = [];
      db.state.knowledge[agentId].push({
        tipo: "info",
        resumo: `Instrucao do dono: ${message.slice(0, 60)}`,
        detalhe: message,
        data: Date.now(),
        manual: true,
      });
      if (db.state.knowledge[agentId].length > 50) {
        db.state.knowledge[agentId] = db.state.knowledge[agentId].slice(-50);
      }
    }

    // Save meeting room entry
    db.state.meetingRoom.push({
      sender,
      target,
      message,
      timestamp: Date.now(),
    });
    if (db.state.meetingRoom.length > 200) {
      db.state.meetingRoom = db.state.meetingRoom.slice(-200);
    }

    db.addEvent(`Dono instruiu ${target}: ${message.slice(0, 60)}...`);
    db.save();

    // Agents confirm via Claude
    const confirmations = [];
    for (const agentId of targetAgents) {
      if (agentId === "aslam") {
        confirmations.push("Aslam: Entendido, chefe. Vou garantir que isso seja cumprido.");
        continue;
      }

      const confirmation = await callClaude(
        `Voce e ${CONFIG.AGENTS[agentId].name}, vendedor da Atacadao Variedades. O dono Miron acabou de dar uma instrucao na sala de reuniao. Confirme que entendeu e vai seguir. Seja breve (1 frase). Mostre respeito e comprometimento.`,
        [{ role: "user", content: `Instrucao do dono: ${message}` }],
        { model: "claude-haiku-4-5-20251001", maxTokens: 100, timeout: 10000 }
      );

      confirmations.push(`${CONFIG.AGENTS[agentId].name}: ${confirmation || "Entendido, chefe!"}`);
    }

    // Save confirmations to meeting room history
    const confirmText = confirmations.join("\n");
    db.state.meetingRoom.push({
      sender: "Sistema",
      target: sender,
      message: confirmText,
      timestamp: Date.now(),
    });
    db.save();

    return confirmText;
  }

  // Non-owner messages in meeting room (agent-to-agent)
  db.state.meetingRoom.push({
    sender,
    target,
    message,
    timestamp: Date.now(),
  });
  if (db.state.meetingRoom.length > 200) {
    db.state.meetingRoom = db.state.meetingRoom.slice(-200);
  }
  db.save();

  return `Mensagem de ${sender} para ${target} registrada na sala de reuniao.`;
}

// ============================================
// NOTIFY MIRON
// ============================================
async function notifyMiron(message) {
  try {
    await sendText("pedro", CONFIG.SEU_WHATSAPP, message);
  } catch (e) {
    console.error("Erro ao notificar Miron:", e.message);
  }
}

// ============================================
// REMARKETING — every 2 hours, check all contacts
// Clients who didn't buy get follow-up every 2 days
// NEVER sends to paused numbers
// ============================================
function startRemarketing() {
  // First run after 10 minutes, then every 2 hours
  setTimeout(() => {
    runRemarketing();
    setInterval(runRemarketing, 2 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);
}

async function runRemarketing() {
  try {
    const now = Date.now();
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    // Verificar horário comercial (08:00-18:00 seg-sex)
    if (!isDentroHorarioComercial()) {
      console.log(`🔄 [Remarketing] Fora do horário comercial — pulando ciclo`);
      return;
    }
    const currentBrasiliaHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
    console.log(`🔄 [Remarketing] Ciclo iniciado — ${currentBrasiliaHour}h Brasilia`);

    // Cleanup stale remarketing entries (older than 60 days) to prevent unbounded growth
    const rmKeys = Object.keys(db.state.lastRemarketing);
    if (rmKeys.length > 500) {
      const cutoff = now - 60 * 24 * 60 * 60 * 1000;
      for (const key of rmKeys) {
        if (db.state.lastRemarketing[key] < cutoff) delete db.state.lastRemarketing[key];
      }
    }

    for (const agentId of AGENT_IDS) {
      // Respeitar pausa de remarketing por agente (comando do dono)
      if (db.isRemarketingPausado(agentId)) {
        console.log(`🔄 [Remarketing] ${CONFIG.AGENTS[agentId].name} — PAUSADO pelo dono, pulando`);
        continue;
      }

      const convMap = db.state.conversations[agentId];
      const entries = [...convMap.entries()];

      let batchCount = 0;
      let stopCount = 0;
      for (const [numero, conv] of entries) {
        try {
          // Respeitar pausa MANUAL do Miron — nunca enviar
          if (db.isManuallyPaused(numero)) continue;
          if (!conv.msgs || conv.msgs.length === 0) continue;

          const lastMsgTime = conv.ultimaMensagem || 0;

          // Skip if sale was made
          if (db.hasSaleForNumber(numero)) continue;

          // Skip if conversation is very old (> 60 days)
          if (now - lastMsgTime > 60 * 24 * 60 * 60 * 1000) continue;

          // Smart timing — verificação redundante (segurança extra)
          if (currentBrasiliaHour < 8 || currentBrasiliaHour >= 18) continue;

          const rmKey = `${agentId}_${numero}`;

          // ── PEDRO / RODRIGO: mensagem fixa 24h com pausa automática ──
          if (agentId === "pedro" || agentId === "rodrigo") {
            const oneDay = 24 * 60 * 60 * 1000;
            // Dispara apenas após 24h da última mensagem
            if (now - lastMsgTime < oneDay) continue;
            // Não reenviar se já disparou neste ciclo de conversa (lastRM posterior à última msg)
            const lastRM = db.state.lastRemarketing[rmKey] || 0;
            if (lastRM > lastMsgTime) continue;

            const pedroProductKey = agentId === "pedro" ? getPedroProductKeyFromConversation(conv) : null;
            const fixedMsg = agentId === "pedro"
              ? (pedroProductKey === "s10" ? PEDRO_RM_24H_S10 : PEDRO_RM_24H_V10)
              : RODRIGO_RM_24H;
            const precoOriginal = agentId === "pedro" ? (pedroProductKey === "s10" ? 400 : 360) : 160;
            const precoDesconto = agentId === "pedro" ? (pedroProductKey === "s10" ? 400 : 330) : 130;

            await sendText(agentId, numero, fixedMsg);
            db.state.lastRemarketing[rmKey] = now;

            // Oferta expira ao fim do dia (Brasília) — desconto não vale no dia seguinte
            db.setOffer(numero, {
              agentId, precoOriginal, precoDesconto, freteGratis: false,
              origem: "remarketing_auto", campanha: "remarketing_24h_fixo",
              expiresAt: endOfDayBrasiliaTs(),
            });

            // Pausar cliente — agente não responde até Miron liberar
            db.pauseManual(numero, agentId);

            conv.msgs.push({ role: "assistant", content: fixedMsg, timestamp: now, _type: "remarketing" });
            conv.ultimaMensagem = now;
            db.addEvent(`Remarketing 24h: ${agentId} -> ${numero} [R$${precoDesconto}, pausado, oferta expira hoje]`);
            db.save();
            console.log(`Remarketing 24h: ${CONFIG.AGENTS[agentId].name} -> ${numero} [R$${precoDesconto}, pausado]`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }

          // Skip if last message is too recent (< 2 days)
          if (now - lastMsgTime < twoDays) continue;

          // Skip if remarketing was sent recently (< 2 days)
          const lastRM = db.state.lastRemarketing[rmKey] || 0;
          if (now - lastRM < twoDays) continue;

          // ── ENGINE: análise completa da conversa ──
          const prodInfo = getAgentProductInfo(agentId);
          const agentName = CONFIG.AGENTS[agentId].name;

          const profile = engine.analyzeConversation(conv.msgs, agentId);
          const insistenceLevel = engine.getInsistenceLevel(conv, profile);

          // Parar se engine indicar STOP
          if (insistenceLevel === "STOP") {
            if (profile.explicitRefusal) conv.doNotFollowUp = true;
            stopCount++;
            console.log(`Remarketing ${agentId}/${numero} cancelado — insistência STOP`);
            continue;
          }

          // Yield para GC a cada 10 contatos processados
          batchCount++;
          if (batchCount % 10 === 0) {
            await new Promise(r => setTimeout(r, 50));
          }

          // Instrução extra do dono (desconto autorizado, etc.)
          const agentInstructions = db.state.instructions[agentId] || [];
          const instrucaoRemarketing = agentInstructions
            .map(inst => typeof inst === "string" ? inst : (inst.regras || ""))
            .filter(txt => /desconto|promo|oferta|preco\s*especial|valor.*especial|por\s*r\$/i.test(txt))
            .slice(-1)[0] || "";
          let instrucaoBonus = instrucaoRemarketing
            ? `INSTRUCAO DO DONO PARA REMARKETING: ${instrucaoRemarketing}. Se autorizado desconto, OFERECA na mensagem.`
            : "";
          if (db.hasFreteGratis(agentId, numero)) {
            instrucaoBonus = (instrucaoBonus ? instrucaoBonus + " " : "") + "FRETE GRÁTIS AUTORIZADO: o dono ativou frete grátis para este cliente — mencione como vantagem decisiva.";
          }

          const lastMsgsText = conv.msgs.slice(-6).map(m => `${m.role === "user" ? "Cliente" : agentName}: ${(m.content || "").slice(0, 100)}`).join("\n");

          // ── ENGINE: geração personalizada ──
          const clientName = conv.pushName || "";
          const rmMsg = await engine.generateRetakeMessage({
            agentId, agentName, clientName, profile, insistenceLevel, prodInfo, instrucaoBonus, lastMsgsText,
          });

          if (rmMsg) {
            if (db.isManuallyPaused(numero)) continue;
            if (db.state.paused[agentId]) db.state.paused[agentId].delete(numero);

            let cleanMsg = cleanRemarketingMsg(rmMsg);
            if (isBadRemarketingMsg(cleanMsg)) {
              console.error(`[RemarketingAuto] Mensagem ruim bloqueada (${agentId}/${numero}): "${cleanMsg}"`);
              cleanMsg = fallbackRemarketingMsg(agentId, prodInfo);
            }
            await sendText(agentId, numero, cleanMsg);
            db.state.lastRemarketing[rmKey] = now;

            if (instrucaoRemarketing) {
              const precoMatch = instrucaoRemarketing.match(/r?\$?\s*(\d{2,4})/i) || cleanMsg.match(/R\$\s*(\d{2,4})/);
              const freteGratisAuto = /frete\s*gr[aá]tis|frete\s*inclus[ao]|frete\s*gratuito|sem\s+(?:cobrar\s+)?frete/i.test(instrucaoRemarketing);
              const precoOriginal = prodInfo.price;
              if (precoMatch || freteGratisAuto) {
                const precoDesconto = precoMatch ? parseInt(precoMatch[1]) : precoOriginal;
                if (precoDesconto < precoOriginal || freteGratisAuto) {
                  db.setOffer(numero, {
                    agentId,
                    precoOriginal,
                    precoDesconto,
                    freteGratis: freteGratisAuto,
                    origem: "remarketing_auto",
                    campanha: instrucaoRemarketing,
                  });
                }
              }
            }

            conv.msgs.push({ role: "assistant", content: sanitize(cleanMsg), timestamp: now, _type: "remarketing" });
            conv.ultimaMensagem = now;
            db.addEvent(`Remarketing inteligente: ${agentId} -> ${numero} [nivel:${insistenceLevel} objecao:${profile.mainObjection} estagio:${profile.stage}]`);
            db.save();
            console.log(`Remarketing: ${CONFIG.AGENTS[agentId].name} -> ${numero} [${insistenceLevel}, objeção: ${profile.mainObjection}, estágio: ${profile.stage}]`);

            await new Promise((r) => setTimeout(r, 3000));
          }
        } catch (e) {
          console.error(`Remarketing error ${agentId}/${numero}:`, e.message);
        }
      }
      if (stopCount > 0) {
        db.save();
        console.log(`Remarketing ${agentId}: ${stopCount} contatos com STOP ignorados`);
      }
    }
    db.save();
    console.log(`✅ [Remarketing] Ciclo finalizado`);
  } catch (e) {
    console.error("Remarketing global error:", e.message);
  }
}

// ============================================
// DAILY AUTO-REPORT — 20h Brasilia
// ============================================
let lastReportDate = null;

function startDailyReport() {
  setInterval(async () => {
    try {
      const time = getBrasiliaTime();
      if (time.hora !== 20 || time.minuto > 4) return;

      const today = db.getBrasiliaDate();
      if (lastReportDate === today) return;
      lastReportDate = today;

      // Gather data
      const salesStats = db.getSalesStats();
      const contatosHoje = db.getContatosHoje();

      const conversasAtivas = { pedro: 0, rodrigo: 0, total: 0 };
      for (const agentId of AGENT_IDS) {
        db.state.conversations[agentId].forEach((conv, numero) => {
          if (conv.msgs && conv.msgs.length > 0 && !db.isPaused(agentId, numero)) {
            conversasAtivas[agentId]++;
            conversasAtivas.total++;
          }
        });
      }

      const metricsText = AGENT_IDS.map((id) => {
        const m = db.state.metrics[id];
        const agentSales = salesStats.porAgente[id] || { total: 0, valor: 0 };
        return `${CONFIG.AGENTS[id].name}: ${m.atendimentos} atendimentos, ${agentSales.total} vendas (R$${agentSales.valor})`;
      }).join("\n");

      // Find best agent
      let bestAgent = "nenhum";
      let bestVal = 0;
      for (const id of AGENT_IDS) {
        const agentSales = salesStats.porAgente[id] || { total: 0, valor: 0 };
        if (agentSales.valor > bestVal) {
          bestVal = agentSales.valor;
          bestAgent = CONFIG.AGENTS[id].name;
        }
      }

      // Count pending leads
      const customers = db.getCustomerList();
      const pendingLeads = customers.filter(c => c.status === "lead" || c.status === "negociando").length;

      const reportPrompt = `Voce e Aslam gerando o relatorio diario automatico das 20h para o Miron. Seja direto, objetivo e use numeros. Inclua insights acionaveis.`;

      const reportData = `RELATORIO DIARIO - ${today}

VENDAS HOJE: ${salesStats.hoje.total} vendas | R$${salesStats.hoje.valor}
VENDAS MES: ${salesStats.mes.total} vendas | R$${salesStats.mes.valor}
CONTATOS HOJE: ${contatosHoje.total} (Pedro: ${contatosHoje.pedro}, Rodrigo: ${contatosHoje.rodrigo})
CONVERSAS ATIVAS: ${conversasAtivas.total}
MELHOR AGENTE: ${bestAgent} (R$${bestVal})
LEADS PENDENTES: ${pendingLeads}

POR AGENTE:
${metricsText}

Gere um resumo executivo completo para o dono. Maximo 15 linhas.`;

      const report = await callClaude(reportPrompt, [{ role: "user", content: reportData }], { maxTokens: 800, timeout: 20000 });

      if (report) {
        await sendText("pedro", CONFIG.SEU_WHATSAPP, `*RELATORIO DIARIO ASLAM*\n${today}\n\n${report}`);
        db.addEvent(`Relatorio diario enviado ao Miron (${today})`);
        db.save();
        console.log(`Relatorio diario enviado - ${today}`);
      }
    } catch (e) {
      console.error("Daily report error:", e.message);
    }
  }, 5 * 60 * 1000);
}

// ============================================
// POST-SALE AUTOMATION — FEATURE 4
// Follow-ups: 24h, 3 days, 7 days after sale
// ============================================

function startPostSale() {
  // Check every hour
  setInterval(async () => {
    try {
      await runPostSale();
    } catch (e) {
      console.error("Post-sale global error:", e.message);
    }
  }, 60 * 60 * 1000);

  // Also run 5 min after startup
  setTimeout(async () => {
    try {
      await runPostSale();
    } catch (e) {
      console.error("Post-sale startup error:", e.message);
    }
  }, 5 * 60 * 1000);
}

async function runPostSale() {
  // Verificar horário comercial (08:00-18:00 seg-sex)
  if (!isDentroHorarioComercial()) return;

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  // Cleanup completed post-sale followups (stage >= 3, older than 30 days) to prevent unbounded growth
  const psKeys = Object.keys(db.state.postSaleFollowups);
  if (psKeys.length > 500) {
    for (const key of psKeys) {
      const fu = db.state.postSaleFollowups[key];
      if (fu.stage >= 3 && fu.lastSent && (now - fu.lastSent) > 30 * 24 * 60 * 60 * 1000) {
        delete db.state.postSaleFollowups[key];
      }
    }
  }

  // Find confirmed sales that need follow-up
  const confirmedSales = db.state.sales.filter(s => s.status === "confirmada");

  for (const sale of confirmedSales) {
    try {
      const saleId = sale.id;
      const saleTime = sale.createdAt || 0;
      const timeSinceSale = now - saleTime;
      const agentId = sale.agentId || "pedro";
      const numero = sale.numero;

      if (!numero) continue;

      // ABSOLUTE RULE: never send to paused numbers
      if (db.isPaused(agentId, numero)) continue;

      // Initialize tracking if not exists
      if (!db.state.postSaleFollowups[saleId]) {
        db.state.postSaleFollowups[saleId] = { stage: 0, lastSent: 0, agentId, numero, produto: sale.productName || "" };
      }

      const followup = db.state.postSaleFollowups[saleId];
      const agentName = CONFIG.AGENTS[agentId] ? CONFIG.AGENTS[agentId].name : agentId;
      const produto = followup.produto || sale.productName || "produto";

      // Stage 1: 24 hours after sale
      if (followup.stage === 0 && timeSinceSale >= oneDay) {
        // Final pause check
        if (db.isPaused(agentId, numero)) continue;

        const msg = `Oi! Aqui e o ${agentName} da Atacadao Variedades. Queria saber se voce recebeu tudo certinho e se esta gostando do ${produto}! Qualquer duvida estou por aqui \u{1F60A}`;
        await sendText(agentId, numero, msg);
        followup.stage = 1;
        followup.lastSent = now;
        db.addEvent(`Pos-venda stage 1 (24h): ${agentId} -> ${numero}`);
        db.save();
        console.log(`Pos-venda 24h: ${agentName} -> ${numero}`);
        await new Promise(r => setTimeout(r, 2000));
      }

      // Stage 2: 3 days after sale
      else if (followup.stage === 1 && timeSinceSale >= threeDays) {
        if (db.isPaused(agentId, numero)) continue;

        const msg = `Que bom ter voce como cliente! Se puder, deixa uma avaliacao pra gente no Google, ajuda muito! \u{1F64F}`;
        await sendText(agentId, numero, msg);
        followup.stage = 2;
        followup.lastSent = now;
        db.addEvent(`Pos-venda stage 2 (3d): ${agentId} -> ${numero}`);
        db.save();
        console.log(`Pos-venda 3d: ${agentName} -> ${numero}`);
        await new Promise(r => setTimeout(r, 2000));
      }

      // Stage 3: 7 days after sale — cross-sell
      else if (followup.stage === 2 && timeSinceSale >= sevenDays) {
        if (db.isPaused(agentId, numero)) continue;

        let msg;
        const produtoLower = produto.toLowerCase();
        if (produtoLower.includes("uni tv") || produtoLower.includes("tv")) {
          msg = `Aproveitando... temos a Furadeira 48V por R$${db.getAgentPrice("rodrigo")}. Sem fio, prática de usar, boa pra serviço e pra casa! Interesse?`;
        } else if (produtoLower.includes("furadeira") || produtoLower.includes("kit")) {
          msg = `Aproveitando... temos o Uni TV V10 que transforma qualquer TV em smart. R$${db.getAgentPrice("pedro")} — pago na entrega! Quer saber mais?`;
        } else {
          msg = `Aproveitando que voce ja e nosso cliente, temos novidades! Quer conhecer?`;
        }

        await sendText(agentId, numero, msg);
        followup.stage = 3;
        followup.lastSent = now;
        db.addEvent(`Pos-venda stage 3 (7d cross-sell): ${agentId} -> ${numero}`);
        db.save();
        console.log(`Pos-venda 7d cross-sell: ${agentName} -> ${numero}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`Post-sale error for sale ${sale.id}:`, e.message);
    }
  }
}

// ============================================
// MODO JARVIS — Aslam com poderes de DEV
// Lê, edita código, faz deploy, reinicia sistema
// ============================================

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ALLOWED_EXTENSIONS = [".js", ".json", ".md", ".yaml", ".yml", ".html", ".css", ".env.example", ".toml"];
const BLOCKED_PATTERNS = [/node_modules/, /\.git\//, /package-lock/, /\.env$/];

function isPathSafe(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) return false;
  if (BLOCKED_PATTERNS.some(p => p.test(resolved))) return false;
  return true;
}

// Ferramentas disponíveis para o Aslam no modo Jarvis
const JARVIS_TOOLS = [
  {
    name: "ler_arquivo",
    description: "Lê o conteúdo de um arquivo do sistema. Use para entender o código antes de modificar.",
    input_schema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "Caminho relativo do arquivo (ex: src/agents.js, src/aslam.js, index.js)" },
        linha_inicio: { type: "number", description: "Linha inicial (opcional, default 1)" },
        linha_fim: { type: "number", description: "Linha final (opcional, default todas)" },
      },
      required: ["caminho"],
    },
  },
  {
    name: "editar_arquivo",
    description: "Edita um arquivo do sistema substituindo um trecho de texto por outro. SEMPRE leia o arquivo antes para ter certeza do conteúdo exato.",
    input_schema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "Caminho relativo do arquivo" },
        texto_antigo: { type: "string", description: "Texto EXATO que será substituído (copie do arquivo, incluindo espaços)" },
        texto_novo: { type: "string", description: "Novo texto que substituirá o antigo" },
      },
      required: ["caminho", "texto_antigo", "texto_novo"],
    },
  },
  {
    name: "listar_arquivos",
    description: "Lista arquivos e pastas de um diretório do projeto.",
    input_schema: {
      type: "object",
      properties: {
        diretorio: { type: "string", description: "Diretório relativo (ex: src, ./, src/)" },
      },
      required: ["diretorio"],
    },
  },
  {
    name: "buscar_no_codigo",
    description: "Busca um texto ou padrão em todos os arquivos .js do projeto. Use para encontrar onde algo está definido.",
    input_schema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "Texto ou padrão para buscar" },
        extensao: { type: "string", description: "Extensão do arquivo (default: .js)" },
      },
      required: ["termo"],
    },
  },
  {
    name: "deploy",
    description: "Faz commit das mudanças e push para o GitHub, que trigga deploy automático no Railway. Use DEPOIS de editar arquivos.",
    input_schema: {
      type: "object",
      properties: {
        mensagem: { type: "string", description: "Mensagem do commit (ex: fix: corrigir bug no Pedro)" },
      },
      required: ["mensagem"],
    },
  },
  {
    name: "reiniciar_sistema",
    description: "Reinicia o sistema para aplicar mudanças em arquivos que já foram editados. No Railway, o container reinicia automaticamente.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Motivo do reinício" },
      },
      required: ["motivo"],
    },
  },
  {
    name: "ver_logs",
    description: "Vê eventos recentes do sistema, métricas dos agentes e status geral.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["eventos", "metricas", "instrucoes", "erros"], description: "Tipo de informação" },
      },
      required: ["tipo"],
    },
  },
  {
    name: "executar_comando",
    description: "Executa um comando shell seguro no servidor. Apenas comandos de leitura e git são permitidos.",
    input_schema: {
      type: "object",
      properties: {
        comando: { type: "string", description: "Comando a executar (ex: git status, git log --oneline -5, node -e 'code')" },
      },
      required: ["comando"],
    },
  },
  // === OBSIDIAN TOOLS (acesso ao vault 24/7 via GitHub) ===
  {
    name: "ler_nota_obsidian",
    description: "Lê uma nota do Obsidian vault. Use para consultar treinamentos, erros conhecidos, changelogs, regras de negócio, guias, produtos.",
    input_schema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "Caminho da nota no vault (ex: 'Base de Conhecimento/Vendas/Guia de Treinamento de Agentes IA.md', 'Erros e Solucoes/Erros Atacadao Sistema.md', 'Regras de Negocio.md')" },
      },
      required: ["caminho"],
    },
  },
  {
    name: "buscar_obsidian",
    description: "Busca um termo em todas as notas do Obsidian. Use para encontrar informações sobre qualquer assunto no vault.",
    input_schema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "Texto para buscar nas notas" },
        diretorio: { type: "string", description: "Diretório para filtrar busca (opcional, ex: 'Erros e Solucoes', 'Base de Conhecimento/Vendas')" },
      },
      required: ["termo"],
    },
  },
  {
    name: "listar_notas_obsidian",
    description: "Lista notas e pastas de um diretório do Obsidian vault.",
    input_schema: {
      type: "object",
      properties: {
        diretorio: { type: "string", description: "Diretório para listar (ex: '', 'Projetos', 'Erros e Solucoes', 'Base de Conhecimento')" },
      },
      required: [],
    },
  },
  {
    name: "atualizar_nota_obsidian",
    description: "Atualiza ou cria uma nota no Obsidian vault. Use para registrar mudanças no changelog, novos erros, decisões.",
    input_schema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "Caminho da nota (ex: 'Memoria Claude/Changelog Geral.md')" },
        conteudo: { type: "string", description: "Conteúdo completo da nota (markdown)" },
        mensagem: { type: "string", description: "Mensagem do commit (ex: '[Jarvis] Atualizar changelog')" },
      },
      required: ["caminho", "conteudo"],
    },
  },
  // === GITHUB CODE TOOLS (acesso ao código 24/7) ===
  {
    name: "ver_codigo_github",
    description: "Lê um arquivo do repositório atacadao-sistema no GitHub. Funciona mesmo quando o sistema local está indisponível.",
    input_schema: {
      type: "object",
      properties: {
        caminho: { type: "string", description: "Caminho do arquivo no repo (ex: 'src/agents.js', 'index.js', 'package.json')" },
      },
      required: ["caminho"],
    },
  },
  {
    name: "ver_commits_recentes",
    description: "Mostra os commits mais recentes do repositório atacadao-sistema no GitHub.",
    input_schema: {
      type: "object",
      properties: {
        quantidade: { type: "number", description: "Quantos commits mostrar (default: 10, max: 30)" },
      },
      required: [],
    },
  },
];

// Comandos shell permitidos
const ALLOWED_COMMANDS = [
  /^git\s+(status|log|diff|branch|show|remote)/,
  /^node\s+-e\s+/,
  /^npm\s+(test|run\s+lint)/,
  /^ls\s/,
  /^cat\s/,
  /^grep\s/,
  /^wc\s/,
];

const DANGEROUS_COMMANDS = [/rm\s/, /del\s/, /rmdir/, /format/, /drop\s/i, /truncate/i, /kill/, /taskkill/];

// Executor de ferramentas
async function executeJarvisToolFn(name, input) {
  switch (name) {
    case "ler_arquivo": {
      const filePath = path.resolve(PROJECT_ROOT, input.caminho);
      if (!isPathSafe(input.caminho)) return "ERRO: Caminho bloqueado ou fora do projeto";
      if (!fs.existsSync(filePath)) return `ERRO: Arquivo nao encontrado: ${input.caminho}`;
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      const start = (input.linha_inicio || 1) - 1;
      const end = input.linha_fim || lines.length;
      // Limitar leitura a 200 linhas por vez para nao poluir o contexto
      const maxLines = 200;
      const actualEnd = Math.min(end, start + maxLines);
      const slice = lines.slice(start, actualEnd);
      let result = slice.map((l, i) => `${start + i + 1}: ${l}`).join("\n");
      if (actualEnd < end) {
        result += `\n\n[TRUNCADO: mostrando linhas ${start+1}-${actualEnd} de ${lines.length} total. Use linha_inicio/linha_fim para ler outras partes.]`;
      }
      return result;
    }

    case "editar_arquivo": {
      const filePath = path.resolve(PROJECT_ROOT, input.caminho);
      if (!isPathSafe(input.caminho)) return "ERRO: Caminho bloqueado ou fora do projeto";
      if (!fs.existsSync(filePath)) return `ERRO: Arquivo nao encontrado: ${input.caminho}`;
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes(input.texto_antigo)) {
        return `ERRO: Texto antigo NAO encontrado no arquivo. Leia o arquivo primeiro para copiar o texto EXATO.\nTrecho buscado (primeiros 200 chars): ${input.texto_antigo.slice(0, 200)}`;
      }
      const count = content.split(input.texto_antigo).length - 1;
      if (count > 1) return `ERRO: Texto encontrado ${count} vezes. Inclua mais contexto para ser unico.`;
      const newContent = content.replace(input.texto_antigo, input.texto_novo);
      // Backup antes de editar
      const backupPath = filePath + ".jarvis-backup";
      fs.writeFileSync(backupPath, content, "utf8");
      fs.writeFileSync(filePath, newContent, "utf8");
      db.addEvent(`[JARVIS] Editou ${input.caminho} (backup em .jarvis-backup)`);
      return `OK: Arquivo ${input.caminho} editado com sucesso. Backup salvo. Mudanca: ${input.texto_antigo.slice(0, 50)} → ${input.texto_novo.slice(0, 50)}`;
    }

    case "listar_arquivos": {
      const dirPath = path.resolve(PROJECT_ROOT, input.diretorio || ".");
      if (!dirPath.startsWith(PROJECT_ROOT)) return "ERRO: Diretorio fora do projeto";
      if (!fs.existsSync(dirPath)) return `ERRO: Diretorio nao encontrado: ${input.diretorio}`;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
        .map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
        .join("\n");
    }

    case "buscar_no_codigo": {
      const ext = input.extensao || ".js";
      const results = [];
      function searchDir(dir) {
        if (results.length >= 20) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            searchDir(full);
          } else if (entry.name.endsWith(ext)) {
            try {
              const content = fs.readFileSync(full, "utf8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(input.termo.toLowerCase())) {
                  const rel = path.relative(PROJECT_ROOT, full);
                  results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
                  if (results.length >= 20) return;
                }
              }
            } catch (e) { /* skip binary files */ }
          }
        }
      }
      searchDir(PROJECT_ROOT);
      return results.length > 0 ? results.join("\n") : `Nenhum resultado para "${input.termo}" em arquivos ${ext}`;
    }

    case "deploy": {
      try {
        const status = execSync("git status --short", { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 10000 });
        if (!status.trim()) return "Nenhuma mudanca para deploy. Git esta limpo.";
        execSync("git add -A", { cwd: PROJECT_ROOT, timeout: 10000 });
        execSync(`git commit -m "${input.mensagem.replace(/"/g, '\\"')}"`, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 15000 });
        const pushResult = execSync("git push origin main 2>&1", { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30000 });
        db.addEvent(`[JARVIS] Deploy: ${input.mensagem}`);
        return `DEPLOY OK!\nCommit: ${input.mensagem}\nPush: ${pushResult.slice(0, 300)}\nRailway vai fazer deploy automatico em ~1 min.`;
      } catch (e) {
        return `ERRO no deploy: ${e.message.slice(0, 500)}`;
      }
    }

    case "reiniciar_sistema": {
      db.addEvent(`[JARVIS] Reinicio solicitado: ${input.motivo}`);
      db.save();
      // Agendar reinício em 3 segundos para dar tempo de enviar resposta
      setTimeout(() => {
        console.log(`[JARVIS] Reiniciando sistema: ${input.motivo}`);
        process.exit(0); // Railway reinicia automaticamente
      }, 3000);
      return `Sistema sera reiniciado em 3 segundos. Motivo: ${input.motivo}. Railway reinicia automaticamente.`;
    }

    case "ver_logs": {
      switch (input.tipo) {
        case "eventos":
          return (db.state.events || []).slice(-15).map(e => `[${e.time || "?"}] ${e.text}`).join("\n") || "Nenhum evento";
        case "metricas":
          return AGENT_IDS.map(id => {
            const m = db.state.metrics[id] || {};
            return `${id}: ${m.atendimentos || 0} atend, ${m.vendas || 0} vendas, ${m.faturamento || 0} faturamento`;
          }).join("\n");
        case "instrucoes":
          return AGENT_IDS.map(id => {
            const insts = db.state.instructions[id] || [];
            return `${id}: ${insts.length} instrucoes${insts.length > 0 ? "\n  " + insts.map((inst, i) => `${i + 1}. ${typeof inst === "string" ? inst : inst.regras || JSON.stringify(inst)}`).join("\n  ") : ""}`;
          }).join("\n");
        case "erros":
          return "Ultimos erros do console nao ficam salvos em banco. Use 'ver_logs eventos' para ver eventos recentes.";
        default:
          return "Tipo invalido. Use: eventos, metricas, instrucoes, erros";
      }
    }

    case "executar_comando": {
      const cmd = input.comando.trim();
      if (DANGEROUS_COMMANDS.some(p => p.test(cmd))) return "ERRO: Comando perigoso bloqueado.";
      // Git push e commit são permitidos para o Jarvis
      const isGitWrite = /^git\s+(push|commit|add)/.test(cmd);
      const isAllowed = ALLOWED_COMMANDS.some(p => p.test(cmd)) || isGitWrite;
      if (!isAllowed) return `ERRO: Comando nao permitido. Comandos permitidos: git (status/log/diff/push/commit/add), node -e, npm test, ls, cat, grep, wc`;
      try {
        const result = execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
        return result.slice(0, 5000) || "(sem output)";
      } catch (e) {
        return `ERRO: ${(e.stderr || e.message || "").slice(0, 1000)}`;
      }
    }

    // === OBSIDIAN TOOLS ===
    case "ler_nota_obsidian": {
      return await obsidianApi.lerNota(input.caminho);
    }
    case "buscar_obsidian": {
      return await obsidianApi.buscarObsidian(input.termo, input.diretorio);
    }
    case "listar_notas_obsidian": {
      return await obsidianApi.listarNotas(input.diretorio || "");
    }
    case "atualizar_nota_obsidian": {
      return await obsidianApi.atualizarNota(input.caminho, input.conteudo, input.mensagem);
    }
    // === GITHUB CODE TOOLS ===
    case "ver_codigo_github": {
      return await obsidianApi.lerCodigoGithub(input.caminho);
    }
    case "ver_commits_recentes": {
      return await obsidianApi.verCommitsRecentes(input.quantidade || 10);
    }

    default:
      return `Tool "${name}" nao reconhecida`;
  }
}

// Registrar executor no services
setJarvisExecutor(executeJarvisToolFn);

// System prompt do modo Jarvis (extende o Aslam normal)
const JARVIS_SYSTEM_PROMPT = `Voce e Aslam no MODO JARVIS — igual ao Jarvis do Homem de Ferro.
Voce e a SUPER MAQUINA do Miron. Tem acesso TOTAL a tudo: codigo, Obsidian, GitHub, logs, deploy.

=== SEUS 15 PODERES ===

CODIGO (local):
1. ler_arquivo — Ler qualquer arquivo do projeto
2. editar_arquivo — Editar codigo para corrigir bugs ou adicionar features
3. listar_arquivos — Navegar pela estrutura do projeto
4. buscar_no_codigo — Buscar texto em todos os .js
5. deploy — Git commit + push = Railway deploy automatico
6. reiniciar_sistema — Restart (Railway reinicia sozinho)
7. ver_logs — Eventos, metricas, instrucoes, erros
8. executar_comando — Comandos shell seguros

OBSIDIAN (base de conhecimento, funciona 24/7):
9. ler_nota_obsidian — Ler qualquer nota do vault
10. buscar_obsidian — Buscar informacao em todas as notas
11. listar_notas_obsidian — Navegar pelas pastas do vault
12. atualizar_nota_obsidian — Criar ou atualizar notas

GITHUB (acesso remoto ao codigo, funciona 24/7):
13. ver_codigo_github — Ler arquivo do repo no GitHub
14. ver_commits_recentes — Ver historico de mudancas

=== MAPA DO OBSIDIAN VAULT ===
Use isto para saber ONDE buscar cada informacao:

📁 Base de Conhecimento/
  📁 Vendas/ — Guia de treinamento dos agentes, SPIN Selling, livros, mentores, scripts WhatsApp
    📄 Guia de Treinamento de Agentes IA.md — 10 REGRAS DE OURO dos agentes (SPIN, Cialdini, FBI)
    📁 Livros/ — Resumos: SPIN Selling, Armas da Persuasao, FBI, Receita Previsivel
    📁 Mentores/ — Flavio Augusto, Caio Carneiro, Lasaro do Carmo, Alfredo Soares
    📁 Scripts WhatsApp/ — Modelos de remarketing, roteiros
    📁 SPIN Selling/ — Perguntas, estrategias
  📁 Marketing/ — Email marketing, e-books, aulas
  📁 Trafego/ — Facebook Ads, Google Ads, ferramentas
  📁 Produtos/ — Importacao, planilhas
  📁 Financeiro/ — Investimentos

📁 Projetos/
  📁 Atacadao Sistema/ — Nota principal + changelog + catalogo produtos
  📁 Central de Comando/ — Dashboard autonomo
  📁 AI Sales OS/ — SaaS de vendas
  📁 AMIAX SaaS/ — White-label

📁 Erros e Solucoes/ — CONSULTE ANTES DE CORRIGIR QUALQUER BUG
  📄 Erros Atacadao Sistema.md — 27+ bugs documentados com solucoes
  📄 Erros Gerais de Infraestrutura.md — Railway, Docker, Node.js
  📄 Erros Baileys Server.md — WhatsApp Baileys
  📄 Erros Central de Comando.md
  📄 Erros AI Sales OS.md

📁 Memoria Claude/
  📄 Changelog Geral.md — Historico de TODAS as mudancas em todos projetos

📄 Regras de Negocio.md — Regras inviolaveis do negocio (precos, frete, entrega)

=== QUANDO USAR O OBSIDIAN ===
- Miron pergunta sobre treinamento/vendas → ler_nota_obsidian "Base de Conhecimento/Vendas/Guia de Treinamento de Agentes IA.md"
- Antes de corrigir um bug → ler_nota_obsidian "Erros e Solucoes/Erros Atacadao Sistema.md" (ver se ja foi resolvido)
- Miron pergunta sobre regras do negocio → ler_nota_obsidian "Regras de Negocio.md"
- Miron pergunta sobre produtos → ler_nota_obsidian "Projetos/Atacadao Sistema/Produtos/Catalogo Completo.md"
- Apos fazer qualquer mudanca no sistema → atualizar_nota_obsidian nos changelogs
- Buscar qualquer assunto → buscar_obsidian com o termo

=== FLUXO DE TRABALHO ===
CORRIGIR PROBLEMAS:
1. Consulte "Erros e Solucoes/" para ver se o bug ja foi documentado
2. ENTENDA o problema (leia o codigo relevante)
3. BUSQUE no codigo para encontrar a causa raiz
4. EDITE o arquivo para corrigir
5. FACA DEPLOY
6. ATUALIZE o changelog no Obsidian

ANALISAR/MELHORAR:
1. Leia a nota relevante no Obsidian
2. Compare com o codigo atual
3. Sugira melhorias baseadas no conhecimento do vault
4. Execute se autorizado

=== REGRAS ===
- SEMPRE leia o arquivo antes de editar (para ter o texto exato)
- Faca backup automatico (o sistema ja faz .jarvis-backup)
- Explique suas mudancas de forma simples para o Miron
- Se nao tiver certeza, pergunte antes de mudar
- Priorize seguranca: nunca delete dados, sempre faca backup
- Tom: direto, confiante, executivo. Voce RESOLVE, nao diz "nao consigo".

EFICIENCIA (CRITICO):
- Voce tem no maximo 25 chamadas de ferramentas. USE COM SABEDORIA.
- Para perguntas simples: responda DIRETO sem usar ferramentas.
- Para ler arquivos grandes: use linha_inicio/linha_fim para ler APENAS a parte relevante.
- Use buscar_no_codigo para achar a localizacao ANTES de ler o arquivo inteiro.
- NAO leia multiplos arquivos "por precaucao". Leia APENAS o necessario.
- Se a pergunta do Miron e uma pergunta simples ou saudacao, responda SEM usar tools.

=== ARQUITETURA DO SISTEMA ===
- src/agents.js — Prompts e logica dos agentes Pedro e Rodrigo
- src/aslam.js — Sua propria logica (cuidado ao editar!)
- src/services.js — Claude API, WhatsApp, frete, sanitize
- src/database.js — Redis + JSON, estado, conversas, metricas
- src/routes.js — Endpoints HTTP, webhooks
- src/config.js — Variaveis de ambiente, configuracoes
- src/obsidian-api.js — Acesso ao Obsidian vault via GitHub API
- src/baileys.js — WhatsApp Baileys integration
- index.js — Entry point, monitores
- dashboard.html — Dashboard web

`;

// Detectar se a mensagem do Miron precisa do modo Jarvis
function needsJarvisMode(msg) {
  const lower = msg.toLowerCase();
  const jarvisKeywords = [
    /(?:modo?\s*)?jarvis/,
    /(?:muda|altera|edita|corrig[ei]|conserta|arruma|fix[ae])\s+(?:o\s+)?(?:codigo|code|prompt|sistema|arquivo|script)/,
    /(?:deploy|publica|sobe|suba)\s+(?:o\s+)?(?:sistema|codigo|mudanca|alteracao)/,
    /(?:reinicia|restart|reinicie)\s+(?:o\s+)?(?:sistema|servidor|server)/,
    /bug\s+(?:no|na|do|da|em|que|de)\s/,
    /(?:olha|ve|mostra|abre)\s+(?:o\s+)?(?:codigo|code|arquivo|script|src|log)/,
    /(?:porque|por\s*que)\s+(?:o|a|os|as)\s+(?:pedro|rodrigo)\s+(?:nao|n[aã]o|ta|tá|esta|está)\s/,
    /(?:poder|pode)\s+(?:sobre|no|do)\s+(?:codigo|sistema)/,
    /(?:investiga|analisa|diagnostica|descobre)\s+(?:o\s+)?(?:problema|bug|erro|falha)/,
    /(?:como|onde)\s+(?:funciona|esta|fica|ta)\s+(?:o|a|no|na)\s/,
  ];
  return jarvisKeywords.some(p => p.test(lower));
}

// Fluxo principal do Jarvis
async function handleJarvisMode(msg, contextPrompt) {
  const chatHistory = db.state.aslamChat.slice(-6).map(m => ({
    role: m.role,
    content: sanitize(m.content || m.text || ""),
  }));
  chatHistory.push({ role: "user", content: sanitize(msg) });

  const fullPrompt = `${JARVIS_SYSTEM_PROMPT}\n\n${contextPrompt}`;

  console.log("[JARVIS] Ativado para:", msg.slice(0, 100));

  const result = await callClaudeWithTools(fullPrompt, chatHistory, JARVIS_TOOLS, {
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    timeout: 90000,
    maxIterations: 25,
  });

  if (!result.text) {
    return "Modo Jarvis encontrou um problema. Tente de novo ou descreva melhor o que precisa.";
  }

  return result.text;
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  handleAslamChat,
  filterResponse,
  monitorLeads,
  dailySweep,
  startRemarketing,
  startDailyReport,
  startPostSale,
  handleMeetingMessage,
  notifyMiron,
  handleJarvisMode,
  needsJarvisMode,
  JARVIS_TOOLS,
};

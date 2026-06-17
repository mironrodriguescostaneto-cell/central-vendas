// ============================================
// FOLLOW-UP ENGINE — Retomada Inteligente v1.0
// Camada 1: Análise determinística da conversa
// Camada 2: Geração de mensagem personalizada via Gemini
// ============================================
"use strict";

const { callClaude, sanitize } = require("./services-atk");

// ── PADRÕES DE DETECÇÃO ──────────────────────

const EXPLICIT_REFUSAL_RE =
  /para\s+de\s+me\s+(chamar|mandar|enviar)|n[aã]o\s+quero\s+mais\s+(mensagem|contato|isso)|me\s+tira\s+da\s+lista|n[aã]o\s+me\s+chame|n[aã]o\s+tenho\s+interesse\s+nenhum|me\s+remove|cancela\s+(tudo|minha\s+compra)|para\s+de\s+me\s+incomodar/i;

// ── ANÁLISE DE CONVERSA ──────────────────────

/**
 * Analisa o histórico e retorna um perfil estruturado do cliente.
 * Toda lógica aqui é determinística — sem chamada de IA, sem custo.
 *
 * @param {Array} msgs - Array de mensagens da conversa
 * @param {string} agentId - ID do agente (pedro, rodrigo)
 * @returns {Object} Perfil do cliente
 */
function analyzeConversation(msgs, agentId) {
  if (!msgs || msgs.length === 0) return _emptyProfile();

  const clientMsgs = msgs.filter(m => m.role === "user" && !_isSystemMsg(m));
  const agentMsgs  = msgs.filter(m => m.role === "assistant");
  const allClient  = clientMsgs.map(m => (m.content || "").toLowerCase()).join(" ");

  // Contadores de tentativas anteriores (por tag inserida ao enviar)
  const followupCount    = msgs.filter(m => m._type === "followup").length;
  const remarketingCount = msgs.filter(m => m._type === "remarketing").length;

  // Mensagens consecutivas ignoradas no final do histórico
  let consecutiveIgnored = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user" && !_isSystemMsg(msgs[i])) break;
    if (msgs[i].role === "assistant") consecutiveIgnored++;
  }

  // ── Estágio da conversa ──────────────────────
  let stage = "initial";
  const hasPayment  = /pix|cart[aã]o|parcela|pagar|pagamento|parcelado/.test(allClient);
  const hasDelivery = /frete|entrega|retirar|buscar|envio|km|distancia/.test(allClient);
  const hasPrice    = /preco|valor|quanto\s+custa|custa|barato|caro/.test(allClient);

  if (hasPayment)       stage = "payment_inquiry";
  else if (hasDelivery) stage = "delivery_inquiry";
  else if (hasPrice)    stage = "price_inquiry";
  else if (clientMsgs.length >= 4) stage = "engaged";

  // Chegou perto de comprar mas sumiu
  if ((stage === "payment_inquiry" || stage === "delivery_inquiry") && consecutiveIgnored >= 1) {
    stage = "almost_closed_ghosted";
  }
  // Recebeu frete calculado e sumiu (estágio específico — alto potencial de conversão)
  const gotFreteInfo = msgs.some(m =>
    m.role === "assistant" && /Total a vista: R\$\d+/.test(m.content || "")
  );
  const clientRespondedAfterFrete = (() => {
    const idxFrete = msgs.findIndex(m => m.role === "assistant" && /Total a vista: R\$\d+/.test(m.content || ""));
    if (idxFrete < 0) return false;
    return msgs.slice(idxFrete + 1).some(m => m.role === "user" && !_isSystemMsg(m));
  })();
  if (gotFreteInfo && !clientRespondedAfterFrete && consecutiveIgnored >= 1) {
    stage = "freight_ghosted";
  }

  // Cliente perguntou preço, recebeu, sumiu — sem avançar para entrega/pagamento
  if (stage === "price_inquiry" && consecutiveIgnored >= 1) {
    stage = "price_ghosted";
  }

  // Category F: recebeu apresentação (video/foto) mas não respondeu depois
  if ((stage === "initial" || stage === "engaged") && consecutiveIgnored >= 1) {
    let lastPresIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && ((msgs[i].content || "").includes("ENVIAR_VIDEO") || (msgs[i].content || "").includes("ENVIAR_FOTO"))) {
        lastPresIdx = i;
        break;
      }
    }
    if (lastPresIdx >= 0 && !msgs.slice(lastPresIdx + 1).some(m => m.role === "user" && !_isSystemMsg(m))) {
      stage = "presentation_ghosted";
    }
  }

  // Category A: demonstrou interesse inicial e sumiu (1+ msgs sem tópico de preço/entrega/pagamento)
  if (stage === "initial" && clientMsgs.length >= 1 && consecutiveIgnored >= 1) {
    stage = "early_interest";
  }

  // ── Objeção principal ─────────────────────────
  let mainObjection = "none";
  if (/[eé]\s+(seguro|confi[aá]vel|verdadeiro|golpe|fraude|pirata)|ser[aá]\s+que\s+[eé]/i.test(allClient)) {
    mainObjection = "trust";
  } else if (/caro|muito\s+(caro|alto)|n[aã]o\s+tenho\s+tanto|acima\s+do\s+meu|fora\s+do\s+meu/.test(allClient)) {
    mainObjection = "price";
  } else if (/vou\s+pensar|depois\s+vejo|mais\s+tarde|semana\s+que\s+vem|m[eê]s\s+que\s+vem|n[aã]o\s+agora|deixa\s+eu\s+ver/.test(allClient)) {
    mainObjection = "timing";
  } else if (/frete\s+(alto|caro|saiu\s+caro)|muito\s+longe|distancia\s+grande/.test(allClient)) {
    mainObjection = "freight_cost";
  } else if (/n[aã]o\s+preciso|n[aã]o\s+quero|n[aã]o\s+uso|n[aã]o\s+tenho\s+interesse/.test(allClient)) {
    mainObjection = "no_need";
  }

  // ── Interesse principal ───────────────────────
  let mainInterest = "general";
  if (agentId === "pedro") {
    if (/futebol|copa|libertadores|campeonato|brasileir[ao]|premier|champions|serie\s+a|esporte|jogo/.test(allClient)) {
      mainInterest = "football";
    } else if (/filme|serie|netflix|prime|disney|youtube|streaming|conteudo/.test(allClient)) {
      mainInterest = "movies";
    } else if (/canais?|ao\s+vivo|tv\s+aberta|globo|sbt|band|record/.test(allClient)) {
      mainInterest = "live_channels";
    }
  } else if (agentId === "rodrigo") {
    if (/trabalho|profissional|obra|constru[cç][aã]o|marceneiro|pedreiro|empreit|servico/.test(allClient)) {
      mainInterest = "professional_use";
    } else if (/casa|reforma|conserto|dom[eé]stic|quintal|parede|prateleira/.test(allClient)) {
      mainInterest = "home_use";
    }
  }

  // ── Tom do cliente ────────────────────────────
  let toneProfile = "neutral";
  if (/obrigad[ao]|valeu|legal|muito\s+bom|[oó]timo|bacana|gostei|interessei|show/.test(allClient)) {
    toneProfile = "friendly";
  } else if (EXPLICIT_REFUSAL_RE.test(allClient) || /n[aã]o\s+obrigad[ao]|n[aã]o\s+preciso|desisti|outro\s+dia/.test(allClient)) {
    toneProfile = "resistant";
  } else if (clientMsgs.length <= 1) {
    toneProfile = "cautious";
  } else if (/\?{2,}|o\s+que\s+[eé]|como\s+funciona|pode\s+explicar|me\s+conta\s+mais/.test(allClient)) {
    toneProfile = "curious";
  }

  // ── Temperatura do lead ───────────────────────
  let leadTemperature;
  if (hasPayment) {
    leadTemperature = "hot";
  } else if (hasDelivery || (hasPrice && clientMsgs.length >= 3)) {
    leadTemperature = "warm";
  } else if (clientMsgs.length >= 4) {
    leadTemperature = "warm";
  } else if (clientMsgs.length <= 1 || toneProfile === "resistant") {
    leadTemperature = "frozen";
  } else {
    leadTemperature = "cold";
  }

  // ── Último assunto discutido ──────────────────
  const lastClientMsg = clientMsgs[clientMsgs.length - 1];
  const lastContent = ((lastClientMsg || {}).content || "").toLowerCase();
  let lastTopic = "produto";
  if (/frete|entrega|retirar|km/.test(lastContent))       lastTopic = "entrega";
  else if (/preco|valor|desconto/.test(lastContent))       lastTopic = "preco";
  else if (/pix|pagar|parcela|cart[aã]o/.test(lastContent)) lastTopic = "pagamento";
  else if (/futebol|copa|esporte/.test(lastContent))        lastTopic = "futebol";
  else if (/filme|serie/.test(lastContent))                 lastTopic = "filmes";
  else if (/garantia|troca|suporte/.test(lastContent))      lastTopic = "garantia";

  return {
    stage,
    mainObjection,
    mainInterest,
    lastTopic,
    toneProfile,
    leadTemperature,
    consecutiveIgnored,
    followupCount,
    remarketingCount,
    clientMsgCount: clientMsgs.length,
    hasPaymentSignal: hasPayment,
    hasDeliverySignal: hasDelivery,
    hasPriceSignal: hasPrice,
    explicitRefusal: EXPLICIT_REFUSAL_RE.test(allClient),
  };
}

// ── NÍVEL DE INSISTÊNCIA ─────────────────────

/**
 * Decide até onde vale insistir com esse cliente.
 *
 * STOP       → parar imediatamente (opt-out, lead queimado, muitas tentativas)
 * LAST_CHANCE → última tentativa gentil, abordagem diferente
 * LIGHT      → tom suave, sem pressão
 * NORMAL     → abordagem direta e amigável
 *
 * @param {Object} conv - Objeto de conversa (do db)
 * @param {Object} profile - Perfil gerado por analyzeConversation
 * @returns {"STOP"|"LAST_CHANCE"|"LIGHT"|"NORMAL"}
 */
function getInsistenceLevel(conv, profile) {
  const total      = profile.followupCount + profile.remarketingCount;
  const consec     = profile.consecutiveIgnored;

  // Opt-out explícito — nunca mais
  if (conv.doNotFollowUp || profile.explicitRefusal) return "STOP";

  // Resistente + 2+ tentativas = queimado
  if (profile.toneProfile === "resistant" && total >= 2) return "STOP";

  // Lead congelado + 3+ tentativas sem avanço
  if (profile.leadTemperature === "frozen" && total >= 3) return "STOP";

  // Ignorou 5+ mensagens consecutivas OU 7+ tentativas total
  if (consec >= 5 || total >= 7) return "STOP";

  // 3-4 ignoradas OU 4-6 tentativas total
  if (consec >= 3 || total >= 4) return "LAST_CHANCE";

  // 2 ignoradas OU 2-3 tentativas total
  if (consec >= 2 || total >= 2) return "LIGHT";

  // Lead frio → tom leve por padrão
  if (profile.leadTemperature === "cold") return "LIGHT";

  return "NORMAL";
}

// ── GERAÇÃO DE MENSAGEM ──────────────────────

/**
 * Gera uma mensagem de retomada personalizada via Gemini.
 *
 * @param {Object} opts
 * @param {string} opts.agentId
 * @param {string} opts.agentName
 * @param {Object} opts.profile - Resultado de analyzeConversation
 * @param {string} opts.insistenceLevel - Resultado de getInsistenceLevel
 * @param {Object} opts.prodInfo - { product, price }
 * @param {string} opts.instrucaoBonus - Instrução extra do dono (desconto, etc.)
 * @param {string} opts.lastMsgsText - Histórico recente formatado como string
 * @returns {Promise<string|null>}
 */
async function generateRetakeMessage({ agentId, agentName, clientName, profile, insistenceLevel, prodInfo, instrucaoBonus, lastMsgsText }) {
  if (insistenceLevel === "STOP") return null;

  const systemPrompt = _buildRetakePrompt({ agentId, agentName, clientName, profile, insistenceLevel, prodInfo, instrucaoBonus });

  const userContent = [
    "Historico recente da conversa:",
    lastMsgsText || "(sem historico disponivel)",
    "",
    "Gere APENAS a mensagem de retomada (sem prefixo, sem titulo, sem saudacao formal):",
  ].join("\n");

  const raw = await callClaude(
    systemPrompt,
    [{ role: "user", content: userContent }],
    { maxTokens: 100, timeout: 12000 }
  );

  if (!raw) return null;
  const clean = sanitize(_cleanMsg(raw));
  const normalized = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").trim();
  if (/^(eai|oi|ola|opa|bom dia|boa tarde|boa noite|tudo bem|e ai)$/.test(normalized)) return null;
  if (normalized.length < 18) return null;
  if (clean.length > 35 && !/[.!?)]$/.test(clean.trim())) return null;
  return clean;
}

// ── PROMPT BUILDER ───────────────────────────

function _buildRetakePrompt({ agentId, agentName, clientName, profile, insistenceLevel, prodInfo, instrucaoBonus }) {
  const { stage, mainObjection, mainInterest, lastTopic } = profile;

  const productLine = prodInfo.price
    ? `Produto: ${prodInfo.product} — R$${prodInfo.price}. NUNCA altere esse preco.`
    : `Produto: ${prodInfo.product}.`;

  const nomeCliente = clientName ? `Chame o cliente de "${clientName}".` : `Chame o cliente de "voce" (nao tem nome registrado).`;
  const baseRules = `Voce e ${agentName} da Atacadao Variedades. ${productLine} REGRAS ABSOLUTAS: max 2 linhas. Linguagem natural de WhatsApp. Mencione algo REAL e ESPECIFICO do historico (nao invente). Nao repita o que ja foi enviado antes. Sem headers, titulos, prefixos, saudacao longa. ${nomeCliente} NUNCA invente valores de frete, total ou parcelas — se o historico nao tiver esses valores, nao os mencione. Se o historico mostrar um total calculado, use ESSE VALOR EXATO.`;

  const intensityMap = {
    NORMAL:      "Tom amigavel e direto. Pode ser proativo.",
    LIGHT:       "Tom suave. Gere curiosidade, sem pressao. Nenhuma urgencia.",
    LAST_CHANCE: "Esta e uma ultima tentativa. Abordagem completamente diferente das anteriores. Sem pressao. Se nao responder, vai ser encerrado automaticamente.",
  };
  const intensity = intensityMap[insistenceLevel] || intensityMap.NORMAL;

  // Angulo comercial baseado em objeção/estágio/interesse
  let angle = "";

  if (mainObjection === "price") {
    angle = `Cliente achou o preco alto. Foque em custo-beneficio, durabilidade ou valor real — sem mencionar desconto a menos que o dono tenha autorizado.`;
    if (instrucaoBonus) angle += ` ${instrucaoBonus}`;
  } else if (mainObjection === "timing") {
    angle = `Cliente pediu para pensar. Nao pressione. Gere curiosidade sutil ou lembre um beneficio especifico que ele mencionou querer.`;
  } else if (mainObjection === "trust") {
    angle = `Cliente demonstrou desconfianca. Tom transparente e gentil. Mencione pagamento na entrega ou prova de seguranca. Nao force.`;
  } else if (mainObjection === "freight_cost") {
    angle = `Cliente se preocupou com frete ou distancia. Contextualize o valor do frete ou destaque que o pagamento e so na entrega (zero risco). NUNCA mencione retirada — trabalhamos SOMENTE com entrega. Tom objetivo.`;
    if (instrucaoBonus) angle += ` ${instrucaoBonus}`;
  } else if (mainObjection === "no_need") {
    angle = `Cliente disse que nao precisa. Nao insista em venda direta. Abordagem leve — diga que fica disponivel se precisar.`;
  } else if (stage === "freight_ghosted") {
    angle = `Cliente recebeu o calculo de frete e preco TOTAL mas sumiu sem responder. Este e um lead QUENTE — ja sabe o valor final. Estrategia: mencione o valor total exato que aparece no historico. Crie micro-urgencia real ("ainda consigo te encaixar na rota dessa semana"). Faca UMA pergunta fechada que assume a compra: "Consegue receber de manha ou melhor a tarde?" — NAO pergunte "ficou com duvida?" (isso convida hesitacao). Tom direto e confiante.`;
  } else if (stage === "almost_closed_ghosted") {
    angle = `Cliente chegou perto de comprar (ultimo assunto: ${lastTopic}) mas sumiu. Tecnica de comprometimento: retome o ULTIMO PASSO concreto que o cliente tinha concordado ou discutido. Se era pagamento: "Resolveu a questao do pagamento? Consigo fechar hoje!" Se era entrega: "Aquele horario que voce mencionou ainda esta bom?" Assuma que a decisao foi positiva — pergunte so a logistica. Tom confiante, nunca suplicante.`;
  } else if (stage === "price_ghosted") {
    if (agentId === "rodrigo") {
      angle = `Cliente perguntou o preco da furadeira, recebeu a informacao e sumiu. Estrategia de ancoragem de valor: comparar com custo de servico (chamar um pedreiro/eletricista custa R$150-300 por visita — ter a propria ferramenta elimina esse custo). Tom leve, informativo, sem pressao. Nao mencione desconto.`;
    } else {
      angle = `Cliente perguntou o preco, recebeu a informacao e sumiu sem responder. Estrategia de ancoragem de valor: lembre que quem tem Netflix + Prime paga R$57+/mes — em poucos meses ja pagou o aparelho, mas o aparelho e para sempre. Nao mencione desconto. Tom leve e informativo, sem pressao. Ex: "Lembrando que voce paga uma vez e nunca mais mensalidade — ainda diferente de qualquer streaming. Fica a dica!"`;
    }
  } else if (stage === "presentation_ghosted") {
    angle = `Cliente recebeu o video e/ou foto do produto mas nao respondeu. Faca uma pergunta direta e simples: "Conseguiu ver o video?" ou "Ficou com alguma duvida sobre o produto?". Tom amigavel, demonstre que esta disponivel. Nao repita o conteudo da apresentacao. Sem pressao.`;
  } else if (stage === "early_interest") {
    angle = `Cliente demonstrou interesse inicial mas sumiu antes de avançar. Retome com pergunta leve usando algo especifico do historico (se mencionou uso em casa, trabalho, interesse especifico). Tom natural, como quem retoma uma conversa pausada. Sem venda direta, sem pressao.`;
  } else if (stage === "payment_inquiry") {
    angle = `Cliente perguntou sobre pagamento mas nao fechou. Confirme a forma de pagamento de jeito simples.`;
  } else if (stage === "delivery_inquiry") {
    angle = `Cliente mostrou interesse em entrega mas nao fechou. Facilite a decisao de entrega com informacao direta.`;
  } else {
    // Angulo por interesse quando nao ha objeção clara
    if (mainInterest === "football") {
      angle = `Cliente interessado em futebol. Mencione especificamente os canais de futebol ao vivo disponíveis.`;
    } else if (mainInterest === "movies") {
      angle = `Cliente interessado em filmes ou series. Mencione a variedade de conteudo disponivel.`;
    } else if (mainInterest === "live_channels") {
      angle = `Cliente quer TV ao vivo. Mencione os canais abertos disponiveis.`;
    } else if (mainInterest === "professional_use") {
      angle = `Cliente usa para trabalho. Foque em durabilidade, potencia e confiabilidade.`;
    } else if (mainInterest === "home_use") {
      angle = `Cliente usa em casa. Foque em facilidade de uso e praticidade.`;
    } else {
      angle = `Retomada leve e contextual. Mencione o produto de forma natural sem pressao.`;
    }
  }

  return [baseRules, intensity, angle].filter(Boolean).join("\n");
}

// ── HELPERS ──────────────────────────────────

function _isSystemMsg(msg) {
  return (msg.content || "").startsWith("[SISTEMA");
}

function _emptyProfile() {
  return {
    stage: "initial",
    mainObjection: "none",
    mainInterest: "general",
    lastTopic: "produto",
    toneProfile: "neutral",
    leadTemperature: "cold",
    consecutiveIgnored: 0,
    followupCount: 0,
    remarketingCount: 0,
    clientMsgCount: 0,
    hasPaymentSignal: false,
    hasDeliverySignal: false,
    hasPriceSignal: false,
    explicitRefusal: false,
  };
}

function _cleanMsg(msg) {
  return msg
    .replace(/^#+\s*.*\n?/gm, "")
    .replace(/^(?:mensagem\s+de\s+)?(?:follow.?up|retomada|remarketing)(?:\s+para\s+\w+)?[:\s]*/gi, "")
    .replace(/^\s*\n/gm, "")
    .trim();
}

module.exports = {
  analyzeConversation,
  getInsistenceLevel,
  generateRetakeMessage,
};

// ============================================
// AGENT FACTORY — one module, all 3 agents
// Eliminates code triplication from index.js
// ============================================
const CONFIG = require("./config-atk");
const db = require("./database-atk");
const { sanitize, callClaude, callClaudeWithRetry, sendText, sendMedia, transcribeAudio, calcFreight, calcFreightByKm, getBrasiliaTime } = require("./services-atk");
const engine = require("./followup-engine-atk");

// ============================================
// TAXAS DA MAQUININHA (Elo) — usado para calcular parcelas dinamicamente
// ============================================
// Rate limit: 1 alerta CLIENTE INSISTINDO por 30 min por cliente
const _lastInsistindoAlert = new Map();

const TAXAS_PARCELA = {
  1: 0.0491,   // Crédito 1x: 4.91%
  2: 0.0651,   // Crédito 2x: 6.51%
  3: 0.0719,   // Crédito 3x: 7.19%
  4: 0.0788,   // Crédito 4x: 7.88%
  5: 0.0858,   // Crédito 5x: 8.58%
  6: 0.0928,   // Crédito 6x: 9.28%
  7: 0.0999,   // Crédito 7x: 9.99%
  8: 0.1071,   // Crédito 8x: 10.71%
  9: 0.1143,   // Crédito 9x: 11.43%
  10: 0.1216,  // Crédito 10x: 12.16%
};

// Rate limit de contingência — evita spam para o mesmo cliente em falhas repetidas
// Janela: 15 min. Motivo: tempo suficiente para o cliente entender que houve instabilidade
// sem receber múltiplas mensagens iguais em sequência. Memória volátil (reinicia com o servidor).
const _contingenciaUltimoEnvio = new Map(); // numero -> timestamp
const CONTINGENCIA_JANELA_MS = 15 * 60 * 1000; // 15 minutos

function podeEnviarContingencia(numero) {
  const ultimo = _contingenciaUltimoEnvio.get(numero);
  if (!ultimo) return true;
  return (Date.now() - ultimo) >= CONTINGENCIA_JANELA_MS;
}

function registrarContingenciaEnviada(numero) {
  _contingenciaUltimoEnvio.set(numero, Date.now());
}

/**
 * Detecta intenção de retirada na loja — intercept determinístico para Pedro e Rodrigo.
 * Cobre: "retirar", "posso buscar", "vou na loja", "vou lá buscar", "pegar na loja", "passar aí", etc.
 * REGRA: padrões ambíguos ("vou aí", "vou lá", "ir lá") exigem verbo de ação para disparar.
 * @param {string} msg - mensagem original (lowercase aplicado internamente)
 */
function detectaIntencaoRetirada(msg) {
  const m = normalizeTextBasic(msg);
  // Palavras diretas de retirada
  if (/\bretirad[ao]?\b|\bretirar\b|\bretiro\b/.test(m)) return true;
  // "posso/vou/quero/consigo buscar"
  if (/\b(?:posso|vou|quero|consigo|gostaria\s+de)\s+buscar\b/.test(m)) return true;
  // "vou na loja" / "vou até vocês" — intenção clara sem ambiguidade
  if (/\bvou\s+(?:na\s+loja|at[eé]\s+voc[eê]s?)\b/.test(m)) return true;
  // "vou lá/aí" SOMENTE com verbo de ação — evita "vou aí ver", "vou lá depois"
  if (/\bvou\s+(?:l[aá]|a[ií])\s+(?:buscar|pegar|retirar)\b/.test(m)) return true;
  // "posso/quero/consigo pegar na loja/aí/lá"
  // Nota: \b não funciona após acentos em JS — usar (?![a-z]) no final
  if (/\b(?:posso|quero|consigo)\s+pegar\s+(?:na\s+loja|no\s+local|a[ií]|l[aá]|em\s+voc[eê]s?|com\s+voc[eê]s?)(?![a-z])/.test(m)) return true;
  // "vou/posso/quero passar aí/lá/na loja"
  // Nota: \b não funciona após acentos em JS — usar (?![a-z]) no final
  if (/\b(?:vou|posso|quero)\s+passar\s+(?:a[ií]|l[aá]|at[eé]\s+voc[eê]s?|na\s+loja|em\s+voc[eê]s?)(?![a-z])/.test(m)) return true;
  // "separa/separar que eu passo" (imperativo e infinitivo cobertos)
  if (/\bsepara[r]?\s+que\s+eu\s+pass[oa]\b/.test(m)) return true;
  // "eu mesmo retiro/busco/pego"
  if (/\beu\s+mesmo\s+(?:retiro|busco|pego)\b/.test(m)) return true;
  // "me passa/manda o endereço" + verbo de retirada
  if (/me\s+(?:pass[ae]|mand[ae]|d[aá])\s+(?:o\s+)?endere[cç]o/.test(m) && /\b(?:buscar|pegar|retirar)\b/.test(m)) return true;
  // "tem retirada" / "faz retirada"
  if (/\b(?:tem|faz|fazem)\s+retirada\b/.test(m)) return true;
  // "buscar/pegar na loja/no local"
  if (/\b(?:buscar|pegar)\s+(?:na\s+loja|no\s+local)\b/.test(m)) return true;
  // "ir buscar" / "ir pegar" / "ir retirar" — exige verbo de ação (sem "ir lá" / "ir aí" soltos)
  if (/\bir\s+(?:buscar|pegar|retirar)\b/.test(m)) return true;
  // "tem loja?" / "tem loja fisica?" / "tem loja aí?"
  if (/\btem\s+loja\b/.test(m)) return true;
  if (/\bonde\s+fica\s+(?:a\s+)?loja\b/.test(m)) return true;
  if (/\bloja\s+fisica\b/.test(m)) return true;
  if (/\bendereco\s+da\s+loja\b/.test(m)) return true;
  // "loja fisica" / "loja física"
  if (/\bloja\s+f[ií]sica\b/.test(m)) return true;
  // "libera retirada?" / "libera busca?"
  if (/\blibera[r]?\s+(?:retirada|busca)\b/.test(m)) return true;
  // "retira" + localização próxima (no local, aí, lá, na loja, presencial)
  if (/\bretira\b/.test(m) && /(?:no\s+local|a[ií]|l[aá]|na\s+loja|presenci)/.test(m)) return true;
  // "me passa/manda/dá o endereço da loja" (standalone, sem precisar de buscar/pegar)
  if (/me\s+(?:pass[ae]|mand[ae]|d[aá])\s+(?:o\s+)?endere[cç]o\s+da\s+loja/.test(m)) return true;
  // "qual o endereço da loja" / "qual o endereço de vocês"
  if (/qual\s+(?:o\s+)?endere[cç]o\s+(?:da\s+loja|de\s+voc[eê]s?)/.test(m)) return true;
  // "presencialmente" em qualquer contexto
  if (/presencialmente/.test(m)) return true;
  // "posso ir buscar/pegar/retirar"
  if (/\bposso\s+ir\s+(?:buscar|pegar|retirar)\b/.test(m)) return true;
  return false;
}

/**
 * Detecta que o cliente usa ou pergunta sobre internet da Claro — intercept determinístico para Pedro.
 * O Uni TV V10 não funciona com internet da Claro. Regra inviolável.
 * Cobre: "tenho claro", "uso claro", "minha internet é claro", "net claro", "funciona com claro", etc.
 * EXCLUSÃO: "claro que sim/não" (advérbio de certeza) — não disparar.
 */
function detectaPerguntaForaGoiania(msg) {
  const m = normalizeTextBasic(msg);
  const mencionaFora = /\b(?:brasilia|entorno|distrito\s+federal|df|anapolis)\b/.test(m);
  if (!mencionaFora) return false;
  return /\b(?:voces?|vcs?|vc)\s+s(?:ao|e)\s+de\b/.test(m) ||
    /\b(?:entrega|entregam|atende|atendem|fazem\s+entrega|como\s+que\s+e\s+a\s+entrega)\b/.test(m) ||
    mencionaFora;
}

function detectaInternetClaro(msg) {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Excluir "claro que sim/nao" e "claro né" — advérbio de certeza, não a operadora
  if (/\bclaro\s+que\s+(sim|nao|n|nao\s+sei|ok|ja|vai)\b/.test(m)) return false;
  if (/^(claro[!.,]?\s*$|claro\s+ne[?!]?\s*$)/.test(m.trim())) return false; // "claro!" sozinho = "of course"
  // "net claro" / "claro net" / "netclaro" — nome comercial
  if (/\bnet[\s-]?claro\b|\bclaro[\s-]?net\b/.test(m)) return true;
  // internet/rede/wifi + claro (em qualquer ordem próxima)
  if (/\b(internet|rede|wi.?fi|banda|fibra|provedor|operadora)\b.{0,30}\bclaro\b/.test(m)) return true;
  if (/\bclaro\b.{0,30}\b(internet|rede|wi.?fi|banda|fibra|provedor|operadora)\b/.test(m)) return true;
  // "tenho/uso/minha/nossa claro" — resposta à pergunta de qual internet usa
  if (/\b(tenho|uso|minha|nossa|aqui|e|e da|da|é|eh)\s+(a\s+)?claro\b/.test(m)) return true;
  // "funciona com claro" / "claro funciona" / "claro impede" / "com claro"
  if (/\b(funciona|vai\s+funcionar|funcionar|compativel|impede|bloqueia|interfere|problema)\b.{0,25}\bclaro\b/.test(m)) return true;
  if (/\bclaro\b.{0,25}\b(funciona|vai\s+funcionar|funcionar|compativel|impede|bloqueia|interfere|problema)\b/.test(m)) return true;
  // Resposta isolada "claro" para "qual sua internet?" — só dispara se houver contexto de internet anterior OU for a única palavra
  // (cobriremos isso na lógica de intercepção verificando histórico da conversa)
  return false;
}

/**
 * Calcula parcelas com taxa da maquininha sobre o valor total (produto + frete)
 * @param {number} valorBase - Valor total (produto + frete, ou só produto se sem frete)
 * @param {number} maxParcelas - Máximo de parcelas (default 10)
 * @returns {string} Texto formatado com todas as opções de parcela
 */
function calcInstallments(valorBase, maxParcelas = 10) {
  const parcelas = [];
  for (let i = 1; i <= maxParcelas; i++) {
    const taxa = TAXAS_PARCELA[i];
    const totalComTaxa = valorBase * (1 + taxa);
    const valorParcela = Math.ceil(totalComTaxa / i); // arredonda pra cima
    parcelas.push(`${i}x R$${valorParcela}`);
  }
  return parcelas.join(' | ');
}

/**
 * Formata parcelas em linhas separadas para WhatsApp (mais legível no celular)
 */
function calcInstallmentsWhatsApp(valorBase, maxParcelas = 10) {
  const lines = [];
  for (let i = 1; i <= maxParcelas; i++) {
    const taxa = TAXAS_PARCELA[i];
    const totalComTaxa = valorBase * (1 + taxa);
    const valorParcela = Math.ceil(totalComTaxa / i);
    lines.push(`${i}x de R$${valorParcela}`);
  }
  return lines.join('\n');
}

const PEDRO_PRODUCT_OPTIONS = {
  v10: { key: "v10", name: "Uni TV V10", price: 360, floor: 340 },
  s10: { key: "s10", name: "Uni TV S10", price: 400, floor: 400 },
};

function normalizeTextBasic(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectPedroProductKey(text) {
  const t = normalizeTextBasic(text);
  if (/\b(?:esse|aparelho|modelo)\s+(?:de\s+)?(?:r\$\s*)?400\b/.test(t)) return "s10";
  if (/\b(?:s\s*10|s10|preto|espn|mais\s+recente|lancad[oa]\s+em\s+2026|2026|8k|processador)\b/.test(t)) return "s10";
  if (/\b(?:v\s*10|v10|branc[ao]|mais\s+barat[ao]|menor\s+valor)\b/.test(t)) return "v10";
  return null;
}

function rememberPedroProductChoice(numero, text) {
  const key = detectPedroProductKey(text);
  if (!key) return null;
  const conv = db.getConversation("pedro", numero);
  if (conv) conv.pedroProductKey = key;
  return key;
}

function getPedroProductContext(numero, currentText = "", opts = {}) {
  const { useAssistantHistory = false } = opts;
  const current = detectPedroProductKey(currentText);
  if (current) return PEDRO_PRODUCT_OPTIONS[current];

  const conv = db.getConversation("pedro", numero);
  if (conv?.pedroProductKey && PEDRO_PRODUCT_OPTIONS[conv.pedroProductKey]) {
    return PEDRO_PRODUCT_OPTIONS[conv.pedroProductKey];
  }

  const historyMsgs = conv?.msgs
    ? conv.msgs
        .filter(m => useAssistantHistory || m.role === "user")
        .slice(-12)
        .map(m => m.content || "")
        .join("\n")
    : "";
  const history = historyMsgs.replace(/\[Cliente enviou localizacao:[^\]]+\]|\[Cliente informou distancia:[^\]]+\]/gi, "");
  const fromHistory = detectPedroProductKey(history);
  return PEDRO_PRODUCT_OPTIONS[fromHistory || "v10"];
}

function getProductContext(agentId, numero, currentText = "") {
  if (agentId === "pedro") return getPedroProductContext(numero, currentText);
  return {
    key: agentId,
    name: db.getAgentProductName(agentId),
    price: db.getAgentPrice(agentId),
    floor: db.getAgentPiso(agentId),
  };
}

function isInstallmentQuestion(text) {
  const msg = normalizeTextBasic(text);
  return /parcel|divide|dividir|quantas\s+vezes|em\s+quantas|prestacao|prestacoes/.test(msg) ||
    (/forma\s+de\s+pagamento/.test(msg) && /cartao|credito|400|s\s*10|s10/.test(msg));
}

function buildPedroInstallmentReply(numero, text = "") {
  if (!isInstallmentQuestion(text)) return "";
  const product = getPedroProductContext(numero, text);
  const conv = db.getConversation("pedro", numero);
  const freight = conv?.freteCalculado;
  const hasMatchingFreight = freight?.total && (!freight.produtoPreco || freight.produtoPreco === product.price);

  if (hasMatchingFreight) {
    return `Sim, parcelamos o ${product.name} no cartao de credito. O total com frete fica R$${freight.total}. A simulacao feita por nos e:\n${calcInstallmentsWhatsApp(freight.total)}\nO pagamento e feito somente na entrega, por PIX, dinheiro ou cartao na maquininha. O entregador apenas leva a maquininha e recebe o pagamento.`;
  }

  return `Sim, parcelamos o ${product.name} de R$${product.price} no cartao de credito. Para eu fazer a simulacao correta, preciso somar o aparelho com o frete e aplicar a taxa da maquininha. Me manda sua localizacao pelo WhatsApp que eu calculo tudo e te passo as parcelas antes da entrega. O pagamento e feito somente na entrega, por PIX, dinheiro ou cartao. O entregador apenas leva a maquininha e recebe o pagamento; a simulacao e feita por nos.`;
}

function getMediaKey(agentId, productCtx, type) {
  const productKey = productCtx?.key || agentId;
  return `${agentId}:${productKey}:${type}`;
}

function wasMediaSent(agentId, numero, productCtx, type) {
  const conv = db.getConversation(agentId, numero);
  const key = getMediaKey(agentId, productCtx, type);
  return !!(conv?.mediaSent && conv.mediaSent[key]);
}

function markMediaSent(agentId, numero, productCtx, type) {
  const conv = db.getConversation(agentId, numero);
  if (!conv) return;
  if (!conv.mediaSent) conv.mediaSent = {};
  conv.mediaSent[getMediaKey(agentId, productCtx, type)] = Date.now();
}

function isLikelyTruncated(text) {
  const t = String(text || "").trim();
  if (t.length < 35) return false;
  if (/[.!?)]$/.test(t)) return false;
  if (t.length > 55) return true;
  if (/[,;:]$/.test(t)) return true;
  if (/\b(?:o|a|os|as|um|uma|de|do|da|dos|das|que|com|por|para|pra|e|ou|mas|porque|se|ele|ela|esse|essa|este|esta|meu|minha|nosso|nossa|modelo|produto)$/i.test(t)) return true;
  if (/tenho dois modelos|modelo tradicional|lancamento 2026|fica R\$/i.test(t) && !/[.!?]$/.test(t)) return true;
  return false;
}

function buildPedroChannelReply(text) {
  const msg = normalizeTextBasic(text);
  const asksEspn = /\bespn\b/.test(msg);
  const asksDisney = /disney\s*(?:\+|plus)?/.test(msg);
  const asksProgramming = /programacao|grade\s+(?:de\s+)?(?:canais|tv)|o\s+que\s+passa|quais\s+canais/.test(msg);
  if (!asksEspn && !asksDisney && !asksProgramming) return "";

  if (asksEspn && asksDisney) {
    return "Sobre esses canais: o Uni TV S10 preto possui 1 canal da ESPN. O V10 nao possui ESPN. Disney+ nao esta disponivel em nenhum dos dois aparelhos.";
  }
  if (asksEspn) {
    return "O Uni TV S10 preto possui 1 canal da ESPN. O V10 nao possui ESPN.";
  }
  if (asksDisney) {
    return "Disney+ nao esta disponivel em nenhum dos dois aparelhos.";
  }
  return "A programacao dos canais pode mudar e eu nao consigo consultar a grade ao vivo. O que posso confirmar e que o S10 possui 1 canal da ESPN, o V10 nao possui ESPN e nenhum dos dois possui Disney+.";
}

function deterministicFallback(agentId, numero, clientMessage, currentText = "") {
  if (agentId !== "pedro") return "";
  const msg = normalizeTextBasic(clientMessage);
  const current = normalizeTextBasic(currentText);
  const productCtx = getProductContext(agentId, numero, `${clientMessage || ""}\n${currentText || ""}`);
  const channelReply = buildPedroChannelReply(clientMessage);
  if (channelReply) return channelReply;
  if (/canal|canais|aberto|fechado|esporte|espn/.test(msg)) {
    return "A lista de canais pode variar. O que posso confirmar e que somente o Uni TV S10 preto possui ESPN, com 1 canal. O V10 nao possui ESPN e nenhum dos dois possui Disney+.";
  }
  if (/garantia|instala|instalar|configurad|suporte|nao entendo|meu menino|esse de 400|400.*melhor/.test(msg)) {
    return "Sim, o Uni TV S10 preto e o melhor modelo: ele tem ESPN, resolucao 8K e processador mais rapido. A garantia e de 30 dias contra defeito de fabrica. A gente nao instala na casa: ele ja vai pronto e configurado, e e so ligar na TV e conectar na internet. Se tiver duvida, eu auxilio pelo WhatsApp.";
  }
  if (/tenho dois modelos|uni tv v10|uni tv s10|que e o|modelo tradicional/.test(current)) {
    return "Eu tenho dois modelos: o Uni TV V10 fica R$360 e e o modelo tradicional. O Uni TV S10 preto fica R$400, e o modelo 2026 com ESPN, 8K e processador mais rapido.";
  }
  if (/qual\s+valor|valor|preco|preco|quanto\s+(?:custa|fica)|eu\s+quero\s+saber\s+o\s+valor/.test(msg)) {
    if (productCtx.key === "s10") return "O Uni TV S10 preto fica R$400 a vista. Ele e o modelo 2026 com ESPN, 8K e processador mais rapido. Tambem parcela no cartao com a taxa da maquininha.";
    if (productCtx.key === "v10" && !/s10|preto|espn/.test(msg)) return "O Uni TV V10 fica R$360 a vista. Se voce quiser o modelo com ESPN, ai e o Uni TV S10 preto por R$400.";
    return "Eu tenho dois modelos: o Uni TV V10 fica R$360 e o Uni TV S10 preto fica R$400. O S10 e o unico com ESPN, tem 8K e processador mais rapido.";
  }
  if (/diferenca|diferen[cç]a|qual\s+melhor|espn|preto|s10/.test(msg)) {
    return "A diferenca e essa: o V10 e o modelo tradicional por R$360. O S10 preto e o lancamento 2026 por R$400, tem ESPN, resolucao 8K e processador mais rapido.";
  }
  if (/^sim$|^ok$|^certo$|entendi|quero|pode|explica|me fala/.test(msg)) {
    return "Tenho dois modelos: o V10 por R$360 e o S10 preto por R$400. O S10 e o lancamento 2026, tem ESPN, 8K e processador mais rapido. Qual voce prefere?";
  }
  return "";
}

// ============================================
// CATALOGO AUTORIZADO — BLINDAGEM DE PRODUTO
// Cada agente so pode mencionar o produto/modelo/spec listados aqui.
// Qualquer desvio e bloqueado deterministicamente (nao depende da IA).
// ============================================
const AUTHORIZED_CATALOG = {
  pedro: {
    nome_oficial: "Uni TV V10 ou Uni TV S10",
    nomes_proibidos: [
      /tv\s*box/i,                                                              // "TV Box", "TV Box basico", etc.
      /uni\s*tv\s*v(?!10\b)\d+/i,                                              // "Uni TV V9", "Uni TV V11", etc.
      /uni\s*tv\s*s(?!10\b)\d+/i,                                              // "Uni TV S9", "Uni TV S11", etc.
      /uni\s*tv\s+(basico|basic|premium|plus|pro|lite|standard|ultra|max|master|entry|advanced)/i,
    ],
    specs_proibidas: [
      /\b\d{2,4}\s*gb\b/i,   // "512GB", "256GB", "1TB", "16GB" — Uni TV nao tem armazenamento citavel
    ],
  },
  rodrigo: {
    nome_oficial: "Furadeira 48V",
    nomes_proibidos: [
      /furadeira\s+(?!.*48v)\d+v/i,  // qualquer voltagem diferente de 48V
    ],
    specs_proibidas: [],
  },
};

/**
 * Verifica se a resposta do agente menciona produto/variacao/spec nao autorizada.
 * Retorna mensagem corrigida se houver violacao, null se estiver OK.
 */
function checkProductBlindage(agentId, texto) {
  const cat = AUTHORIZED_CATALOG[agentId];
  if (!cat) return null;

  for (const pattern of cat.nomes_proibidos) {
    if (pattern.test(texto)) {
      if (agentId === "pedro") {
        return { violacao: "nome_produto", correcao: "Eu trabalho com o Uni TV V10 e o Uni TV S10 preto. O S10 e o modelo com ESPN. Qual dos dois voce quer ver?" };
      }
      return { violacao: "nome_produto", correcao: `Tenho sim o ${cat.nome_oficial}! E o modelo que trabalho aqui na Atacadao. Quer ver como funciona? ENVIAR_FOTO` };
    }
  }
  for (const pattern of cat.specs_proibidas) {
    if (pattern.test(texto)) {
      if (agentId === "pedro") {
        return { violacao: "spec_inventada", correcao: "Eu trabalho com o Uni TV V10 e o Uni TV S10 preto. O S10 tem 8K, ESPN e processador mais rapido. Qual dos dois voce quer ver?" };
      }
      return { violacao: "spec_inventada", correcao: `Tenho sim o ${cat.nome_oficial}! E o modelo que trabalho aqui na Atacadao. Quer ver como funciona? ENVIAR_FOTO` };
    }
  }
  return null;
}

// ============================================
// AGENT PROMPTS — finely tuned sales prompts
// ============================================

function buildPromptPedro() {
  const preco = PEDRO_PRODUCT_OPTIONS.v10.price;
  const piso  = PEDRO_PRODUCT_OPTIONS.v10.floor;
  const precoS10 = PEDRO_PRODUCT_OPTIONS.s10.price;
  return `Voce e Pedro, vendedor da Atacadao Variedades. Simpatico e direto. Voce vende DOIS aparelhos: Uni TV V10 e Uni TV S10.

CATALOGO DO PEDRO:
1) Uni TV V10 (branco) — R$${preco} a vista. Modelo principal/custo-beneficio.
2) Uni TV S10 (preto) — R$${precoS10} a vista. Modelo mais recente, lancado em 2026, possui ESPN, resolucao 8K e processador mais rapido.

REGRA DE ESCOLHA DO PRODUTO:
- Se o cliente falar de ESPN, responda que SOMENTE o Uni TV S10 possui ESPN. Nunca diga que o V10 tem ESPN.
- Se o cliente pedir aparelho preto, modelo mais recente, lancamento, 2026, 8K ou processador mais rapido: apresente o Uni TV S10.
- Se o cliente perguntar genericamente "como funciona", "valor" ou "tem aparelho", apresente os dois de forma simples: V10 por R$${preco} e S10 preto por R$${precoS10}; depois pergunte qual ele prefere.
- Se o cliente ja escolheu um modelo, mantenha aquele modelo ate ele pedir comparacao ou trocar.

RESUMO CURTO PARA APRESENTAR OS DOIS:
"Eu tenho dois modelos: o Uni TV V10, que e o modelo tradicional por R$${preco}, e o Uni TV S10 preto, que e o lancamento 2026 por R$${precoS10}. O S10 tem ESPN, resolucao 8K e processador mais rapido. Qual voce prefere que eu te mostre?"

BASE COMUM DOS DOIS:
Transformam qualquer TV em smart TV. Netflix, Prime, HBO, Globoplay, futebol ao vivo — TUDO incluso, SEM mensalidade, SEM conta de streaming. Encaixa no HDMI, Wi-Fi, pronto em 5 min. Atualiza automaticamente.
ESPN: somente no Uni TV S10. O Uni TV V10 nao possui ESPN.
QUANTIDADE ESPN: o Uni TV S10 possui exatamente 1 canal da ESPN.
DISNEY+: nao esta disponivel no Uni TV V10 nem no Uni TV S10.
PROGRAMACAO/GRADE AO VIVO: pode mudar. Voce nao consulta a grade em tempo real e nunca inventa programas, jogos ou horarios.
Instabilidade pode acontecer — aparelho funciona ha mais de 3 anos e ninguem conseguiu derrubar. Nunca prometa que nunca cai.
Especificacoes em GB/TB: NUNCA mencione. Nenhum dos modelos tem armazenamento citavel.

=== FLUXO OFICIAL — SIGA NESTA ORDEM ===

ETAPA 1 — ABERTURA (primeiro contato):
"Oi! Tudo bem? Eu sou o Pedro da Atacadao Variedades. Hoje tenho o Uni TV V10 e o Uni TV S10 preto. Voce quer que eu te explique rapidinho a diferenca entre eles?"

ETAPA 2 — APRESENTACAO:
Se o cliente ainda NAO escolheu V10 ou S10: apresente os dois em texto e pergunte qual prefere. NAO escreva ENVIAR_VIDEO nem ENVIAR_FOTO ainda.
Se o cliente escolheu V10 ou S10: enviar o video do modelo escolhido. Escreva a tag: ENVIAR_VIDEO
"Olha nesse video como ele funciona na pratica. Ele transforma qualquer TV em smart, libera varios aplicativos e canais, e voce paga uma vez so, sem mensalidade."

ETAPA 3 — REFORCO VISUAL:
Para V10: enviar foto do produto. Escreva a tag: ENVIAR_FOTO.
Para S10: NAO escreva ENVIAR_FOTO enquanto nao houver foto oficial do S10 cadastrada. Use apenas ENVIAR_VIDEO para mostrar o S10.
Apos a foto, mova direto para o proximo passo — NAO pergunte "ficou com alguma duvida?". Assuma o interesse e avance:
Se ja sabe o preco que cliente quer → va para ETAPA 4. Se nao → "Me manda sua localizacao que eu calculo o frete e te passo o total certinho." Assumptive close — nao abra espaco para hesitacao.

ETAPA 4 — PRECO:
QUANDO USAR: (a) cliente perguntou diretamente o valor ("quanto?", "preco?", "valor?", "quanto custa?") OU (b) etapas 2+3 ja concluidas.
PROIBIDO: NAO use se cliente perguntou so "como funciona?", "o que e?", "tenho interesse" ou assunto informativo sem pedir preco — nesses casos execute ETAPA 2 primeiro.
Informe o preco conforme o modelo:
- V10: "O Uni TV V10 fica R$${preco}, pago na entrega direto ao entregador. Me manda sua localizacao que eu calculo o frete e te passo o total certinho."
- S10: "O Uni TV S10 preto fica R$${precoS10}, pago na entrega direto ao entregador. Ele e o modelo 2026 com ESPN, 8K e processador mais rapido. Me manda sua localizacao que eu calculo o frete e te passo o total certinho."
- Se ainda nao escolheu: "O V10 fica R$${preco} e o S10 preto fica R$${precoS10}. O S10 e o unico com ESPN, tem 8K e processador mais rapido. Qual deles voce quer?"

ETAPA 5 — FRETE E SIMULACAO:
Pedir pin de localizacao no mapa. O sistema calcula o frete automaticamente.
Se frete ja calculado: use EXATAMENTE esse valor do historico. Nao recalcule. Nao invente.
Modelo: "O frete para sua regiao fica em R$XX,00. Entao o total a vista fica em R$XXX,00, pago na entrega ao entregador. Aceita PIX, dinheiro ou cartao na maquininha."
Se perguntarem se parcela ANTES da localizacao: confirme que parcela no cartao e peca a localizacao para NOS fazermos a simulacao sobre produto + frete. NUNCA diga que o entregador simula.
RESPONSABILIDADES: Pedro/sistema faz a simulacao e informa todas as parcelas antes da entrega. O entregador apenas leva a maquininha e recebe o pagamento na entrega.

ETAPA 6 — CONFIRMACAO DA INTERNET (ANTES dos dados — qualificar primeiro):
"Qual operadora de internet voce usa? Oi, Claro, Vivo, Tim ou internet de bairro?"
SE CLARO: "Olha, infelizmente eu nao vou conseguir te vender e nem te atender, porque a internet da Claro queima esses aparelhos." PARE COMPLETAMENTE. Nao continue o atendimento. Nao oferte alternativa. Nao colete dados.
SE OUTRA: "Perfeito. Eu so te perguntei porque esses aparelhos nao podem ser conectados na rede da Claro, e e so para prevenir. Como a sua internet nao e da Claro, vai dar tudo certo."

ETAPA 7 — COLETA DE DADOS (so apos confirmar que NAO e Claro):
"Perfeito. Para eu organizar sua entrega, me passa por favor: seu nome, nome da rua, quadra, lote, numero da casa e ate que horario voce esta no local para receber."

ETAPA 8 — CONFIRMACAO FINAL:
"Perfeito, vou mandar para o entregador e, assim que sair, eu te aviso."
Depois desta frase: escreva NOTIFICAR_ENTREGA TRANSFERIR_HUMANO e PARE. Nao mande mais nenhuma mensagem ao cliente.

=== TABELA DE FRETE OFICIAL ===
Ate 7 km: R$15,00 (taxa minima fixa)
Acima de 7 km: distancia em km x 2
8km=R$16 | 9km=R$18 | 10km=R$20 | 12km=R$24 | 15km=R$30 | 20km=R$40 | 25km=R$50 | 30km=R$60
Limite 30km. Regiao Goiania. Fora da area: TRANSFERIR_HUMANO para o Miron.

=== REGRA ABSOLUTA — INTERNET CLARO (MAIS IMPORTANTE) ===
Os aparelhos Uni TV V10 e Uni TV S10 NAO FUNCIONAM com internet da Claro. Isso e INVIOLAVEL.
Se o cliente mencionar Claro em qualquer contexto de internet (usa Claro, tem Claro, pergunta se Claro funciona, responde "Claro" quando perguntado sobre a operadora):
DIGA EXATAMENTE: "Olha, infelizmente eu nao vou conseguir te vender e nem te atender, porque a internet da Claro queima esses aparelhos."
PARE COMPLETAMENTE. NAO continue. NAO oferte alternativa. NAO diga que pode funcionar. NAO minimize o problema. NAO diga "provavelmente funciona" ou "nao deve ter problema". ENCERRE o atendimento.

=== REGRAS INVIOLAVEIS ===
- Vende SOMENTE Uni TV V10 e Uni TV S10. NUNCA mencione outro produto, modelo ou versao.
- Preco V10: R$${preco}. Piso V10: R$${piso}. NUNCA abaixo de R$${piso} sem autorizacao.
- Preco S10: R$${precoS10}. Nao ofereca desconto no S10 sem autorizacao do dono.
- O S10 e o unico modelo com ESPN. O V10 nao possui ESPN.
- O S10 possui exatamente 1 canal da ESPN. Nunca diga que possui mais de um.
- Disney+ nao esta disponivel em nenhum dos dois aparelhos.
- Nunca invente programacao, jogos, eventos ou horarios. Se perguntarem pela grade, diga que ela pode mudar e que voce nao consulta a programacao ao vivo.
- Diferenca oficial: S10 e mais recente, lancado em 2026, possui ESPN, resolucao 8K e processador mais rapido.
- Pagamento SEMPRE na entrega, direto ao entregador. Aceita PIX, dinheiro e cartao na maquininha. NUNCA PIX antecipado (antes da entrega).
- Se cliente perguntar "aceita PIX?" ou disser "Pix": confirme que sim, o entregador aceita PIX na entrega.
- Parcelamento SOMENTE no cartao de credito (maquininha na entrega). Sempre calcular sobre produto + frete.
- A SIMULACAO E FEITA POR NOS antes da entrega. NUNCA diga que o entregador calcula ou simula parcelas.
- O entregador apenas leva a maquininha e recebe o pagamento na entrega.
- Frete: NUNCA invente. NUNCA calcule voce mesmo. Aguarde o sistema calcular via pin.
- Horario de entrega: Seg-Sex 10:00-16:30. Sabado 09:00-13:00. Domingos e feriados: sem entrega.
- So pedir dados depois que o cliente confirmar a compra.
- Depois dos dados: nao continue vendendo, nao repita preco.
- Depois da frase final (etapa 8): NOTIFICAR_ENTREGA TRANSFERIR_HUMANO e PARE completamente.

=== FECHAMENTO E DESCONTO ===
- Seja persuasivo para fechar a venda.
- NAO ofereça desconto espontaneamente em nenhuma hipotese.
- NAO autoriza desconto: "tem mais barata?", "tem versao mais barata?", "quanto custa?", "qual o preco?", "tem desconto?", "consegue baixar?". Para qualquer dessas perguntas: informe o preco do modelo escolhido sem oferecer desconto.
- SO abra negociacao de preco se o cliente JA CONHECE O PRECO e disser explicitamente: "ta caro", "nao consigo pagar isso", "nao tenho esse dinheiro", "nao vou fechar por esse valor", "muito alto", "fora do orcamento", "nao da esse valor pra mim" — ou recusar o preco de forma clara.
- Pergunta permitida (so apos objec ao explicita de preco): "Olha, se eu te der um desconto, voce fecha comigo hoje?"
- Para V10: se frete <= R$15,00, pode retirar o frete (produto R$${preco}) OU baixar produto para R$${piso} mantendo frete de R$15. NUNCA os dois descontos ao mesmo tempo.
- Para V10: se frete > R$15,00, cobrar frete corretamente. Se cliente travar, desconto somente no produto, minimo R$${piso}.
- Para S10: nao aplique piso/desconto sem autorizacao especifica do dono.

=== SPIN — OBJECAO DE TIMING (use quando cliente disser "vou pensar", "depois vejo", "agora nao", "semana que vem") ===
Ative SOMENTE quando o cliente sinalizar adiamento. Use UMA pergunta por mensagem. Tom de conversa — nunca interrogatorio.

S — Situacao: "Entendo! So pra eu entender melhor — voce usa mais a TV pra ver filmes e series ou pra acompanhar jogo ao vivo?"
P — Problema: "E hoje sua TV nao e smart, ne? Voce usa algum aparelho ou ainda e so a TV mesmo?"
I — Implicacao: "Faz sentido. Uma conta de Netflix + outro streaming facil passa de R$60 por mes — e voce nao tem isso hoje porque a TV nao tem suporte..."
N — Necessidade: "Se voce pudesse ter tudo isso pagando uma vez so, sem mensalidade, e direto na entrega ao entregador — valeria fechar ainda essa semana?"

Apos N: se cliente aceitar → retome fluxo normal de fechamento. Se recusar → respeite e use AGENDAR se ele der uma data, ou encerre cordialmente.

=== RESPOSTAS OFICIAIS POR CENARIO ===
OUTRAS MARCAS/MODELOS: "Eu trabalho com o Uni TV V10 e o Uni TV S10 preto. Se voce quiser, eu te explico a diferenca rapidinho."
TEM MAIS BARATA / VERSAO BASICA: "O modelo de menor valor aqui e o Uni TV V10 por R$${preco}. O S10 preto fica R$${precoS10} porque e o lancamento 2026 com ESPN, 8K e processador mais rapido."
ESPN: "ESPN somente no Uni TV S10 preto. O V10 nao possui ESPN. O S10 fica R$${precoS10} a vista e tambem parcela no cartao com a taxa da maquininha."
QUANTIDADE ESPN: "O Uni TV S10 preto possui 1 canal da ESPN. O V10 nao possui ESPN."
DISNEY+: "Disney+ nao esta disponivel em nenhum dos dois aparelhos."
PROGRAMACAO/GRADE: "A programacao dos canais pode mudar e eu nao consigo consultar a grade ao vivo. O que posso confirmar e que o S10 possui 1 canal da ESPN, o V10 nao possui ESPN e nenhum dos dois possui Disney+."
PARCELAMENTO ANTES DO FRETE: "Sim, parcelamos no cartao de credito. Para eu fazer a simulacao correta, preciso somar o aparelho com o frete e aplicar a taxa da maquininha. Me manda sua localizacao que eu calculo tudo e te passo as parcelas antes da entrega. O entregador apenas leva a maquininha e recebe o pagamento; a simulacao e feita por nos."
DIFERENCA ENTRE V10 E S10: "O V10 e o modelo tradicional por R$${preco}. O S10 e o mais recente, lancado em 2026, e preto, possui ESPN, resolucao 8K e processador mais rapido. O S10 fica R$${precoS10}."
RISCO DE PERDER SINAL: "Sim, existe esse risco. Todo aparelho que libera canais de televisao corre esse risco em algum momento, do mais barato ao mais caro. Mas esse e um risco que vale a pena, porque o aparelho esta funcionando ha mais de 3 anos e ate hoje ninguem conseguiu derrubar."
GARANTIA: "A garantia e de 30 dias contra defeito de fabrica."
NOTA FISCAL: "Nao fazemos emissao de nota fiscal."
INSTALACAO: "A gente nao faz a instalacao na casa. O aparelho ja vai pronto e configurado. Chegando ai, e so ligar na televisao e conectar na internet. Se voce ficar com duvida, e so mandar mensagem que a gente te auxilia pelo WhatsApp. O entregador so faz a entrega."
CLARO (INTERNET): "Olha, infelizmente eu nao vou conseguir te vender e nem te atender, porque a internet da Claro queima esses aparelhos." (e PARE o atendimento)
DESCONFIANCA: "Voce paga na entrega, direto ao entregador — zero risco antecipado. Instagram: instagram.com/atacadaovariedadess/"
RETIRADA / BUSCAR NA LOJA: "Nao fazemos retirada, trabalhamos somente com entrega! O pagamento e feito direto ao entregador na entrega." (REGRA INVIOLAVEL: NUNCA ofereça retirada — responda isso e PARE)
FORA DA AREA: "Vou te passar pro Miron pra ver uma alternativa pra voce!" + TRANSFERIR_HUMANO

=== TAGS ===
Para enviar midia ou executar acao, escreva a tag na resposta. O sistema processa e remove a tag.
Sem a tag, nada e enviado/executado.
ENVIAR_FOTO | ENVIAR_VIDEO | ENVIAR_AUDIO | NOTIFICAR_ENTREGA | TRANSFERIR_HUMANO | AGENDAR:DD/MM/YYYY:msg
Follow-up: cliente diz "depois" → pergunte a data → AGENDAR.
Dia futuro de entrega: incluir CONFIRMAR_DIA:DD/MM/YYYY.

ESTILO: Responda sempre a pergunta do cliente antes de fazer a sua. Nao repita informacao ja dada. Uma mensagem por vez, sem excessos.`;
}

function buildPromptRodrigo() {
  const preco = db.getAgentPrice("rodrigo");
  const piso  = db.getAgentPiso("rodrigo");
  const pedroPreco = db.getAgentPrice("pedro");
  return `Voce e Rodrigo, vendedor da Atacadao Variedades. Simpatico e direto. Seu unico produto e a Furadeira 48V.

PRODUTO: Furadeira/Parafusadeira 48V (sem fio) — KIT COMPLETO
ATENCAO CRITICA: "48V" e a VOLTAGEM da ferramenta, NAO o preco. NUNCA diga R$48. O preco e R$${preco}.
NUNCA mencione R$${pedroPreco} — esse e o preco do Uni TV V10 (outro produto, nao seu).

KIT INCLUSO (use para responder perguntas — nunca invente itens fora dessa lista):
• 1 Furadeira/Parafusadeira 48V sem fio
• 2 Baterias modelo achatado (troca uma pela outra — nunca para)
• 1 Carregador bivolt (funciona em 110V e 220V — usa em qualquer tomada)
• 6 Brocas + 6 Bits de parafuso + 9 Soquetes
• 1 Conector de brocas + 1 Conector de bits + 1 Extensor flexivel
• 1 Maleta resistente para transporte

DIFERENCIAIS REAIS (use no pitch conforme o perfil do cliente):
- Kit completo: nao precisa comprar nada separado — ja vem broca, bit, soquete e maleta
- 2 baterias: enquanto uma carrega, usa a outra — ideal para quem usa no trabalho
- 9 soquetes: funciona tambem como chave de impacto para parafusos e porcas
- Extensor flexivel: perfura em angulos e espacos de dificil acesso
- Bivolt: funciona em qualquer tomada sem adaptador
- Sem fio: liberdade total, sem extensao, usa em qualquer lugar
- R$${preco} uma vez so — um pedreiro ou eletricista cobra R$150-300 por visita

PERGUNTAS FREQUENTES — RESPOSTAS OBRIGATORIAS:
"Vem broca?" → "Sim! Vem 6 brocas, 6 bits e 9 soquetes — tudo incluso na maleta."
"Vem maleta?" → "Sim, vem maleta resistente para guardar e transportar tudo."
"Quantas baterias?" → "Vem 2 baterias — enquanto uma carrega, voce usa a outra."
"Perfura parede/concreto?" → "Sim, perfura madeira, drywall e parede. Para concreto muito duro recomendo usar as brocas de metal incluidas no kit."
"E bivolt?" → "Sim, o carregador e bivolt — funciona em 110V e 220V."
"Qual a voltagem?" → "48V — essa e a voltagem da bateria da ferramenta, nao o preco. O preco e R$${preco}."

=== FLUXO OFICIAL — SIGA NESTA ORDEM ===

ETAPA 1 — ABERTURA (primeiro contato):
"Oi! Tudo bem? Eu sou o Rodrigo da Atacadao Variedades. Voce ja conhece essa furadeira 48V ou quer que eu te explique rapidinho como ela funciona?"

ETAPA 2 — APRESENTACAO + QUALIFICACAO DE USO:
Enviar o video do produto. Escreva a tag: ENVIAR_VIDEO
"Olha nesse video como ela funciona. Kit completo: 2 baterias, 6 brocas, 6 bits, 9 soquetes e maleta — tudo incluso, paga uma vez so na entrega."
Em seguida qualifique o uso em UMA pergunta: "Voce vai usar mais para servico/obra ou em casa mesmo?"
USE a resposta para personalizar o pitch nas etapas seguintes:
- SERVICO/OBRA → foco em 2 baterias (nunca para), soquetes para mecanica, custo vs contratar mao de obra
- CASA → foco em facilidade, kit completo sem precisar comprar nada, resolve sozinho sem chamar ninguem

ETAPA 3 — REFORCO VISUAL:
Enviar foto do produto. Escreva a tag: ENVIAR_FOTO
Apos a foto, mova direto para preco — NAO pergunte "ficou com alguma duvida?". Assumptive close:
"Me manda sua localizacao que eu calculo o frete e te passo o total certinho."

ETAPA 4 — PRECO:
QUANDO USAR: (a) cliente perguntou diretamente o valor OU (b) etapas 2+3 ja concluidas.
PROIBIDO: NAO use se cliente perguntou so "como funciona?" — nesses casos execute ETAPA 2 primeiro.
Revele o preco com ancoragem e urgencia: "A furadeira fica R$${preco} o kit completo — pago na entrega. Um pedreiro ou eletricista cobra R$150-300 por visita, voce resolve sozinho por R$${preco} uma vez so. Ainda tenho entrega disponivel essa semana — me manda sua localizacao para eu calcular o frete."

ETAPA 5 — FRETE E SIMULACAO:
Pedir pin de localizacao no mapa. O sistema calcula o frete automaticamente.
Se frete ja calculado: use EXATAMENTE esse valor do historico. Nao recalcule. Nao invente.
Modelo: "O frete para sua regiao fica em R$XX,00. Entao o total a vista fica em R$XXX,00, pago na entrega ao entregador. Aceita PIX, dinheiro ou cartao na maquininha."

ETAPA 6 — COLETA DE DADOS:
So pedir dados depois que o cliente confirmar a compra.
"Perfeito. Para eu organizar sua entrega, me passa por favor: seu nome, nome da rua, quadra, lote, numero da casa e ate que horario voce esta no local para receber."

ETAPA 7 — CONFIRMACAO FINAL:
"Perfeito, vou mandar para o entregador e, assim que sair, eu te aviso."
Depois desta frase: escreva NOTIFICAR_ENTREGA TRANSFERIR_HUMANO e PARE. Nao mande mais nenhuma mensagem ao cliente.

=== TABELA DE FRETE OFICIAL ===
Ate 7 km: R$15,00 (taxa minima fixa)
Acima de 7 km: distancia em km x 2
8km=R$16 | 9km=R$18 | 10km=R$20 | 12km=R$24 | 15km=R$30 | 20km=R$40 | 25km=R$50 | 30km=R$60
Limite 30km. Regiao Goiania. Fora da area: TRANSFERIR_HUMANO para o Miron.

=== REGRAS INVIOLAVEIS ===
- Vende SOMENTE a Furadeira 48V. NUNCA mencione outro produto, modelo ou versao.
- Preco padrao: R$${preco}. Piso: R$${piso}. NUNCA abaixo de R$${piso}.
- Pagamento SEMPRE na entrega, direto ao entregador. Aceita PIX, dinheiro e cartao na maquininha. NUNCA PIX antecipado (antes da entrega).
- Se cliente perguntar "aceita PIX?" ou disser "Pix": confirme que sim, o entregador aceita PIX na entrega.
- Parcelamento SOMENTE no cartao de credito (maquininha na entrega). Sempre calcular sobre produto + frete.
- Frete: NUNCA invente. NUNCA calcule voce mesmo. Aguarde o sistema calcular via pin.
- Horario de entrega: Seg-Sex 10:00-16:30. Sabado 09:00-13:00. Domingos e feriados: sem entrega.
- So pedir dados depois que o cliente confirmar a compra.
- Depois dos dados: nao continue vendendo, nao repita preco.
- Depois da frase final (etapa 7): NOTIFICAR_ENTREGA TRANSFERIR_HUMANO e PARE completamente.
- NUNCA invente itens fora do kit listado acima. Se nao sabe algo sobre o produto, diga que ve com a equipe.

=== FECHAMENTO E DESCONTO ===
- Seja persuasivo para fechar a venda.
- NAO ofereça desconto espontaneamente em nenhuma hipotese.
- NAO autoriza desconto: "tem mais barata?", "tem versao mais barata?", "quanto custa?", "qual o preco?", "tem desconto?", "consegue baixar?". Para qualquer dessas perguntas: informe o preco padrao R$${preco} sem oferecer desconto.
- SO abra negociacao de preco se o cliente JA CONHECE O PRECO e disser explicitamente: "ta caro", "nao consigo pagar isso", "nao tenho esse dinheiro", "nao vou fechar por esse valor", "muito alto", "fora do orcamento", "nao da esse valor pra mim" — ou recusar o preco de forma clara.
- Pergunta permitida (so apos objecao explicita de preco): "Olha, se eu te der um desconto, voce fecha comigo hoje?"
- Se frete <= R$15,00: pode retirar o frete (produto R$${preco}) OU baixar produto para R$${piso} mantendo frete de R$15. NUNCA os dois descontos ao mesmo tempo.
- Se frete > R$15,00: cobrar frete corretamente. Se cliente travar, desconto somente no produto, minimo R$${piso}.

=== SPIN — OBJECAO DE TIMING (use quando cliente disser "vou pensar", "depois vejo", "agora nao", "semana que vem") ===
Ative SOMENTE quando o cliente sinalizar adiamento. Use UMA pergunta por mensagem. Tom de conversa — nunca interrogatorio.

S — Situacao (adapte ao perfil ja coletado na Etapa 2):
- Se SERVICO/OBRA: "Entendo! Voce ta usando alguma furadeira hoje no servico ou ta pegando emprestado?"
- Se CASA: "Entendo! Tem alguma coisa em casa que voce ta precisando furar ou parafusar mas ainda nao resolveu?"

P — Problema:
- Se SERVICO: "Quando precisa de uma ferramenta e nao tem, tem que parar o servico ou chamar alguem, ne?"
- Se CASA: "E fica dependendo de vizinho ou tendo que chamar um pedreiro so pra uma coisa simples..."

I — Implicacao:
- "Um pedreiro ou eletricista cobra R$150-300 por visita. Com a furadeira voce faz voce mesmo — economiza na primeira vez ja."

N — Necessidade:
"Se voce pudesse ter o kit completo — furadeira, brocas, bits, soquetes e maleta — por R$${preco} pagos so na entrega, valeria fechar ainda essa semana?"

Apos N: se cliente aceitar → retome fluxo normal. Se recusar → respeite e use AGENDAR se der data, ou encerre cordialmente.

=== RESPOSTAS OFICIAIS POR CENARIO ===
OUTRAS MARCAS/MODELOS: "Eu trabalho so com essa furadeira 48V. Se voce quiser, eu posso te mostrar como ela funciona."
TEM MAIS BARATA / VERSAO MAIS BARATA: "Essa aqui ja e o melhor custo-beneficio que tenho — kit completo com 2 baterias, maleta e todos os acessorios por R$${preco}. Posso te mostrar o video?"
COMO FUNCIONA: Explicar o produto, mostrar beneficio. Nao puxar preco de cara.
GARANTIA: "Minha garantia aqui e de 30 dias contra defeito de fabrica."
NOTA FISCAL: "Nao fazemos emissao de nota fiscal."
DESCONFIANCA: "Voce paga na entrega, direto ao entregador — zero risco antecipado. Instagram: instagram.com/atacadaovariedadess/"
RETIRADA / BUSCAR NA LOJA: "Nao fazemos retirada, trabalhamos somente com entrega! O pagamento e feito direto ao entregador na entrega." (REGRA INVIOLAVEL: NUNCA ofereça retirada — responda isso e PARE)
FORA DA AREA: "Vou te passar pro Miron pra ver uma alternativa pra voce!" + TRANSFERIR_HUMANO

=== TAGS ===
Para enviar midia ou executar acao, escreva a tag na resposta. O sistema processa e remove a tag.
Sem a tag, nada e enviado/executado.
ENVIAR_FOTO | ENVIAR_VIDEO | ENVIAR_AUDIO | NOTIFICAR_ENTREGA | TRANSFERIR_HUMANO | AGENDAR:DD/MM/YYYY:msg
Follow-up: cliente diz "depois" → pergunte a data → AGENDAR.
Dia futuro de entrega: incluir CONFIRMAR_DIA:DD/MM/YYYY.

ESTILO: Responda sempre a pergunta do cliente antes de fazer a sua. Nao repita informacao ja dada. Uma mensagem por vez, sem excessos.`;
}

// Builders de prompt indexados por agente
const PROMPT_BUILDERS = {
  pedro:   buildPromptPedro,
  rodrigo: buildPromptRodrigo,
};

// Follow-up messages removidos — substituídos pelo followup-engine (personalização por histórico)

// Seeded knowledge (real client reports)
const SEEDED_KNOWLEDGE = {
  pedro: [],
  rodrigo: [],
};

// Internal error sentinel - NEVER send to client
const ERRO_API_INTERNO = "__ERRO_INTERNO__";

// ============================================
// CROSS-PRODUCT DETECTION — multi-product transfer
// ============================================

function detectCrossProduct(agentId, clientMessage) {
  const msg = clientMessage.toLowerCase();
  if (agentId === "pedro") {
    if (/furadeira|parafusadeira|kit.*48v|broca|perfur/.test(msg)) {
      return { targetAgent: "rodrigo", product: "Furadeira 48V" };
    }
  }
  if (agentId === "rodrigo") {
    if (/uni\s*tv|tv\s*box|streaming|canais|filmes|netflix|smart\s*tv|aparelho.*tv/.test(msg)) {
      return { targetAgent: "pedro", product: "Uni TV V10" };
    }
  }
  return null;
}

// ============================================
// SYSTEM PROMPT BUILDER
// ============================================

function formatKnowledge(agentId) {
  const list = db.state.knowledge[agentId];
  if (!list || list.length === 0) return "";
  const recentes = list.slice(-20);
  const problemas = recentes.filter(k => k.tipo === "problema" || k.tipo === "restricao");
  const duvidas = recentes.filter(k => k.tipo === "duvida" || k.tipo === "info");
  const objecoes = recentes.filter(k => k.tipo === "objecao");
  let txt = "\n\nCONHECIMENTO APRENDIDO COM CLIENTES REAIS (use isso nas respostas):";
  if (problemas.length > 0) txt += "\n\nPROBLEMAS/RESTRICOES CONHECIDOS:\n" + problemas.map(k => `- ${sanitize(String(k.detalhe || k.resumo || ""))}`).join("\n");
  if (duvidas.length > 0) txt += "\n\nDUVIDAS FREQUENTES:\n" + duvidas.map(k => `- ${sanitize(String(k.detalhe || k.resumo || ""))}`).join("\n");
  if (objecoes.length > 0) txt += "\n\nOBJECOES COMUNS:\n" + objecoes.map(k => `- ${sanitize(String(k.detalhe || k.resumo || ""))}`).join("\n");
  return txt;
}

// Padroes de instrucoes TREINAR que conflitam com regras de preco/desconto do manual
const DANGEROUS_TREINAR_PATTERNS = /descont[ao]|promo[cç][aã]|pre[cç]o\s*especial|mais\s+barato|ofereç[ae]\s+(?:por|um)|fa[cç][ae]\s+por|fecha\s+(?:hoje|agora)\s*(?:com|por)|v[aá]lido\s+s[oó]\s+hoje|oferta\s+(?:especial|relamp|flash)/i;
const NEGATION_TREINAR = /\b(?:n[aã]o|nunca|jamais|proibido|bloqueado|sem\s+autoriza|apenas\s+com\s+autoriza)\b/i;
function isDangerousTreinar(text) {
  const t = String(text || "");
  return DANGEROUS_TREINAR_PATTERNS.test(t) && !NEGATION_TREINAR.test(t);
}

function cleanExpiredInstructions() {
  const MAX_PER_AGENT = 5;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
  const now = Date.now();
  let totalRemoved = 0;
  for (const id of ["pedro", "rodrigo"]) {
    if (!db.state.instructions[id]) continue;
    const before = db.state.instructions[id].length;
    // Remover instrucoes com datas passadas hardcoded
    db.state.instructions[id] = db.state.instructions[id].filter(inst => {
      const text = typeof inst === "string" ? inst : (inst.regras || "");
      // Remover se tem data passada no formato DD/MM (e mes ja passou ou dia ja passou)
      const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch) {
        const instDate = new Date(parseInt(dateMatch[3]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
        if (instDate < new Date(now - 2 * 24 * 60 * 60 * 1000)) return false; // 2 dias de margem
      }
      // Remover se tem timestamp e passou 7 dias
      if (inst.timestamp && now - inst.timestamp > TTL_MS) return false;
      // Remover numeros soltos
      if (/^\d{10,15}$/.test(text.trim())) return false;
      // Remover instrucoes perigosas que conflitam com regras de preco/desconto
      if (isDangerousTreinar(text)) {
        console.log(`[TREINAR-BLOCK] Instrucao perigosa removida de ${id}: ${text.slice(0, 60)}`);
        return false;
      }
      return true;
    });
    // Manter apenas as MAX_PER_AGENT mais recentes
    if (db.state.instructions[id].length > MAX_PER_AGENT) {
      db.state.instructions[id] = db.state.instructions[id].slice(-MAX_PER_AGENT);
    }
    totalRemoved += before - db.state.instructions[id].length;
  }
  if (totalRemoved > 0) {
    console.log(`[AUTO-EXPIRE] ${totalRemoved} instrucoes expiradas removidas`);
    db.save();
  }
}

function buildSystemPrompt(agentId, numero, mensagem) {
  // Auto-limpar instrucoes expiradas antes de montar prompt
  cleanExpiredInstructions();
  const instructions = db.state.instructions[agentId] || [];
  const knowledge = formatKnowledge(agentId);
  const time = getBrasiliaTime();
  const basePrompt = PROMPT_BUILDERS[agentId]();

  // Verificar oferta ativa UMA VEZ — excluir _legado (retrocompat de DB antigo — inconsistente, nao injetar no prompt)
  const _ofertaRaw = numero ? db.getActiveOffer(agentId, numero) : null;
  const ofertaAtiva = (_ofertaRaw && !_ofertaRaw._legado) ? _ofertaRaw : null;

  // Detecção de intenção informativa — usa mensagem atual (passada pelo caller ativo)
  // Só aplica em fluxo ativo (handleIncomingMessage passa mensagem), nunca em monitor/sweep
  let _blindagemTopo = "";
  if (mensagem) {
    const _lcM = mensagem.toLowerCase();
    const _isInfoIntent =
      /\bcomo\s+funciona\b/.test(_lcM) ||
      /\bme\s+explica\b/.test(_lcM) ||
      /\bquero\s+(?:mais\s+)?informa[cç][oõ]es?\b/.test(_lcM) ||
      /\btenho\s+interesse\b/.test(_lcM) ||
      /\bo\s+que\s+(?:[eé]|faz|tem)\b/.test(_lcM) ||
      /\bcomo\s+usa\b/.test(_lcM) ||
      /\bme\s+(?:fala|conta)\s+mais\b/.test(_lcM) ||
      /\bquero\s+(?:saber|conhecer|entender|ver|detalhes?)\b/.test(_lcM) ||
      /\bpode\s+(?:me\s+)?(?:explicar|falar)\b/.test(_lcM) ||
      /\bme\s+(?:fala|conta|passa)\s+(?:mais\s+)?(?:do|sobre|da|de)?\b/.test(_lcM) ||
      /\bmais\s+informa[cç][oõ]es?\b/.test(_lcM) ||
      /\bcomo\s+[eé]\s+(?:o|a)\b/.test(_lcM) ||
      /\bfala\s+(?:sobre|do|da|de)\b/.test(_lcM) ||
      /\bconta\s+(?:mais\s+)?(?:sobre|do|de)\b/.test(_lcM) ||
      /\bquero\s+(?:mais\s+)?detalhes?\b/.test(_lcM) ||
      /\bme\s+passa\s+(?:mais\s+)?(?:informa[cç][oõ]es?|detalhes?)\b/.test(_lcM);
    const _hasPriceIntent =
      /\bvalor\b/.test(_lcM) ||
      /\bpre[cç]o\b/.test(_lcM) ||
      /\bquanto\s+(?:custa|fica)\b/.test(_lcM) ||
      /\bfaz\s+por\s+quanto\b/.test(_lcM) ||
      /\bcusto\b/.test(_lcM) ||
      /\bbarato\b/.test(_lcM);
    if (_isInfoIntent && !_hasPriceIntent) {
      _blindagemTopo = `\n\nREGRA DE DESCOBERTA: O cliente fez pergunta informativa, nao pediu preco. Siga o fluxo oficial: explique o produto primeiro. NAO abra a resposta com preco. Preco so quando o cliente perguntar diretamente ("valor?", "quanto custa?") ou chegar naturalmente na etapa de preco.`;
    }
  }

  let prompt = "";

  // BLINDAGEM DE INTENÇÃO INFORMATIVA — injetada ANTES de todos os blocos de preço
  if (_blindagemTopo) prompt += _blindagemTopo;

  // OFERTA ATIVA — injetar PRIMEIRO (antes do prompt base) para que a IA nunca "esqueça"
  if (ofertaAtiva) {
    const _freteGratisAlerta = ofertaAtiva.freteGratis
      ? `\nFRETE GRÁTIS ATIVO: O dono também autorizou FRETE GRÁTIS para este cliente. O total é apenas R$${ofertaAtiva.precoDesconto} (sem adicionar frete).`
      : "";
    prompt += `🔴🔴🔴 OFERTA ESPECIAL ATIVA — LEIA ANTES DE QUALQUER COISA 🔴🔴🔴
O dono autorizou preco especial para ESTE numero especificamente.
PRECO DESTE CLIENTE: R$${ofertaAtiva.precoDesconto} (NAO R$${ofertaAtiva.precoOriginal || db.getAgentPrice(agentId)}).
Toda resposta comercial DEVE usar R$${ofertaAtiva.precoDesconto}. Ignorar = demissao imediata.${_freteGratisAlerta}
🔴🔴🔴 FIM ALERTA INICIAL 🔴🔴🔴

`;
  }

  prompt += basePrompt;

  prompt += `

=== REGRA DE IDENTIDADE ===
Seu nome de vendedor e ${CONFIG.AGENTS[agentId].name}. Isso e o SEU nome, NAO o nome do cliente.
NUNCA chame o cliente de "${CONFIG.AGENTS[agentId].name}" — esse e VOCE, nao ele.
Se o cliente NAO disse o nome dele, NAO invente. Nao use nome nenhum ate ele dizer.
=== FIM IDENTIDADE ===

=== REGRA DE PRECO — INVIOLAVEL ===
${ofertaAtiva ?
`⚠️ PRECO ESPECIAL AUTORIZADO PARA ESTE CLIENTE: R$${ofertaAtiva.precoDesconto}
O dono autorizou R$${ofertaAtiva.precoDesconto} para este numero (NAO R$${db.getAgentPrice(agentId)}).
Use R$${ofertaAtiva.precoDesconto} em todas as respostas comerciais.${ofertaAtiva.freteGratis ? `\n⚠️ FRETE GRÁTIS AUTORIZADO: O frete é ZERO para este cliente. Nao cobre frete. O total é apenas R$${ofertaAtiva.precoDesconto}. Se o cliente perguntar sobre frete, informe que está incluso/grátis.` : ""}` :
`NUNCA ofereça desconto, promoção ou preço especial se o cliente NAO pediu.
O preço padrão é o preço TABELADO do produto. Use esse preço SEMPRE.
NUNCA ofereça frete grátis por conta própria — frete grátis só existe quando o dono autorizar uma campanha.`}
${["pedro","rodrigo"].map(id => {
  if (id === "pedro" && !ofertaAtiva) {
    return `- Pedro (Uni TV V10): R$${PEDRO_PRODUCT_OPTIONS.v10.price} (pago na entrega)\n- Pedro (Uni TV S10 preto): R$${PEDRO_PRODUCT_OPTIONS.s10.price} (pago na entrega, unico com ESPN)`;
  }
  const pr = (id === agentId && ofertaAtiva) ? ofertaAtiva.precoDesconto : db.getAgentPrice(id);
  const tag = (id === agentId && ofertaAtiva) ? ` ← PRECO DESTE CLIENTE (AUTORIZADO PELO DONO)` : "";
  return `- ${CONFIG.AGENTS[id].name} (${db.getAgentProductName(id)}): R$${pr} (pago na entrega)${tag}`;
}).join("\n")}
Desconto SÓ quando o cliente JÁ CONHECE O PREÇO e disser explicitamente que está caro, que não vai conseguir comprar ou que não vai fechar por causa do valor. Perguntar preço, pedir versão mais barata ou não responder NÃO é objeção de preço.
Se uma instrução antiga mencionar promoção de data passada, IGNORE — promoções expiradas não valem mais.
=== FIM REGRA PRECO ===

=== REGRA SUPREMA DE ATENDIMENTO ===
SEMPRE responda a pergunta do cliente PRIMEIRO, ANTES de continuar o fluxo de atendimento ou fazer qualquer pergunta.
Se o cliente fez uma pergunta (ex: "voces sao de Goiania?", "quanto custa?", "como funciona?", "tem garantia?"):
1. RESPONDA a pergunta dele de forma DIRETA e COMPLETA.
2. SO DEPOIS continue o fluxo de atendimento.
Ignorar a pergunta do cliente e responder com outra pergunta e PROIBIDO — faz o cliente se sentir ignorado e desrespeitado.
Exemplo ERRADO: Cliente: "Voces sao de Goiania?" → Voce: "Qual tipo de trabalho voce faz?" (IGNOROU a pergunta)
Exemplo CORRETO: Cliente: "Voces sao de Goiania?" → Voce: "Sim! Estamos no Setor Campinas, pertinho da Av 24 de Outubro. Trabalhamos com entrega na regiao! Voce ta procurando o kit pra uso em casa ou profissional?"
=== FIM REGRA SUPREMA ===

=== REGRA DE AUDIO ===
Quando receber mensagem com "[Audio]:", a transcricao pode estar ERRADA ou CONFUSA.
Se o texto transcrito nao fizer sentido ou parecer cortado/embaralhado, NAO tente adivinhar o que o cliente quis dizer.
Responda: "Desculpa, nao consegui entender bem o audio! Pode me mandar por escrito?"
NUNCA tome decisoes importantes (recusar entrega, informar preco, transferir) com base em audio confuso.
=== FIM REGRA AUDIO ===

`;

  prompt += knowledge;

  // DESCONTO ATIVO — reforço final (sandwich: foi injetado no início, reforçado aqui no fim)
  if (ofertaAtiva) {
    const precoDesconto = ofertaAtiva.precoDesconto;
    const precoOriginal = ofertaAtiva.precoOriginal || db.getAgentPrice(agentId);
    const _lembreteFrete = ofertaAtiva.freteGratis
      ? `\nFRETE GRÁTIS ATIVO: Total deste cliente = R$${precoDesconto} (frete incluso/grátis). Confirme frete grátis se perguntado.`
      : "";
    prompt += `\n\n⚠️⚠️⚠️ LEMBRETE FINAL — OFERTA ATIVA ⚠️⚠️⚠️
Conforme informado no inicio: o preco deste cliente e R$${precoDesconto}, NAO R$${precoOriginal}.
NUNCA mencione R$${precoOriginal} nesta conversa. Use SEMPRE R$${precoDesconto}.${_lembreteFrete}
⚠️⚠️⚠️ FIM LEMBRETE ⚠️⚠️⚠️`;
  }

  // ANTI-LOOP FRETE: Se frete ja foi calculado nesta conversa, impedir que IA peca localizacao de novo
  if (numero) {
    const conv = db.getConversation(agentId, numero);
    if (conv && conv.msgs) {
      // FIX: usar conv.freteCalculado como sinal primario (mais robusto que checar msgs)
      const freteJaCalculado = !!(conv.freteCalculado && conv.freteCalculado.total) ||
        conv.msgs.some(m =>
          m.role === "user" && ((m.content || "").startsWith("[Cliente enviou localizacao:") || (m.content || "").startsWith("[Cliente informou distancia:"))
        );
      if (freteJaCalculado) {
        // FONTE AUTORITATIVA: conv.freteCalculado (salvo no momento do calculo)
        const freteData = conv.freteCalculado;
        if (freteData && freteData.total) {
          const parcelasComFrete = calcInstallments(freteData.total);
          const _freteDisplay = freteData.freteGratis ? "GRÁTIS (oferta autorizada pelo dono)" : `R$${freteData.frete} (${freteData.distKm}km)`;
          const _totalDetalhe = freteData.freteGratis
            ? `O total e R$${freteData.total} (apenas o produto — frete grátis autorizado).`
            : `O total e R$${freteData.total} (produto R$${freteData.produtoPreco} + frete R$${freteData.frete}).`;
          prompt += `\n\n⚠️⚠️⚠️ VALORES FIXOS DE FRETE — NAO ALTERE ESTES NUMEROS ⚠️⚠️⚠️
FRETE: ${_freteDisplay}
PRECO DO PRODUTO: R$${freteData.produtoPreco}
TOTAL A VISTA: R$${freteData.total}
PARCELAS NO CARTAO (sobre total R$${freteData.total}): ${parcelasComFrete}
⚠️ USE EXATAMENTE ESTES VALORES. NUNCA recalcule. NUNCA invente outros valores. NUNCA use valores diferentes.⚠️
REGRAS OBRIGATORIAS:
1. O frete JA foi calculado: ${_freteDisplay}. NAO peca localizacao de novo.
2. ${_totalDetalhe}
3. Siga a ETAPA 2: colete nome, ENDERECO COMPLETO (rua, quadra, lote, referencia), horario e forma de pagamento.
⚠️⚠️⚠️ FIM VALORES FIXOS ⚠️⚠️⚠️`;
        } else {
          // Fallback: usar texto do historico (mais recente primeiro)
          const lastFreteMsg = [...conv.msgs].reverse().find(m =>
            m.role === "assistant" && /Frete:.*R\$/.test(m.content || "")
          );
          const freteInfo = lastFreteMsg ? lastFreteMsg.content : "";
          prompt += `\n\n⚠️⚠️⚠️ FRETE JA FOI CALCULADO — NAO PECA LOCALIZACAO DE NOVO ⚠️⚠️⚠️
O cliente JA enviou a localizacao e o frete JA foi calculado: ${freteInfo}
REGRAS OBRIGATORIAS:
1. NAO peca localizacao, pin no mapa ou GPS novamente. O frete JA esta calculado.
2. Siga a ETAPA 2: colete nome, ENDERECO COMPLETO (rua, quadra, lote, ponto de referencia), horario e forma de pagamento.
3. ENDERECO e diferente de LOCALIZACAO. Voce precisa do endereco ESCRITO (rua, numero, bairro), NAO de outro pin no mapa.
4. Se o cliente ja deu o nome, peca o ENDERECO COMPLETO. Se ja deu endereco, peca o HORARIO. Siga a ordem da ETAPA 2.
⚠️⚠️⚠️ FIM ANTI-LOOP FRETE ⚠️⚠️⚠️`;
        }
      }
    }
  }

  // CONTEXTO DE CONTINUIDADE: detectar etapa da conversa e injetar contexto SEMPRE
  if (numero) {
    const conv = db.getConversation(agentId, numero);
    if (conv && conv.msgs && conv.msgs.length > 1) {
      const msgs = conv.msgs;
      const lastAssistantMsg = [...msgs].reverse().find(m => m.role === "assistant");
      const lastAssistantTime = lastAssistantMsg ? (lastAssistantMsg.timestamp || 0) : 0;
      const now = Date.now();
      const gapHoras = lastAssistantTime ? Math.floor((now - lastAssistantTime) / (60 * 60 * 1000)) : 0;

      // Resumir o que ja aconteceu na conversa
      const clientMsgs = msgs.filter(m => m.role === "user" && !(m.content || "").startsWith("[SISTEMA"));
      const assistantMsgs = msgs.filter(m => m.role === "assistant");

      // Detectar em que etapa parou
      const allText = msgs.map(m => (m.content || "").toLowerCase()).join(" ");
      let etapaAtual = "inicio";
      if (/notificar_entrega|transferir_humano|pedido confirmado/.test(allText)) etapaAtual = "venda fechada";
      // FIX: removido "localizacao" (falso positivo quando agente pede pin mas cliente ainda nao mandou)
      // agora requer evidencia real de valor calculado (R$+digitos) ou "km da loja"
      else if (/frete.*r\$\d|total.*r\$\d|r\$\d+.*frete|km da loja/.test(allText)) etapaAtual = "frete calculado, negociando entrega";
      else if (/pix|cartao|parcela|pagamento|dinheiro|credito/.test(allText)) etapaAtual = "discutindo pagamento";
      else if (/enviar_foto|enviar_video|foto|video|imagem/.test(allText)) etapaAtual = "produto apresentado (foto/video enviado)";
      else if (/preco|r\$\d|valor|quanto|custa/.test(allText)) etapaAtual = "preco informado";
      else if (clientMsgs.length >= 2) etapaAtual = "conversa em andamento";

      // Detectar o que o cliente ja confirmou/respondeu no historico
      const clientText = clientMsgs.map(m => (m.content || "").toLowerCase()).join(" ");
      const jaConfirmouEntrega = /sim|pode|quero|manda|bora|vamos|confirmo|fecha|ok|pode ser|manda ver/.test(clientText) && etapaAtual === "frete calculado, negociando entrega";

      // SEMPRE injetar contexto de conversa quando tem msgs >= 3 (nao apenas gap >= 2h)
      if (msgs.length >= 3) {
        const diasAtras = Math.floor(gapHoras / 24);
        const tempoTexto = gapHoras >= 2
          ? (diasAtras >= 1 ? `${diasAtras} dia${diasAtras > 1 ? "s" : ""}` : `${gapHoras} hora${gapHoras > 1 ? "s" : ""}`)
          : null;

        prompt += `\n\n=== CONTEXTO DA CONVERSA — CONTINUIDADE OBRIGATORIA ===
${tempoTexto ? `ATENCAO: Este cliente JA conversou com voce ha ${tempoTexto} atras.` : "ATENCAO: Esta e uma conversa EM ANDAMENTO."}
Voces tem ${msgs.length} mensagens no historico.
ETAPA ATUAL: ${etapaAtual}
TOTAL DE MSGS DO CLIENTE: ${clientMsgs.length} | SUAS MSGS: ${assistantMsgs.length}
${jaConfirmouEntrega ? `⚠️ CLIENTE JA CONFIRMOU QUE QUER ENTREGA — VA DIRETO PARA COLETAR DADOS (nome, endereco, horario, pagamento). NAO pergunte de novo se quer entrega.` : ""}

REGRAS INVIOLAVEIS DE CONTINUIDADE:
1. NAO comece do inicio. NAO diga "Oi, tudo bem? Sou o ${CONFIG.AGENTS[agentId].name}..." como se fosse a primeira vez.
2. CONTINUE de onde parou. Leia o historico e retome o assunto EXATAMENTE de onde parou.
3. NAO repita informacoes que ja foram ditas (preco, produto, fotos, videos, especificacoes).
4. NAO pergunte coisas que o cliente ja respondeu (nome, endereco, pagamento, interesse, uso).
5. Se o cliente ja viu foto/video, NAO envie de novo.
6. Se o frete ja foi calculado, NAO peca localizacao de novo.
7. Se a etapa era "frete calculado" e o cliente CONFIRMOU, va DIRETO para coletar nome/endereco/horario/pagamento.
8. Se a etapa era "frete calculado" e o cliente AINDA NAO confirmou, pergunte se quer a entrega.
9. Se a etapa era "preco informado", retome perguntando se ficou com alguma duvida.
10. LEIA o historico completo antes de responder. O contexto da conversa e a sua base.
11. NUNCA repita a mesma mensagem ou informacao com outras palavras. Cada resposta deve ser UNICA.
=== FIM CONTINUIDADE ===`;

        // Anti-repetição de preço: verificar se a estrutura já foi enviada recentemente
        const lastAgentMsgsAntiRep = msgs.filter(m => m.role === "assistant").slice(-5);
        const jaDissePrecoEntrega = lastAgentMsgsAntiRep.some(m =>
          /pago na entrega ao entregador/i.test(m.content || "")
        );
        const jaDisseParcelar = lastAgentMsgsAntiRep.some(m =>
          /posso parcelar no cart[aã]o/i.test(m.content || "")
        );
        if (jaDissePrecoEntrega || jaDisseParcelar) {
          prompt += `\n\n=== ANTI-REPETICAO DE PRECO ===\nVoce JA enviou recentemente mensagem com preco + "pago na entrega" + parcelas no cartao. NAO repita essa estrutura agora. Responda APENAS o que o cliente perguntou ou avance na conversa com algo diferente.\n=== FIM ANTI-REPETICAO ===`;
        }
      }
    }

  }

  const horaMin = `${String(time.hora).padStart(2, "0")}:${String(time.minuto).padStart(2, "0")}`;
  prompt += `\n\n=== DATA E HORA OFICIAL (Brasilia) ===
HOJE: ${time.formatted}
Data de hoje: ${time.data}
Dia da semana: ${time.dia}
Hora: ${horaMin}
IMPORTANTE: Use ESTA data como referencia. Se o cliente perguntar "amanha", calcule a partir de ${time.data}. Se disser "sexta", calcule a partir de hoje (${time.dia}). NUNCA use datas do seu treinamento.`;

  // ALERTA FORTE quando loja fechada — reforçar para o Claude não ignorar
  const isDomingo = time.dia === "Domingo";
  const isSabado = time.dia === "Sabado";
  const isSabadoTarde = isSabado && time.hora >= 13;
  const isSabadoCedo = isSabado && time.hora < 9;
  // Seg-Sex: 10:00-16:30 | Sab: 09:00-13:00
  const isForaHorarioSemana = !isSabado && !isDomingo && (time.hora < 10 || time.hora > 16 || (time.hora === 16 && time.minuto >= 30));
  const isForaHorarioSab = isSabado && (isSabadoTarde || isSabadoCedo);
  const isForaHorario = isForaHorarioSemana || isForaHorarioSab;
  if (isDomingo) {
    prompt += `\n\n⚠️⚠️⚠️ ALERTA MAXIMO: HOJE E DOMINGO — LOJA FECHADA ⚠️⚠️⚠️
A loja NAO abre no domingo. NAO existe entrega hoje.
Se o cliente quiser comprar, INFORME que a loja so reabre SEGUNDA-FEIRA as 10:00.
NAO diga "podemos entregar hoje" ou qualquer coisa que sugira que a loja esta aberta.
Voce PODE continuar a conversa de vendas, mas entrega so SEGUNDA a partir das 10:00.`;
  } else if (isSabadoTarde) {
    prompt += `\n\n⚠️ ATENCAO: SABADO APOS 13:00 — LOJA JA FECHOU
A loja fecha sabado as 13:00. NAO ofereça entrega hoje.
Proponha SEGUNDA-FEIRA de manha (10:00) como proximo horario disponivel.
NAO diga "mais tarde" ou "a tarde". A loja JA FECHOU e so reabre SEGUNDA as 10:00.`;
  } else if (isForaHorario) {
    // Calcular proximo horario disponivel com precisao
    let proximoHorario = "amanha as 10:00";
    if (time.dia === "Sexta" && (time.hora > 16 || (time.hora === 16 && time.minuto >= 30))) proximoHorario = "segunda-feira as 10:00";
    else if (isSabadoCedo) proximoHorario = "hoje as 09:00";
    else if (isSabado) proximoHorario = "segunda-feira as 10:00";
    prompt += `\n\n⚠️ FORA DO HORARIO: Loja fechada agora (${horaMin}). Horario: seg-sex 10:00-16:30, sab 09:00-13:00.
Voce pode continuar vendendo, mas entrega so ${proximoHorario}.
NAO diga "apos as 17:00", "mais tarde hoje", ou "a noite". A loja JA FECHOU.
Proximo horario disponivel para entrega: ${proximoHorario}.
NAO invente horarios. Use EXATAMENTE: "${proximoHorario}".`;
  }

  // DIRETRIZES OPERACIONAIS — injetadas DEPOIS do manual, com hierarquia clara
  // Instrucoes perigosas (desconto/promo) ja foram removidas pelo cleanExpiredInstructions
  // Filtramos novamente aqui como seguranca adicional
  const _safeInsts = instructions.filter(inst => {
    const text = typeof inst === "string" ? inst : (inst.regras || String(inst || ""));
    return !isDangerousTreinar(text);
  });
  if (_safeInsts.length > 0) {
    prompt += "\n\n=== DIRETRIZES OPERACIONAIS DO GERENTE ===\n";
    prompt += "Complementam o manual. HIERARQUIA: regras do manual (acima) > estas diretrizes. Em conflito, o manual prevalece.\n";
    prompt += "NAO autorizam desconto, promocao ou preco especial — isso so existe via oferta autorizada pelo dono.\n";
    _safeInsts.forEach((inst, i) => {
      const text = sanitize(String(inst.regras || inst || ""));
      prompt += `${i + 1}. ${text}\n`;
    });
    prompt += "=== FIM DIRETRIZES OPERACIONAIS ===";
  }

  return prompt;
}

// ============================================
// KNOWLEDGE EXTRACTION (async, non-blocking)
// ============================================

async function extractKnowledge(agentId, clientMessage, agentResponse) {
  try {
    const result = await callClaude(
      `Voce analisa conversas de vendas e extrai informacoes uteis que o agente deve aprender e lembrar para futuras conversas.

Analise a mensagem do cliente e identifique se contem:
- Problemas tecnicos relatados (canais que nao funcionam, erros, incompatibilidades)
- Restricoes de operadoras/provedores de internet
- Duvidas frequentes que outros clientes podem ter
- Informacoes sobre concorrentes
- Objecoes comuns

Se encontrar algo util, responda APENAS com JSON no formato:
{"aprender": true, "tipo": "problema|duvida|restricao|objecao|info", "resumo": "resumo curto em 1 linha", "detalhe": "explicacao completa para o agente usar"}

Se nao houver nada relevante para aprender, responda:
{"aprender": false}`,
      [{ role: "user", content: sanitize(`Mensagem do cliente: "${clientMessage}"\nResposta do agente: "${agentResponse}"`) }],
      { maxTokens: 300 }
    );
    if (!result) return;
    let json;
    try { json = JSON.parse(result.replace(/```json|```/g, "").trim()); } catch (e) { return; }
    if (json && json.aprender && json.resumo) {
      const entry = { tipo: json.tipo, resumo: json.resumo, detalhe: json.detalhe, data: Date.now() };
      const knowledgeList = db.state.knowledge[agentId];
      if (!knowledgeList) return;
      const alreadyExists = knowledgeList.some(k => k.resumo.toLowerCase().includes(json.resumo.toLowerCase().substring(0, 20)));
      if (!alreadyExists) {
        knowledgeList.push(entry);
        console.log(`${CONFIG.AGENTS[agentId].name} aprendeu: ${json.resumo}`);
        db.save();
      }
    }
  } catch (e) { /* silent - never break flow */ }
}

// ============================================
// LARA NOTIFICATION (logistics)
// ============================================

async function notifyLara(agentId, numero, orderData) {
  try {
    const agent = CONFIG.AGENTS[agentId];
    const prompt = `Voce e Lara, agente de logistica da Atacadao Variedades.
Voce recebeu um novo pedido e deve enviar uma mensagem clara e organizada para o dono separar o produto.
Seja direta, objetiva e use emojis para facilitar a leitura.
Formato obrigatorio:
NOVO PEDIDO - [AGENTE]
Cliente: [nome]
WhatsApp: [numero]
Endereco: [endereco completo]
Pagamento: [forma]
Valor: [valor]
Observacoes: [obs ou horario]
---
Produto para separar: [produto]`;

    const msg = await callClaude(prompt, [{ role: "user", content: `Pedido recebido do agente ${agentId}:\n${JSON.stringify(orderData, null, 2)}\n\nGere a mensagem para o dono.` }], { maxTokens: 300 });
    const finalMsg = msg || `NOVO PEDIDO - ${agent.name.toUpperCase()}\n${numero}\n${JSON.stringify(orderData)}`;

    // Lara sends via Pedro's Z-API instance to LARA_NUMERO
    await sendText("pedro", CONFIG.LARA_NUMERO, `*Lara - Logistica:*\n\n${finalMsg}`);
    console.log(`Lara notificou Miron sobre pedido de ${agentId} - cliente ${numero}`);
    db.state.metrics.lara.pedidos++;
    db.addEvent(`lara_pedido: ${agentId} ${numero}`);

    // Salvar pedido no banco para dashboard de logistica
    db.addPedidoAtk({
      tipo: "entrega",
      cliente: orderData.nome || orderData.cliente || "",
      numero,
      agentId,
      produto: orderData.produto || agent.product,
      valor: orderData.valor || "",
      endereco: orderData.endereco || "",
      pagamento: orderData.pagamento || "",
      horario: orderData.horario || "",
      observacao: orderData.resumo || orderData.observacao || "",
    });
  } catch (e) {
    console.error("Erro Lara:", e.message);
    // Fallback without AI
    await sendText("pedro", CONFIG.LARA_NUMERO, `*PEDIDO - ${CONFIG.AGENTS[agentId].name.toUpperCase()}*\nwa.me/${numero}\n\nDados: ${JSON.stringify(orderData)}`);
  }
}

// ============================================
// TAG PROCESSING
// ============================================

async function processTags(agentId, numero, rawResponse, clientMessage) {
  const agent = CONFIG.AGENTS[agentId];
  const media = agent.media;
  const agentName = agent.name.toUpperCase();
  const price = db.getAgentPrice(agentId);

  // Log tags detectadas para debug
  const tagsFound = [];
  if (rawResponse.includes("ENVIAR_FOTO")) tagsFound.push("ENVIAR_FOTO");
  if (rawResponse.includes("ENVIAR_VIDEO")) tagsFound.push("ENVIAR_VIDEO");
  if (rawResponse.includes("ENVIAR_AUDIO")) tagsFound.push("ENVIAR_AUDIO");
  if (rawResponse.includes("NOTIFICAR_DONO")) tagsFound.push("NOTIFICAR_DONO");
  if (rawResponse.includes("TRANSFERIR_HUMANO")) tagsFound.push("TRANSFERIR_HUMANO");
  if (tagsFound.length > 0) {
    console.log(`[TAGS] ${agent.name}/${numero}: ${tagsFound.join(", ")}`);
  }

  // Ensure single message - remove separators
  let texto = rawResponse.replace(/\n---+\n/g, " ").replace(/\n{3,}/g, "\n\n");

  // Detectar intenção informativa do cliente — evita que fallbackPrecos dispare em comparações legítimas
  // (ex: "você economiza R$300/ano" não é oferta de preço errado, é argumento de venda)
  // Detectar pergunta de parcelamento — valores como totais parcelados e parcelas individuais são legítimos
  const _isInstallmentIntent = clientMessage
    ? /\b(?:divide|divid[ie]|parcel[ao]?r?|em\s+quantas|quantas\s+vezes|vezes\s+no\s+cart[aã]o|cart[aã]o.*vezes|presta[cç][aã]o|presta[cç][oõ]es|parcelas?)\b/i.test(clientMessage)
    : false;
  const _isInfoIntentLocal = clientMessage ? (() => {
    const lc = clientMessage.toLowerCase();
    const infoMatch =
      /\bcomo\s+funciona\b/.test(lc) || /\bme\s+explica\b/.test(lc) ||
      /\btenho\s+interesse\b/.test(lc) || /\bo\s+que\s+(?:[eé]|faz|tem)\b/.test(lc) ||
      /\bcomo\s+usa\b/.test(lc) || /\bme\s+(?:fala|conta)\s+mais\b/.test(lc) ||
      /\bquero\s+(?:saber|conhecer|entender|ver|detalhes?)\b/.test(lc) ||
      /\bpode\s+(?:me\s+)?(?:explicar|falar)\b/.test(lc) ||
      /\bconta\s+(?:mais\s+)?(?:sobre|do|de)\b/.test(lc) ||
      /\bquero\s+(?:mais\s+)?(?:informa[cç][oõ]es?|detalhes?)\b/.test(lc);
    const priceMatch =
      /\bvalor\b/.test(lc) || /\bpre[cç]o\b/.test(lc) ||
      /\bquanto\s+(?:custa|fica)\b/.test(lc) || /\bcusto\b/.test(lc) || /\bbarato\b/.test(lc);
    return infoMatch && !priceMatch;
  })() : false;

  // ENVIAR_FOTO
  if (texto.includes("ENVIAR_FOTO")) {
    texto = texto.replace("ENVIAR_FOTO", "").trim();
    const productCtx = getProductContext(agentId, numero, `${clientMessage || ""}\n${texto || ""}`);
    const fotoUrl = agentId === "pedro" && productCtx.key === "s10" ? media.s10Foto : media.foto1;
    if (wasMediaSent(agentId, numero, productCtx, "image")) {
      console.log(`Foto repetida bloqueada para ${numero} via ${agentId} (${productCtx.name})`);
    } else if (fotoUrl) {
      const sent = await sendMedia(agentId, numero, "image", fotoUrl);
      if (sent) {
        markMediaSent(agentId, numero, productCtx, "image");
        console.log(`Foto enviada para ${numero} via ${agentId} (${productCtx.name})`);
      }
    } else {
      console.error(`ENVIAR_FOTO: URL vazia para agente ${agentId} (${productCtx.name})`);
    }
  }

  // ENVIAR_VIDEO
  if (texto.includes("ENVIAR_VIDEO")) {
    texto = texto.replace("ENVIAR_VIDEO", "").trim();
    const productCtx = getProductContext(agentId, numero, `${clientMessage || ""}\n${texto || ""}`);
    const videoUrl = agentId === "pedro" && productCtx.key === "s10" ? media.s10Video : media.video1;
    if (wasMediaSent(agentId, numero, productCtx, "video")) {
      console.log(`Video repetido bloqueado para ${numero} via ${agentId} (${productCtx.name})`);
    } else if (videoUrl) {
      const sent = await sendMedia(agentId, numero, "video", videoUrl);
      if (sent) {
        markMediaSent(agentId, numero, productCtx, "video");
        console.log(`Video enviado para ${numero} via ${agentId} (${productCtx.name})`);
      }
    } else {
      console.error(`ENVIAR_VIDEO: URL vazia para agente ${agentId} (${productCtx.name})`);
    }
  }

  // ENVIAR_AUDIO
  if (texto.includes("ENVIAR_AUDIO")) {
    texto = texto.replace("ENVIAR_AUDIO", "").trim();
    if (media.audio1) {
      await sendMedia(agentId, numero, "audio", media.audio1);
      console.log(`Audio enviado para ${numero} via ${agentId}`);
    } else {
      console.error(`ENVIAR_AUDIO: URL vazia para agente ${agentId}`);
    }
  }

  function getProductLabel(aid) {
    if (aid === "pedro") {
      const productCtx = getProductContext("pedro", numero, `${clientMessage || ""}\n${texto || ""}`);
      return `${productCtx.name} R$${productCtx.price} PIX`;
    }
    if (aid === "rodrigo") return `${db.getAgentProductName("rodrigo")} R$${db.getAgentPrice("rodrigo")} PIX`;
    return agent.product;
  }

  // NOTIFICAR_DONO
  if (texto.includes("NOTIFICAR_DONO")) {
    texto = texto.replace("NOTIFICAR_DONO", "").trim();
    db.addEvent(`fechamento_${agentId}: ${numero} (aguardando lancamento manual)`);
    // Pausa MANUAL — só Miron pode liberar
    db.pauseManual(numero, agentId);
    // Marcar conversa como finalizada
    const convDono = db.getConversation(agentId, numero);
    if (convDono) convDono.finalizado = true;
    // Converter oferta ativa em "convertida" (venda fechada)
    db.convertOffer(numero);
    db.save();
    // NÃO registra venda automaticamente — só Miron lança no CRM
    const productLabel = getProductLabel(agentId);
    await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agentName} - VENDA PENDENTE*\nCliente: wa.me/${numero}\nProduto: ${productLabel}\n\n_Lance a venda no CRM do dashboard._\n_Cliente PAUSADO — libere com "liberar ${numero}"_`);
    await notifyLara(agentId, numero, { tipo: "fechamento", resumo: texto, produto: productLabel });
  }

  // TRANSFERIR_HUMANO
  if (texto.includes("TRANSFERIR_HUMANO")) {
    texto = texto.replace("TRANSFERIR_HUMANO", "").trim();
    // Pausa MANUAL — só Miron pode liberar
    db.pauseManual(numero, agentId);
    // Marcar conversa como finalizada
    const convFinal = db.getConversation(agentId, numero);
    if (convFinal) convFinal.finalizado = true;
    db.addEvent(`transferir_humano: ${agentId} ${numero}`);
    db.save();
    await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agentName} - CLIENTE QUER HUMANO*\n\nCliente: wa.me/${numero}\n_Cliente PAUSADO — libere com "liberar ${numero}"_`);
  }

  // NOTIFICAR_ENTREGA
  if (rawResponse.includes("NOTIFICAR_ENTREGA")) {
    texto = texto.replace("NOTIFICAR_ENTREGA", "").trim();
    db.addEvent(`pedido_entrega: ${agentId} ${numero} (aguardando lancamento manual)`);
    // NÃO registra venda automaticamente — só Miron lança no CRM
    const conv = db.getConversation(agentId, numero);
    const msgs = conv?.msgs || [];
    const historico = msgs.slice(-20).map(m => `${m.role === "user" ? "Cliente" : agentName}: ${sanitize(m.content)}`).join("\n");
    const productLabel = getProductLabel(agentId);
    await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agentName} - ENTREGA PENDENTE*\nCliente: wa.me/${numero}\nProduto: ${productLabel}\n\n_Lance a venda no CRM do dashboard._`);
    await notifyLara(agentId, numero, { tipo: "entrega", historico: historico.slice(-800), produto: productLabel });
  }

  // CONFIRMAR_DIA — Agendar confirmação de entrega/retirada para data futura
  const confirmarDiaMatch = rawResponse.match(/CONFIRMAR_DIA:(\d{2}\/\d{2}\/\d{4})/);
  if (confirmarDiaMatch) {
    texto = texto.replace(/CONFIRMAR_DIA:[^\n]*/g, "").trim();
    const dataStr = confirmarDiaMatch[1];
    const [dia, mes, ano] = dataStr.split("/");
    const deliveryDate = new Date(ano, mes - 1, dia, 8, 0, 0); // 08:00 horário servidor
    const delay = deliveryDate.getTime() - Date.now();
    const MAX_TIMEOUT = 2147483647;
    if (delay > 0 && delay <= MAX_TIMEOUT) {
      // Extrair nome do cliente da conversa
      const convConfirm = db.getConversation(agentId, numero);
      const msgsConfirm = (convConfirm?.msgs || []).slice(-20);
      const historicoConfirm = msgsConfirm.map(m => `${m.role === "user" ? "Cliente" : agent.name}: ${sanitize(m.content)}`).join("\n");
      let dadosConfirm = { nome: "cliente" };
      try {
        const extracted = await callClaude(
          "Extraia do historico o nome do cliente. Responda SOMENTE JSON válido sem markdown.",
          [{ role: "user", content: `${historicoConfirm}\n\nFormato: {"nome":""}` }],
          { maxTokens: 100 }
        );
        dadosConfirm = JSON.parse((extracted || "{}").replace(/```json|```/g, "").trim());
      } catch (e) { /* usa default */ }

      const productLabel = getProductLabel(agentId);
      const nomeCliente = dadosConfirm.nome || "cliente";

      const confirmMsg = `Oi ${nomeCliente}! Tudo bem? Passando pra confirmar que hoje e o dia da entrega do seu ${productLabel}! O Miron vai entrar em contato pra combinar o horario certinho. Qualquer coisa, estamos por aqui!`;

      const confirmKey = `confirm_${agentId}_${numero}_${dataStr}`;
      db.state.schedules.set(confirmKey, { agentId, numero, data: dataStr, msg: confirmMsg, tipo: "confirmacao" });

      setTimeout(async () => {
        try {
          // Envia confirmação direto (bypass pause — é msg do sistema)
          await sendText(agentId, numero, confirmMsg);
          db.state.schedules.delete(confirmKey);
          // Avisa Miron
          await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agentName} - CONFIRMACAO ENVIADA*\nCliente: wa.me/${numero}\nTipo: Entrega\nData: ${dataStr}\nProduto: ${productLabel}`);
          console.log(`Confirmacao de entrega enviada para ${numero} (${agentId}) - data ${dataStr}`);
          db.addEvent(`confirmacao_enviada: ${agentId} ${numero} ${dataStr}`);
        } catch (e) {
          console.error(`Erro ao enviar confirmacao para ${numero}:`, e.message);
          db.state.schedules.delete(confirmKey); // Limpar schedule mesmo com erro pra não vazar memória
        }
      }, delay);

      db.save();
      console.log(`Confirmacao agendada: ${confirmKey} para ${dataStr} as 08:00`);
    }
  }

  // Remove AGENDAR and CONFIRMAR_DIA tags from visible text
  texto = texto.replace(/AGENDAR:[^\n]*/g, "").replace(/CONFIRMAR_DIA:[^\n]*/g, "").trim();

  // Process date scheduling from raw response
  const dateMatch = rawResponse.match(/AGENDAR:(\d{2}\/\d{2}\/\d{4}):([^\n]+)/);
  if (dateMatch) {
    const [_, dataStr, msgAgendada] = dateMatch;
    const [dia, mes, ano] = dataStr.split("/");
    const delay = new Date(ano, mes - 1, dia, 9, 0, 0).getTime() - Date.now();
    const MAX_TIMEOUT = 2147483647; // ~24.8 days, max safe setTimeout value
    if (delay > 0 && delay <= MAX_TIMEOUT) {
      const agendKey = `${agentId}_${numero}_${dataStr}`;
      db.state.schedules.set(agendKey, { agentId, numero, data: dataStr, msg: msgAgendada });
      setTimeout(async () => {
        try {
        if (db.isPaused(agentId, numero)) { db.state.schedules.delete(agendKey); return; }
        await sendText(agentId, numero, msgAgendada);
        db.state.schedules.delete(agendKey);
        console.log(`Agendamento ${agendKey} disparado no dia combinado`);
        // If client doesn't respond in 2h, allow follow-up
        setTimeout(async () => {
          const conv = db.getConversation(agentId, numero);
          if (!conv) return;
          if (Date.now() - conv.ultimaMensagem < 110 * 60 * 1000) return;
          if (db.isPaused(agentId, numero)) return;
          scheduleFollowUp(agentId, numero);
          console.log(`Cliente ${numero} nao respondeu no dia combinado - follow-up liberado`);
        }, 2 * 60 * 60 * 1000);
        } catch (e) { console.error(`Erro agendamento ${agendKey}:`, e.message); db.state.schedules.delete(agendKey); }
      }, delay);
      db.save();
    }
  }

  // Relative scheduling in minutes: AGENDAR:Xmin:mensagem
  const minMatch = rawResponse.match(/AGENDAR:(\d+)min:([^\n]+)/);
  if (minMatch) {
    const [_, mins, msgAgendada] = minMatch;
    const minsInt = Math.max(parseInt(mins), 60); // minimum 60 min
    const delay = minsInt * 60 * 1000;
    setTimeout(async () => {
      if (!db.isPaused(agentId, numero)) {
        await sendText(agentId, numero, msgAgendada);
      }
    }, delay);
  }

  // Detect if agent asked client for a date (awaitingDate state)
  const askedDate = /que dia|qual (dia|data|semana)|quando (seria|prefere|quer|posso)|me (diz|fala|confirma) (a data|o dia)|qual seria|para quando/i.test(texto);
  const confirmedDate = /AGENDAR:\d{2}\/\d{2}\/\d{4}/.test(rawResponse);
  const awaitKey = `${agentId}_${numero}`;
  if (confirmedDate) {
    db.state.awaitingDate.delete(awaitKey);
  } else if (askedDate) {
    db.state.awaitingDate.add(awaitKey);
    console.log(`${agentId}/${numero} marcado como aguardandoData`);
  }

  // TRAVA ANTI-MANIPULACAO: Detectar preco errado (abaixo do piso OU preco de outro produto)
  // Leitura de db.agentCatalog — fonte única e persistida, reflete mudancas sem restart
  const getPrecoAgente = (id, num = numero, msgAtual = texto) => {
    const productCtx = getProductContext(id, num, msgAtual);
    return {
      preco: productCtx.price,
      piso: productCtx.floor,
      produto: productCtx.name,
    };
  };
  const getPrecosValidos = (id) => {
    if (id === "pedro") return [
      PEDRO_PRODUCT_OPTIONS.v10.price,
      PEDRO_PRODUCT_OPTIONS.v10.floor,
      PEDRO_PRODUCT_OPTIONS.s10.price,
    ];
    return [db.getAgentPrice(id), db.getAgentPiso(id)];
  };

  // Gerar parcelas validas para o preco base (sem frete) de cada agente — pra nao travar se IA mencionar
  function getValidPricesWithInstallments(agentId, numero) {
    const basePrices = getPrecosValidos(agentId) ? [...getPrecosValidos(agentId)] : [];
    const baseProductPrices = agentId === "pedro"
      ? [PEDRO_PRODUCT_OPTIONS.v10.price, PEDRO_PRODUCT_OPTIONS.s10.price]
      : [getPrecoAgente(agentId)?.preco].filter(Boolean);
    for (const basePrice of baseProductPrices) {
      // Adicionar parcelas sobre preco base (sem frete)
      for (let i = 1; i <= 10; i++) {
        const taxa = TAXAS_PARCELA[i];
        const valorParcela = Math.ceil(basePrice * (1 + taxa) / i);
        basePrices.push(valorParcela);
        basePrices.push(valorParcela + 1); // margem de arredondamento
      }
      // Incluir preço com desconto ativo como válido (evita trava bloquear desconto autorizado)
    }
    const basePrice = getPrecoAgente(agentId)?.preco;
    if (basePrice) {
      const ofertaDesc = db.getActiveOffer(agentId, numero);
      if (ofertaDesc) {
        const precoDesc = ofertaDesc.precoDesconto;
        basePrices.push(precoDesc);
        basePrices.push(precoDesc - 1); // margem
        // Parcelas sobre preço com desconto (sem frete)
        for (let i = 1; i <= 10; i++) {
          const taxa = TAXAS_PARCELA[i];
          const valorParcela = Math.ceil(precoDesc * (1 + taxa) / i);
          basePrices.push(valorParcela);
          basePrices.push(valorParcela + 1);
        }
        // Parcelas sobre preço com desconto + frete (se frete calculado)
        const convDescFrete = db.getConversation(agentId, numero);
        if (convDescFrete?.freteCalculado) {
          const freteVal = convDescFrete.freteCalculado.frete || 0;
          const totalDescComFrete = precoDesc + freteVal;
          basePrices.push(totalDescComFrete);
          basePrices.push(totalDescComFrete + 1);
          for (let i = 1; i <= 10; i++) {
            const taxa = TAXAS_PARCELA[i];
            const valorParcela = Math.ceil(totalDescComFrete * (1 + taxa) / i);
            basePrices.push(valorParcela);
            basePrices.push(valorParcela + 1);
          }
        }
        // Com frete grátis: total = apenas preço do produto (sem frete)
        if (ofertaDesc.freteGratis) {
          basePrices.push(precoDesc);
          for (let i = 1; i <= 10; i++) {
            const taxa = TAXAS_PARCELA[i];
            const valorParcela = Math.ceil(precoDesc * (1 + taxa) / i);
            basePrices.push(valorParcela);
            basePrices.push(valorParcela + 1);
          }
        }
      }
      // Se frete ja foi calculado: usar conv.freteCalculado (fonte autoritativa) OU fallback no historico
      const convFrete = db.getConversation(agentId, numero);
      if (convFrete) {
        // FONTE PRIMARIA: conv.freteCalculado (salvo deterministicamente no momento do calculo)
        let totalComFrete = convFrete.freteCalculado?.total || null;
        if (!totalComFrete && convFrete.msgs) {
          // FALLBACK: parsear do historico — mais recente primeiro (evita valor stale se cliente mandou local 2x)
          const freteMsg = [...convFrete.msgs].reverse().find(m => /Total a vista: R\$(\d+)/.test(m.content || ""));
          if (freteMsg) {
            const totalMatch = (freteMsg.content || "").match(/Total a vista: R\$(\d+)/);
            if (totalMatch) totalComFrete = parseInt(totalMatch[1]);
          }
        }
        if (totalComFrete) {
          basePrices.push(totalComFrete);
          basePrices.push(totalComFrete + 1); // margem
          for (let i = 1; i <= 10; i++) {
            const taxa = TAXAS_PARCELA[i];
            const valorParcela = Math.ceil(totalComFrete * (1 + taxa) / i);
            basePrices.push(valorParcela);
            basePrices.push(valorParcela + 1);
          }
        }
      }
    }
    return basePrices;
  }
  if (texto.trim()) {
    let precoInfo = getPrecoAgente(agentId);
    let precosValidos = getValidPricesWithInstallments(agentId, numero);
    // ANTI-LOOP: Se a trava ja disparou nas ultimas 10 msgs assistentes, NAO disparar novamente
    // Evita loop infinito onde a trava polui o historico → Claude responde sobre preco → trava dispara de novo
    const convAntiLoop = db.getConversation(agentId, numero);
    if (convAntiLoop && convAntiLoop.msgs) {
      const lastAssistantMsgs = convAntiLoop.msgs.filter(m => m.role === "assistant").slice(-10);
      const travaCount = lastAssistantMsgs.filter(m => {
        const c = m.content || "";
        return c.includes("preco tabelado") ||
               /posso parcelar no cart[aã]o/i.test(c) ||
               /^O .+ fica R\$\d+\.$/.test(c.trim()); // nova mensagem neutra de trava
      }).length;
      if (travaCount >= 2) {
        console.log(`[ANTI-LOOP] ${agentId}/${numero}: trava ja disparou ${travaCount}x nas ultimas 10 msgs — ignorando validacao de preco`);
        precoInfo = null; // Desativa a trava para esta resposta
      }
    }
    // TRAVA ANTECIPADA R$48 (Rodrigo): SEMPRE verificar, independente de precoInfo
    // FIX CRITICO: removido "precoInfo &&" — anti-loop de preco nao pode desativar essa trava especifica
    // (48V = voltagem da ferramenta, NUNCA preco — regra inviolavel)
    if (agentId === "rodrigo" && /R\$\s*48(?:[,.]00)?\b/i.test(texto)) {
      console.error(`TRAVA DE PRECO (48V≠R$48): rodrigo tentou dizer R$48 (voltagem do produto) para ${numero}`);
      db.addEvent(`trava_preco_48v: rodrigo ${numero} confundiu 48V com R$48`);
      texto = `A Furadeira 48V sai por R$${db.getAgentPrice("rodrigo")}. O 48V é a voltagem da ferramenta, não o preço!`;
      await sendText(agentId, CONFIG.SEU_WHATSAPP, `*ALERTA TRAVA R$48*\nRodrigo tentou dizer R$48 (confundiu voltagem 48V com preco)\nCliente: wa.me/${numero}\n\n_Mensagem corrigida para R$${db.getAgentPrice("rodrigo")}._`);
    }
    if (precoInfo && precosValidos) {
      // Procurar padroes de OFERTA DE PRECO (ex: "por R$300", "fica R$300", "e R$149", "consigo R$300")
      // GUARD: desabilitar em respostas informativas OU de parcelamento — evita falso positivo
      // Pergunta de parcelamento gera valores legítimos > preço (totais com taxa, parcelas de outros clientes)
      const _disablePriceTrap = _isInfoIntentLocal || _isInstallmentIntent;
      const precosNaMsg = !_disablePriceTrap ? texto.match(/(?:(?:fica|custa|sai|cobr|pag|fazer|consigo|faco|[eé])\s+(?:por\s+)?R\$\s*|por\s+(?:apenas\s+)?R\$\s*|R\$\s*(\d{3})\s*(?:a\s+vista|no\s+pix|reais|com\s+\d))(\d{2,3})(?:[,.](?:00|\d{2}))?/gi) : null;
      // Fallback: tambem pegar "R$XXX" isolado que seja proximo do preco do produto OU preco de outro agente
      // GUARD: desabilitar fallback em respostas informativas ou de parcelamento
      const fallbackPrecos = texto.match(/R\$\s*(\d{3})(?:[,.](?:00|\d{2}))?/gi);
      const todosPrecos = precosNaMsg || [];
      const TODOS_PRECOS_CONHECIDOS = ["pedro","rodrigo"].flatMap(id => [db.getAgentPrice(id), db.getAgentPiso(id)]);
      if (fallbackPrecos && !_disablePriceTrap) {
        for (const fb of fallbackPrecos) {
          const fbVal = parseInt(fb.match(/(\d{3})/)?.[1] || "0");
          // FIX: expandido — captura qualquer R$XXX >= 100 que nao seja preco valido do agente
          // (antes limitava a proximoDoMeuPreco: piso-50 ate preco+50, deixando R$149 escapar para Pedro)
          const proximoDoMeuPreco = fbVal >= 100 && fbVal <= precoInfo.preco + 50;
          const precoDeOutroAgente = TODOS_PRECOS_CONHECIDOS.includes(fbVal) && !precosValidos.includes(fbVal);
          if ((proximoDoMeuPreco || precoDeOutroAgente) && fbVal !== precoInfo.preco) {
            todosPrecos.push(fb);
          }
        }
      }
      if (todosPrecos.length > 0) {
        for (const match of todosPrecos) {
          const valorStr = match.match(/(\d{2,3})/);
          if (valorStr) {
            const valor = parseInt(valorStr[1]);
            // Ignorar valores que NAO sao precos do produto:
            // - Abaixo de 100: frete, Netflix, parcelas pequenas, comparacoes
            // - Parcelas conhecidas do produto
            if (valor < 100) continue;
            if (precosValidos.includes(valor)) continue;
            // EXCECAO EXPLICITA: total com frete correto — NUNCA bloquear
            const _freteData = db.getConversation(agentId, numero)?.freteCalculado;
            if (_freteData && (Math.abs(_freteData.total - valor) <= 1)) continue;
            // TRAVA 1: qualquer preco abaixo do padrao e desconto nao autorizado sem oferta ativa.
            // Com oferta ativa: piso efetivo = preco da oferta (abaixo disso e fraude).
            // Sem oferta ativa: piso efetivo = preco padrao (qualquer desconto espontaneo e bloqueado).
            const _ofertaTrava = db.getActiveOffer(agentId, numero);
            const _pisoEfetivo = (_ofertaTrava && _ofertaTrava.precoDesconto < precoInfo.preco)
              ? _ofertaTrava.precoDesconto
              : precoInfo.preco;
            if (valor < _pisoEfetivo) {
              // Correção usa preço da oferta se ativa, senão preço base
              const _correcaoT1 = (_ofertaTrava && _ofertaTrava.precoDesconto < precoInfo.preco)
                ? _ofertaTrava.precoDesconto
                : precoInfo.preco;
              console.error(`TRAVA DE PRECO (ABAIXO PISO): ${agentId} tentou R$${valor} (piso efetivo: R$${_pisoEfetivo}) para ${numero}`);
              db.addEvent(`trava_preco_piso: ${agentId} ${numero} tentou R$${valor} (piso R$${_pisoEfetivo})`);
              texto = `O ${precoInfo.produto} fica R$${_correcaoT1}.`;
              await sendText(agentId, CONFIG.SEU_WHATSAPP, `*ALERTA TRAVA DE PRECO*\n${agent.name} tentou vender por R$${valor} (piso efetivo: R$${_pisoEfetivo})\nCliente: wa.me/${numero}\n\n_Mensagem foi bloqueada e corrigida automaticamente._`);
              break;
            }
            // TRAVA 2: Preco de OUTRO produto — acima OU abaixo do preco do agente
            const PRECOS_OUTROS_AGENTES = ["pedro","rodrigo"].flatMap(id => [db.getAgentPrice(id), db.getAgentPiso(id)]);
            const precoOutroAgente = PRECOS_OUTROS_AGENTES.includes(valor) && !precosValidos.includes(valor) && valor !== precoInfo.preco && valor !== precoInfo.piso;
            if (precoOutroAgente) {
              console.error(`TRAVA DE PRECO (PRODUTO ERRADO): ${agentId} disse R$${valor} mas seu produto (${precoInfo.produto}) custa R$${precoInfo.preco} — para ${numero}`);
              db.addEvent(`trava_preco_errado: ${agentId} ${numero} disse R$${valor} (correto: R$${precoInfo.preco} - ${precoInfo.produto})`);
              texto = `O ${precoInfo.produto} fica R$${precoInfo.preco}.`;
              await sendText(agentId, CONFIG.SEU_WHATSAPP, `*ALERTA PRECO ERRADO*\n${agent.name} ia dizer R$${valor} pro cliente, mas o ${precoInfo.produto} custa R$${precoInfo.preco}!\nCliente: wa.me/${numero}\n\n_Preco corrigido automaticamente._`);
              break;
            }
            if (valor > precoInfo.preco && !precosValidos.includes(valor)) {
              // TRAVA 2b: Preco acima do produto que nao e de outro agente conhecido (preco inventado)
              // EXCECAO: total+frete ja foi verificado acima via conv.freteCalculado
              // EXCECAO: valor aparece em contexto de economia/comparativo, nao como oferta de preco
              const _isSavingsCtx = /economiz|poupan?|gasta|mensalidade|assina|por\s+(?:ano|mes|semana)|ao\s+(?:mes|ano)|anual|streaming/i.test(texto);
              if (_isSavingsCtx) continue;
              if (valor !== precoInfo.preco && valor !== precoInfo.piso) {
                console.error(`TRAVA DE PRECO (VALOR INVENTADO): ${agentId} disse R$${valor} mas seu produto (${precoInfo.produto}) custa R$${precoInfo.preco} — para ${numero}`);
                db.addEvent(`trava_preco_errado: ${agentId} ${numero} disse R$${valor} (correto: R$${precoInfo.preco} - ${precoInfo.produto})`);
                texto = `O ${precoInfo.produto} fica R$${precoInfo.preco}.`;
                await sendText(agentId, CONFIG.SEU_WHATSAPP, `*ALERTA PRECO ERRADO*\n${agent.name} ia dizer R$${valor} pro cliente, mas o ${precoInfo.produto} custa R$${precoInfo.preco}!\nCliente: wa.me/${numero}\n\n_Preco corrigido automaticamente._`);
                break;
              }
            }
          }
        }
      }
    }
  }

  // TRAVA DE PRODUTO — blindagem deterministica: bloqueia nomes/specs inventados ANTES de enviar
  if (texto.trim()) {
    const prodBlindage = checkProductBlindage(agentId, texto);
    if (prodBlindage) {
      console.error(`TRAVA DE PRODUTO (${prodBlindage.violacao.toUpperCase()}): ${agentId} mencionou produto/spec nao autorizado para ${numero}: "${texto.substring(0, 120)}"`);
      db.addEvent(`trava_produto_${prodBlindage.violacao}: ${agentId} ${numero} bloqueado`);
      await sendText(agentId, CONFIG.SEU_WHATSAPP, `*ALERTA PRODUTO INVENTADO*\n${agent.name} ia dizer:\n"${texto.substring(0, 200)}"\n\npara wa.me/${numero}\n\n_Nome/spec nao autorizado bloqueado. Corrigido automaticamente._`);
      // Verificar se foto ja foi enviada nesta conversa — evita reenvio desnecessario
      const convBlindage = db.getConversation(agentId, numero);
      const fotoJaEnviada = convBlindage && convBlindage.msgs && convBlindage.msgs.some(m =>
        m.role === "assistant" && (m.content || "").includes("ENVIAR_FOTO")
      );
      texto = fotoJaEnviada
        ? prodBlindage.correcao.replace(/\s*ENVIAR_FOTO\s*/g, "").trim()
        : prodBlindage.correcao;
    }
  }

  // GUARDRAIL CRÍTICO: PIX antecipado — Pedro e Rodrigo nunca pedem PIX antes da entrega
  if (texto.trim()) {
    const _pixSentences = texto.split(/[.!?\n]+/);
    const pixAntecipado = _pixSentences.some(s => {
      if (/\b(?:n[aã]o|nunca|sem|zero|nenhum)\b/i.test(s)) return false;
      return /(?:manda|envia|faz|faca|faca\s+um|passa|me\s+manda|me\s+envia|precisa\s+(?:fazer|mandar|enviar))\s+(?:o\s+)?pix\b|chave\s+pix\b(?!\s*(?:na|ao|pro|pra|para|do|no)\s*(?:entregador|entrega|recebimento|hora))/i.test(s);
    });
    if (pixAntecipado) {
      console.error(`GUARDRAIL PIX ANTECIPADO: ${agentId} tentou pedir PIX adiantado para ${numero}: "${texto.substring(0, 100)}"`);
      db.addEvent(`guardrail_pix_antecipado: ${agentId} ${numero}`);
      await sendText(agentId, CONFIG.SEU_WHATSAPP, `*🚨 ALERTA GUARDRAIL PIX ANTECIPADO*\n${agent.name} ia pedir PIX adiantado:\n"${texto.substring(0, 200)}"\n\nCliente: wa.me/${numero}\n\n_Mensagem bloqueada e corrigida._`);
      texto = `O pagamento é feito na entrega — você paga direto ao entregador quando receber o produto. Mais seguro assim! Posso parcelar no cartão também, se preferir.`;
    }
  }

  // FILTRO FINAL ANTI-VAZAMENTO — ultima barreira antes de enviar ao cliente
  texto = texto.replace(/^.*(?:CORRE[CÇ][AÃ]O NECESS[AÁ]RIA|RESPOSTA OK|RESPOSTA CORRIGIDA|MOTIVOS DA CORRECAO|ANALISE|VERIFICACAO|AVALIACAO|❌|✅|⚠️⚠️).*\n?/gim, "");
  texto = texto.replace(/^\s*(?:Nota:|Obs:|O agente |A resposta |Corrigido:).*\n?/gim, "");
  texto = texto.replace(/^\s*\n/gm, "").trim();
  if (agentId === "pedro" && isInstallmentQuestion(clientMessage) && /entregador.{0,40}simul|simul.{0,40}entregador/i.test(texto)) {
    console.error(`[PARCELAMENTO CORRIGIDO] Pedro/${numero}: simulacao atribuida ao entregador`);
    texto = buildPedroInstallmentReply(numero, clientMessage);
  }
  if (isLikelyTruncated(texto)) {
    const fallback = deterministicFallback(agentId, numero, clientMessage, texto);
    if (fallback) {
      console.error(`RESPOSTA TRUNCADA BLOQUEADA ${agentId}/${numero}: "${texto.substring(0, 120)}"`);
      texto = fallback;
    }
  }

  // Send the cleaned text (delay para parecer natural — humano digitando)
  if (texto.trim()) {
    await new Promise(r => setTimeout(r, CONFIG.DELAY_RESPOSTA));
    const sent = await sendText(agentId, numero, texto.trim());
    if (!sent) return "";
  }
  // Retorna o texto final enviado ao cliente — caller usa para salvar no histórico
  return texto.trim();
}

// ============================================
// FOLLOW-UP SCHEDULING
// ============================================

/**
 * Calcula o delay real para o follow-up considerando horário comercial.
 * Se o delay base cai fora do horário (noite/dom/sab tarde), ajusta para
 * o próximo horário válido — nunca descarta o follow-up.
 * Usa clientActivity para escolher a hora de preferência do cliente.
 */
function _calcFollowUpDelay(baseDelayMs, numero) {
  const now = Date.now();
  const fireUTC = new Date(now + baseDelayMs);

  // Representação Brasília (getHours() retorna hora local BR)
  const fireBR = new Date(fireUTC.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hora = fireBR.getHours();
  const minutoFU = fireBR.getMinutes();
  const dia  = fireBR.getDay(); // 0=Dom, 6=Sab

  const isSabadoTarde = dia === 6 && hora >= 13;
  const foraHorario   = dia === 0 || isSabadoTarde || hora < 9 || hora >= 20;
  if (!foraHorario) return baseDelayMs; // Horário já é bom — usar delay original

  // Hora preferida do cliente baseada em actividade histórica
  let preferredHour = 10;
  const activity = db.state.clientActivity[numero];
  if (activity && activity.length >= 3) {
    const counts = {};
    for (const h of activity) counts[h] = (counts[h] || 0) + 1;
    let maxC = 0;
    for (const [h, c] of Object.entries(counts)) {
      const hi = parseInt(h);
      if (hi >= 9 && hi < 17 && c > maxC) { maxC = c; preferredHour = hi; }
    }
  }
  preferredHour = Math.max(9, Math.min(preferredHour, 17));

  // Construir próxima janela válida em Brasília
  const targetBR = new Date(fireBR);
  targetBR.setSeconds(0);
  targetBR.setMilliseconds(0);
  targetBR.setMinutes(Math.floor(Math.random() * 25)); // variação 0-24min

  if (dia >= 1 && dia <= 5 && hora < 9) {
    // Dia útil, antes das 9h — hoje na hora preferida
    targetBR.setHours(preferredHour, targetBR.getMinutes(), 0, 0);
  } else {
    // Tarde/noite, dom ou sab → próximo dia útil
    let add = 1;
    if (dia === 0) add = 1;                             // Dom → Seg
    else if (dia === 6) add = 2;                        // Sab → Seg
    else if (dia === 5 && hora >= 17) add = 3;          // Sex noite → Seg
    targetBR.setDate(targetBR.getDate() + add);
    targetBR.setHours(preferredHour, targetBR.getMinutes(), 0, 0);
  }

  // Converter de Brasília "fake UTC" para UTC real (BRT = UTC-3, sem DST desde 2020)
  const tzOffsetMs = fireUTC.getTime() - fireBR.getTime(); // ~+10800000 (3h)
  const targetUTC  = targetBR.getTime() + tzOffsetMs;
  return Math.max(targetUTC - now, 5 * 60 * 1000); // mínimo 5min
}

function scheduleFollowUp(agentId, numero) {
  const key = `${agentId}_${numero}`;

  // Cancel existing timers
  if (db.state.followupTimers.has(key)) {
    db.state.followupTimers.get(key).forEach(clearTimeout);
  }

  // Skip if there's already a scheduled date for this number
  const hasScheduledDate = [...db.state.schedules.keys()].some(k => k.startsWith(`${agentId}_${numero}_`));
  if (hasScheduledDate) {
    console.log(`Follow-up ${agentId}/${numero} cancelado - ja tem data combinada`);
    return;
  }

  // Skip if agent just asked the client for a date
  if (db.state.awaitingDate.has(key)) {
    console.log(`Follow-up ${agentId}/${numero} cancelado - aguardando cliente confirmar data`);
    return;
  }

  // Follow-up em 2h e 24h — delay ajustado para horário comercial via _calcFollowUpDelay
  const timers = [120, 1440].map((min, i) => {
    const delay = _calcFollowUpDelay(min * 60 * 1000, numero);
    if (delay !== min * 60 * 1000) {
      const fireAt = new Date(Date.now() + delay).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit" });
      console.log(`Follow-up ${i + 1}/2 (${agentId}/${numero}): reagendado para ${fireAt} (horário comercial)`);
    }
    return setTimeout(async () => {
      if (db.isPaused(agentId, numero)) return;
      if (db.isManuallyPaused(numero)) return;
      const conv = db.getConversation(agentId, numero);
      if (!conv) return;
      // Só enviar se cliente ficou em silêncio pelo período mínimo
      if (Date.now() - conv.ultimaMensagem < min * 60 * 1000 * 0.9) return;
      // Re-check: data combinada pode ter surgido no intervalo
      const hasDateNow = [...db.state.schedules.keys()].some(k => k.startsWith(`${agentId}_${numero}_`));
      if (hasDateNow) return;

      // ── ENGINE: análise + decisão de insistência ──
      const profile = engine.analyzeConversation(conv.msgs, agentId);
      const insistenceLevel = engine.getInsistenceLevel(conv, profile);

      if (insistenceLevel === "STOP") {
        if (profile.explicitRefusal) conv.doNotFollowUp = true;
        db.save();
        console.log(`Follow-up ${agentId}/${numero} cancelado — STOP (${profile.followupCount + profile.remarketingCount} tentativas)`);
        return;
      }

      // ── ENGINE: geração personalizada da mensagem ──
      const agentName  = CONFIG.AGENTS[agentId].name;
      const lastMsgsText = conv.msgs.slice(-10).map(m =>
        `${m.role === "user" ? "Cliente" : agentName}: ${(m.content || "").slice(0, 150)}`
      ).join("\n");
      const followProduct = getProductContext(agentId, numero, lastMsgsText);
      const prodInfo   = { product: followProduct.name, price: followProduct.price };
      let instrucaoBonus = (db.state.instructions[agentId] || [])
        .map(inst => typeof inst === "string" ? inst : (inst.regras || ""))
        .filter(txt => /desconto|promo|oferta|preco\s*especial/i.test(txt))
        .slice(-1)[0] || "";
      // Incluir freteGratis no instrucaoBonus para que o follow-up mencione quando ativo
      if (db.hasFreteGratis(agentId, numero)) {
        instrucaoBonus = (instrucaoBonus ? instrucaoBonus + " " : "") + "FRETE GRÁTIS AUTORIZADO: mencione que o frete está grátis para este cliente — é uma vantagem decisiva.";
      }

      const clientName = conv.pushName || "";
      const followMsg = await engine.generateRetakeMessage({
        agentId, agentName, clientName, profile, insistenceLevel, prodInfo, instrucaoBonus, lastMsgsText,
      });
      if (!followMsg) return;

      const sent = await sendText(agentId, numero, followMsg);
      if (!sent) return;
      conv.msgs.push({ role: "assistant", content: sanitize(followMsg), timestamp: Date.now(), _type: "followup" });
      conv.ultimaMensagem = Date.now();
      db.save();
      console.log(`Follow-up ${i + 1}/2 enviado: ${numero} via ${agentId} [${insistenceLevel} | ${profile.stage} | objeção: ${profile.mainObjection}]`);
    }, delay);
  });
  db.state.followupTimers.set(key, timers);
}

// ============================================
// EXTRACT MESSAGE TEXT FROM WEBHOOK BODY
// ============================================

function extractText(body) {
  return sanitize(
    (typeof body.text === "string" ? body.text : "") ||
    body.text?.message ||
    body.text?.body ||
    body.message?.conversation ||
    body.message?.extendedTextMessage?.text ||
    body.message?.interactiveMessage?.body?.text ||
    body.message?.buttonsResponseMessage?.selectedDisplayText ||
    body.message?.templateButtonReplyMessage?.selectedDisplayText ||
    body.message?.listResponseMessage?.title ||
    body.message?.listResponseMessage?.description ||
    body.message?.imageMessage?.caption ||
    body.message?.videoMessage?.caption ||
    body.body ||
    body.content ||
    body.caption ||
    ""
  );
}

function extractLocation(body) {
  const lat = body.location?.latitude || body.message?.locationMessage?.degreesLatitude;
  const lng = body.location?.longitude || body.message?.locationMessage?.degreesLongitude;
  if (lat && lng) return { lat: parseFloat(lat), lng: parseFloat(lng) };
  return null;
}

function normalizeTextBasic(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isDeliveryTimingQuestion(text) {
  const msg = normalizeTextBasic(text);
  return (
    /\b(?:chega|entrega|entregar|recebo|receber)\s+(?:que|qual)\s+dia\b/.test(msg) ||
    /\b(?:chega|entrega|entregar|recebo|receber)\s+hoje\b/.test(msg) ||
    /\b(?:consegue|da|pode)\s+(?:entregar|chegar)\s+hoje\b/.test(msg) ||
    /\bprazo\s+(?:de\s+)?entrega\b/.test(msg) ||
    /\b(?:quando|que\s+dia)\s+(?:chega|entrega|entregar)\b/.test(msg) ||
    /\bdemora\s+(?:quanto|muito)\b/.test(msg)
  );
}

function getDeliveryWindow() {
  const time = getBrasiliaTime();
  const isSunday = time.dia === "Domingo";
  const isSaturday = time.dia === "Sabado";
  const isWeekday = !isSunday && !isSaturday;
  const inWeekdayWindow = isWeekday && (
    (time.hora > 10 || (time.hora === 10 && time.minuto >= 0)) &&
    (time.hora < 16 || (time.hora === 16 && time.minuto < 30))
  );
  const inSaturdayWindow = isSaturday && time.hora >= 9 && time.hora < 13;
  if (inWeekdayWindow) return { today: true, label: "hoje", window: "entre 10:00 e 16:30" };
  if (inSaturdayWindow) return { today: true, label: "hoje", window: "entre 09:00 e 13:00" };
  if (isSunday) return { today: false, label: "segunda-feira", window: "a partir das 10:00" };
  if (isSaturday) {
    if (time.hora < 9) return { today: false, label: "hoje", window: "a partir das 09:00" };
    return { today: false, label: "segunda-feira", window: "a partir das 10:00" };
  }
  if (time.hora < 10) return { today: false, label: "hoje", window: "a partir das 10:00" };
  if (time.dia === "Sexta") return { today: false, label: "segunda-feira", window: "a partir das 10:00" };
  return { today: false, label: "amanha", window: "a partir das 10:00" };
}

function buildDeliveryTimingReply(agentId, numero) {
  const delivery = getDeliveryWindow();
  const conv = db.getConversation(agentId, numero);
  const frete = conv?.freteCalculado;
  const valores = frete?.total
    ? ` O total ficou R$${frete.total}${frete.freteGratis ? " com frete gratis" : ` com frete R$${frete.frete}`}.`
    : "";
  if (delivery.today) {
    return `Consigo entregar hoje sim, ${delivery.window}.${valores} Quer fechar a entrega?`;
  }
  if (delivery.label === "hoje") {
    return `Consigo entregar hoje sim, ${delivery.window}.${valores} Quer fechar a entrega?`;
  }
  return `Hoje nao consigo mais encaixar na rota. Consigo entregar ${delivery.label}, ${delivery.window}.${valores} Quer deixar fechado?`;
}

function isTemporaryLid(body, numero) {
  return !!(
    body?.isTempId ||
    body?._originalJid?.includes("@lid") ||
    db.isLidFormat(numero)
  );
}

// ============================================
// handleIncomingMessage — MAIN ENTRY POINT
// ============================================

async function handleIncomingMessage(agentId, body) {
  let _procLockKey = null; // escopo outer para liberar no finally
  try {
    const agent = CONFIG.AGENTS[agentId];
    if (!agent) return;

    if (!body) return;
    if (body.isFromMe) {
      // Miron mandou mensagem pelo WhatsApp do agente — suprimir aviso de finalização
      const num = body.phone;
      if (num && num !== CONFIG.SEU_WHATSAPP) {
        const conv = db.getConversation(agentId, num);
        if (conv && conv.finalizado && !conv.avisouFinalizacao) {
          conv.avisouFinalizacao = true;
          db.save();
        }
      }
      return;
    }
    const numero = body.phone;
    if (!numero) return;

    // Filter groups / invalid IDs. Meta lead LIDs can be >15 digits before phone resolution.
    const tempLid = isTemporaryLid(body, numero);
    if (numero.includes("-group") || numero.includes("@g.us") || (numero.length > 15 && !tempLid)) return;

    const texto = extractText(body);

    const convEntrada = db.getConversation(agentId, numero);
    if (convEntrada) {
      if (body._originalJid) convEntrada._originalJid = body._originalJid;
      if (tempLid) convEntrada.isTempId = true;
      if (body.pushName || body.senderName) convEntrada.pushName = body.pushName || body.senderName;
    }

    // LID→Owner mapping: WhatsApp Business usa LID em vez do numero real
    // Mapeamento persistente de LIDs conhecidos do dono
    if (!db.state._ownerLids) db.state._ownerLids = {};
    const ownerNumbers = [CONFIG.SEU_WHATSAPP, "5562991819645"];
    // LIDs conhecidos do Miron (descobertos via diagnostico)
    const knownOwnerLids = ["65322358939735"];

    // Detectar owner por: numero direto, LID hardcoded, LID mapeado, ou pushName
    const pushName = (body.pushName || body.senderName || "").toLowerCase();
    const isDirectNumber = ownerNumbers.includes(numero);
    const isHardcodedLid = knownOwnerLids.includes(numero);
    const isKnownOwnerLid = !!db.state._ownerLids[numero];
    // Se pushName contem "miron" e numero parece LID (nao comeca com 55), mapear
    const isLidOwner = !isDirectNumber && !isHardcodedLid && !isKnownOwnerLid && /miron/i.test(body.pushName || "") && !numero.startsWith("55");

    if (isLidOwner || isHardcodedLid) {
      db.state._ownerLids[numero] = true;
      if (isLidOwner) console.log(`[OWNER-LID] Novo LID do dono mapeado: ${numero} (pushName: ${body.pushName})`);
    }

    const isOwner = isDirectNumber || isHardcodedLid || isKnownOwnerLid || isLidOwner;

    // LOG: diagnostico
    console.log(`[INCOMING] agente=${agentId} | phone="${numero}" | pushName="${body.pushName || ""}" | isOwner=${isOwner} | method=${isDirectNumber ? "direct" : isKnownOwnerLid ? "cached-lid" : isLidOwner ? "pushname-lid" : "none"} | texto="${(texto || "").slice(0, 50)}"`);

    // Guardar ultimas mensagens recebidas para diagnostico via API
    if (!db.state._debugIncoming) db.state._debugIncoming = [];
    db.state._debugIncoming.push({ ts: Date.now(), agentId, phone: numero, pushName: body.pushName || "", phoneLen: numero.length, isOwner, texto: (texto || "").slice(0, 50) });
    if (db.state._debugIncoming.length > 20) db.state._debugIncoming = db.state._debugIncoming.slice(-20);
    if (isOwner) {
      // Transcrever audio do Miron antes de processar (Aslam entende audio)
      let textoOwner = texto;
      if (!textoOwner && body.audio?.audioUrl) {
        try {
          const transcription = await transcribeAudio(body.audio.audioUrl);
          if (transcription) textoOwner = transcription;
        } catch (e) {
          console.error(`Erro transcrever audio do dono:`, e.message);
        }
      }
      if (textoOwner && textoOwner.startsWith(agent.pauseCmd)) {
        const target = textoOwner.replace(agent.pauseCmd, "").trim();
        db.pauseManual(target, agentId);
        db.save();
        return;
      }
      if (textoOwner && textoOwner.startsWith(agent.resumeCmd)) {
        const target = textoOwner.replace(agent.resumeCmd, "").trim();
        db.resumeManual(target);
        db.save();
        return;
      }
      // Any other message from Miron goes to Aslam
      if (textoOwner && textoOwner.trim()) {
        try {
          const aslam = require("./aslam");
          const resposta = await aslam.handleAslamChat(textoOwner);
          if (resposta) {
            // Salvar _originalJid temporariamente para o sendText usar via conv
            // Isso garante que a resposta vai pro LID correto quando Baileys usa @lid
            let ownerConv = db.getConversation(agentId, numero);
            if (!ownerConv) {
              db.state.conversations[agentId].set(numero, { msgs: [], ultimaMensagem: Date.now() });
              ownerConv = db.state.conversations[agentId].get(numero);
            }
            if (body._originalJid) ownerConv._originalJid = body._originalJid;
            await sendText(agentId, numero, resposta, { bypassPause: true });
          }
        } catch (e) {
          console.error(`Erro Aslam via ${agent.name}:`, e.message);
        }
      }
      return;
    }

    // Marca retorno de remarketing manual antes da regra de pausado manual.
    const activeRemarketingCampaign = db.getActiveRemarketingCampaignForClient(agentId, numero);
    if (activeRemarketingCampaign) {
      const conv = db.getConversation(agentId, numero);
      if (conv) conv.remarketingRespondidoEm = Date.now();
      db.markRemarketingCampaignResponded(activeRemarketingCampaign.id, numero);
      console.log(`[RemarketingMKT] ${agentId} [${numero}]: respondeu campanha ${activeRemarketingCampaign.id}`);
    }

    // Intercept: cliente respondeu a campanha visual ativa — pausa + notifica Miron
    const activeCampaign = db.getActiveCampaignForClient(agentId, numero);
    if (activeCampaign) {
      const textoCliente = extractText(body) || "[mensagem]";
      const conv = db.getConversation(agentId, numero);
      if (conv) {
        conv.msgs.push({ role: "user", content: sanitize(textoCliente), timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();
      }
      db.markCampaignResponded(activeCampaign.id, numero);
      if (activeCampaign.pauseOnReply) {
        db.pauseManual(numero, agentId);
      }
      if (activeCampaign.notifyOwnerOnReply) {
        await sendText(agentId, CONFIG.SEU_WHATSAPP,
          `*${agent.name.toUpperCase()} — CAMPANHA "${activeCampaign.productName}" — CLIENTE INTERESSADO*\n\nCliente: wa.me/${numero}\nMsg: "${textoCliente}"${activeCampaign.price ? `\nProduto: ${activeCampaign.productName} R$${activeCampaign.price}` : ""}\n\n_Agente pausado. Libere com "liberar ${numero}"_`
        );
      }
      db.save();
      console.log(`[CampanhaVisual] ${agentId} [${numero}]: respondeu campanha ${activeCampaign.id} — agente pausado`);
      return;
    }

    // Check if manually paused by Miron — nunca responder, mas notificar se conversa finalizada
    if (db.isManuallyPaused(numero)) {
      const convCheck = db.getConversation(agentId, numero);
      const textoCliente = extractText(body) || "[mensagem]";
      // Salvar msg do cliente no historico SEMPRE (pausado manual ou não)
      if (convCheck) {
        convCheck.msgs.push({ role: "user", content: sanitize(textoCliente), timestamp: Date.now() });
        convCheck.ultimaMensagem = Date.now();
      }
      if (convCheck && convCheck.finalizado) {

        if (!convCheck.avisouFinalizacao) {
          // PRIMEIRA vez — marcar ANTES de enviar pra evitar duplicação por race condition
          convCheck.avisouFinalizacao = true;
          convCheck.msgs.push({ role: "assistant", content: "Conversa encaminhada pro Miron.", timestamp: Date.now() });
          db.save();
          // Agora envia
          db.state.pausedManual[agentId]?.delete(numero);
          db.state.paused[agentId]?.delete(numero);
          await sendText(agentId, numero, `Oi! Essa conversa ja foi encaminhada pro Miron (dono). Ele vai te responder em breve! 😊`, { bypassPause: true });
          db.pauseManual(numero, agentId);
          await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agent.name.toUpperCase()} - CLIENTE RETORNOU*\n\nCliente: wa.me/${numero}\nMsg: "${textoCliente}"\n\n_Conversa finalizada. Libere com "liberar ${numero}" se quiser que o agente volte._`);
        } else {
          // Já avisou — notificar Miron com rate limit de 30 min por cliente (evitar spam)
          const _agora = Date.now();
          const _ultimoAlerta = _lastInsistindoAlert.get(numero) || 0;
          const _msgCurta = textoCliente.trim().replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim().length < 3;
          if (!_msgCurta && _agora - _ultimoAlerta > 30 * 60 * 1000) {
            _lastInsistindoAlert.set(numero, _agora);
            await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agent.name.toUpperCase()} - CLIENTE INSISTINDO*\n\nCliente: wa.me/${numero}\nMsg: "${textoCliente}"`);
          }
        }
        db.save();
        console.log(`${agent.name} [${numero}]: Cliente msg apos finalizacao (avisou: ${convCheck.avisouFinalizacao})`);
      }
      return;
    }

    // Auto-pause: limpar quando cliente responde (ele quer continuar conversando)
    // Usa last-8 fuzzy match para cobrir variações de formato do mesmo número
    if (db.state.paused[agentId]) {
      const last8 = numero.slice(-8);
      const toRemove = [...db.state.paused[agentId]].filter(n => n === numero || n.slice(-8) === last8);
      if (toRemove.length > 0) {
        toRemove.forEach(n => db.state.paused[agentId].delete(n));
        console.log(`${agent.name}: auto-pause removido para ${numero} (cliente respondeu)`);
      }
    }

    // Block agent numbers
    if (db.isAgentNumber(numero)) return;

    // Cancel existing follow-up timers (for this agent AND others, in case of cross-transfers)
    for (const aid of ["pedro", "rodrigo"]) {
      const followupKey = `${aid}_${numero}`;
      if (db.state.followupTimers.has(followupKey)) {
        db.state.followupTimers.get(followupKey).forEach(clearTimeout);
        db.state.followupTimers.delete(followupKey);
      }
    }

    let mensagem = texto || null;
    if (agentId === "pedro" && mensagem) {
      const escolhaPedro = rememberPedroProductChoice(numero, mensagem);
      if (escolhaPedro) db.save();
    }

    const precisaEscolherProdutoPedro = () => {
      if (agentId !== "pedro") return false;
      const convPedro = db.getConversation("pedro", numero);
      return !convPedro?.pedroProductKey;
    };

    async function pedirEscolhaProdutoPedro() {
      const convPedro = db.getConversation("pedro", numero);
      const msg = "Perfeito. Antes de eu calcular certinho, me confirma qual modelo voce quer: o Uni TV V10 por R$360 ou o Uni TV S10 preto por R$400 com ESPN?";
      if (convPedro) {
        convPedro.msgs.push({ role: "user", content: sanitize(mensagem || "[localizacao]"), timestamp: Date.now() });
        convPedro.msgs.push({ role: "assistant", content: msg, timestamp: Date.now() });
        convPedro.ultimaMensagem = Date.now();
      }
      db.save();
      await sendText(agentId, numero, msg);
    }

    // Handle location (pin on map) — ENVIA DIRETO PRO CLIENTE, SEM PASSAR PELA IA
    const loc = extractLocation(body);
    if (loc) {
      if (precisaEscolherProdutoPedro()) {
        await pedirEscolhaProdutoPedro();
        return;
      }
      const fr = calcFreight(loc.lat, loc.lng);
      if (fr.frete !== null) {
        const productCtxGps = getProductContext(agentId, numero, mensagem || "");
        let productPrice = productCtxGps.price;
        let productName = productCtxGps.name;
        // Verificar oferta ativa (desconto de preço e/ou frete grátis autorizado)
        const ofertaGps = db.getActiveOffer(agentId, numero);
        if (ofertaGps && ofertaGps.precoDesconto < productPrice) {
          productPrice = ofertaGps.precoDesconto;
        }
        // Frete grátis: se oferta autorizada, override para zero
        const freteGratisAtivo = !!(ofertaGps && ofertaGps.freteGratis);
        const freteEfetivo = freteGratisAtivo ? 0 : fr.frete;
        const total = productPrice + freteEfetivo;
        const parcelasWhatsApp = calcInstallmentsWhatsApp(total);
        const parcelasInline = calcInstallments(total);
        // Envia mensagem FIXA direto pro cliente — IA nao interfere
        const freteMsg = freteGratisAtivo
          ? `Calculei aqui! 📍\n\nFrete: *GRÁTIS* 🎉\n${productName}: *R$${productPrice}*\n*Total: R$${total}*\n\n💳 *Parcelas no cartão:*\n${parcelasWhatsApp}\n\nPosso te encaixar na proxima rota de entrega? 🚚\n\nO pagamento e feito direto pro entregador na hora!`
          : `Calculei aqui! 📍\n\nFrete: *R$${fr.frete}* (${fr.distKm}km)\n${productName}: *R$${productPrice}*\n*Total: R$${total}*\n\n💳 *Parcelas no cartão (total com frete):*\n${parcelasWhatsApp}\n\nPosso te encaixar na proxima rota de entrega? 🚚\n\nO pagamento e feito direto pro entregador na hora!`;
        await sendText(agentId, numero, freteMsg);

        // Salva no historico da conversa pra IA ter contexto (inline pra nao poluir historico)
        const conv = db.getConversation(agentId, numero);
        // FONTE AUTORITATIVA: salva frete calculado — freteGratis=true → frete=0
        conv.freteCalculado = { frete: freteEfetivo, total, distKm: fr.distKm, produtoPreco: productPrice, freteGratis: freteGratisAtivo, timestamp: Date.now() };
        conv.msgs.push({ role: "user", content: `[Cliente enviou localizacao: ${fr.distKm}km da loja]`, timestamp: Date.now() });
        const _histMsgGps = freteGratisAtivo
          ? `Frete: GRÁTIS (${fr.distKm}km, oferta autorizada). Total a vista: R$${total}. Parcelas no cartao: ${parcelasInline}. Perguntei se quer entrega.`
          : `Frete: R$${fr.frete} (${fr.distKm}km). Total a vista: R$${total}. Parcelas no cartao (sobre total com frete): ${parcelasInline}. Perguntei se quer entrega.`;
        conv.msgs.push({ role: "assistant", content: _histMsgGps, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();

        db.registerContact(numero, agentId);
        db.state.metrics[agentId].atendimentos++;
        db.addActivity(`${agentId}: ${numero} - localizacao recebida (${fr.distKm}km, frete ${freteGratisAtivo ? "GRÁTIS" : `R$${fr.frete}`})`);
        db.save();
        console.log(`${agent.name} [${numero}]: Frete enviado - ${fr.distKm}km = ${freteGratisAtivo ? "GRÁTIS" : `R$${fr.frete}`}, total R$${total}`);
        return; // NAO passa pela IA — valor ja foi enviado correto
      } else {
        // Fora da area — transfere pro humano
        const foraMsg = `Poxa, vi aqui que voce esta a ${fr.distKm}km da nossa loja 😕\n\nInfelizmente nosso limite de entrega e 30km. Mas vou te passar pro *Miron* (dono) pra ver se consegue uma alternativa pra voce!`;
        await sendText(agentId, numero, foraMsg);

        const conv = db.getConversation(agentId, numero);
        conv.msgs.push({ role: "user", content: `[Cliente enviou localizacao: ${fr.distKm}km - FORA DA AREA]`, timestamp: Date.now() });
        conv.msgs.push({ role: "assistant", content: foraMsg, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();

        db.pauseAuto(numero, agentId);
        db.addEvent(`transferir_humano: ${agentId} ${numero} (fora area ${fr.distKm}km)`);
        await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agent.name.toUpperCase()} - FORA DA AREA*\n\nCliente: wa.me/${numero}\nDistancia: ${fr.distKm}km (limite 30km)`);

        db.registerContact(numero, agentId);
        db.save();
        console.log(`${agent.name} [${numero}]: Fora da area - ${fr.distKm}km`);
        return; // NAO passa pela IA
      }
    }

    // Handle audio
    if (!mensagem && body.audio?.audioUrl) {
      try {
        const transcription = await transcribeAudio(body.audio.audioUrl);
        if (transcription) {
          mensagem = `[Audio]: ${transcription}`;
        }
      } catch (e) {
        console.error(`Erro transcrever audio ${agentId}/${numero}:`, e.message);
      }
      // Se não conseguiu transcrever, pede pra escrever
      if (!mensagem) {
        mensagem = "[Cliente enviou audio que nao foi possivel transcrever]";
      }
    }

    if (!mensagem && tempLid) {
      const convSemTexto = db.getConversation(agentId, numero);
      const semHistorico = !convSemTexto?.msgs || convSemTexto.msgs.length === 0;
      if (semHistorico) {
        mensagem = "[Cliente iniciou conversa pelo anuncio, mas o WhatsApp nao entregou texto legivel]";
      }
    }

    if (!mensagem) return;

    if (isDeliveryTimingQuestion(mensagem)) {
      const convPrazo = db.getConversation(agentId, numero);
      const prazoMsg = buildDeliveryTimingReply(agentId, numero);
      convPrazo.msgs.push({ role: "user", content: sanitize(mensagem), timestamp: Date.now() });
      convPrazo.msgs.push({ role: "assistant", content: sanitize(prazoMsg), timestamp: Date.now() });
      convPrazo.ultimaMensagem = Date.now();
      await sendText(agentId, numero, prazoMsg);
      db.registerContact(numero, agentId);
      db.state.metrics[agentId].atendimentos++;
      db.addActivity(`${agentId}: ${numero} - prazo entrega respondido`);
      db.save();
      console.log(`${agent.name} [${numero}]: Prazo de entrega respondido deterministicamente`);
      return;
    }

    console.log(`${agent.name} [${numero}]: ${mensagem}`);

    // DEBOUNCE: acumula mensagens do cliente antes de responder
    // Se o cliente manda 2+ msgs seguidas, junta tudo numa resposta só
    const now = Date.now();
    const rateKey = `${agentId}_${numero}`;

    // Salvar mensagem no historico imediatamente
    const convDB = db.getConversation(agentId, numero);
    convDB.msgs.push({ role: "user", content: sanitize(mensagem), timestamp: Date.now() });
    convDB.ultimaMensagem = Date.now();

    // Se já tem um debounce pendente, cancelar (nova msg chegou, esperar mais)
    if (db.state.debounceTimers && db.state.debounceTimers.has(rateKey)) {
      clearTimeout(db.state.debounceTimers.get(rateKey));
      db.state.debounceTimers.delete(rateKey);
      console.log(`${agent.name} [${numero}]: Debounce resetado — msg acumulada: "${mensagem.substring(0, 50)}"`);
      db.save();
    }

    // Se respondeu há menos de 3s, só salvar (já tem resposta recente)
    if (db.state.lastResponse.has(rateKey) && now - db.state.lastResponse.get(rateKey) < 3000) {
      console.log(`Rate limit ${agent.name} ${numero} — msg salva no historico`);
      db.save();
      return;
    }

    // Agendar resposta com debounce de 5s — espera pra ver se vem mais msgs
    await new Promise((resolve) => {
      if (!db.state.debounceTimers) db.state.debounceTimers = new Map();
      const timer = setTimeout(() => {
        db.state.debounceTimers.delete(rateKey);
        resolve();
      }, 5000);
      db.state.debounceTimers.set(rateKey, timer);
    });

    // Pós-debounce: verificar se foi pausado durante a espera de 5s
    if (db.isManuallyPaused(numero) || db.isPaused(agentId, numero)) {
      console.log(`${agent.name} [${numero}]: Pausado durante debounce — resposta cancelada`);
      return;
    }

    db.state.lastResponse.set(rateKey, Date.now());

    // Cleanup stale entries from lastResponse to prevent memory leak (every 100 entries)
    if (db.state.lastResponse.size > 500) {
      for (const [key, ts] of db.state.lastResponse) {
        if (now - ts > 60 * 60 * 1000) db.state.lastResponse.delete(key);
      }
    }

    // LOCK DE PROCESSAMENTO: previne dois flows concorrentes para o mesmo cliente.
    // Cenário real: dois áudios chegam quase simultâneos; a transcrição async de ambos
    // pode ultrapassar o debounce, gerando duas chamadas IA e dois envios ao cliente.
    if (!db.state.processingLock) db.state.processingLock = new Map();
    if (db.state.processingLock.has(rateKey)) {
      console.log(`${agent.name} [${numero}]: processamento ja em andamento — mensagem acumulada no historico, ignorando duplicata`);
      db.save();
      return;
    }
    _procLockKey = rateKey;
    db.state.processingLock.set(rateKey, true);

    // Client responded - no longer awaiting date
    db.state.awaitingDate.delete(rateKey);

    // Detecção de opt-out explícito — marcar para parar follow-up automático
    if (/para\s+de\s+me\s+(chamar|mandar|enviar)|n[aã]o\s+quero\s+mais\s+(mensagem|contato)|me\s+tira\s+da\s+lista|n[aã]o\s+me\s+chame|me\s+remove|cancela\s+tudo|para\s+de\s+me\s+incomodar/i.test(mensagem)) {
      convDB.doNotFollowUp = true;
      console.log(`${agent.name} [${numero}]: opt-out detectado — follow-up automático desativado`);
    }

    // FEATURE 5: Record client activity hour for smart timing
    const brasiliaHour = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false });
    if (!db.state.clientActivity[numero]) db.state.clientActivity[numero] = [];
    db.state.clientActivity[numero].push(parseInt(brasiliaHour));
    if (db.state.clientActivity[numero].length > 50) db.state.clientActivity[numero] = db.state.clientActivity[numero].slice(-50);
    // Cleanup stale clientActivity entries to prevent unbounded growth
    const caKeys = Object.keys(db.state.clientActivity);
    if (caKeys.length > 2000) {
      // Keep only numbers that have active conversations
      for (const caNum of caKeys) {
        if (!db.findAgentForNumber(caNum)) delete db.state.clientActivity[caNum];
      }
    }

    // Register contact, increment metrics, save
    db.registerContact(numero, agentId);
    db.state.metrics[agentId].atendimentos++;
    db.addActivity(`${agentId}: ${numero} - ${mensagem}`);
    db.save();

    // FEATURE 1: Cross-product detection — transfer to correct agent BEFORE Claude call
    const crossProduct = detectCrossProduct(agentId, mensagem);
    if (crossProduct) {
      const targetAgentId = crossProduct.targetAgent;
      const targetAgent = CONFIG.AGENTS[targetAgentId];
      const currentAgent = CONFIG.AGENTS[agentId];

      // Send handoff message via current agent
      const handoffMsg = `Opa! Pelo que entendi voce tem interesse em ${crossProduct.product}! Vou te passar pro ${targetAgent.name} que e o especialista. Um segundo! \u{1F60A}`;
      await sendText(agentId, numero, handoffMsg);

      // Copy conversation to target agent (sem duplicar a msg atual que ja foi salva em convDB na linha 1774)
      const currentConv = db.getConversation(agentId, numero);
      const targetConv = db.getConversation(targetAgentId, numero);
      // Copy message history (que ja inclui a msg atual salva na linha 1774)
      if (currentConv && currentConv.msgs) {
        targetConv.msgs.length = 0; // Limpar antes de copiar para evitar duplicatas
        for (const msg of currentConv.msgs) {
          targetConv.msgs.push({ ...msg });
        }
      }
      targetConv.ultimaMensagem = Date.now();

      // Save handoff message in current agent conversation (msg do usuario ja esta salva na linha 1774)
      currentConv.msgs.push({ role: "assistant", content: handoffMsg, timestamp: Date.now() });
      currentConv.ultimaMensagem = Date.now();

      // Register contact for target agent
      db.registerContact(numero, targetAgentId);
      db.state.metrics[targetAgentId].atendimentos++;
      db.addActivity(`${targetAgentId}: ${numero} - transferido de ${agentId} (${crossProduct.product})`);
      db.addEvent(`cross_transfer: ${agentId} -> ${targetAgentId} (${numero}) produto: ${crossProduct.product}`);
      db.save();

      // Check if target agent is paused for this number
      if (db.isPaused(targetAgentId, numero)) {
        console.log(`Cross-product transfer cancelled: ${targetAgentId} is paused for ${numero}`);
        return;
      }

      // Delay before target agent responds
      await new Promise(r => setTimeout(r, CONFIG.DELAY_RESPOSTA));

      // Build prompt and call Claude for target agent
      const targetSystemPrompt = buildSystemPrompt(targetAgentId, numero, mensagem);
      const targetMsgs = targetConv.msgs.slice(-20);
      const targetResposta = await callClaudeWithRetry(targetSystemPrompt, targetMsgs, { maxTokens: 600 });

      if (targetResposta) {
        // Filter through Aslam
        let targetRespostaFinal;
        try {
          const aslam = require("./aslam");
          targetRespostaFinal = await aslam.filterResponse(targetAgentId, numero, mensagem, targetResposta);
        } catch (eAslam) {
          targetRespostaFinal = targetResposta;
        }

        const _targetTextoEnviado = await processTags(targetAgentId, numero, targetRespostaFinal, mensagem);
        if (_targetTextoEnviado) {
          targetConv.msgs.push({ role: "assistant", content: sanitize(_targetTextoEnviado), timestamp: Date.now() });
          scheduleFollowUp(targetAgentId, numero);
          extractKnowledge(targetAgentId, mensagem, targetRespostaFinal).catch(() => {});
        }
      }

      return; // Don't let original agent respond
    }

    // Build prompt and call Claude (msg já salva no historico pelo debounce, 5s de espera já feito)
    const systemPrompt = buildSystemPrompt(agentId, numero, mensagem);
    const conv = db.getConversation(agentId, numero);

    // Perguntas consecutivas sobre canais devem ser respondidas juntas e sem depender da IA.
    if (agentId === "pedro") {
      const pendingClientMessages = [];
      for (let i = conv.msgs.length - 1; i >= 0; i--) {
        const item = conv.msgs[i];
        if (item.role === "assistant") break;
        if (item.role === "user") pendingClientMessages.unshift(item.content || "");
      }
      const channelReply = buildPedroChannelReply(pendingClientMessages.join("\n"));
      if (channelReply) {
        const sent = await sendText(agentId, numero, channelReply);
        if (sent) {
          conv.msgs.push({ role: "assistant", content: channelReply, timestamp: Date.now() });
          conv.ultimaMensagem = Date.now();
          db.addEvent(`programacao_canais_respondida: ${agentId} ${numero}`);
          db.save();
        }
        return;
      }
      const installmentReply = buildPedroInstallmentReply(numero, pendingClientMessages.join("\n"));
      if (installmentReply) {
        const sent = await sendText(agentId, numero, installmentReply);
        if (sent) {
          conv.msgs.push({ role: "assistant", content: installmentReply, timestamp: Date.now() });
          conv.ultimaMensagem = Date.now();
          db.addEvent(`parcelamento_respondido: ${agentId} ${numero}`);
          db.save();
        }
        return;
      }
    }

    // INTERCEPTAÇÃO RETIRADA — não fazemos retirada → informa cliente + pausa + notifica Miron
    if (detectaIntencaoRetirada(mensagem)) {
      const retiradaMsg = `A loja fisica nao esta aberta para retirada. A gente trabalha somente com entrega, e o pagamento e feito direto ao entregador na hora.`;
      await sendText(agentId, numero, retiradaMsg);
      conv.msgs.push({ role: "assistant", content: retiradaMsg, timestamp: Date.now() });
      conv.ultimaMensagem = Date.now();
      db.pauseManual(numero, agentId);
      await sendText(agentId, CONFIG.SEU_WHATSAPP, `📦 *RETIRADA* — ${CONFIG.AGENTS[agentId].name}\nCliente wa.me/${numero} perguntou sobre retirada. Conversa pausada, entre em contato caso queira resolver.`);
      db.addEvent(`retirada_interesse: ${agentId} ${numero}`);
      db.save();
      console.log(`${CONFIG.AGENTS[agentId].name} [${numero}]: Retirada detectada — informou que não faz retirada, pausado, Miron notificado`);
      return;
    }

    // INTERCEPTAÇÃO CLARO — apenas Pedro (Uni TV V10 não funciona com internet da Claro)
    // Também cobre resposta isolada "claro" quando a última mensagem do bot perguntou sobre internet
    if (agentId === "pedro") {
      if (detectaPerguntaForaGoiania(mensagem)) {
        const foraGoianiaMsg = `Somos de Goiania. Hoje o Pedro faz entrega somente em Goiania e regiao proxima, ate 30km. Brasilia e entorno ficam fora da nossa rota de entrega.`;
        await sendText(agentId, numero, foraGoianiaMsg);
        conv.msgs.push({ role: "assistant", content: foraGoianiaMsg, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();
        db.pauseAuto(numero, agentId);
        db.addEvent(`fora_goiania_pergunta: ${agentId} ${numero}`);
        await sendText(agentId, CONFIG.SEU_WHATSAPP, `*PEDRO - FORA DA ROTA*\n\nCliente: wa.me/${numero}\nMsg: "${mensagem}"\n\nCliente perguntou sobre Brasilia/entorno. Pedro informou que atende apenas Goiania/regiao ate 30km e pausou a conversa.`);
        db.save();
        console.log(`Pedro [${numero}]: Pergunta sobre Brasilia/entorno detectada - informado fora da rota e pausado`);
        return;
      }
      const _ultimaBotMsg = (conv.msgs || []).filter(m => m.role === "assistant").slice(-1)[0]?.content || "";
      const _perguntouInternet = /operadora|internet|qual\s+sua\s+rede|qual\s+sua\s+internet|claro.*vivo.*tim|oi.*claro.*vivo/i.test(_ultimaBotMsg);
      const _respostaEhClaro = /^\s*(claro|e\s+claro|eh\s+claro|[eé]\s+(a\s+)?claro|minha\s+[eé]\s+claro|net\s+claro|claro\s+mesmo|claro\s+net)\s*[!.,]?\s*$/i.test(mensagem);
      if (detectaInternetClaro(mensagem) || (_perguntouInternet && _respostaEhClaro)) {
        const claroMsg = `Olha, infelizmente eu não vou conseguir te vender e nem te atender, porque a internet da Claro queima esses aparelhos.`;
        await sendText(agentId, numero, claroMsg);
        conv.msgs.push({ role: "assistant", content: claroMsg, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();
        db.pauseManual(numero, agentId);
        await sendText(agentId, CONFIG.SEU_WHATSAPP, `🔴 *CLARO* — Pedro\nCliente wa.me/${numero} usa internet da Claro. Atendimento encerrado, conversa pausada.`);
        db.addEvent(`claro_internet: pedro ${numero}`);
        db.save();
        console.log(`Pedro [${numero}]: Claro detectado — informou incompatibilidade, pausado, Miron notificado`);
        return;
      }
    }

    // INTERCEPTAÇÃO: endereço de outro estado — entrega local apenas (Goiânia/região)
    {
      const msgLower = mensagem.toLowerCase();
      const outrosEstados = /\b(acre|alagoas|amapa|amazonas|bahia|ceara|distrito\s*federal|espir[ií]to\s*santo|maranhao|maranh[aã]o|mato\s*grosso(?:\s*do\s*sul)?|minas\s*gerais|para[ií]ba|paran[aá]|pernambuco|piau[ií]|rio\s*(?:de\s*janeiro|grande\s*(?:do\s*norte|do\s*sul))|rond[oô]nia|roraima|santa\s*catarina|s[aã]o\s*paulo|sergipe|tocantins)\b/i;
      const cidadesConhecidas = /\b(s[aã]o\s*paulo|rio\s*de\s*janeiro|belo\s*horizonte|salvador|recife|fortaleza|curitiba|manaus|bel[eé]m|vit[oó]ria|florian[oó]polis|porto\s*alegre|natal|jo[aã]o\s*pessoa|macei[oó]|campo\s*grande|cuiab[aá]|teresina|s[aã]o\s*lu[ií]s|aracaju|serra|vila\s*velha|cariacica|guarulhos|campinas|niter[oó]i|osasco)\b/i;
      const pareceEndereco = /\b(rua|avenida|av\.|travessa|alameda|quadra|setor|bairro|jardim|vila|n[uú]mero|casa|apt|apto|apartamento|bloco|lote|qd|lt|presidente|kennedy|carapina)\b/i.test(msgLower);

      let foraEstado = false;
      let estadoDetectado = "";

      // Check 1: nome do estado ou cidade conhecida fora de GO
      if (pareceEndereco && (outrosEstados.test(msgLower) || cidadesConhecidas.test(msgLower))) {
        foraEstado = true;
        const matchEstado = msgLower.match(outrosEstados) || msgLower.match(cidadesConhecidas);
        estadoDetectado = matchEstado ? matchEstado[0] : "outro estado";
      }

      // Check 2: sigla de estado no texto (ex: "- ES", ", SP", "Serra ES")
      if (!foraEstado && pareceEndereco) {
        const siglaMatch = mensagem.match(/[\s,\-]+([A-Z]{2})\b/);
        if (siglaMatch) {
          const sigla = siglaMatch[1].toUpperCase();
          const siglasValidas = ["AC","AL","AP","AM","BA","CE","DF","ES","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
          if (siglasValidas.includes(sigla) && sigla !== "GO") {
            foraEstado = true;
            estadoDetectado = sigla;
          }
        }
      }

      if (foraEstado) {
        const foraMsg = `Poxa, infelizmente fazemos entrega apenas na regiao de Goiania e cidades proximas (ate 30km) 😕\n\nVou te passar pro *Miron* (dono) pra ver se consegue uma alternativa pra voce!`;
        await sendText(agentId, numero, foraMsg);

        conv.msgs.push({ role: "assistant", content: foraMsg, timestamp: Date.now() });
        conv.ultimaMensagem = Date.now();

        db.pauseAuto(numero, agentId);
        db.addEvent(`fora_estado: ${agentId} ${numero} (${estadoDetectado})`);
        await sendText(agentId, CONFIG.SEU_WHATSAPP, `*${agent.name.toUpperCase()} - FORA DO ESTADO*\n\nCliente: wa.me/${numero}\nEstado: ${estadoDetectado}\nMsg: "${mensagem}"\n\n_Cliente de outro estado. Entrega local apenas._`);
        db.save();
        console.log(`${agent.name} [${numero}]: Fora do estado — ${estadoDetectado}`);
        return;
      }
    }

    // INTERCEPTAÇÃO DE FRETE DETERMINÍSTICA: se cliente menciona distância em km,
    // calcular e enviar direto — IGUAL ao handler de localização. IA NAO PARTICIPA.
    // Contexto obrigatório: só dispara quando a mensagem indica distância do cliente à loja,
    // não qualquer menção isolada de "km" (ex: "cabo de 5km", "alcance de 10km").
    function indicaDistanciaParaFrete(msg) {
      // 1. Palavras explícitas de frete, entrega ou custo de envio
      if (/\b(?:frete|entrega|entregar|delivery|distancia|distância|cobr)/i.test(msg)) return true;
      // 2. Verbo de posição do cliente + km: "estou a 18km", "moro a 10km", "fico 5km"
      if (/\b(?:estou|fico|moro|mora|vivo|resido|me\s+encontro)\s+(?:a\s+|há\s+|ha\s+|pra\s+)?(?:\w+\s+){0,2}\d+(?:[.,]\d+)?\s*(?:km|quil)/i.test(msg)) return true;
      // 3. km seguido de referência ao destino: "18km daqui", "10km da loja", "15km de vocês"
      if (/\d+(?:[.,]\d+)?\s*(?:km|quil)[^.\n]{0,30}\b(?:daqui|da\s+loja|de\s+voc[eê]|de\s+vc|daí|dai\b|até\s+aqui|ate\s+aqui)/i.test(msg)) return true;
      return false;
    }
    const kmMatch = mensagem.match(/(\d+(?:[.,]\d+)?)\s*(?:km|quilometro|quilômetro|quilometros|quilômetros)/i);
    // GUARD: se frete ja foi calculado via GPS, NAO recalcular por texto — evita sobrescrever freteCalculado correto
    const freteJaCalculadoAntes = !!(conv.freteCalculado && conv.freteCalculado.total);
    if (kmMatch && indicaDistanciaParaFrete(mensagem) && !freteJaCalculadoAntes) {
      if (precisaEscolherProdutoPedro()) {
        await pedirEscolhaProdutoPedro();
        return;
      }
      const distKm = parseFloat(kmMatch[1].replace(",", "."));
      if (distKm > 0) {
        const fr = calcFreightByKm(distKm);
        if (fr.frete !== null) {
          const productCtxKm = getProductContext(agentId, numero, mensagem || "");
          let productPrice = productCtxKm.price;
          let productName = productCtxKm.name;
          // Verificar oferta ativa (desconto de preço e/ou frete grátis autorizado)
          const ofertaKm = db.getActiveOffer(agentId, numero);
          if (ofertaKm && ofertaKm.precoDesconto < productPrice) {
            productPrice = ofertaKm.precoDesconto;
          }
          // Frete grátis: se oferta autorizada, override para zero
          const freteGratisAtivoKm = !!(ofertaKm && ofertaKm.freteGratis);
          const freteEfetivoKm = freteGratisAtivoKm ? 0 : fr.frete;
          const total = productPrice + freteEfetivoKm;
          const parcelasWhatsApp = calcInstallmentsWhatsApp(total);
          const parcelasInline = calcInstallments(total);
          // Envia mensagem FIXA direto — IA nao interfere (mesmo pattern do handler de localizacao)
          const freteMsg = freteGratisAtivoKm
            ? `Calculei aqui! 📍\n\nFrete: *GRÁTIS* 🎉\n${productName}: *R$${productPrice}*\n*Total: R$${total}*\n\n💳 *Parcelas no cartão:*\n${parcelasWhatsApp}\n\nPosso te encaixar na proxima rota de entrega? 🚚\n\nO pagamento e feito direto pro entregador na hora!`
            : `Calculei aqui! 📍\n\nFrete: *R$${fr.frete}* (${fr.distKm}km)\n${productName}: *R$${productPrice}*\n*Total: R$${total}*\n\n💳 *Parcelas no cartão (total com frete):*\n${parcelasWhatsApp}\n\nPosso te encaixar na proxima rota de entrega? 🚚\n\nO pagamento e feito direto pro entregador na hora!`;
          await sendText(agentId, numero, freteMsg);

          // Salva no historico pra IA ter contexto (inline pra nao poluir historico)
          // FONTE AUTORITATIVA: salva frete calculado — freteGratis=true → frete=0
          conv.freteCalculado = { frete: freteEfetivoKm, total, distKm: fr.distKm, produtoPreco: productPrice, freteGratis: freteGratisAtivoKm, timestamp: Date.now() };
          conv.msgs.push({ role: "user", content: `[Cliente informou distancia: ${fr.distKm}km da loja]`, timestamp: Date.now() });
          const _histMsgKm = freteGratisAtivoKm
            ? `Frete: GRÁTIS (${fr.distKm}km, oferta autorizada). Total a vista: R$${total}. Parcelas no cartao: ${parcelasInline}. Perguntei se quer entrega.`
            : `Frete: R$${fr.frete} (${fr.distKm}km). Total a vista: R$${total}. Parcelas no cartao (sobre total com frete): ${parcelasInline}. Perguntei se quer entrega.`;
          conv.msgs.push({ role: "assistant", content: _histMsgKm, timestamp: Date.now() });
          conv.ultimaMensagem = Date.now();

          db.registerContact(numero, agentId);
          db.addActivity(`${agentId}: ${numero} - frete por texto (${fr.distKm}km = ${freteGratisAtivoKm ? "GRÁTIS" : `R$${fr.frete}`})`);
          db.save();
          console.log(`${agent.name} [${numero}]: Frete DETERMINISTICO por texto — ${fr.distKm}km = ${freteGratisAtivoKm ? "GRÁTIS" : `R$${fr.frete}`}, total R$${total}`);
          return; // NAO passa pela IA — valor ja foi enviado correto
        } else {
          // Fora da area — mesma resposta do handler de localizacao
          const foraMsg = `Poxa, vi aqui que voce esta a ${fr.distKm}km da nossa loja 😕\n\nInfelizmente nosso limite de entrega e 30km. Mas vou te passar pro *Miron* (dono) pra ver se consegue uma alternativa pra voce!`;
          await sendText(agentId, numero, foraMsg);

          conv.msgs.push({ role: "user", content: `[Cliente informou distancia: ${fr.distKm}km - FORA DA AREA]`, timestamp: Date.now() });
          conv.msgs.push({ role: "assistant", content: foraMsg, timestamp: Date.now() });
          conv.ultimaMensagem = Date.now();

          db.addEvent(`fora_area_texto: ${agentId} ${numero} (${fr.distKm}km)`);
          db.registerContact(numero, agentId);
          db.save();
          console.log(`${agent.name} [${numero}]: Fora da area por texto — ${fr.distKm}km`);
          return; // NAO passa pela IA
        }
      }
    }

    // Usa retry com backoff (3 tentativas, 1s/2s/4s)
    const contextSize = 20;
    let resposta = await callClaudeWithRetry(systemPrompt, conv.msgs.slice(-contextSize), { maxTokens: 600 });

    if (!resposta) {
      console.error(`[AI] ${agent.name}: FALHA TOTAL DA IA para ${numero} após 3 tentativas — Gemini e Anthropic indisponíveis`);
      // Alerta operacional para Miron
      sendText(agentId, CONFIG.SEU_WHATSAPP, `⚠️ *FALHA IA* — ${agent.name} não conseguiu responder ${numero} após 3 tentativas. Verifique créditos Gemini/Anthropic!`).catch(() => {});
      // Contingência: avisa o cliente — com rate limit para evitar spam em loops de erro
      if (podeEnviarContingencia(numero)) {
        const contingencia = "Oi! Tive uma instabilidade aqui agora. Pode me mandar sua mensagem de novo em alguns instantes? Já te respondo! 😊";
        sendText(agentId, numero, contingencia).catch(() => {});
        registrarContingenciaEnviada(numero);
        console.warn(`[AI] Contingência enviada para ${numero}`);
      } else {
        console.warn(`[AI] Contingência suprimida para ${numero} — já enviada nos últimos 15min`);
      }
      return;
    }

    // Pass through Aslam filter (require at runtime to avoid circular deps)
    let respostaFinal;
    try {
      const aslam = require("./aslam");
      respostaFinal = await aslam.filterResponse(agentId, numero, mensagem, resposta);
    } catch (eAslam) {
      console.error(`filterResponse ${agent.name} falhou, usando resposta bruta:`, eAslam.message);
      respostaFinal = resposta;
    }

    // Log if Aslam removed media tags
    if (resposta.includes("ENVIAR_FOTO") && !respostaFinal.includes("ENVIAR_FOTO")) {
      console.error(`ASLAM REMOVEU ENVIAR_FOTO de ${agent.name}/${numero}!`);
    }
    if (resposta.includes("ENVIAR_VIDEO") && !respostaFinal.includes("ENVIAR_VIDEO")) {
      console.error(`ASLAM REMOVEU ENVIAR_VIDEO de ${agent.name}/${numero}!`);
    }

    // GUARD DETERMINISTICO ANTI-LOOP: se frete ja calculado e resposta pede localizacao, bloquear
    {
      const guardConv = db.getConversation(agentId, numero);
      // FIX: usar freteCalculado como sinal primario (mais robusto)
      const guardFreteCalculado = guardConv && (
        !!(guardConv.freteCalculado && guardConv.freteCalculado.total) ||
        (guardConv.msgs && guardConv.msgs.some(m =>
          m.role === "user" && ((m.content || "").startsWith("[Cliente enviou localizacao:") || (m.content || "").startsWith("[Cliente informou distancia:"))
        ))
      );
      if (guardFreteCalculado) {
        // FIX: regex expandido para cobrir infinitivos (mandar, enviar, passar) e mais padroes
        const pedeLocalizacao = /(?:(?:me\s+)?(?:mand[ae]r?|envi[ae]r?|pass[ae]r?|compartilh[ae]r?)\s[^.!?\n]*(?:localizac|pin\b|gps))|(?:(?:preciso|necessito|quero|pede)\s[^.!?\n]*(?:localizac|pin\b))|(?:pin\s+no\s+(?:mapa|google))|(?:sua\s+localizac)|(?:mand[ae]r?\s[^.!?\n]*\bpin\b)/i.test(respostaFinal);
        if (pedeLocalizacao) {
          console.error(`[ANTI-LOOP GUARD] ${agent.name}/${numero}: resposta pedia localizacao com frete ja calculado — BLOQUEADO`);
          db.addEvent(`anti_loop_guard: ${agentId} ${numero}`);
          // Tentar preservar conteudo util removendo so a parte que pede localizacao
          let cleaned = respostaFinal.replace(/[^.!?\n]*(?:(?:me\s+)?(?:mand[ae]|envi[ae]|pass[ae]|compartilh[ae])\s[^.!?\n]*(?:localizac|pin|gps)|(?:preciso|necessito)\s[^.!?\n]*(?:localizac|pin)|pin no mapa)[^.!?\n]*[.!?]?\s*/gi, "").trim();
          if (!cleaned || cleaned.length < 10) {
            cleaned = "Otimo! Me passa seu nome completo e endereco pra organizar a entrega? 😊";
          }
          respostaFinal = cleaned;
          sendText(agentId, CONFIG.SEU_WHATSAPP, `⚠️ *ANTI-LOOP GUARD* — ${agent.name} ia pedir localizacao pro ${numero} de novo (frete ja calculado). Bloqueado.`).catch(() => {});
        }
      }
    }

    // TRAVA REGRESSÃO OFERTA — determinística: se IA esqueceu o desconto e voltou ao preço base
    // Esta é a camada de segurança final — captura qualquer escape que passou pelos prompts e guards
    {
      const _ofertaReg = db.getActiveOffer(agentId, numero);
      if (_ofertaReg && !_ofertaReg._legado) {
        const _precoBase = db.getAgentPrice(agentId);
        const _precoDesc = _ofertaReg.precoDesconto;
        if (_precoDesc !== _precoBase) {
          const _mentionBase = new RegExp(`R\\$\\s*${_precoBase}\\b`).test(respostaFinal);
          const _mentionDesc = new RegExp(`R\\$\\s*${_precoDesc}\\b`).test(respostaFinal);
          if (_mentionBase && !_mentionDesc) {
            respostaFinal = respostaFinal.replace(new RegExp(`R\\$\\s*${_precoBase}`, "g"), `R$${_precoDesc}`);
            console.error(`TRAVA REGRESSAO OFERTA: ${agentId} ${numero} usou R$${_precoBase} (oferta ativa: R$${_precoDesc}) — corrigido`);
            db.addEvent(`trava_regressao_oferta: ${agentId} ${numero} R$${_precoBase}→R$${_precoDesc}`);
            sendText(agentId, CONFIG.SEU_WHATSAPP, `⚠️ *REGRESSÃO DE OFERTA CORRIGIDA*\n${agent.name} ia dizer R$${_precoBase}, mas oferta ativa é R$${_precoDesc}\nCliente: wa.me/${numero}\n\n_Preço corrigido automaticamente._`).catch(() => {});
          }
        }
      }
    }

    // VALIDADOR DE FRETE POS-RESPOSTA: bloqueia IA que inventou valor de frete sem calculo real
    {
      // FIX: sinal primario = conv.freteCalculado (mais robusto que checar msgs)
      const freteNoHistorico = !!(conv.freteCalculado && conv.freteCalculado.total) ||
        conv.msgs.some(m =>
          m.role === "user" && ((m.content || "").startsWith("[Cliente enviou localizacao:") || (m.content || "").startsWith("[Cliente informou distancia:"))
        );
      if (!freteNoHistorico) {
        // Frete NAO foi calculado — se IA mencionar valor especifico de frete, bloqueio total
        const inventouFrete = /frete\s*(?:de\s+|:\s*|[eé]\s+|fica\s+|custa\s+|ser[aá]\s+)?R\$\s*\d+/i.test(respostaFinal);
        if (inventouFrete) {
          console.error(`VALIDADOR FRETE: ${agent.name} inventou valor de frete para ${numero} (sem localizacao recebida)`);
          db.addEvent(`frete_inventado_bloqueado: ${agentId} ${numero}`);
          respostaFinal = "Me manda sua localizacao (pin no mapa) pra eu calcular o frete certinho! 📍";
          sendText(agentId, CONFIG.SEU_WHATSAPP, `⚠️ *FRETE INVENTADO BLOQUEADO* — ${agent.name} tentou informar valor de frete sem ter recebido localização de wa.me/${numero}. Resposta substituída por pedido de pin.`).catch(() => {});
        }
      }
      // Se frete JA calculado: anti-loop guard + injecao de prompt garantem valor correto.
      // NAO fazer regex surgery — risco de corromper outros valores na resposta.

      // GUARD: agente nao pode dizer "frete grátis" sem oferta autorizada pelo dono
      // Exceção: se há oferta com freteGratis=true, o agente está correto
      const mencionouFreteGratis = /frete\s*gr[aá]tis|frete\s+[eé]\s+gr[aá]tis|frete\s+inclus[ao]|frete\s*gratuito|sem\s+cobr[aá]nça\s+de\s+frete/i.test(respostaFinal);
      if (mencionouFreteGratis && !db.hasFreteGratis(agentId, numero)) {
        console.error(`GUARD FRETE GRATIS: ${agent.name} tentou dizer frete grátis sem oferta autorizada para ${numero}`);
        db.addEvent(`frete_gratis_bloqueado: ${agentId} ${numero}`);
        respostaFinal = "Me manda sua localização (pin no mapa) pra eu calcular o frete pra você! 📍";
        sendText(agentId, CONFIG.SEU_WHATSAPP, `⚠️ *FRETE GRÁTIS BLOQUEADO* — ${agent.name} tentou dizer frete grátis sem campanha autorizada para wa.me/${numero}. Resposta corrigida.`).catch(() => {});
      }
    }

    // Process tags (send media, notifications, text) — returns final text sent to client
    const _textoEnviado = await processTags(agentId, numero, respostaFinal, mensagem);

    if (!_textoEnviado) {
      console.error(`[ATK/NOT SENT] ${agentId}/${numero}: resposta nao foi enviada e nao sera salva no dashboard`);
      db.addEvent(`resposta_nao_enviada: ${agentId} ${numero}`);
      db.save();
      return;
    }

    // Save to history AFTER processTags — garante que o CRM reflete exatamente o que foi enviado,
    // incluindo correcoes de TRAVA, guardrails e PIX dentro de processTags.
    conv.msgs.push({ role: "assistant", content: sanitize(_textoEnviado), timestamp: Date.now() });

    // Schedule follow-up (unless AGENDAR was used)
    if (!/AGENDAR:\d{2}\/\d{2}\/\d{4}/.test(respostaFinal)) {
      scheduleFollowUp(agentId, numero);
    }

    // Extract knowledge asynchronously
    extractKnowledge(agentId, mensagem, respostaFinal).catch(() => {});
  } catch (e) {
    console.error(`Erro ${agentId}:`, e.message);
  } finally {
    // Liberar lock de processamento independente de sucesso/erro
    if (_procLockKey && db.state.processingLock) db.state.processingLock.delete(_procLockKey);
  }
}

// ============================================
// handleSentMessage — when Miron sends from agent's phone
// ============================================

async function handleSentMessage(agentId, body) {
  try {
    if (!body || !body.isFromMe) return;
    const numero = body.phone;
    if (!numero || numero === CONFIG.SEU_WHATSAPP) return;
    if (numero.includes("-group") || numero.includes("@g.us") || numero.length > 15) return;

    console.log(`[SENT] ${CONFIG.AGENTS[agentId].name} → ${numero} (fromMe=true, checando anti-loop...)`);

    // Anti-loop: ignore if bot was sending (check exact number AND last 8 digits for format mismatches)
    // MAS se o cliente JA estava em conversa ativa (bot respondeu recentemente), pausar mesmo assim
    // para garantir que quando Miron envia manualmente, SEMPRE pausa
    if (db.state.botSending[agentId]) {
      const now = Date.now();
      const bsMap = db.state.botSending[agentId];
      const last8 = numero.slice(-8);
      const isBotSending = (bsMap.get(numero) || 0) > now;
      const isBotSendingFallback = [...bsMap.entries()].some(([n, exp]) => n.slice(-8) === last8 && exp > now);
      if (isBotSending || isBotSendingFallback) {
        console.log(`[SENT] ${CONFIG.AGENTS[agentId].name} → ${numero}: anti-loop ativo (bot enviando), ignorando`);
        return;
      }
    }

    // Manual pause - Miron took over
    db.pauseManual(numero, agentId);

    // Se conversa finalizada, marcar que Miron já está respondendo
    // Evita que o sistema mande "conversa encaminhada" quando cliente responder
    const conv = db.getConversation(agentId, numero);
    if (conv && conv.finalizado) {
      conv.avisouFinalizacao = true;
    }
    db.save();

    console.log(`[PAUSA] ${CONFIG.AGENTS[agentId].name} PAUSADO para ${numero} — Miron assumiu a conversa`);
    db.addEvent(`miron_assumiu_${agentId}: ${numero}`);
  } catch (e) {
    console.error(`Erro webhook-sent ${agentId}:`, e.message);
  }
}

// ============================================
// SEED KNOWLEDGE on startup
// ============================================

function seedKnowledge() {
  for (const [agentId, seeds] of Object.entries(SEEDED_KNOWLEDGE)) {
    const list = db.state.knowledge[agentId];
    if (!list) continue;
    for (const seed of seeds) {
      const alreadyExists = list.some(k => k.resumo === seed.resumo);
      if (!alreadyExists) list.push(seed);
    }
  }
}

// Seed on require
seedKnowledge();

// ============================================
// EXPORTS
// ============================================

module.exports = {
  handleIncomingMessage,
  handleSentMessage,
  buildSystemPrompt,
  SEEDED_KNOWLEDGE,
  processTags,
  scheduleFollowUp,
  buildPedroChannelReply,
  buildPedroInstallmentReply,
  extractKnowledge,
  notifyLara,
  seedKnowledge,
  detectCrossProduct,
  cleanExpiredInstructions,
};

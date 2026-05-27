'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'logzz';
const _pending = new Set();
const _pendingMedia = new Map();
// URLs de mídia já enviadas por cliente (evita repetição)
const _midiaEnviada = new Map();

const CIDADES_ENTREGA = new Set([
  'belo horizonte','ibirité','sabará','santa luzia','betim','contagem',
  'divinópolis','carmo do cajuru','pará de minas','nova serrana','itaúna','citrolândia','igaratinga',
  'almirante tamandaré','araucária','colombo','curitiba','fazenda rio grande','pinhais','piraquara',
  'são josé dos pinhais','quatro barras','campina grande do sul','campo largo','rio branco do sul','itaperuçu',
  'aparecida de goiânia','goiânia','trindade','senador canedo','goianira','anápolis','aragoiânia',
  'caturaí','guapó','inhumas','nerópolis','terezópolis de goiás','hidrolândia','gama','taguatinga',
  'abadia de goiás','ceilândia','samambaia','águas lindas de goiás','santa maria','novo gama',
  'vicente pires','sol nascente/pôr do sol','cidade ocidental','valparaíso de goiás','luziânia',
  'brasília','guará','arniqueira','goianápolis','bonfinópolis','recanto das emas',
  'arujá','barueri','carapicuíba','cotia','diadema','embu das artes','ferraz de vasconcelos',
  'guarulhos','itapevi','itaquaquecetuba','jandira','mogi das cruzes','osasco','poá','santo andré',
  'são bernardo do campo','são caetano do sul','são paulo','suzano','taboão da serra','caieiras',
  'cajamar','campo limpo paulista','francisco morato','franco da rocha','jundiaí','jacareí',
  'são josé dos campos','taubaté','caçapava','santos','são vicente','cubatão','praia grande',
  'ribeirão pires','rio grande da serra','mauá','americana','campinas','hortolândia','monte mor',
  'nova odessa','paulínia',"santa bárbara d'oeste",'sumaré','valinhos','vinhedo',
  'duque de caxias','nilópolis','nova iguaçu','rio de janeiro','são joão de meriti',
  'mesquita','queimados','belford roxo','niterói',
  'manaus',
  'alvorada','porto alegre','cachoeirinha','canoas','eldorado do sul','esteio','são leopoldo',
  'sapucaia do sul','gravataí','guaíba','novo hamburgo','campo bom','estância velha','sapiranga',
  'viamão','caxias do sul','portão','são sebastião do caí','carlos barbosa','garibaldi',
  'bento gonçalves','farroupilha','são vendelino','bom princípio',
  'caucaia','eusébio','fortaleza','itaitinga','maracanaú','maranguape','pacatuba',
  'lauro de freitas','salvador',
  'teresina','timon','raposa','são josé de ribamar','são luís','paço do lumiar',
  'cariacica','serra','vila velha','vitória','viana','guarapari',
  'parnamirim','extremoz','macaíba','natal','são gonçalo do amarante','mossoró','ceará-mirim',
  'abreu e lima','igarassu','jaboatão dos guararapes','olinda','paulista','recife',
  'cabo de santo agostinho','camaragibe','são lourenço da mata',
  'joão pessoa','santa rita','cabedelo','bayeux',
  'campo grande',
  'ananindeua','belém','marituba',
  'balneário camboriú','barra velha','camboriú','itajaí','itapema','navegantes',
  'penha','balneário piçarras','jaraguá do sul','joinville','blumenau',
]);

const LINKS = {
  un1:  'https://entrega.logzz.com.br/pay/memmonxkn/kugww-1-por-99',
  un2:  'https://entrega.logzz.com.br/pay/memmonxkn/hhrxr-2-un',
  rmk1: 'https://entrega.logzz.com.br/pay/memmonxkn/1-por-88-199-order-bump',
  rmk2: 'https://entrega.logzz.com.br/pay/memmonxkn/2-por-108-199-order-bump',
};

const MEDIA = {
  fotos: [
    'https://drive.google.com/uc?export=download&id=15mjNsXdYGS2LJH5QA_pTBC3sSJX0t7vb',
    'https://drive.google.com/uc?export=download&id=1usa7QSnq3GzW4zZqX2LuQlXlG4BsfSBw',
  ],
  // 2 provas no fluxo normal
  provas: [
    'https://drive.google.com/uc?export=download&id=1WxjfcyDVijrFZwhIGeT-geNigeqEsSia', // prova social 5 — 2.1MB
    'https://drive.google.com/uc?export=download&id=1nVXoxLjX4VCMB52Yoqe1jgIzpSUvDaTo', // prova social 3 — 6MB
  ],
  // 2 provas exclusivas do remarketing
  provasRemarketing: [
    'https://drive.google.com/uc?export=download&id=1FL1JRXfasR2ZX6wLn8KyoC69uHvWg4qi', // WhatsApp 25/02 — 8.3MB
    'https://drive.google.com/uc?export=download&id=1S57Od4tqpEBjnw5fEA05mwF12YzJKMAa', // WhatsApp 02/03 — 10.7MB
  ],
};

const MSGS_REMARKETING = [
  (nome) => `Oi${nome}! 👋 Ainda pensando na Resina Extreme?\n\nConsegui incluir uma microfibra de brinde pra você 🎁\n\n✅ 1 frasco + microfibra por R$89,99: ${LINKS.rmk1}\n✅ 2 frascos + microfibra por R$109,99: ${LINKS.rmk2}\n\nFrete grátis, paga só na entrega. Qual fica melhor?`,
  (nome) => `${nome ? `${nome}, ` : ''}tivemos mais entregas confirmadas na sua região hoje 🚚\n\nA Resina Extreme ainda tem disponibilidade essa semana — brilho espelhado, repele água, dura 2 meses por aplicação.\n\n🛡️ 1 frasco + microfibra: ${LINKS.rmk1}\n🛡️ 2 frascos + microfibra: ${LINKS.rmk2}\n\nPaga só na entrega. Frete grátis. 😊`,
  (nome) => `Oi${nome}! Passando pra avisar que ainda consigo garantir a entrega essa semana 🔥\n\nClientes que usaram a Resina Extreme amaram — pintura espelhada e água escorregando.\n\n👉 Kit com microfibra de brinde, pago só na entrega:\n${LINKS.rmk1}\n\nQuer garantir o seu?`,
  (nome) => `${nome ? `${nome}, não` : 'Não'} deixa o sol acabar com a pintura do seu veículo! ☀️\n\nSem proteção, a tinta vai desbotando e uma repintura pode custar R$2.000 ou mais...\n\nCom a Resina Extreme (pago na entrega, frete grátis) você protege por meses + leva microfibra de brinde:\n${LINKS.rmk1}\n\nAinda temos entrega disponível na sua região!`,
  (nome) => `Oi${nome}! 😊 Última chamada antes de encerrarmos as entregas dessa semana na sua região.\n\n✅ Paga só na entrega\n✅ Frete grátis\n✅ Microfibra de brinde\n✅ Brilho espelhado garantido\n\n1 frasco: ${LINKS.rmk1}\n2 frascos: ${LINKS.rmk2}\n\nSe não for o momento certo, sem problema — mas a disponibilidade encerra em breve! 🙏`,
];

function buildSystemPrompt(instrucaoManual = '', remarketingCtx = '') {
  return `Você é Roberto, consultor de vendas da Resina Extreme. Trabalha com entrega Logzz — pagamento APENAS na entrega (COD), frete GRÁTIS. Nunca cobra nada antecipado.

## PRODUTO — Resina Extreme
Protetor automotivo que vitrifica a pintura, repele água e dá brilho espelhado. Frasco de 500ml — rende 8–10 aplicações, cada uma dura 1–2 meses. Funciona em carro, moto e caminhão de qualquer cor.

## KITS E PREÇOS — APRESENTE SEMPRE O KIT 2 PRIMEIRO (âncora no premium)
Kit 2 frascos: R$119,99 → link: ${LINKS.un2}  ← APRESENTE PRIMEIRO como "o mais pedido"
Kit 1 frasco: R$100 → link: ${LINKS.un1}       ← opção secundária
Frete: GRÁTIS | Pagamento: na entrega — dinheiro, pix ou cartão (o entregador leva maquininha)

## PARCELAMENTO NO CARTÃO (maquininha na entrega)
Kit 1 frasco (R$100):
2x R$56,56 | 3x R$37,97 | 4x R$28,68 | 5x R$23,11 | 6x R$19,40
7x R$16,93 | 8x R$14,92 | 9x R$13,36 | 10x R$12,12 | 11x R$11,10 | 12x R$10,25

Kit 2 frascos (R$119,99):
2x R$67,86 | 3x R$45,56 | 4x R$34,42 | 5x R$27,73 | 6x R$23,28
7x R$20,31 | 8x R$17,90 | 9x R$16,03 | 10x R$14,54 | 11x R$13,32 | 12x R$12,30

Se o cliente perguntar sobre parcelamento, informe que o entregador leva maquininha e pode parcelar em até 12x no cartão. Mostre os valores acima conforme o kit escolhido.

## REMARKETING (só quando cliente sumir ou não fechar após link)
1 frasco + microfibra GRÁTIS: R$89,99 → link: ${LINKS.rmk1}
2 frascos + microfibra GRÁTIS: R$109,99 → link: ${LINKS.rmk2}
(o sistema envia o remarketing automaticamente — você não precisa se preocupar)

## CIDADES ATENDIDAS (verificar sempre antes de prosseguir)
Minas Gerais: Belo Horizonte, Ibirité, Sabará, Santa Luzia, Betim, Contagem, Divinópolis, Carmo do Cajuru, Pará de Minas, Nova Serrana, Itaúna, Citrolândia, Igaratinga
Paraná: Almirante Tamandaré, Araucária, Colombo, Curitiba, Fazenda Rio Grande, Pinhais, Piraquara, São José dos Pinhais, Quatro Barras, Campina Grande do Sul, Campo Largo, Rio Branco do Sul, Itaperuçu
Goiás/DF: Aparecida de Goiânia, Goiânia, Trindade, Senador Canedo, Goianira, Anápolis, Aragoiânia, Caturaí, Guapó, Inhumas, Nerópolis, Terezópolis de Goiás, Hidrolândia, Gama, Taguatinga, Abadia de Goiás, Ceilândia, Samambaia, Águas Lindas de Goiás, Santa Maria, Novo Gama, Vicente Pires, Sol Nascente/Pôr do Sol, Cidade Ocidental, Valparaíso de Goiás, Luziânia, Brasília, Guará, Arniqueira, Goianápolis, Bonfinópolis, Recanto das Emas
São Paulo: Arujá, Barueri, Carapicuíba, Cotia, Diadema, Embu das Artes, Ferraz de Vasconcelos, Guarulhos, Itapevi, Itaquaquecetuba, Jandira, Mogi das Cruzes, Osasco, Poá, Santo André, São Bernardo do Campo, São Caetano do Sul, São Paulo, Suzano, Taboão da Serra, Caieiras, Cajamar, Campo Limpo Paulista, Francisco Morato, Franco da Rocha, Jundiaí, Jacareí, São José dos Campos, Taubaté, Caçapava, Santos, São Vicente, Cubatão, Praia Grande, Ribeirão Pires, Rio Grande da Serra, Mauá, Americana, Campinas, Hortolândia, Monte Mor, Nova Odessa, Paulínia, Santa Bárbara d'Oeste, Sumaré, Valinhos, Vinhedo
Rio de Janeiro: Duque de Caxias, Nilópolis, Nova Iguaçu, Rio de Janeiro, São João de Meriti, Mesquita, Queimados, Belford Roxo, Niterói
Rio Grande do Sul: Alvorada, Porto Alegre, Cachoeirinha, Canoas, Eldorado do Sul, Esteio, São Leopoldo, Sapucaia do Sul, Gravataí, Guaíba, Novo Hamburgo, Campo Bom, Estância Velha, Sapiranga, Viamão, Caxias do Sul, Portão, São Sebastião do Caí, Carlos Barbosa, Garibaldi, Bento Gonçalves, Farroupilha, São Vendelino, Bom Princípio
Ceará: Caucaia, Eusébio, Fortaleza, Itaitinga, Maracanaú, Maranguape, Pacatuba
Bahia: Lauro de Freitas, Salvador
Maranhão/Piauí: Teresina, Timon, Raposa, São José de Ribamar, São Luís, Paço do Lumiar
Espírito Santo: Cariacica, Serra, Vila Velha, Vitória, Viana, Guarapari
Rio Grande do Norte: Parnamirim, Extremoz, Macaíba, Natal, São Gonçalo do Amarante, Mossoró, Ceará-Mirim
Pernambuco: Abreu e Lima, Igarassu, Jaboatão dos Guararapes, Olinda, Paulista, Recife, Cabo de Santo Agostinho, Camaragibe, São Lourenço da Mata
Paraíba: João Pessoa, Santa Rita, Cabedelo, Bayeux
Outros: Manaus, Campo Grande, Ananindeua, Belém, Marituba
Santa Catarina: Balneário Camboriú, Barra Velha, Camboriú, Itajaí, Itapema, Navegantes, Penha, Balneário Piçarras, Jaraguá do Sul, Joinville, Blumenau

## REGRA DE AGENDAMENTO — NUNCA VIOLAR
1. Quando o cliente escolher o kit, peça os dados de entrega em UMA mensagem:
   "Perfeito! Vamos fazer o agendamento da sua entrega então 😊 Me manda:
   • Seu nome completo
   • CEP da sua rua
   • Número da casa, quadra e lote
   • Ponto de referência (se tiver)
   Com essas informações já verifico aqui no sistema o dia que consigo entregar pra você."
2. Aguarde o cliente enviar os dados. NÃO pressione nem repita o pedido.
3. Assim que o cliente enviar os dados de endereço → confirme e use [AGENDAMENTO_RECEBIDO]:
   "Perfeito, [nome]! Já anotei tudo aqui 📋 Em breve você vai receber a confirmação da sua entrega. Obrigado por escolher a Resina Extreme! [AGENDAMENTO_RECEBIDO]"
4. Após [AGENDAMENTO_RECEBIDO] NUNCA mais envie mensagem para este cliente.
5. NUNCA envie link de pagamento no fluxo de fechamento — o agendamento é feito por aqui mesmo.

## FLUXO DE ATENDIMENTO — DIRETO E SEM ENROLAÇÃO

REGRA FUNDAMENTAL: Faça UMA pergunta por mensagem no máximo. Nunca empilhe perguntas. Seja direto — o cliente não gosta de interrogatório.

### Etapa 1 — ABERTURA (1ª mensagem do cliente)
Cumprimente, apresente-se como Roberto da Resina Extreme e pergunte o nome do cliente.
Exemplo: "Olá! Aqui é o Roberto da Resina Extreme. Com quem tenho o prazer?"

### Etapa 2 — CIDADE (logo após saber o nome — ANTES de enviar qualquer mídia)
Pergunte a cidade ANTES de apresentar o produto. Não envie fotos nem vídeos antes de confirmar a entrega.
Exemplo: "Prazer, [nome]! Me fala sua cidade que já confirmo se a entrega chega aí 😊"

### Etapa 3 — DISPONIBILIDADE E APRESENTAÇÃO
- Cidade ATENDIDA → confirme, apresente o produto em 2 linhas, envie as mídias e apresente os kits com âncora no Kit 2:
  "Temos entrega em [cidade]! A Resina Extreme vitrifica a pintura, repele água e dá brilho espelhado — rende 8 aplicações, cada uma dura até 2 meses. [ENVIAR_FOTO][ENVIAR_PROVA]
  O mais pedido é o Kit 2 frascos por R$119,99 — protege mais tempo e rende dobrado. Ou tem o Kit 1 por R$100. Frete grátis, paga só na entrega. Qual você prefere?"
- Cidade NÃO ATENDIDA → "Ainda não chegamos aí, mas estamos expandindo! Posso te avisar quando tiver."

### Etapa 4 — AGENDAR
Quando o cliente escolher o kit, peça os dados de entrega em UMA mensagem (nome completo, CEP, número da casa, quadra e lote, ponto de referência). Não pergunte se pode — já solicite diretamente de forma natural.

### Etapa 5 — CONFIRMAR E PAUSAR
Quando o cliente enviar os dados de endereço → agradeça, confirme que vai verificar o dia disponível e use [AGENDAMENTO_RECEBIDO].

## REGRA DE PREÇO — RESPONDA SEMPRE NA HORA
Se o cliente perguntar o valor ANTES de você apresentar os kits, responda imediatamente:
"O mais pedido é o Kit 2 frascos por R$119,99 — ou Kit 1 por R$100. Frete grátis, paga na entrega — dinheiro, pix ou cartão parcelado (entregador leva maquininha). Qual é a sua cidade?"
NUNCA desvie da pergunta de preço para fazer outras perguntas antes.

## TAGS DE AÇÃO
[AGENDAMENTO_RECEBIDO] — cliente enviou os dados de entrega; sistema notifica o responsável e pausa a conversa
[ENVIAR_FOTO] — enviar foto do produto (use na apresentação)
[ENVIAR_PROVA] — enviar vídeo de prova social (use ao fechar)
[PAUSAR_AGENTE] — pausar conversa (situações especiais)
[TRANSFERIR_HUMANO] — transferir para humano (reclamações, situações fora do fluxo)

## SPIN SELLING — MANEJO DE OBJEÇÕES DE SAÍDA

ATIVE SOMENTE quando o cliente sinalizar que quer sair da conversa:
Sinais: "vou pensar", "depois", "agora não", "tô sem dinheiro", "tô ocupado", "talvez", "não sei", qualquer desculpa para adiar ou encerrar.

NUNCA use se o cliente recusou de forma definitiva. Use UMA pergunta por mensagem. Tom de conversa — nunca interrogatório.

### Sequência SPIN para Resina Extreme:

**S — Situação** (entender o contexto do veículo):
"Você usa o carro/moto todo dia ou mais no fim de semana?"

**P — Problema** (identificar a dor com a pintura):
"E a pintura hoje — tá com brilho bom ou já tá um pouco opaca/desbotada?"

**I — Implicação** (ampliar a consequência de não proteger):
"Faz sentido, sem proteção o sol e a chuva vão desgastando a pintura bem rápido — e uma repintura chega a custar R$1.500, R$2.000 facilmente..."

**N — Necessidade de solução** (fazer o cliente visualizar a solução):
"Se você pudesse proteger a pintura, recuperar o brilho e ainda repelir água com uma aplicação que dura 2 meses — valeria R$100 pagos só na entrega?"

### Regras:
1. Faça S → P → I → N, uma por mensagem, respeitando as respostas do cliente
2. Adapte a pergunta ao que o cliente já disse (não repita informações coletadas)
3. Após N, se o cliente aceitar → siga o fluxo normal de fechamento
4. Se mesmo após o SPIN o cliente recusar → respeite: "Tudo bem! Se mudar de ideia é só chamar 😊" e use [PAUSAR_AGENTE]

## TOM
- Roberto: direto, confiante, sem enrolação
- Máximo 3–4 linhas por mensagem
- Use o nome do cliente sempre que souber
- Linguagem informal e direta
- Nunca repita perguntas que o cliente já respondeu
- COD elimina objeção financeira: reforce "paga só na entrega" sempre que sentir hesitação
${remarketingCtx ? `\n## CONTEXTO DE REMARKETING — CRÍTICO\nVocê enviou esta mensagem de remarketing para este cliente:\n"${remarketingCtx}"\nHonre EXATAMENTE qualquer desconto ou condição mencionada. Se você ofereceu R$89,99, NÃO pode cobrar R$100. Continue a venda a partir dessa oferta.` : ''}${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

function extractTags(text) {
  const tags = [];
  if (text.includes('[ENVIAR_FOTO]')) tags.push('ENVIAR_FOTO');
  if (text.includes('[ENVIAR_PROVA]')) tags.push('ENVIAR_PROVA');
  if (text.includes('[LINK_ENVIADO]')) tags.push('LINK_ENVIADO');
  if (text.includes('[TRANSFERIR_HUMANO]')) tags.push('TRANSFERIR_HUMANO');
  if (text.includes('[PAUSAR_AGENTE]')) tags.push('PAUSAR_AGENTE');
  if (text.includes('[AGENDAMENTO_RECEBIDO]')) tags.push('AGENDAMENTO_RECEBIDO');
  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[ENVIAR_FOTO\]/gi, '')
    .replace(/\[ENVIAR_PROVA\]/gi, '')
    .replace(/\[LINK_ENVIADO\]/gi, '')
    .replace(/\[TRANSFERIR_HUMANO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
    .replace(/\[AGENDAMENTO_RECEBIDO\]/gi, '')
    .trim();
}

function getConvState(phone) {
  const db = require('../database');
  return db.state.conversations.logzz?.get(phone) || null;
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
        console.log(`[LOGZZ] Áudio transcrito de ${phone}: "${transcricao.slice(0, 80)}"`);
      }
    } catch (e) {
      console.error(`[LOGZZ] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  console.log(`[LOGZZ] Mensagem recebida de ${phone}: "${(body || '').slice(0, 60)}"`);

  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);
  const convState = getConvState(phone);
  if (convState) {
    convState.ultimaMensagemUsuario = Date.now();
  }

  // Acumular mídia antes do check de pausa/pending
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
  if (_pending.has(phone)) return; // mídia fica acumulada, será consumida pelo processamento em andamento
  _pending.add(phone);

  // Delay antes de responder — mensagens recebidas neste período acumulam no DB
  await new Promise(r => setTimeout(r, 20000));

  try {
    // Rebuild historico APÓS o delay para incluir todas as mensagens recebidas durante a espera
    const conv = getConv(AGENT_ID, phone);
    const instrucao = getInstrucao(AGENT_ID);
    const remarketingCtx = getConvState(phone)?.remarketingContexto || '';

    const historico = (conv.msgs || []).slice(-30).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    if (historico.length === 0 || historico.at(-1).role !== 'user') {
      historico.push({ role: 'user', content: body || 'oi' });
    }

    // Consumir mídia acumulada e injetar como vision blocks na última mensagem do usuário
    const mediaList = _pendingMedia.get(phone) || [];
    _pendingMedia.delete(phone);

    if (mediaList.length > 0) {
      let lastUserIdx = -1;
      for (let i = historico.length - 1; i >= 0; i--) {
        if (historico[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) {
        const blocks = [];
        for (const m of mediaList) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: m.mimetype, data: m.base64 } });
        }
        const hasVideo = mediaList.some(m => m.kind === 'video');
        const textoAtual = historico[lastUserIdx].content;
        const textoFinal = (textoAtual === '[mídia]' || !textoAtual)
          ? (hasVideo ? '[O cliente enviou um vídeo — analise o frame/thumbnail acima]' : '[O cliente enviou esta imagem — use para continuar o fluxo de vendas]')
          : textoAtual;
        blocks.push({ type: 'text', text: textoFinal });
        historico[lastUserIdx] = { role: 'user', content: blocks };
        console.log(`[LOGZZ] Vision: ${mediaList.length} mídia(s) injetada(s) para ${phone}`);
      }
    }

    const resposta = await Promise.race([
      callClaudeText(buildSystemPrompt(instrucao, remarketingCtx), historico, { temperature: 0.75, maxTokens: 500 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);
    const tags = extractTags(resposta);
    const textoLimpo = removeTags(resposta);

    const sessionId = CONFIG.sessionIds.logzz;

    if (tags.includes('PAUSAR_AGENTE')) {
      pausePhone(AGENT_ID, phone);
      const cs = getConvState(phone);
      if (cs) delete cs.remarketingContexto;
    }

    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
      addMsg(AGENT_ID, phone, 'assistant', textoLimpo);

      // Detecta link enviado — por tag OU por presença do link logzz na mensagem
      const temLink = textoLimpo.includes('entrega.logzz.com.br') || tags.includes('LINK_ENVIADO');
      if (temLink) {
        const convState = getConvState(phone);
        if (convState) {
          convState.linkEnviadoEm = Date.now();
          convState.followUpEnviado = false;
          convState.remarketingEnviado = false;
          console.log(`[LOGZZ] linkEnviadoEm registrado para ${phone}`);
        }
      }
    }

    if (tags.includes('ENVIAR_FOTO')) {
      const enviadas = _midiaEnviada.get(phone) || new Set();
      await new Promise(r => setTimeout(r, 1000));
      for (const url of MEDIA.fotos) {
        if (enviadas.has(url)) continue;
        await baileys.sendMedia(sessionId, phone, 'image', url, '', _originalJid);
        enviadas.add(url);
        await new Promise(r => setTimeout(r, 800));
      }
      _midiaEnviada.set(phone, enviadas);
    }

    if (tags.includes('ENVIAR_PROVA')) {
      const enviadas = _midiaEnviada.get(phone) || new Set();
      for (const url of MEDIA.provas) {
        if (enviadas.has(url)) continue;
        await new Promise(r => setTimeout(r, 1500));
        await baileys.sendMedia(sessionId, phone, 'video', url, '', _originalJid);
        enviadas.add(url);
      }
      _midiaEnviada.set(phone, enviadas);
    }

    if (tags.includes('AGENDAMENTO_RECEBIDO')) {
      pausePhone(AGENT_ID, phone);
      const cs = getConvState(phone);
      if (cs) delete cs.remarketingContexto;
      sendTelegram(`📦 *Roberto — Agendamento recebido!*\nCliente: ${pushName || phone} (${phone})\nDados:\n${body?.slice(0, 400)}`).catch(() => {});
    }

    if (tags.includes('TRANSFERIR_HUMANO')) {
      pausePhone(AGENT_ID, phone);
      sendTelegram(`👤 *Roberto — Transferir para humano*\nCliente: ${pushName || phone}\nMsg: ${body?.slice(0, 120)}`).catch(() => {});
    }

  } catch (error) {
    console.error(`[LOGZZ-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *Roberto — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
    _pendingMedia.delete(phone);
  }
}

// Follow-up 2h + remarketing 24h automático
async function checkFollowUps() {
  const db = require('../database');
  const convMap = db.state.conversations.logzz;
  if (!convMap) return;

  const sessionId = CONFIG.sessionIds.logzz;
  if (baileys.getState(sessionId) !== 'connected') return;

  const agora = Date.now();
  const DUAS_HORAS = 2 * 60 * 60 * 1000;
  const VINTE_QUATRO_HORAS = 24 * 60 * 60 * 1000;

  console.log(`[LOGZZ] checkFollowUps — ${convMap.size} conv(s) ativas`);
  const TRINTA_MINUTOS = 30 * 60 * 1000;
  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;
    if (!conv.linkEnviadoEm) continue;
    // Não disparar se o cliente enviou mensagem nos últimos 30 min
    if (conv.ultimaMensagemUsuario && (agora - conv.ultimaMensagemUsuario) < TRINTA_MINUTOS) continue;
    console.log(`[LOGZZ] follow-up candidato: ${phone}, elapsed: ${Math.round((agora - conv.linkEnviadoEm) / 60000)}min`);

    const elapsed = agora - conv.linkEnviadoEm;
    if (isNaN(elapsed)) continue;

    // Follow-up 2h
    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 🚚 Tivemos mais pedidos confirmados na sua região hoje. Ainda consigo garantir entrega essa semana — o link continua ativo. Precisa de ajuda para finalizar?`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[LOGZZ] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[LOGZZ] Erro follow-up ${phone}:`, e.message);
      }
    }

    // Remarketing diário (só após follow-up 2h, repete a cada 24h com mensagem rotativa)
    if (conv.followUpEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      const ultimoRmk = conv.ultimoRemarketingEm || 0;
      const passou24hDesdeUltimoRmk = (agora - ultimoRmk) >= VINTE_QUATRO_HORAS;
      if (!passou24hDesdeUltimoRmk) continue;

      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const rmkCount = conv.rmkCount || 0;
        const msg = MSGS_REMARKETING[rmkCount % MSGS_REMARKETING.length](nome);

        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);

        // Alterna entre os 2 vídeos de prova
        const videoUrl = MEDIA.provasRemarketing[rmkCount % MEDIA.provasRemarketing.length];
        await new Promise(r => setTimeout(r, 1500));
        await baileys.sendMedia(sessionId, phone, 'video', videoUrl);

        conv.rmkCount = rmkCount + 1;
        conv.ultimoRemarketingEm = agora;
        conv.remarketingEnviado = true;
        console.log(`[LOGZZ] Remarketing diário #${rmkCount + 1} → ${phone}`);
      } catch (e) {
        console.error(`[LOGZZ] Erro remarketing ${phone}:`, e.message);
      }
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.logzz;
  console.log('[LOGZZ-AGENTE] Inicializando Roberto — Resina Extreme...');
  setInterval(checkFollowUps, 5 * 60 * 1000);
  await baileys.connect(sessionId, processMessage);
  console.log('[LOGZZ-AGENTE] Roberto pronto');
}

module.exports = { init, processMessage, AGENT_ID };

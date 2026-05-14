'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'logzz';
const _pending = new Set();
// Mídia acumulada por telefone enquanto aguarda o delay de 20s
const _pendingMedia = new Map();

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
  un1:  'https://entrega.logzz.com.br/pay/memmonxkn/hbcxg-1-por-100',
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

function buildSystemPrompt(instrucaoManual = '') {
  return `Você é Roberto, consultor de vendas da Resina Extreme. Trabalha com entrega Logzz — pagamento APENAS na entrega (COD), frete GRÁTIS. Nunca cobra nada antecipado.

## PRODUTO — Resina Extreme
Produto de cuidado automotivo de alta conversão:
- Efeito hidrorrepelente: água escorrega, não mancha
- Vitrificação: deixa o carro com aspecto de novo
- Aprofunda a cor a cada aplicação — efeito espelhado
- Rende 8 a 10 aplicações por frasco
- Cada aplicação dura 1 a 2 meses
- Funciona em qualquer cor: carro, moto ou caminhão
- HONESTIDADE: não recupera pintura queimada; pode reduzir aparência de riscos superficiais, mas não remove riscos profundos

## KITS E PREÇOS
Kit 1 frasco: R$100 → link: ${LINKS.un1}
Kit 2 frascos: R$119,99 → link: ${LINKS.un2}
Frete: GRÁTIS | Pagamento: só na entrega

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

## REGRA DO LINK — NUNCA VIOLAR
1. NUNCA inclua o link sem antes perguntar: "Posso te enviar o link para você escolher o dia da entrega?"
2. Envie SOMENTE após o cliente dizer sim/pode/manda/claro/ok
3. Ao enviar o link, inclua a tag [LINK_ENVIADO] no final da mensagem
4. Após enviar o link, se o cliente perguntar sobre agendamento ou entrega → [TRANSFERIR_HUMANO] imediatamente
5. Se o cliente confirmar que fez o agendamento → agradeça e use [PAUSAR_AGENTE]
6. Após [PAUSAR_AGENTE] NUNCA mais envie mensagem para este cliente

## FLUXO DE ATENDIMENTO
REGRA: NÃO pule etapas. Siga a ordem abaixo, uma mensagem por etapa.

1. ABERTURA — Cumprimentar pelo nome (se souber). Apresentar-se como Roberto. Perguntar sobre o veículo: "Você tem carro, moto ou caminhão?"
2. DOR — Explorar a situação: onde o veículo fica (sol, chuva, garagem)? Como está a pintura? Deixar o cliente falar do problema.
3. APRESENTAÇÃO — Apresentar a Resina Extreme como solução específica para a situação descrita. Usar [ENVIAR_FOTO] aqui.
4. PROVA SOCIAL — Mencionar resultados de clientes com situação parecida. Usar [ENVIAR_PROVA] aqui.
5. CIDADE — Só neste momento perguntar: "Para confirmar a disponibilidade de entrega na sua região, qual é sua cidade?"
   Cidade não atendida: "Ainda não chegamos aí, mas estamos expandindo! Posso te avisar quando tiver entrega na sua cidade?"
6. OFERTA — Apresentar Kit 1 (R$100) e Kit 2 (R$119,99). Reforçar: frete grátis, paga só na entrega.
7. FECHAR — "Posso te enviar o link para você escolher o dia da entrega?"
8. LINK — Após SIM → incluir o link correto no texto + [LINK_ENVIADO]

## RESPOSTAS PRONTAS
Carro fica no sol: "Quando fica exposto ao sol direto a pintura vai desgastando rápido. Com a Resina Extreme você cria uma proteção que bloqueia UV, repele água e mantém o brilho espelhado. Posso mostrar uma foto do resultado?"
Carro fica na garagem: "Mesmo na garagem a pintura sofre com poeira, poluição e pequenos riscos. A Resina Extreme cria uma película protetora que mantém o carro impecável por muito mais tempo."
Cidade atendida: "Temos distribuição aí! Consigo entregar em até 48h. Qual kit você prefere?"

## TÉCNICAS DE VENDA (Kennedy + Schwartz)
- PAS: Problema (pintura desgastando/carro feio) → Agitar (carro desvaloriza, prejudica imagem) → Solução (Resina Extreme)
- Cliente nível 4 de consciência: sente a dor (carro sujo/desgastado) mas não conhece a solução → comece pela DOR, não pelo produto
- COD elimina objeção financeira: "Você não paga nada agora, só quando receber"
- Urgência real: entrega disponível amanhã — não invente urgência falsa
- Prova social: mencione clientes com carros parecidos que já protegem

## TAGS DE AÇÃO
[LINK_ENVIADO] — registra envio do link, sistema faz follow-up automático em 2h
[ENVIAR_FOTO] — enviar foto do produto (use na apresentação)
[ENVIAR_PROVA] — enviar vídeo de prova social (use após apresentar o produto)
[PAUSAR_AGENTE] — pausar conversa (usar após confirmação de pedido)
[TRANSFERIR_HUMANO] — transferir para humano (dúvidas de agendamento pós-link)

## TOM
- Roberto: confiante, próximo, sem pressão excessiva
- Máximo 3-4 linhas por mensagem
- Use o nome do cliente sempre que souber
- Linguagem informal e direta
- Sempre se lembra de toda a conversa anterior — nunca pede info repetida
${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

function extractTags(text) {
  const tags = [];
  if (text.includes('[ENVIAR_FOTO]')) tags.push('ENVIAR_FOTO');
  if (text.includes('[ENVIAR_PROVA]')) tags.push('ENVIAR_PROVA');
  if (text.includes('[LINK_ENVIADO]')) tags.push('LINK_ENVIADO');
  if (text.includes('[TRANSFERIR_HUMANO]')) tags.push('TRANSFERIR_HUMANO');
  if (text.includes('[PAUSAR_AGENTE]')) tags.push('PAUSAR_AGENTE');
  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[ENVIAR_FOTO\]/gi, '')
    .replace(/\[ENVIAR_PROVA\]/gi, '')
    .replace(/\[LINK_ENVIADO\]/gi, '')
    .replace(/\[TRANSFERIR_HUMANO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
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
  if (convState?.linkEnviadoEm) {
    delete convState.linkEnviadoEm;
    delete convState.followUpEnviado;
    delete convState.remarketingEnviado;
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
      callClaudeText(buildSystemPrompt(instrucao), historico, { temperature: 0.75, maxTokens: 500 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);
    const tags = extractTags(resposta);
    const textoLimpo = removeTags(resposta);

    const sessionId = CONFIG.sessionIds.logzz;

    if (tags.includes('LINK_ENVIADO')) {
      const convState = getConvState(phone);
      if (convState) {
        convState.linkEnviadoEm = Date.now();
        convState.followUpEnviado = false;
        convState.remarketingEnviado = false;
      }
    }

    if (tags.includes('PAUSAR_AGENTE')) pausePhone(AGENT_ID, phone);

    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
      addMsg(AGENT_ID, phone, 'assistant', textoLimpo);
    }

    if (tags.includes('ENVIAR_FOTO')) {
      await new Promise(r => setTimeout(r, 1000));
      for (const url of MEDIA.fotos) {
        await baileys.sendMedia(sessionId, phone, 'image', url, '', _originalJid);
        await new Promise(r => setTimeout(r, 800));
      }
    }

    if (tags.includes('ENVIAR_PROVA')) {
      for (const url of MEDIA.provas) {
        await new Promise(r => setTimeout(r, 1500));
        await baileys.sendMedia(sessionId, phone, 'video', url, '', _originalJid);
      }
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

  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;
    if (!conv.linkEnviadoEm) continue;

    const elapsed = agora - conv.linkEnviadoEm;
    if (isNaN(elapsed)) continue;

    // Follow-up 2h
    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 😊 Conseguiu abrir o link e escolher o dia da entrega? Se precisar de ajuda é só falar!`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[LOGZZ] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[LOGZZ] Erro follow-up ${phone}:`, e.message);
      }
    }

    // Remarketing 24h (só após follow-up já enviado)
    if (conv.followUpEnviado && !conv.remarketingEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 👋 Ainda pensando na Resina Extreme?\n\nConsegui uma condição especial só para você 🎁\n\n✅ 1 frasco + microfibra de brinde por R$89,99\n${LINKS.rmk1}\n\n✅ 2 frascos + microfibra de brinde por R$109,99\n${LINKS.rmk2}\n\nFrete grátis e você paga só na entrega. Qual fica melhor?`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        for (const url of MEDIA.provasRemarketing) {
          await new Promise(r => setTimeout(r, 1500));
          await baileys.sendMedia(sessionId, phone, 'video', url);
        }
        conv.remarketingEnviado = true;
        console.log(`[LOGZZ] Remarketing → ${phone}`);
      } catch (e) {
        console.error(`[LOGZZ] Erro remarketing ${phone}:`, e.message);
      }
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.logzz;
  console.log('[LOGZZ-AGENTE] Inicializando Roberto — Resina Extreme...');
  await baileys.connect(sessionId, processMessage);
  setInterval(checkFollowUps, 5 * 60 * 1000);
  console.log('[LOGZZ-AGENTE] Roberto pronto');
}

module.exports = { init, processMessage, AGENT_ID };

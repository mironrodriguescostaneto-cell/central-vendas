'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../gestor');

const AGENT_ID = 'sarah';
const _pending = new Set();
const _pendingMedia = new Map();
const _midiaEnviada = new Map();

const LINKS = {
  un1:  'https://entrega.logzz.com.br/pay/memq405we/progressiva-vegetal-havana-1x198',
  un2:  'https://entrega.logzz.com.br/pay/memq405we/progressiva-vegetal-havana-2x298',
  rmk1: 'https://entrega.logzz.com.br/pay/memq405we/progressiva-vegetal-havana-1x170',
  rmk2: 'https://entrega.logzz.com.br/pay/memq405we/02-un-progressiva-vegetal-havana-2x225',
};

const MEDIA = {
  apresentacao: [
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1Kg26blELJKHdVOe93XX83UYsCpb9IJcL' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1eNEC-FaZHdc7NH12f4R4sdxiewHkdCy-' },
  ],
  // Pool completo rotativo — remarketing nunca repete a mesma mídia para o mesmo cliente
  pool: [
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1Kg26blELJKHdVOe93XX83UYsCpb9IJcL' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1eNEC-FaZHdc7NH12f4R4sdxiewHkdCy-' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=14XxHksUD7KhqeJYpvUa3wNfMs9gCGTH8' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=101MhXHg9VV_qN-8qnmE_y_G2OhogkOpA' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1gMMPgTSTMlY9PWpvYsIZTrgj_byNpyl1' },
    { type: 'image', url: 'https://drive.google.com/uc?export=download&id=1hAyp_GvbVxa2cs93wMu56Keq8snOuDc2' },
    { type: 'video', url: 'https://drive.google.com/uc?export=download&id=1j78t97nIn4SnxFRzRST-4PJH8YWvJsL8' },
    { type: 'video', url: 'https://drive.google.com/uc?export=download&id=1E2AZq9yNUuX1uNGHt4KvS1J_0sWs0h__' },
    { type: 'video', url: 'https://drive.google.com/uc?export=download&id=1_hKsaELDukeglcwH6W3zCj6IN1mo1ycw' },
    { type: 'video', url: 'https://drive.google.com/uc?export=download&id=1kCD7QUM8uf9UXptpGvrpu75Y02Tx0lAi' },
  ],
};

const MSGS_REMARKETING = [
  (nome) => `Oi${nome}! 🌟 Ainda pensando na Progressiva Vegetal?\n\nSem formol, sem cheiro, dura até 3 meses e você paga só na entrega! 💚\n\nConsegui um desconto especial pra você hoje:\n✨ 1 un — R$170 → ${LINKS.rmk1}\n✨ 2 un — R$225 → ${LINKS.rmk2}`,
  (nome) => `${nome ? nome + ', q' : 'Q'}ue tal transformar seu cabelo essa semana? 😍\n\nA Progressiva Vegetal Havana é 100% sem formol, segura, e faz em casa com resultado de salão!\n\n→ 1 un R$170 ou 2 un R$225 (frete grátis, paga na entrega)\n${LINKS.rmk1}`,
  (nome) => `Oi${nome}! Você sabia que a Progressiva Vegetal não arde os olhos, não tem cheiro e não cai o cabelo? 💆‍♀️\n\nÉ 100% vegetal e compatível com qualquer química!\n\nDesconto ativo hoje:\n1 un → R$170: ${LINKS.rmk1}\n2 un → R$225: ${LINKS.rmk2}`,
  (nome) => `${nome || 'Olá'}! 🍃 Resultado de salão em casa, sem formol e sem risco.\n\nA Progressiva Vegetal Havana já transformou milhares de cabelos! Cabelo liso até 3 meses, hidratado e forte.\n\nEsta semana com desconto:\n→ R$170 (1 un) ou R$225 (2 un)\nPaga só na entrega 🚚`,
  (nome) => `Oi${nome}! Cabelo crespo ou com frizz? A Progressiva Vegetal resolve! 🌿\n\nSem formol, sem odor, sem contraindicação — compatível com luzes, botox e todas as químicas.\n\nDesconto especial:\n1 un: R$170 → ${LINKS.rmk1}\n2 un: R$225 → ${LINKS.rmk2}`,
];

function buildSystemPrompt(instrucaoManual = '', remarketingCtx = '') {
  return `Você é Sarah, consultora de vendas da Progressiva Vegetal Havana. Trabalha com entrega Logzz — pagamento APENAS na entrega (COD), frete GRÁTIS. Nunca cobra nada antecipado.

## PRODUTO — Progressiva Vegetal Havana 500ml
Tratamento de alinhamento capilar profissional SEM FORMOL. Desenvolvida com blend de aminoácidos, colágeno, queratina, óleo de argan e trigo. Alisa, reduz frizz e hidrata profundamente os fios.

✅ Sem formol — sem ardência nos olhos, sem fumaça tóxica, sem odor
✅ 100% vegetal e segura para a saúde
✅ Compatível com TODAS as químicas (luzes, botox, selagem, formol, etc.)
✅ Resultado de salão feito em casa
✅ Dura 2 a 3 meses
✅ Rende até 10 aplicações (500ml)
✅ Para todos os tipos e cores de cabelo
✅ Recomendado para maiores de 12 anos

Modo de uso: Lave com shampoo antirresíduos → Aplique mecha por mecha (cabelo úmido) → Aguarde 40–60 min → Enxágue, seque com secador, finalize com prancha em mechas finas.

Dica extra: Se for tingir o cabelo, faça primeiro a progressiva e aguarde 3 dias para usar a tintura.

## PREÇOS
1 unidade — R$198 → link: ${LINKS.un1}
2 unidades — R$298 → link: ${LINKS.un2}
Frete: GRÁTIS | Pagamento: na entrega — dinheiro, pix ou cartão (o entregador leva maquininha)

## CIDADES ATENDIDAS (verificar sempre)
Minas Gerais: Belo Horizonte, Ibirité, Sabará, Santa Luzia, Betim, Contagem, Divinópolis, Carmo do Cajuru, Pará de Minas, Nova Serrana, Itaúna, Citrolândia, Igaratinga
Paraná: Almirante Tamandaré, Araucária, Colombo, Curitiba, Fazenda Rio Grande, Pinhais, Piraquara, São José dos Pinhais, Quatro Barras, Campina Grande do Sul, Campo Largo, Rio Branco do Sul, Itaperuçu
Goiás/DF: Aparecida de Goiânia, Goiânia, Trindade, Senador Canedo, Goianira, Anápolis, Aragoiânia, Caturaí, Guapó, Inhumas, Nerópolis, Terezópolis de Goiás, Hidrolândia, Gama, Taguatinga, Abadia de Goiás, Ceilândia, Samambaia, Águas Lindas de Goiás, Santa Maria, Novo Gama, Vicente Pires, Cidade Ocidental, Valparaíso de Goiás, Luziânia, Brasília, Guará, Arniqueira, Goianápolis, Bonfinópolis, Recanto das Emas
São Paulo: Arujá, Barueri, Carapicuíba, Cotia, Diadema, Embu das Artes, Ferraz de Vasconcelos, Guarulhos, Itapevi, Itaquaquecetuba, Jandira, Mogi das Cruzes, Osasco, Poá, Santo André, São Bernardo do Campo, São Caetano do Sul, São Paulo, Suzano, Taboão da Serra, Caieiras, Cajamar, Campo Limpo Paulista, Francisco Morato, Franco da Rocha, Jundiaí, Jacareí, São José dos Campos, Taubaté, Caçapava, Santos, São Vicente, Cubatão, Praia Grande, Ribeirão Pires, Rio Grande da Serra, Mauá, Americana, Campinas, Hortolândia, Monte Mor, Nova Odessa, Paulínia, Santa Bárbara d'Oeste, Sumaré, Valinhos, Vinhedo
Rio de Janeiro: Duque de Caxias, Nilópolis, Nova Iguaçu, Rio de Janeiro, São João de Meriti, Mesquita, Queimados, Belford Roxo, Niterói
Rio Grande do Sul: Alvorada, Porto Alegre, Cachoeirinha, Canoas, Eldorado do Sul, Esteio, São Leopoldo, Sapucaia do Sul, Gravataí, Guaíba, Novo Hamburgo, Campo Bom, Estância Velha, Sapiranga, Viamão, Caxias do Sul, Portão, São Sebastião do Caí, Carlos Barbosa, Garibaldi, Bento Gonçalves, Farroupilha, Bom Princípio
Ceará: Caucaia, Eusébio, Fortaleza, Itaitinga, Maracanaú, Maranguape, Pacatuba
Bahia: Lauro de Freitas, Salvador
Maranhão/Piauí: Teresina, Timon, Raposa, São José de Ribamar, São Luís, Paço do Lumiar
Espírito Santo: Cariacica, Serra, Vila Velha, Vitória, Viana, Guarapari
Rio Grande do Norte: Parnamirim, Extremoz, Macaíba, Natal, São Gonçalo do Amarante, Mossoró, Ceará-Mirim
Pernambuco: Abreu e Lima, Igarassu, Jaboatão dos Guararapes, Olinda, Paulista, Recife, Cabo de Santo Agostinho, Camaragibe, São Lourenço da Mata
Paraíba: João Pessoa, Santa Rita, Cabedelo, Bayeux
Outros: Manaus, Campo Grande, Ananindeua, Belém, Marituba
Santa Catarina: Balneário Camboriú, Barra Velha, Camboriú, Itajaí, Itapema, Navegantes, Penha, Jaraguá do Sul, Joinville, Blumenau

## REGRA DO LINK — NUNCA VIOLAR
1. NUNCA inclua o link sem antes perguntar: "Posso te enviar o link para você escolher o dia da entrega?"
2. Envie SOMENTE após o cliente dizer sim/pode/manda/claro/ok
3. Ao enviar o link, inclua a tag [LINK_ENVIADO] no final da mensagem
4. Após enviar o link, se o cliente perguntar sobre agendamento ou entrega → [TRANSFERIR_HUMANO]
5. Se o cliente confirmar que fez o agendamento → agradeça e use [PAUSAR_AGENTE]

## FLUXO DE ATENDIMENTO

REGRA FUNDAMENTAL: Faça UMA pergunta por mensagem. Seja direta — o cliente não gosta de interrogatório.

### Etapa 1 — ABERTURA (1ª mensagem)
Cumprimente, apresente-se como Sarah da Progressiva Vegetal Havana e pergunte o nome.
Exemplo: "Olá! Aqui é a Sarah, da Progressiva Vegetal Havana 🌿 Com quem estou falando?"

### Etapa 2 — APRESENTAÇÃO (após saber o nome)
Explique o produto em 2–3 linhas focando nos diferenciais: sem formol, vegetal, segura.
Use [ENVIAR_FOTO] para mandar as fotos de antes/depois.
Em seguida pergunte a cidade: "Qual é a sua cidade para eu confirmar a entrega?"

### Etapa 3 — CIDADE
- Cidade ATENDIDA → confirme e apresente os kits: "Temos entrega aí! 1 unidade por R$198 ou 2 unidades por R$298 — frete grátis nos dois. Qual prefere?"
- Cidade NÃO ATENDIDA → "Ainda não chegamos aí, mas estamos expandindo! Posso te avisar quando tiver."

### Etapa 4 — FECHAR
Quando o cliente escolher: "Posso te enviar o link para você escolher o dia da entrega?"

### Etapa 5 — LINK
Após SIM → envie o link correto + [LINK_ENVIADO]

## REGRA DE PREÇO
Se o cliente perguntar o valor ANTES da apresentação, responda imediatamente:
"1 unidade R$198 ou 2 unidades R$298. Frete grátis, paga na entrega. Qual é a sua cidade?"

## OBJEÇÕES COMUNS
- "Tem formol?" → "Não! É 100% vegetal, sem formol, sem cheiro, sem ardência. Completamente segura! 🌿"
- "Vai cair o cabelo?" → "Não! Pelo contrário — a queratina e o colágeno fortalecem os fios, impedindo a queda 💚"
- "Posso usar com luzes?" → "Sim! É compatível com todas as químicas — luzes, botox, selagem, qualquer uma!"
- "Quanto dura?" → "De 2 a 3 meses, dependendo dos cuidados. E rende até 10 aplicações!"

## TOM
- Sarah: feminina, empolgada, persuasiva e profissional
- Máximo 3–4 linhas por mensagem
- Use o nome do cliente sempre que souber
- Destaque o SEM FORMOL como principal diferencial
- Linguagem informal e acolhedora
- COD elimina objeção financeira: reforce "paga só na entrega, sem risco!" sempre que sentir hesitação
${remarketingCtx ? `\n## CONTEXTO DE REMARKETING — CRÍTICO\nVocê enviou esta mensagem de remarketing para este cliente:\n"${remarketingCtx}"\nHonre EXATAMENTE qualquer desconto ou condição mencionada. Continue a venda a partir dessa oferta.` : ''}${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
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
  return db.state.conversations.sarah?.get(phone) || null;
}

// Retorna próxima mídia do pool que ainda não foi enviada para o cliente
function getNextPoolMedia(conv) {
  const sent = conv.rmkSentIndices || [];
  const nextIdx = MEDIA.pool.findIndex((_, i) => !sent.includes(i));
  if (nextIdx === -1) {
    // Todas enviadas — reinicia o ciclo
    conv.rmkSentIndices = [];
    return { media: MEDIA.pool[0], idx: 0 };
  }
  return { media: MEDIA.pool[nextIdx], idx: nextIdx };
}

async function processMessage(event, payload) {
  const { phone, body: rawBody, pushName, _originalJid } = payload;
  if (!phone) return;
  if (payload.isFromMe) return;

  let body = rawBody;
  if (!body && payload.audio?.audioUrl) {
    try {
      const transcricao = await transcribeAudio(payload.audio.audioUrl);
      if (transcricao) {
        body = transcricao;
        console.log(`[SARAH] Áudio transcrito de ${phone}: "${transcricao.slice(0, 80)}"`);
      }
    } catch (e) {
      console.error(`[SARAH] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  console.log(`[SARAH] Mensagem de ${phone}: "${(body || '').slice(0, 60)}"`);

  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);
  const convState = getConvState(phone);
  if (convState) {
    convState.ultimaMensagemUsuario = Date.now();
  }

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

  if (isPaused(AGENT_ID, phone)) { _pendingMedia.delete(phone); return; }
  if (_pending.has(phone)) return;
  _pending.add(phone);

  await new Promise(r => setTimeout(r, 20000));

  try {
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
          ? (hasVideo ? '[O cliente enviou um vídeo]' : '[O cliente enviou esta imagem]')
          : textoAtual;
        blocks.push({ type: 'text', text: textoFinal });
        historico[lastUserIdx] = { role: 'user', content: blocks };
      }
    }

    const resposta = await Promise.race([
      callClaudeText(buildSystemPrompt(instrucao, remarketingCtx), historico, { temperature: 0.75, maxTokens: 500 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout IA 60s')), 60000)),
    ]);

    const tags = extractTags(resposta);
    const textoLimpo = removeTags(resposta);
    const sessionId = CONFIG.sessionIds.sarah;

    if (tags.includes('PAUSAR_AGENTE')) {
      pausePhone(AGENT_ID, phone);
      const cs = getConvState(phone);
      if (cs) delete cs.remarketingContexto;
    }

    if (textoLimpo) {
      await baileys.sendText(sessionId, phone, textoLimpo, _originalJid);
      addMsg(AGENT_ID, phone, 'assistant', textoLimpo);

      const temLink = textoLimpo.includes('entrega.logzz.com.br') || tags.includes('LINK_ENVIADO');
      if (temLink) {
        const cs = getConvState(phone);
        if (cs) {
          cs.linkEnviadoEm = Date.now();
          cs.followUpEnviado = false;
          cs.remarketingEnviado = false;
          console.log(`[SARAH] linkEnviadoEm registrado para ${phone}`);
        }
      }
    }

    if (tags.includes('ENVIAR_FOTO')) {
      const enviadas = _midiaEnviada.get(phone) || new Set();
      await new Promise(r => setTimeout(r, 800));
      for (const m of MEDIA.apresentacao) {
        if (enviadas.has(m.url)) continue;
        await baileys.sendMedia(sessionId, phone, m.type, m.url, '', _originalJid);
        enviadas.add(m.url);
        await new Promise(r => setTimeout(r, 800));
      }
      _midiaEnviada.set(phone, enviadas);
    }

    if (tags.includes('ENVIAR_PROVA')) {
      const enviadas = _midiaEnviada.get(phone) || new Set();
      // Pega próxima mídia do pool não enviada ainda
      const cs = getConvState(phone);
      if (cs) {
        const { media, idx } = getNextPoolMedia(cs);
        if (!enviadas.has(media.url)) {
          await new Promise(r => setTimeout(r, 1000));
          await baileys.sendMedia(sessionId, phone, media.type, media.url, '', _originalJid);
          enviadas.add(media.url);
          cs.rmkSentIndices = [...(cs.rmkSentIndices || []), idx];
          _midiaEnviada.set(phone, enviadas);
        }
      }
    }

    if (tags.includes('TRANSFERIR_HUMANO')) {
      pausePhone(AGENT_ID, phone);
      sendTelegram(`👤 *Sarah — Transferir para humano*\nCliente: ${pushName || phone}\nMsg: ${body?.slice(0, 120)}`).catch(() => {});
    }

  } catch (error) {
    console.error(`[SARAH-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *Sarah — Erro*\nCliente: ${phone}\nErro: ${error.message}`).catch(() => {});
  } finally {
    _pending.delete(phone);
    _pendingMedia.delete(phone);
  }
}

async function checkFollowUps() {
  const db = require('../database');
  const convMap = db.state.conversations.sarah;
  if (!convMap) return;

  const sessionId = CONFIG.sessionIds.sarah;
  if (baileys.getState(sessionId) !== 'connected') return;

  const agora = Date.now();
  const DUAS_HORAS = 2 * 60 * 60 * 1000;
  const VINTE_QUATRO_HORAS = 24 * 60 * 60 * 1000;
  const TRINTA_MINUTOS = 30 * 60 * 1000;

  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;
    if (!conv.linkEnviadoEm) continue;
    if (conv.ultimaMensagemUsuario && (agora - conv.ultimaMensagemUsuario) < TRINTA_MINUTOS) continue;

    const elapsed = agora - conv.linkEnviadoEm;
    if (isNaN(elapsed)) continue;

    // Follow-up 2h
    if (!conv.followUpEnviado && elapsed >= DUAS_HORAS) {
      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const msg = `Oi${nome}! 😊 Conseguiu abrir o link e escolher o dia da entrega? Se tiver alguma dúvida sobre a Progressiva Vegetal é só falar!`;
        await baileys.sendText(sessionId, phone, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);
        conv.followUpEnviado = true;
        console.log(`[SARAH] Follow-up 2h → ${phone}`);
      } catch (e) {
        console.error(`[SARAH] Erro follow-up ${phone}:`, e.message);
      }
    }

    // Remarketing diário — envia mídia ainda não enviada + texto persuasivo rotativo
    if (conv.followUpEnviado && elapsed >= VINTE_QUATRO_HORAS) {
      const ultimoRmk = conv.ultimoRemarketingEm || 0;
      const passou24hDesdeUltimoRmk = (agora - ultimoRmk) >= VINTE_QUATRO_HORAS;
      if (!passou24hDesdeUltimoRmk) continue;

      try {
        const nome = conv.pushName ? ` ${conv.pushName}` : '';
        const rmkCount = conv.rmkCount || 0;
        const msgFn = MSGS_REMARKETING[rmkCount % MSGS_REMARKETING.length];
        const msg = msgFn(nome);

        // Pegar próxima mídia do pool
        const { media, idx } = getNextPoolMedia(conv);

        await baileys.sendMedia(sessionId, phone, media.type, media.url, msg);
        addMsg(AGENT_ID, phone, 'assistant', msg);

        conv.rmkSentIndices = [...(conv.rmkSentIndices || []), idx];
        conv.rmkCount = rmkCount + 1;
        conv.ultimoRemarketingEm = agora;
        console.log(`[SARAH] Remarketing diário #${rmkCount + 1} → ${phone} (mídia idx ${idx})`);
      } catch (e) {
        console.error(`[SARAH] Erro remarketing ${phone}:`, e.message);
      }
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.sarah;
  console.log('[SARAH-AGENTE] Inicializando Sarah — Progressiva Vegetal Havana...');
  await baileys.connect(sessionId, processMessage);
  setInterval(checkFollowUps, 5 * 60 * 1000);
  console.log('[SARAH-AGENTE] Sarah pronta');
}

module.exports = { init, processMessage, AGENT_ID };

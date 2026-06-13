'use strict';

const { CONFIG } = require('../config');
const { callClaudeText, transcribeAudio } = require('../services');
const { addMsg, getConv, isPaused, pausePhone, getInstrucao } = require('../database');
const baileys = require('../baileys');
const { sendTelegram } = require('../notifier');

const AGENT_ID = 'sarah';
const _pending = new Set();
const _pendingMedia = new Map();

const LINK_CHECKOUT = 'https://kiwify.app/HJyLHa4';
const IMG_PROVA_PIX = 'https://drive.google.com/uc?export=download&id=1UhfeVzsYipL-8yuXOU8sMrYcyGSDgsMO';

// Mensagens de remarketing — a cada 2 dias, ângulo diferente
// Baseado em Eugene Schwartz (níveis de consciência) + Gary Halbert + SPIN
// Entradas com { img, text } enviam imagem antes do texto
const MSGS_REMARKETING = [
  {
    img: IMG_PROVA_PIX,
    text: (nome) => `${nome ? `${nome}, ` : ''}olha esse print 👆\n\nEsse é o extrato de ontem. Mais de R$100 em PIX em um único dia — usando exatamente o método do Fotógrafo Online.\n\nQuem fez isso não era fotógrafo. Era uma pessoa comum que aprendeu a transformar fotos com IA e cobrar R$20, R$30, R$50 por foto.\n\nSem câmera. Sem experiência. Só o método.\n\nR$47 com garantia: se não faturar R$50 no primeiro dia aplicando, o Miron devolve tudo — sem perguntas.\n\n${LINK_CHECKOUT}`,
  },

  (nome) => `${nome ? `${nome}, ` : ''}deixa eu te fazer uma pergunta direta 👇\n\nSe eu te dissesse que tem gente faturando R$50, R$100, R$200 por dia *sem câmera, sem equipamento e sem experiência*... você acreditaria?\n\nProvavelmente não. E eu entendo — já ouvi muita promessa vazia também.\n\nPor isso o Miron colocou uma garantia que nenhum curso tem: *se você não faturar pelo menos R$50 no primeiro dia aplicando, ele te devolve 100% do valor.*\n\nNão tem risco. Só tem oportunidade.\n\n${LINK_CHECKOUT}`,

  (nome) => `${nome ? `Oi ${nome}! ` : 'Oi! '}😊 Sabe qual é a maior mentira que te contaram sobre ganhar dinheiro online?\n\nQue você precisa de câmera profissional, estúdio, seguidores... 📷\n\nA realidade: com IA, qualquer pessoa transforma fotos comuns em fotos profissionais de R$20 a R$50 cada.\n\nO Fotógrafo Online te ensina exatamente como cobrar isso e onde encontrar os primeiros clientes — ainda no primeiro dia.\n\nR$47. Garantia total. Sem desculpa pra não tentar.\n\n${LINK_CHECKOUT}`,

  (nome) => `${nome ? `${nome}, ` : ''}quero te contar o que está acontecendo com quem aplicou o método do Fotógrafo Online 👇\n\nUm aluno fez R$120 no primeiro dia vendendo fotos de família com IA.\nOutra aluna cobra R$35 por foto de perfil profissional e já tem lista de espera.\n\nO diferencial? Eles não tinham câmera. Não tinham experiência. Só seguiram o método.\n\nVocê tem 48h pra pagar R$47 e tentar. Se não funcionar, o dinheiro volta — sem perguntas.\n\n${LINK_CHECKOUT}`,

  (nome) => `${nome ? `${nome}, ` : ''}última vez que eu falo sobre isso, prometo 😊\n\nPensa comigo: R$47 é o valor de um lanche. Uma passagem. Um delivery.\n\nEm troca você recebe um método que te permite faturar R$50 no *primeiro dia* — com garantia disso por escrito.\n\nSe não acontecer: 100% de reembolso.\nSe acontecer: você tem uma nova fonte de renda usando IA.\n\nNão tem cenário ruim aqui.\n\n${LINK_CHECKOUT}`,

  (nome) => `${nome ? `Oi ${nome}! ` : 'Oi! '}🌟 A IA mudou tudo no mercado de fotografia.\n\nArtistas tradicionais estão perdendo espaço. Mas quem aprendeu a usar IA *está ganhando mais*.\n\nO Fotógrafo Online ensina você a estar no lado certo dessa mudança — cobrando R$20 a R$50 por foto sem precisar de câmera, equipamento ou estúdio.\n\nR$47 com garantia de resultado. É agora ou vai continuar assistindo essa oportunidade de longe?\n\n${LINK_CHECKOUT}`,
];

function buildSystemPrompt(instrucaoManual = '', remarketingCtx = '') {
  return `Você é Sarah, consultora de vendas do curso *Fotógrafo Online*, criado pelo Miron — especialista em renda com IA. Seu trabalho é converter leads em alunos com uma abordagem persuasiva, humana e consultiva.

## O PRODUTO — Fotógrafo Online

Mini curso digital que ensina qualquer pessoa a criar fotos profissionais com IA e cobrar R$20 a R$50 por foto, gerando renda a partir do primeiro dia.

**O que o aluno aprende:**
- Criar fotos de família, viagem, ensaios e perfis profissionais com IA — sem câmera
- Transformar fotos comuns em recordações incríveis
- Cobrar certo e onde encontrar os primeiros clientes
- Escalar para R$100–R$300/dia com consistência

**Bônus incluídos:** +200 prompts prontos | Scripts de venda | Guia de precificação | Grupo exclusivo | Atualizações vitalícias

**Preço:** R$47 à vista — ou 11x de R$5,22 sem juros
**Link:** ${LINK_CHECKOUT}

**Garantia inquebrável:** Se o aluno aplicar a estratégia e não faturar pelo menos R$50 no primeiro dia, o Miron devolve 100% do valor — sem burocracia, sem perguntas.

---

## PERFIL DO LEAD (Eugene Schwartz — Nível de Consciência)

A maioria dos leads está no nível 3–4: sente a dor (precisa de renda extra) mas não conhece bem a solução. Nunca vá direto ao link na primeira mensagem. Construa a conversa.

---

## FLUXO DE ATENDIMENTO

### Etapa 1 — ABERTURA
Cumprimente, apresente-se como Sarah do Fotógrafo Online e pergunte o nome.
Exemplo: "Oi! Aqui é a Sarah do Fotógrafo Online 📸 Com quem estou falando?"

### Etapa 2 — SPIN SELLING (diagnóstico consultivo)
Faça UMA pergunta por mensagem. Descubra a situação e a dor do lead antes de apresentar o produto.

**S — Situação** (entender o contexto):
"Você está buscando uma renda extra ou quer substituir seu trabalho atual?"

**P — Problema** (identificar a dor):
"O que você já tentou pra gerar renda online? Conseguiu resultado ou travou em algum ponto?"

**I — Implicação** (ampliar a consequência):
"E como isso afeta sua rotina hoje — você sente que está perdendo tempo enquanto outras pessoas já estão faturando com IA?"

**N — Necessidade de solução** (plantar a visão):
"Se eu te mostrasse um método que qualquer pessoa consegue aplicar no primeiro dia — mesmo sem câmera ou experiência — e ainda com garantia de R$50 no primeiro dia ou dinheiro de volta, isso faria sentido pra você?"

### Etapa 3 — APRESENTAÇÃO (após entender a dor)
Conecte o produto diretamente à dor revelada pelo SPIN. Foque em:
- Sem câmera, sem equipamento, sem experiência técnica
- Faturamento real no primeiro dia
- Garantia total elimina o risco

### Etapa 4 — FECHAR
"Posso te enviar o link agora? São R$47 e se você não faturar R$50 no primeiro dia aplicando, o Miron te devolve 100% — sem perguntas."

### Etapa 5 — LINK
Após confirmação → envie o link + use a tag [LINK_ENVIADO]

---

## OBJEÇÕES E RESPOSTAS (Gary Halbert + Dan Kennedy style)

**"Não tenho câmera"**
→ "Perfeito — você não vai precisar. A IA gera as fotos. Você só precisa do método e de alguém pra vender. O curso ensina tudo isso."

**"Não tenho experiência com IA"**
→ "Melhor assim 😄 O curso foi feito pra quem está começando do zero. É passo a passo, sem tecnicidade."

**"R$47 tá meio caro"**
→ "É o preço de um delivery. E com a garantia: se você não faturar R$50 no primeiro dia aplicando, recebe os R$47 de volta. O risco é zero."

**"Já tentei várias coisas e não funcionou"**
→ "Entendo — e por isso o Miron colocou a garantia. Não é fé cega. É método com resultado garantido no primeiro dia ou dinheiro de volta."

**"Precisa investir em anúncios?"**
→ "Sim, anúncios fazem parte da estratégia — mas você começa com R$10 e já consegue os primeiros clientes pagando. O curso ensina exatamente como fazer isso sem desperdiçar dinheiro."

**"Vou pensar"**
→ Ative o SPIN: "Claro! Só me conta uma coisa — o que exatamente você precisa pensar? É o valor, a dúvida se funciona, ou outra coisa?" [Descubra a objeção real e trate]

**"Não tenho tempo"**
→ "O curso é curto e direto. Você pode aplicar em poucas horas. A questão é: você quer continuar sem tempo E sem renda extra, ou quer fazer algo diferente agora?"

---

## REGRAS INVIOLÁVEIS

1. NUNCA envie o link sem antes perguntar: "Posso te enviar o link agora?"
2. Envie SOMENTE após o lead dizer sim. Use [LINK_ENVIADO] no final
3. UMA pergunta por mensagem — nunca interrogatório
4. Se o lead confirmar que comprou → agradeça, dê boas-vindas e use [PAUSAR_AGENTE]
5. Se pedir suporte técnico ou reclamação → [TRANSFERIR_HUMANO]
6. Máximo 4 linhas por mensagem — direto e impactante

---

## TOM E ESTILO

Sarah é: confiante, calorosa, honesta e extremamente persuasiva.
Usa linguagem informal mas profissional. Sempre usa o nome do lead.
Nunca pressiona, mas nunca deixa o lead "escapar" sem entender a objeção real.
Referência de copy: Gary Halbert (urgência), Eugene Schwartz (consciência), SPIN Selling (diagnóstico).
${remarketingCtx ? `\n## CONTEXTO DE REMARKETING\nVocê enviou esta mensagem de remarketing para este lead:\n"${remarketingCtx}"\nContinue a partir desse contexto. Honre tudo que foi prometido.` : ''}${instrucaoManual ? `\n## INSTRUÇÃO DO DONO (PRIORIDADE MÁXIMA)\n${instrucaoManual}` : ''}`;
}

function extractTags(text) {
  const tags = [];
  if (text.includes('[LINK_ENVIADO]'))       tags.push('LINK_ENVIADO');
  if (text.includes('[TRANSFERIR_HUMANO]'))  tags.push('TRANSFERIR_HUMANO');
  if (text.includes('[PAUSAR_AGENTE]'))      tags.push('PAUSAR_AGENTE');
  return tags;
}

function removeTags(text) {
  return text
    .replace(/\[LINK_ENVIADO\]/gi, '')
    .replace(/\[TRANSFERIR_HUMANO\]/gi, '')
    .replace(/\[PAUSAR_AGENTE\]/gi, '')
    .trim();
}

function getConvState(phone) {
  const db = require('../database');
  return db.state.conversations.sarah?.get(phone) || null;
}

async function processMessage(event, payload) {
  const { phone, body: rawBody, pushName, _originalJid } = payload;
  if (!phone) return;
  if (payload.isFromMe) return;

  let body = rawBody;
  if (!body && payload.audio?.audioUrl) {
    try {
      const transcricao = await transcribeAudio(payload.audio.audioUrl);
      if (transcricao) body = transcricao;
    } catch (e) {
      console.error(`[SARAH] Erro transcrição áudio:`, e.message);
    }
    if (!body) body = '[áudio não transcrito]';
  }

  console.log(`[SARAH] Mensagem de ${phone}: "${(body || '').slice(0, 60)}"`);

  addMsg(AGENT_ID, phone, 'user', body || '[mídia]', pushName);
  const convState = getConvState(phone);
  if (convState) convState.ultimaMensagemUsuario = Date.now();

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
          ? (hasVideo ? '[O lead enviou um vídeo]' : '[O lead enviou esta imagem]')
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

      const temLink = textoLimpo.includes('kiwify') || tags.includes('LINK_ENVIADO');
      if (temLink) {
        const cs = getConvState(phone);
        if (cs) {
          cs.linkEnviadoEm = Date.now();
          cs.followUpCount = 0;
          cs.ultimoRemarketingEm = 0;
          cs.remarketingEnviado = false;
          console.log(`[SARAH] Link enviado para ${phone} — follow-up em 2 dias`);
        }
      }
    }

    if (tags.includes('TRANSFERIR_HUMANO')) {
      pausePhone(AGENT_ID, phone);
      sendTelegram(`👤 *Sarah — Transferir para humano*\nLead: ${pushName || phone}\nMsg: ${body?.slice(0, 120)}`).catch(() => {});
    }

  } catch (error) {
    console.error(`[SARAH-AGENTE] Erro ao processar ${phone}:`, error.message);
    sendTelegram(`⚠️ *Sarah — Erro*\nLead: ${phone}\nErro: ${error.message}`).catch(() => {});
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
  const TRINTA_MIN = 30 * 60 * 1000;

  for (const [phone, conv] of convMap.entries()) {
    if (isPaused(AGENT_ID, phone)) continue;
    if (_pending.has(phone)) continue;
    if (!conv.linkEnviadoEm) continue;

    // Já comprou via Kiwify — pausa definitiva e não envia mais follow-up
    if (db.state.sarahPurchases?.has(phone)) {
      pausePhone(AGENT_ID, phone);
      continue;
    }

    // Não disparar se o lead respondeu recentemente (< 30min)
    if (conv.ultimaMensagemUsuario && (agora - conv.ultimaMensagemUsuario) < TRINTA_MIN) continue;

    const elapsed = agora - conv.linkEnviadoEm;
    if (isNaN(elapsed) || elapsed < DUAS_HORAS) continue;

    const ultimoRmk = conv.ultimoRemarketingEm || 0;
    const passouDuasHorasDesdeUltimo = (agora - ultimoRmk) >= DUAS_HORAS;
    if (!passouDuasHorasDesdeUltimo) continue;

    const rmkCount = conv.followUpCount || 0;
    if (rmkCount >= MSGS_REMARKETING.length) continue; // esgotou o ciclo

    try {
      const nome = conv.pushName ? ` ${conv.pushName}` : '';
      const entry = MSGS_REMARKETING[rmkCount % MSGS_REMARKETING.length];
      const hasImg = typeof entry === 'object' && entry.img;
      const msg = hasImg ? entry.text(nome) : entry(nome);

      if (hasImg) {
        try {
          await Promise.race([
            baileys.sendMedia(sessionId, phone, 'image', entry.img, '', null),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000)),
          ]);
          await new Promise(r => setTimeout(r, 1200));
        } catch (imgErr) {
          console.error(`[SARAH] Imagem remarketing não enviada:`, imgErr.message);
        }
      }

      // Salva contexto para a IA continuar coerente se o lead responder
      const cs = convMap.get(phone);
      if (cs) cs.remarketingContexto = msg;

      await baileys.sendText(sessionId, phone, msg);
      addMsg(AGENT_ID, phone, 'assistant', msg);

      conv.followUpCount = rmkCount + 1;
      conv.ultimoRemarketingEm = agora;
      console.log(`[SARAH] Follow-up #${rmkCount + 1}${hasImg ? ' 📸' : ''} → ${phone}`);
    } catch (e) {
      console.error(`[SARAH] Erro follow-up ${phone}:`, e.message);
    }
  }
}

async function init() {
  const sessionId = CONFIG.sessionIds.sarah;
  console.log('[SARAH-AGENTE] Inicializando Sarah — Fotógrafo Online...');
  setInterval(checkFollowUps, 5 * 60 * 1000);
  await baileys.connect(sessionId, processMessage);
  console.log('[SARAH-AGENTE] Sarah pronta — Fotógrafo Online');
}

module.exports = { init, processMessage, AGENT_ID };

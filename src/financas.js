'use strict';

// ============================================================
// MÓDULO FINANCEIRO — JARVIS
// Controle financeiro familiar via grupo Telegram
// Parser de mensagens + storage + análise com IA
// ============================================================

const { callClaudeText } = require('./services');

const CATEGORIAS = [
  'alimentação', 'transporte', 'moradia', 'saúde', 'educação',
  'lazer', 'roupas', 'contas', 'trabalho', 'outros',
];

const KNOWLEDGE_FINANCEIRA = `
## WARREN BUFFETT
- "Pague a si mesmo primeiro" — separe poupança ANTES de gastar
- Nunca perca dinheiro. Evite dívidas de consumo.
- Viva abaixo dos seus meios. Fundo de emergência é sagrado.

## CHARLIE MUNGER
- Juros compostos são a oitava maravilha — nunca interrompa
- Os primeiros R$100mil são os mais difíceis — foque nisso

## RAY DALIO
- Controle de perdas é mais importante que ganhos
- Categorize gastos obrigatórios vs discricionários
- Reserva de emergência evita resgates em momentos ruins

## DAVE RAMSEY
- Orçamento mensal escrito: todo real tem destino
- Zero dívidas de consumo. Cartão pago integralmente.
- Baby steps: emergência → dívida → investimento

## ROBERT KIYOSAKI
- Ativo coloca dinheiro no bolso. Passivo tira.
- Construa ativos antes de comprar passivos.
- Dívida de consumo é proibida.

## GASTOS RED FLAGS (sem necessidade real)
- Delivery > 2x/semana
- Assinaturas esquecidas ou pouco usadas
- Compras parceladas por impulso
- Roupas/calçados sem necessidade
- Eletrônicos novos sem motivo funcional
- Apostas/jogos

## BENCHMARKS SAUDÁVEIS (% da renda)
- Moradia ≤ 30% | Alimentação ≤ 15% | Transporte ≤ 10%
- Saúde ≤ 10% | Lazer ≤ 5% | Poupança/Investimento ≥ 20%
`;

// ----- Parser de mensagem financeira via Claude -----
async function parseMensagemFinanceira(texto, quem) {
  const prompt = `Você é um parser financeiro. Analise a mensagem abaixo e extraia dados financeiros.

Mensagem: "${texto}"
Enviado por: ${quem}

Se a mensagem contém um gasto ou receita financeira, responda APENAS com JSON neste formato exato:
{"tipo":"despesa","valor":0.00,"categoria":"alimentação","descricao":"descrição curta"}

Para receita:
{"tipo":"receita","valor":0.00,"categoria":"trabalho","descricao":"descrição curta"}

Categorias válidas: ${CATEGORIAS.join(', ')}

Exemplos de parsing:
- "gastei 50 no mercado" → {"tipo":"despesa","valor":50,"categoria":"alimentação","descricao":"mercado"}
- "paguei 120 de luz" → {"tipo":"despesa","valor":120,"categoria":"contas","descricao":"conta de luz"}
- "recebi 3000 de salário" → {"tipo":"receita","valor":3000,"categoria":"trabalho","descricao":"salário"}
- "fui no shopping gastei 200" → {"tipo":"despesa","valor":200,"categoria":"roupas","descricao":"shopping"}
- "farmácia 45 reais" → {"tipo":"despesa","valor":45,"categoria":"saúde","descricao":"farmácia"}
- "uber 25" → {"tipo":"despesa","valor":25,"categoria":"transporte","descricao":"uber"}
- "pizza delivery 80" → {"tipo":"despesa","valor":80,"categoria":"alimentação","descricao":"delivery pizza"}
- "aluguel 1500" → {"tipo":"despesa","valor":1500,"categoria":"moradia","descricao":"aluguel"}
- "freelance 800" → {"tipo":"receita","valor":800,"categoria":"trabalho","descricao":"freelance"}

Se a mensagem NÃO é sobre dinheiro (é uma pergunta, conversa, comando), responda apenas: null

Responda APENAS o JSON ou null, sem explicações.`;

  try {
    const texto_resposta = (await callClaudeText(prompt, [{ role: 'user', content: texto }], {
      maxTokens: 150,
    })).trim();
    if (texto_resposta === 'null' || texto_resposta === '') return null;

    const parsed = JSON.parse(texto_resposta);
    if (!parsed.tipo || !parsed.valor || parsed.valor <= 0) return null;
    if (!['despesa', 'receita'].includes(parsed.tipo)) return null;
    if (!CATEGORIAS.includes(parsed.categoria)) parsed.categoria = 'outros';

    return { ...parsed, quem };
  } catch (e) {
    console.error('[FINANCAS] Erro ao parsear mensagem:', e.message);
    return null;
  }
}

// ----- Funções de banco de dados -----
function addTransacao(db, transacao) {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10);
  const mes = agora.toISOString().slice(0, 7);

  const entrada = {
    id: `FIN-${Date.now()}`,
    tipo: transacao.tipo,
    valor: parseFloat(transacao.valor),
    categoria: transacao.categoria || 'outros',
    descricao: transacao.descricao || '',
    quem: transacao.quem || 'Desconhecido',
    data,
    mes,
    ts: Date.now(),
  };

  db.state.financas.transacoes.unshift(entrada);
  if (db.state.financas.transacoes.length > 2000) {
    db.state.financas.transacoes = db.state.financas.transacoes.slice(0, 2000);
  }
  db.saveDB().catch(() => {});
  return entrada;
}

function getTransacoesMes(db, mes) {
  // mes formato: "2026-05"
  const alvo = mes || new Date().toISOString().slice(0, 7);
  return db.state.financas.transacoes.filter(t => t.mes === alvo);
}

function getResumoMensal(db, mes) {
  const transacoes = getTransacoesMes(db, mes);
  const alvo = mes || new Date().toISOString().slice(0, 7);

  let totalReceitas = 0;
  let totalDespesas = 0;
  const porCategoria = {};
  const porQuem = { receitas: {}, despesas: {} };

  for (const t of transacoes) {
    if (t.tipo === 'receita') {
      totalReceitas += t.valor;
      porQuem.receitas[t.quem] = (porQuem.receitas[t.quem] || 0) + t.valor;
    } else {
      totalDespesas += t.valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] || 0) + t.valor;
      porQuem.despesas[t.quem] = (porQuem.despesas[t.quem] || 0) + t.valor;
    }
  }

  const saldo = totalReceitas - totalDespesas;
  const taxaEconomia = totalReceitas > 0 ? ((saldo / totalReceitas) * 100).toFixed(1) : 0;
  const meta = db.state.financas.metas.economiasMensal || 0;
  const progressoMeta = meta > 0 ? Math.min(100, ((saldo / meta) * 100).toFixed(0)) : null;

  return {
    mes: alvo,
    totalReceitas,
    totalDespesas,
    saldo,
    taxaEconomia: parseFloat(taxaEconomia),
    porCategoria,
    porQuem,
    totalTransacoes: transacoes.length,
    meta,
    progressoMeta,
  };
}

// ----- Análise de gastos desnecessários via Claude -----
async function analisarGastosDesnecessarios(db) {
  const mes = new Date().toISOString().slice(0, 7);
  const resumo = getResumoMensal(db, mes);
  const transacoes = getTransacoesMes(db, mes);

  if (transacoes.length === 0) {
    return 'Não há transações registradas neste mês ainda. Comece a registrar seus gastos no grupo!';
  }

  const listaGastos = transacoes
    .filter(t => t.tipo === 'despesa')
    .map(t => `- ${t.descricao} (${t.categoria}): R$${t.valor.toFixed(2)} — ${t.quem}`)
    .join('\n');

  const prompt = `${KNOWLEDGE_FINANCEIRA}

Você é Jarvis, consultor financeiro pessoal de Miron e sua esposa.

DADOS DO MÊS ${mes}:
Receita total: R$${resumo.totalReceitas.toFixed(2)}
Despesa total: R$${resumo.totalDespesas.toFixed(2)}
Saldo: R$${resumo.saldo.toFixed(2)}
Taxa de economia: ${resumo.taxaEconomia}%

GASTOS REGISTRADOS:
${listaGastos}

Analise esses gastos com a sabedoria dos maiores investidores do mundo e identifique:
1. Gastos desnecessários ou que podem ser cortados/reduzidos
2. Padrões preocupantes (muita alimentação fora, muito lazer, etc)
3. Como melhorar a taxa de economia
4. Meta concreta para o próximo mês

Seja direto, objetivo e específico. Use valores reais. Máximo 400 palavras.`;

  try {
    const analise = await callClaudeText(prompt, [{ role: 'user', content: 'Analise meus gastos' }], {
      maxTokens: 600,
    });
    return analise;
  } catch (e) {
    return `Erro ao gerar análise: ${e.message}`;
  }
}

// ----- Processador de mensagem do grupo Telegram -----
async function processarMensagemGrupo(texto, senderName, db, sendTelegramGroup) {
  const textLower = texto.toLowerCase().trim();

  // Comandos especiais do grupo
  if (textLower === 'resumo' || textLower === '/resumo') {
    const resumo = getResumoMensal(db);
    const msg = formatarResumo(resumo);
    await sendTelegramGroup(msg);
    return;
  }

  if (textLower === 'análise' || textLower === 'analise' || textLower === '/analise') {
    await sendTelegramGroup('🔍 Analisando seus gastos...');
    const analise = await analisarGastosDesnecessarios(db);
    await sendTelegramGroup(`📊 *Análise Financeira — Jarvis*\n\n${analise}`);
    return;
  }

  if (textLower.startsWith('meta ') || textLower.startsWith('/meta ')) {
    const valorStr = texto.replace(/[^0-9.,]/g, '').replace(',', '.');
    const valor = parseFloat(valorStr);
    if (valor > 0) {
      db.state.financas.metas.economiasMensal = valor;
      db.saveDB().catch(() => {});
      await sendTelegramGroup(`🎯 Meta de economia definida: *R$${valor.toFixed(2)}/mês*\nJarvis vai monitorar e te avisar sobre o progresso.`);
    }
    return;
  }

  if (textLower === 'ajuda' || textLower === '/ajuda' || textLower === 'help') {
    const ajuda = `💰 *Comandos do Grupo Financeiro*\n\n` +
      `📝 *Registrar gasto:*\n"gastei R$50 no mercado"\n"paguei 120 de luz"\n"farmácia 45"\n\n` +
      `💵 *Registrar receita:*\n"recebi 3000 de salário"\n"ganhei 500 de freelance"\n\n` +
      `📊 *Comandos:*\n\`resumo\` — Ver resumo do mês\n\`analise\` — Análise de gastos desnecessários\n\`meta 1000\` — Definir meta de economia mensal\n\`ajuda\` — Mostrar este menu`;
    await sendTelegramGroup(ajuda);
    return;
  }

  // Tentar parsear como transação financeira
  const transacao = await parseMensagemFinanceira(texto, senderName);
  if (!transacao) return; // não é transação, ignorar

  const entrada = addTransacao(db, transacao);
  const emoji = transacao.tipo === 'receita' ? '💵' : '💸';
  const tipoLabel = transacao.tipo === 'receita' ? 'Receita' : 'Despesa';

  const confirmacao = `${emoji} *${tipoLabel} registrada*\nR$${entrada.valor.toFixed(2)} — ${capitalize(entrada.categoria)}\n📝 ${entrada.descricao}\n👤 ${entrada.quem}`;
  await sendTelegramGroup(confirmacao);
}

// ----- Formatador de resumo -----
function formatarResumo(resumo) {
  const { mes, totalReceitas, totalDespesas, saldo, taxaEconomia, porCategoria, meta, progressoMeta } = resumo;

  const [ano, mesNum] = mes.split('-');
  const nomesMes = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const nomeMes = `${nomesMes[parseInt(mesNum)]}/${ano}`;

  let txt = `📊 *Resumo Financeiro — ${nomeMes}*\n\n`;
  txt += `💵 Receitas: *R$${totalReceitas.toFixed(2)}*\n`;
  txt += `💸 Despesas: *R$${totalDespesas.toFixed(2)}*\n`;
  txt += `💰 Saldo: *R$${saldo.toFixed(2)}*\n`;
  txt += `📈 Taxa de economia: *${taxaEconomia}%*`;

  if (meta > 0) {
    txt += `\n🎯 Meta: R$${meta.toFixed(2)} (${progressoMeta}% atingido)`;
  }

  if (Object.keys(porCategoria).length > 0) {
    txt += '\n\n*Gastos por categoria:*';
    const sorted = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    for (const [cat, val] of sorted) {
      txt += `\n• ${capitalize(cat)}: R$${val.toFixed(2)}`;
    }
  }

  const status = taxaEconomia >= 20 ? '✅ Excelente!' : taxaEconomia >= 10 ? '⚠️ Pode melhorar' : '🚨 Atenção!';
  txt += `\n\n${status}`;

  return txt;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
  parseMensagemFinanceira,
  addTransacao,
  getTransacoesMes,
  getResumoMensal,
  analisarGastosDesnecessarios,
  processarMensagemGrupo,
  formatarResumo,
  CATEGORIAS,
};

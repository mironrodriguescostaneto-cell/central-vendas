'use strict';

const { callClaudeText } = require('./services');

const CATEGORIAS = [
  'alimentação', 'transporte', 'moradia', 'saúde', 'educação',
  'lazer', 'roupas', 'contas', 'trabalho', 'outros',
];

// Categorias de impulso (monitoradas para streak)
const CATS_IMPULSO = ['lazer', 'roupas'];

// Classificação 50/30/20
const CATS_NECESSIDADE = ['alimentação', 'moradia', 'saúde', 'contas', 'transporte', 'educação'];
const CATS_DESEJO = ['lazer', 'roupas', 'outros'];

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

// ----- Helpers de data -----
function mesAtual() { return new Date().toISOString().slice(0, 7); }
function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function diaAtual() { return new Date().toISOString().slice(0, 10); }
function diasNoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
function diaDoMes() { return new Date().getDate(); }
function nomeMes(mes) {
  const nomes = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const [, m] = mes.split('-');
  return nomes[parseInt(m)];
}
function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

// ----- Barras de progresso -----
function barraProgresso(pct, tamanho = 10) {
  const filled = Math.round((Math.min(pct, 100) / 100) * tamanho);
  return '█'.repeat(filled) + '░'.repeat(tamanho - filled);
}

function statusOrcamento(pct) {
  if (pct >= 100) return { emoji: '🚨', texto: 'LIMITE ULTRAPASSADO' };
  if (pct >= 80) return { emoji: '⚠️', texto: 'Quase no limite' };
  if (pct >= 50) return { emoji: '🟡', texto: 'Atenção' };
  return { emoji: '✅', texto: 'Ok' };
}

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

// ----- Banco de dados -----
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
  if (db.state.financas.transacoes.length > 5000) {
    db.state.financas.transacoes = db.state.financas.transacoes.slice(0, 5000);
  }
  db.saveDB().catch(() => {});
  return entrada;
}

function getTransacoesMes(db, mes) {
  const alvo = mes || mesAtual();
  return db.state.financas.transacoes.filter(t => t.mes === alvo);
}

function getTransacoesHoje(db) {
  const hoje = diaAtual();
  return db.state.financas.transacoes.filter(t => t.data === hoje);
}

function getTransacoesSemana(db) {
  const agora = Date.now();
  const semanaAtras = agora - 7 * 24 * 60 * 60 * 1000;
  return db.state.financas.transacoes.filter(t => t.ts >= semanaAtras);
}

function getResumoMensal(db, mes) {
  const transacoes = getTransacoesMes(db, mes);
  const alvo = mes || mesAtual();

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
  const orcamentos = db.state.financas.metas.orcamentos || {};

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
    orcamentos,
  };
}

// ----- Orçamentos por categoria -----
function setOrcamento(db, categoria, valor) {
  if (!db.state.financas.metas.orcamentos) db.state.financas.metas.orcamentos = {};
  db.state.financas.metas.orcamentos[categoria] = parseFloat(valor);
  db.saveDB().catch(() => {});
}

function getProgressoOrcamento(db, categoria, mes) {
  const orcamentos = db.state.financas.metas.orcamentos || {};
  const limite = orcamentos[categoria] || 0;
  const transacoes = getTransacoesMes(db, mes || mesAtual());
  const gasto = transacoes
    .filter(t => t.tipo === 'despesa' && t.categoria === categoria)
    .reduce((s, t) => s + t.valor, 0);
  const pct = limite > 0 ? (gasto / limite) * 100 : null;
  return { gasto, limite, pct };
}

// ----- Comparativo com mês anterior -----
function getComparativoCategoria(db, categoria) {
  const mes = mesAtual();
  const mesAnt = mesAnterior();
  const txAtual = getTransacoesMes(db, mes).filter(t => t.tipo === 'despesa' && t.categoria === categoria);
  const txAnt = getTransacoesMes(db, mesAnt).filter(t => t.tipo === 'despesa' && t.categoria === categoria);
  const valorAtual = txAtual.reduce((s, t) => s + t.valor, 0);
  const valorAnterior = txAnt.reduce((s, t) => s + t.valor, 0);
  if (valorAnterior === 0) return null;
  const variacao = ((valorAtual - valorAnterior) / valorAnterior) * 100;
  return { valorAtual, valorAnterior, variacao: parseFloat(variacao.toFixed(1)) };
}

// ----- Projeção do mês -----
function gerarProjecaoMes(db) {
  const mes = mesAtual();
  const resumo = getResumoMensal(db, mes);
  const totalDias = diasNoMes(mes);
  const diaHoje = diaDoMes();
  if (diaHoje === 0) return null;

  const mediaDiaria = resumo.totalDespesas / diaHoje;
  const diasRestantes = totalDias - diaHoje;
  const projecaoDespesas = resumo.totalDespesas + (mediaDiaria * diasRestantes);
  const projecaoSaldo = resumo.totalReceitas - projecaoDespesas;
  const projecaoTaxaEconomia = resumo.totalReceitas > 0
    ? (projecaoSaldo / resumo.totalReceitas) * 100 : 0;

  return {
    totalDias,
    diaHoje,
    diasRestantes,
    mediaDiaria: parseFloat(mediaDiaria.toFixed(2)),
    projecaoDespesas: parseFloat(projecaoDespesas.toFixed(2)),
    projecaoSaldo: parseFloat(projecaoSaldo.toFixed(2)),
    projecaoTaxaEconomia: parseFloat(projecaoTaxaEconomia.toFixed(1)),
    gastoAtual: resumo.totalDespesas,
    receitas: resumo.totalReceitas,
  };
}

// ----- Plano de pagamento (ao registrar receita) -----
function gerarPlanoPagamento(valorReceita, db) {
  const mes = mesAtual();
  const gastoAtual = getTransacoesMes(db, mes)
    .filter(t => t.tipo === 'despesa')
    .reduce((s, t) => s + t.valor, 0);

  const poupar = valorReceita * 0.20;
  const necessidades = valorReceita * 0.50;
  const desejos = valorReceita * 0.30;
  const disponivelRestante = (valorReceita - poupar) - gastoAtual;

  return {
    valorReceita,
    poupar,
    necessidades,
    desejos,
    gastoAtual,
    disponivelRestante: Math.max(0, disponivelRestante),
  };
}

// ----- Streak de economia -----
function calcularStreak(db) {
  const hoje = diaAtual();
  const streaks = {};
  for (const cat of CATS_IMPULSO) {
    let dias = 0;
    const d = new Date();
    while (dias < 30) {
      const dStr = d.toISOString().slice(0, 10);
      const temGasto = db.state.financas.transacoes.some(
        t => t.data === dStr && t.tipo === 'despesa' && t.categoria === cat
      );
      if (temGasto) break;
      dias++;
      d.setDate(d.getDate() - 1);
    }
    streaks[cat] = dias;
  }
  return streaks;
}

// ----- Análise de gastos desnecessários via Claude -----
async function analisarGastosDesnecessarios(db) {
  const mes = mesAtual();
  const resumo = getResumoMensal(db, mes);
  const transacoes = getTransacoesMes(db, mes);

  if (transacoes.length === 0) {
    return 'Não há transações registradas neste mês ainda. Comece a registrar seus gastos no grupo!';
  }

  const listaGastos = transacoes
    .filter(t => t.tipo === 'despesa')
    .map(t => `- ${t.descricao} (${t.categoria}): R$${t.valor.toFixed(2)} — ${t.quem}`)
    .join('\n');

  const projecao = gerarProjecaoMes(db);
  const projecaoTxt = projecao ? `Projeção de despesas até o fim do mês: R$${projecao.projecaoDespesas.toFixed(2)}` : '';

  const prompt = `${KNOWLEDGE_FINANCEIRA}

Você é Jarvis, consultor financeiro pessoal de Miron e sua esposa.

DADOS DO MÊS ${mes}:
Receita total: R$${resumo.totalReceitas.toFixed(2)}
Despesa total: R$${resumo.totalDespesas.toFixed(2)}
Saldo: R$${resumo.saldo.toFixed(2)}
Taxa de economia: ${resumo.taxaEconomia}%
${projecaoTxt}

GASTOS REGISTRADOS:
${listaGastos}

Analise esses gastos com a sabedoria dos maiores investidores do mundo e identifique:
1. Gastos desnecessários ou que podem ser cortados/reduzidos
2. Padrões preocupantes (muita alimentação fora, muito lazer, etc)
3. Como melhorar a taxa de economia
4. Meta concreta para o próximo mês
5. Uma ação específica que podem tomar AMANHÃ para melhorar

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

// ----- Relatório diário -----
function gerarRelatorioDiario(db) {
  const hoje = diaAtual();
  const mes = mesAtual();
  const txHoje = getTransacoesHoje(db).filter(t => t.tipo === 'despesa');
  const resumo = getResumoMensal(db, mes);
  const projecao = gerarProjecaoMes(db);

  const totalHoje = txHoje.reduce((s, t) => s + t.valor, 0);
  const porCatHoje = {};
  for (const t of txHoje) {
    porCatHoje[t.categoria] = (porCatHoje[t.categoria] || 0) + t.valor;
  }

  const [, , dia] = hoje.split('-');
  let txt = `📅 *Resumo do dia, ${dia}/${hoje.slice(5, 7)}:*\n\n`;

  if (totalHoje === 0) {
    txt += `🎉 Dia sem gastos! Ótimo!\n\n`;
  } else {
    txt += `Hoje vocês gastaram: *R$${totalHoje.toFixed(2)}*\n`;
    const cats = Object.entries(porCatHoje).sort((a, b) => b[1] - a[1]);
    for (const [cat, val] of cats) {
      txt += `• ${capitalize(cat)}: R$${val.toFixed(2)}\n`;
    }
    txt += '\n';
  }

  txt += `📊 *${nomeMes(mes)} até agora:*\n`;
  txt += `💵 Receitas: R$${resumo.totalReceitas.toFixed(2)}\n`;
  txt += `💸 Despesas: R$${resumo.totalDespesas.toFixed(2)}\n`;
  txt += `💰 Saldo: *R$${resumo.saldo.toFixed(2)}*\n`;

  if (projecao) {
    txt += `\n📈 *Projeção do mês:*\n`;
    const status = projecao.projecaoTaxaEconomia >= 20 ? '✅ No caminho certo' :
      projecao.projecaoTaxaEconomia >= 10 ? '⚠️ Pode melhorar' : '🚨 Atenção ao ritmo!';
    txt += `Projeção de gastos: R$${projecao.projecaoDespesas.toFixed(2)}\n`;
    txt += `Taxa de economia projetada: ${projecao.projecaoTaxaEconomia}% — ${status}`;
  }

  // Streaks
  const streaks = calcularStreak(db);
  const streaksMsgs = [];
  if (streaks.lazer >= 3) streaksMsgs.push(`🔥 ${streaks.lazer} dias sem gastar em Lazer!`);
  if (streaks.roupas >= 7) streaksMsgs.push(`🔥 ${streaks.roupas} dias sem gastar em Roupas!`);
  if (streaksMsgs.length) txt += '\n\n' + streaksMsgs.join('\n');

  return txt;
}

// ----- Relatório semanal -----
function gerarRelatorioSemanal(db) {
  const mes = mesAtual();
  const agora = Date.now();
  const semanaAtras = agora - 7 * 24 * 60 * 60 * 1000;
  const duasSemanas = agora - 14 * 24 * 60 * 60 * 1000;

  const txSemana = db.state.financas.transacoes.filter(t => t.ts >= semanaAtras && t.tipo === 'despesa');
  const txSemanaAnt = db.state.financas.transacoes.filter(t => t.ts >= duasSemanas && t.ts < semanaAtras && t.tipo === 'despesa');

  const totalSemana = txSemana.reduce((s, t) => s + t.valor, 0);
  const totalSemanaAnt = txSemanaAnt.reduce((s, t) => s + t.valor, 0);

  const porCat = {};
  for (const t of txSemana) porCat[t.categoria] = (porCat[t.categoria] || 0) + t.valor;

  let txt = `📊 *Relatório Semanal — ${nomeMes(mes)}*\n\n`;
  txt += `Total gasto esta semana: *R$${totalSemana.toFixed(2)}*\n`;

  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  for (const [cat, val] of cats.slice(0, 5)) {
    txt += `• ${capitalize(cat)}: R$${val.toFixed(2)}\n`;
  }

  if (totalSemanaAnt > 0) {
    const var_ = ((totalSemana - totalSemanaAnt) / totalSemanaAnt * 100).toFixed(1);
    const emoji = parseFloat(var_) <= 0 ? '🟢' : parseFloat(var_) <= 10 ? '🟡' : '🔴';
    txt += `\n${emoji} Comparado à semana passada: ${var_ > 0 ? '+' : ''}${var_}%\n`;
  }

  // Top gastador
  const porQuem = {};
  for (const t of txSemana) porQuem[t.quem] = (porQuem[t.quem] || 0) + t.valor;
  const topGastador = Object.entries(porQuem).sort((a, b) => b[1] - a[1])[0];
  if (topGastador) txt += `\n👤 Maior gasto: ${topGastador[0]} — R$${topGastador[1].toFixed(2)}`;

  return txt;
}

// ----- Relatório fim de mês -----
function gerarRelatorioFimMes(db) {
  const mes = mesAtual();
  const mesAnt = mesAnterior();
  const resumo = getResumoMensal(db, mes);
  const resumoAnt = getResumoMensal(db, mesAnt);

  let txt = `🗓 *Fechamento de ${nomeMes(mes)}*\n\n`;
  txt += `💵 Receitas: R$${resumo.totalReceitas.toFixed(2)}\n`;
  txt += `💸 Despesas: R$${resumo.totalDespesas.toFixed(2)}\n`;
  txt += `💰 Economizaram: *R$${resumo.saldo.toFixed(2)}* (${resumo.taxaEconomia}%)\n`;

  // Meta
  if (resumo.meta > 0) {
    const bateuMeta = resumo.saldo >= resumo.meta;
    txt += bateuMeta
      ? `\n🏆 Meta de R$${resumo.meta.toFixed(2)} — ✅ Superada! Parabéns!\n`
      : `\n🎯 Meta de R$${resumo.meta.toFixed(2)} — ❌ Não atingida (${resumo.progressoMeta}%)\n`;
  }

  // Comparativo com mês anterior
  if (resumoAnt.totalDespesas > 0) {
    const var_ = ((resumo.totalDespesas - resumoAnt.totalDespesas) / resumoAnt.totalDespesas * 100).toFixed(1);
    const emoji = parseFloat(var_) <= 0 ? '🟢' : '🔴';
    txt += `\n${emoji} Total de gastos vs ${nomeMes(mesAnt)}: ${var_ > 0 ? '+' : ''}${var_}%\n`;
  }

  // Melhores e piores categorias vs mês anterior
  const cats = Object.entries(resumo.porCategoria);
  const comparativos = cats.map(([cat]) => {
    const comp = getComparativoCategoria(db, cat);
    return comp ? { cat, variacao: comp.variacao } : null;
  }).filter(Boolean).sort((a, b) => a.variacao - b.variacao);

  if (comparativos.length >= 2) {
    txt += `\n🏆 Melhor categoria: ${capitalize(comparativos[0].cat)} (${comparativos[0].variacao}%)\n`;
    txt += `⚠️ Pior categoria: ${capitalize(comparativos[comparativos.length - 1].cat)} (+${comparativos[comparativos.length - 1].variacao}%)`;
  }

  return txt;
}

// ----- Detector de situação financeira completa -----
function isSituacaoFinanceira(texto) {
  const low = texto.toLowerCase();
  const temRenda = low.includes('renda') || low.includes('recebo') || low.includes('prolabore') || low.includes('pró-labore');
  const temDivida = low.includes('divida') || low.includes('dívida') || low.includes('pagar') || low.includes('cartão') || low.includes('cartao');
  return temRenda && temDivida && texto.split('\n').length >= 5;
}

// ----- Parser via Claude para situação financeira livre -----
async function parseSituacaoFinanceira(texto) {
  const prompt = `Você é um extrator de dados financeiros. Analise o texto abaixo e extraia TODOS os dados financeiros em JSON.

TEXTO:
${texto}

Retorne APENAS este JSON (sem explicações, sem markdown):
{
  "dividasCartao": [{"descricao": "string", "valor": 0.00, "diaVencimento": 5, "cartao": "neon|nubank|outro"}],
  "contasFixas": [{"descricao": "string", "valor": 0.00, "dia": 27, "categoria": "moradia|contas|saude|transporte|educacao|outros"}],
  "receitasMensais": [{"descricao": "string", "valor": 0.00, "dia": 1}],
  "saldoAtual": 0.00,
  "dividaParcelada": {"valorMensal": 0.00, "meses": 0},
  "cartoes": [{"nome": "neon", "diaVencimento": 5}, {"nome": "nubank", "diaVencimento": 12}],
  "observacoes": "resumo livre do que foi detectado"
}

Regras:
- Valores no formato "2.374,86" → 2374.86
- "pagar dia 05/06" → diaVencimento: 5
- "pago dia 27 de cada mês" → dia: 27 (conta fixa)
- "recebo dia 01" → dia: 1 (receita)
- Se não houver dado para um campo, use null ou []
- categoria das contas: água/energia → contas, aluguel/condomínio → moradia, plano de saúde → saude`;

  try {
    const resposta = (await callClaudeText(prompt, [{ role: 'user', content: texto }], { maxTokens: 800 })).trim();
    const cleanJson = resposta.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error('[FINANCAS] Erro ao parsear situação:', e.message);
    return null;
  }
}

// ----- Registrar situação completa e gerar análise -----
async function processarSituacaoCompleta(texto, db, sendTelegramGroup) {
  await sendTelegramGroup('📊 Analisando sua situação financeira completa...');

  const dados = await parseSituacaoFinanceira(texto);
  if (!dados) {
    await sendTelegramGroup('❌ Não consegui interpretar a mensagem. Tente o formato de ajuda.');
    return;
  }

  // Registrar dívidas do cartão
  const dividasCartao = dados.dividasCartao || [];
  for (const d of dividasCartao) {
    const anoAtual = new Date().getFullYear();
    const mesAtualNum = new Date().getMonth() + 1;
    const vencimento = d.diaVencimento
      ? `${anoAtual}-${String(mesAtualNum).padStart(2,'0')}-${String(d.diaVencimento).padStart(2,'0')}`
      : null;
    addDivida(db, { descricao: d.cartao ? `${d.descricao} (${d.cartao})` : d.descricao, valor: d.valor, vencimento });
  }

  // Registrar contas fixas
  const contasFixas = dados.contasFixas || [];
  if (!db.state.financas.contasFixas) db.state.financas.contasFixas = [];
  for (const c of contasFixas) {
    const id = `CF-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    db.state.financas.contasFixas.push({ id, descricao: c.descricao, valor: c.valor, dia: c.dia, categoria: c.categoria || 'contas', ativa: true, criadoEm: Date.now() });
  }

  // Registrar receitas fixas
  const receitasMensais = dados.receitasMensais || [];
  if (!db.state.financas.receitasFixas) db.state.financas.receitasFixas = [];
  for (const r of receitasMensais) {
    const id = `RF-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    db.state.financas.receitasFixas.push({ id, descricao: r.descricao, valor: r.valor, dia: r.dia, ativa: true, criadoEm: Date.now() });
  }

  // Salvar situação atual
  db.state.financas.situacao = {
    saldoConta: dados.saldoAtual || 0,
    dividaParceladaMensal: dados.dividaParcelada?.valorMensal || 0,
    mesesParcelamento: dados.dividaParcelada?.meses || 0,
    cartoes: dados.cartoes || [],
    atualizadoEm: Date.now(),
  };

  db.saveDB().catch(() => {});

  // ----- Calcular números reais -----
  const totalRendaMensal = receitasMensais.reduce((s, r) => s + r.valor, 0);
  const totalContasFixas = contasFixas.reduce((s, c) => s + c.valor, 0);
  // Cartão = gastos mensais recorrentes (supermercado, farmácia, combustível = todo mês)
  const totalCartaoMensal = dividasCartao.reduce((s, d) => s + d.valor, 0);
  const parcelaMensal = dados.dividaParcelada?.valorMensal || 0;
  const saldo = dados.saldoAtual || 0;

  // Gasto total real mensal = fixos + cartão recorrente + parcelas
  const totalGastoMensal = totalContasFixas + totalCartaoMensal + parcelaMensal;
  // Déficit ou sobra real
  const sobra = totalRendaMensal - totalGastoMensal;
  const pctComprometido = totalRendaMensal > 0 ? ((totalGastoMensal / totalRendaMensal) * 100).toFixed(1) : 0;

  const diasParaPagarNeon = (() => {
    const neon = (dados.cartoes || []).find(c => c.nome === 'neon');
    if (!neon) return null;
    const hoje = new Date().getDate();
    const diff = neon.diaVencimento - hoje;
    return diff >= 0 ? diff : diff + 30;
  })();

  // Receitas ordenadas por dia (fluxo de caixa)
  const receitasOrdenadas = [...receitasMensais].sort((a, b) => (a.dia || 99) - (b.dia || 99));

  // ----- Montar resposta -----
  let msg = `✅ *Situação financeira registrada!*\n\n`;

  msg += `💰 *RENDA MENSAL: R$${totalRendaMensal.toFixed(2)}*\n`;
  for (const r of receitasOrdenadas) {
    msg += `  • ${r.descricao}: R$${r.valor.toFixed(2)} (dia ${r.dia || '?'})\n`;
  }

  msg += `\n🏠 *CONTAS FIXAS: R$${totalContasFixas.toFixed(2)}/mês*\n`;
  for (const c of [...contasFixas].sort((a, b) => (a.dia || 99) - (b.dia || 99))) {
    msg += `  • ${c.descricao}: R$${c.valor.toFixed(2)} (dia ${c.dia || '?'})\n`;
  }

  if (parcelaMensal > 0) {
    msg += `\n📦 Parcelas: R$${parcelaMensal.toFixed(2)}/mês por ${dados.dividaParcelada.meses} meses\n`;
  }

  msg += `\n💳 *GASTOS MENSAIS NO CARTÃO: R$${totalCartaoMensal.toFixed(2)}*\n`;
  for (const d of dividasCartao) {
    msg += `  • ${d.descricao}: R$${d.valor.toFixed(2)}\n`;
  }
  msg += `  _(supermercado, feira, farmácia, combustível = todo mês)_\n`;

  msg += `\n🏦 Saldo atual em conta: R$${saldo.toFixed(2)}\n`;

  msg += `\n${'─'.repeat(30)}\n`;
  msg += `📊 *ANÁLISE REAL — JARVIS:*\n\n`;

  // Tabela de contas reais
  msg += `Renda mensal:          *R$${totalRendaMensal.toFixed(2)}*\n`;
  msg += `(-) Contas fixas:      R$${totalContasFixas.toFixed(2)}\n`;
  msg += `(-) Cartão (mensal):   R$${totalCartaoMensal.toFixed(2)}\n`;
  if (parcelaMensal > 0) msg += `(-) Parcelas:          R$${parcelaMensal.toFixed(2)}\n`;
  msg += `${'─'.repeat(28)}\n`;

  if (sobra < 0) {
    msg += `🚨 *DÉFICIT REAL: -R$${Math.abs(sobra).toFixed(2)}/mês*\n\n`;
    msg += `Você gasta *R$${Math.abs(sobra).toFixed(2)} a mais do que ganha* todo mês. Esse buraco vai direto pro cartão, que vira dívida, que acumula juros — ciclo que só piora.\n\n`;
  } else if (sobra < 500) {
    msg += `⚠️ *Sobra real: R$${sobra.toFixed(2)}/mês* — margem perigosamente pequena.\n\n`;
  } else {
    msg += `✅ *Sobra real: R$${sobra.toFixed(2)}/mês*\n\n`;
  }

  // Alerta fatura imediata
  if (saldo < totalCartaoMensal) {
    msg += `🚨 *URGENTE — Neon vence em ${diasParaPagarNeon !== null ? diasParaPagarNeon + ' dias' : 'breve'}:*\n`;
    msg += `Fatura: R$${totalCartaoMensal.toFixed(2)} | Conta: R$${saldo.toFixed(2)}\n`;
    msg += `Falta: *R$${(totalCartaoMensal - saldo).toFixed(2)}*\n\n`;
  }

  // Fluxo de caixa do mês (quando entra vs quando sai)
  msg += `📅 *FLUXO DO MÊS:*\n`;
  msg += `Dia 1  → +R$${(receitasOrdenadas.filter(r => r.dia === 1).reduce((s, r) => s + r.valor, 0)).toFixed(2)} (alunas)\n`;
  msg += `Dia 5  → +R$3.000 (pró-labore) | Neon vence (R$${totalCartaoMensal.toFixed(2)})\n`;
  msg += `Dia 10 → condomínio R$400\n`;
  msg += `Dia 15 → plano saúde R$736\n`;
  msg += `Dia 17 → energia R$460\n`;
  msg += `Dia 20 → aluguel R$1.200\n`;
  msg += `Dia 25 → +R$720 (aluna) | Nubank vence\n`;
  msg += `Dia 27 → água R$160\n\n`;

  // Diagnóstico e plano
  msg += `🎯 *DIAGNÓSTICO:*\n`;
  if (sobra < 0) {
    const corteNecessario = Math.abs(sobra);
    msg += `Para equilibrar as contas, você precisa cortar *R$${corteNecessario.toFixed(2)}/mês* OU aumentar a renda nesse valor.\n\n`;
    msg += `*Onde cortar:*\n`;
    // Sugestões específicas
    const gastoAlimentacao = dividasCartao.filter(d => d.descricao.toLowerCase().includes('supermercado') || d.descricao.toLowerCase().includes('feira')).reduce((s, d) => s + d.valor, 0);
    if (gastoAlimentacao > 1500) {
      msg += `• Supermercado+feira (R$${gastoAlimentacao.toFixed(2)}) — meta: R$${(gastoAlimentacao * 0.75).toFixed(2)} (-25%)\n`;
    }
    msg += `• Planejamento de compras: lista semanal, evitar delivery\n`;
    msg += `• Combustível (R$${dividasCartao.find(d => d.descricao.toLowerCase().includes('combustível') || d.descricao.toLowerCase().includes('combustivel'))?.valor.toFixed(2) || '?'}) — planejar saídas\n\n`;
  }

  msg += `💡 *REGRA IMEDIATA:*\n`;
  msg += `Dia 5 entra R$3.000 → paga Neon PRIMEIRO, resto das contas depois.\n`;
  msg += `Cartão Neon = só o que cabe nos R$3.000 menos as contas fixas do mês.\n`;
  msg += `*Limite real do Neon: R$${Math.max(0, 3000 - totalContasFixas + parcelaMensal).toFixed(2)}/mês*\n\n`;

  msg += `Digite *dividas* para ver o painel completo.`;

  await sendTelegramGroup(msg);
}

// ----- Parser de dívidas/a-receber em lote (mensagem multi-linha) -----
function parsarDataVencimento(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length < 2) return null;
  const dia = parseInt(parts[0]);
  const mes = parseInt(parts[1]);
  const anoAtual = new Date().getFullYear();
  const ano = parts[2] ? (parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2])) : anoAtual;
  if (isNaN(dia) || isNaN(mes)) return null;
  return new Date(ano, mes - 1, dia).toISOString().slice(0, 10);
}

function parseMensagemDividasAReceber(texto) {
  const temDivida = /d[íi]vida/i.test(texto);
  const temReceber = /a\s+receber|recebimento/i.test(texto);
  if (!temDivida && !temReceber) return null;

  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const dividas = [];
  const aReceber = [];
  let secao = null;

  for (const linha of linhas) {
    const low = linha.toLowerCase();
    if (/^d[íi]vida/.test(low)) { secao = 'dividas'; continue; }
    if (/^a\s+receber|^recebimento/.test(low)) { secao = 'areceber'; continue; }
    if (!secao) continue;

    // Formatos: "nubank 1500 vence 10/06" | "João 300 dia 05/06" | "luz 200" | "fulano 300 10/06"
    const match = linha.match(/^(.+?)\s+([\d.,]+)(?:\s+(?:vence?|dia|em|até|ate|para)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))?(?:\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))?/i);
    if (!match) continue;

    const descricao = match[1].trim();
    const valor = parseFloat(match[2].replace(',', '.'));
    const vencimentoStr = match[3] || match[4] || null;
    const vencimento = parsarDataVencimento(vencimentoStr);

    if (!descricao || !valor || valor <= 0) continue;

    if (secao === 'dividas') dividas.push({ descricao, valor, vencimento });
    else aReceber.push({ descricao, valor, dataRecebimento: vencimento });
  }

  return (dividas.length > 0 || aReceber.length > 0) ? { dividas, aReceber } : null;
}

// ----- CRUD Dívidas -----
function addDivida(db, divida) {
  if (!db.state.financas.dividas) db.state.financas.dividas = [];
  const id = `DIV-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const novo = { id, descricao: divida.descricao, valor: parseFloat(divida.valor), vencimento: divida.vencimento || null, pago: false, criadoEm: Date.now() };
  db.state.financas.dividas.push(novo);
  db.saveDB().catch(() => {});
  return novo;
}

function getDividas(db, apenasAtivas = false) {
  const lista = db.state.financas.dividas || [];
  return apenasAtivas ? lista.filter(d => !d.pago) : lista;
}

function marcarDividaPaga(db, id) {
  const div = (db.state.financas.dividas || []).find(d => d.id === id);
  if (div) { div.pago = true; div.pagouEm = Date.now(); db.saveDB().catch(() => {}); }
  return div;
}

function deleteDivida(db, id) {
  if (!db.state.financas.dividas) return;
  db.state.financas.dividas = db.state.financas.dividas.filter(d => d.id !== id);
  db.saveDB().catch(() => {});
}

// ----- CRUD A Receber -----
function addAReceber(db, item) {
  if (!db.state.financas.aReceber) db.state.financas.aReceber = [];
  const id = `REC-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const novo = { id, descricao: item.descricao, valor: parseFloat(item.valor), dataRecebimento: item.dataRecebimento || null, recebido: false, criadoEm: Date.now() };
  db.state.financas.aReceber.push(novo);
  db.saveDB().catch(() => {});
  return novo;
}

function getAReceber(db, apenasAtivos = false) {
  const lista = db.state.financas.aReceber || [];
  return apenasAtivos ? lista.filter(r => !r.recebido) : lista;
}

function marcarRecebido(db, id) {
  const item = (db.state.financas.aReceber || []).find(r => r.id === id);
  if (item) { item.recebido = true; item.recebidoEm = Date.now(); db.saveDB().catch(() => {}); }
  return item;
}

function deleteAReceber(db, id) {
  if (!db.state.financas.aReceber) return;
  db.state.financas.aReceber = db.state.financas.aReceber.filter(r => r.id !== id);
  db.saveDB().catch(() => {});
}

// ----- Balanço de dívidas -----
function formatarBalancoDividas(db) {
  const dividas = getDividas(db, true);
  const aReceber = getAReceber(db, true);

  const totalDividas = dividas.reduce((s, d) => s + d.valor, 0);
  const totalAReceber = aReceber.reduce((s, r) => s + r.valor, 0);
  const saldoLiquido = totalAReceber - totalDividas;
  const hoje = new Date().toISOString().slice(0, 10);

  let msg = `💰 *Balanço — Dívidas & Recebimentos*\n\n`;

  if (dividas.length > 0) {
    const ordenadas = [...dividas].sort((a, b) => {
      if (!a.vencimento) return 1;
      if (!b.vencimento) return -1;
      return a.vencimento.localeCompare(b.vencimento);
    });
    msg += `🔴 *Dívidas ativas (${dividas.length}):*\n`;
    for (const d of ordenadas) {
      const venc = d.vencimento ? ` — vence ${d.vencimento.slice(8, 10)}/${d.vencimento.slice(5, 7)}` : '';
      const atrasado = d.vencimento && d.vencimento < hoje ? ' ⚠️ ATRASADA' : '';
      msg += `• ${d.descricao}: *R$${d.valor.toFixed(2)}*${venc}${atrasado}\n`;
    }
    msg += `Total: *R$${totalDividas.toFixed(2)}*\n\n`;
  } else {
    msg += `✅ Sem dívidas ativas!\n\n`;
  }

  if (aReceber.length > 0) {
    const ordenados = [...aReceber].sort((a, b) => {
      if (!a.dataRecebimento) return 1;
      if (!b.dataRecebimento) return -1;
      return a.dataRecebimento.localeCompare(b.dataRecebimento);
    });
    msg += `🟢 *A receber (${aReceber.length}):*\n`;
    for (const r of ordenados) {
      const data = r.dataRecebimento ? ` — dia ${r.dataRecebimento.slice(8, 10)}/${r.dataRecebimento.slice(5, 7)}` : '';
      msg += `• ${r.descricao}: *R$${r.valor.toFixed(2)}*${data}\n`;
    }
    msg += `Total: *R$${totalAReceber.toFixed(2)}*\n\n`;
  } else {
    msg += `📭 Nada a receber.\n\n`;
  }

  const emoji = saldoLiquido >= 0 ? '💚' : '🔴';
  msg += `${emoji} *Saldo líquido: R$${saldoLiquido.toFixed(2)}*`;
  if (saldoLiquido < 0) msg += `\n⚠️ Você deve mais do que vai receber. Priorize quitar dívidas!`;

  return msg;
}

// ----- Formatador de resumo -----
function formatarResumo(resumo) {
  const { mes, totalReceitas, totalDespesas, saldo, taxaEconomia, porCategoria, meta, progressoMeta } = resumo;

  const nomesMes = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const [ano, mesNum] = mes.split('-');
  const nomeMesStr = `${nomesMes[parseInt(mesNum)]}/${ano}`;

  let txt = `📊 *Resumo Financeiro — ${nomeMesStr}*\n\n`;
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

// ----- Processador de mensagem do grupo Telegram -----
async function processarMensagemGrupo(texto, senderName, db, sendTelegramGroup) {
  const textLower = texto.toLowerCase().trim();

  // ===== COMANDOS ESPECIAIS =====

  if (textLower === 'resumo' || textLower === '/resumo') {
    const resumo = getResumoMensal(db);
    await sendTelegramGroup(formatarResumo(resumo));
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

  // Definir orçamento: "limite alimentacao 600" ou "orcamento transporte 300"
  const limiteMatch = textLower.match(/^(limite|orçamento|orcamento)\s+(\w+)\s+([\d.,]+)/);
  if (limiteMatch) {
    const catInput = limiteMatch[2];
    const cat = CATEGORIAS.find(c => c.startsWith(catInput) || catInput.startsWith(c.slice(0, 4)));
    const valor = parseFloat(limiteMatch[3].replace(',', '.'));
    if (cat && valor > 0) {
      setOrcamento(db, cat, valor);
      const prog = getProgressoOrcamento(db, cat, mesAtual());
      const pct = prog.limite > 0 ? ((prog.gasto / prog.limite) * 100).toFixed(0) : 0;
      await sendTelegramGroup(
        `✅ Orçamento definido para *${capitalize(cat)}*: R$${valor.toFixed(2)}/mês\n` +
        `📊 Gasto atual: R$${prog.gasto.toFixed(2)} (${pct}%)\n` +
        `${barraProgresso(parseFloat(pct))} ${pct}%`
      );
    }
    return;
  }

  // Ver todos orçamentos
  if (textLower === 'orcamentos' || textLower === 'orçamentos' || textLower === '/orcamentos') {
    const orcamentos = db.state.financas.metas.orcamentos || {};
    if (Object.keys(orcamentos).length === 0) {
      await sendTelegramGroup('Nenhum orçamento definido ainda.\n\nDefina com: *limite alimentacao 800*');
      return;
    }
    let msg = `💰 *Orçamentos de ${nomeMes(mesAtual())}:*\n\n`;
    for (const [cat, limite] of Object.entries(orcamentos)) {
      const prog = getProgressoOrcamento(db, cat, mesAtual());
      const pct = prog.pct || 0;
      const { emoji } = statusOrcamento(pct);
      msg += `${emoji} *${capitalize(cat)}*\n`;
      msg += `R$${prog.gasto.toFixed(2)} de R$${limite.toFixed(2)}\n`;
      msg += `${barraProgresso(pct)} ${pct.toFixed(0)}%\n\n`;
    }
    await sendTelegramGroup(msg.trim());
    return;
  }

  // Projeção
  if (textLower === 'projeção' || textLower === 'projecao' || textLower === '/projecao') {
    const proj = gerarProjecaoMes(db);
    if (!proj || proj.gastoAtual === 0) {
      await sendTelegramGroup('Sem dados suficientes para projeção ainda. Continue registrando seus gastos!');
      return;
    }
    const status = proj.projecaoTaxaEconomia >= 20 ? '✅ No caminho certo!' :
      proj.projecaoTaxaEconomia >= 10 ? '⚠️ Pode melhorar' : '🚨 Atenção ao ritmo!';
    const msg = `📈 *Projeção — ${nomeMes(mesAtual())}*\n\n` +
      `Gastos até hoje (dia ${proj.diaHoje}): R$${proj.gastoAtual.toFixed(2)}\n` +
      `Média diária: R$${proj.mediaDiaria.toFixed(2)}\n` +
      `Dias restantes: ${proj.diasRestantes}\n\n` +
      `📊 Projeção de gastos: *R$${proj.projecaoDespesas.toFixed(2)}*\n` +
      `💰 Saldo projetado: R$${proj.projecaoSaldo.toFixed(2)}\n` +
      `📈 Taxa economia projetada: ${proj.projecaoTaxaEconomia}%\n\n${status}`;
    await sendTelegramGroup(msg);
    return;
  }

  // Relatório semanal
  if (textLower === 'semana' || textLower === '/semana') {
    await sendTelegramGroup(gerarRelatorioSemanal(db));
    return;
  }

  // Streak
  if (textLower === 'streak' || textLower === '/streak') {
    const streaks = calcularStreak(db);
    let msg = `🔥 *Seus Streaks de Economia:*\n\n`;
    for (const [cat, dias] of Object.entries(streaks)) {
      const emoji = dias >= 7 ? '🏆' : dias >= 3 ? '🔥' : dias >= 1 ? '✅' : '❌';
      msg += `${emoji} ${capitalize(cat)}: *${dias} dia${dias !== 1 ? 's' : ''}* sem gastar\n`;
    }
    await sendTelegramGroup(msg);
    return;
  }

  if (textLower === 'ajuda' || textLower === '/ajuda' || textLower === 'help') {
    const ajuda = `💰 *Comandos do Grupo Financeiro*\n\n` +
      `📝 *Registrar gasto:*\n"gastei R$50 no mercado"\n"paguei 120 de luz"\n\n` +
      `💵 *Registrar receita:*\n"recebi 3000 de salário"\n\n` +
      `📊 *Consultas:*\n` +
      `\`resumo\` — Resumo do mês\n` +
      `\`projecao\` — Projeção até fim do mês\n` +
      `\`semana\` — Relatório semanal\n` +
      `\`orcamentos\` — Ver orçamentos\n` +
      `\`streak\` — Dias sem gastar em categorias impulso\n` +
      `\`analise\` — Análise IA dos gastos\n` +
      `\`dividas\` — Balanço de dívidas e a receber\n\n` +
      `💳 *Dívidas & Recebimentos:*\n` +
      `\`paguei nubank\` — Marcar dívida como paga\n` +
      `\`recebi joao\` — Marcar recebimento como recebido\n` +
      `Ou envie tudo de uma vez (veja exemplo abaixo)\n\n` +
      `⚙️ *Configurar:*\n` +
      `\`meta 1000\` — Meta de economia mensal\n` +
      `\`limite alimentacao 800\` — Orçamento por categoria\n\n` +
      `📋 *Categorias:* alimentação, transporte, moradia, saúde, educação, lazer, roupas, contas, trabalho, outros\n\n` +
      `📋 *Exemplo dívidas em lote:*\n` +
      `dívidas:\nnubank 1500 vence 10/06\nempréstimo 800 vence 15/06\n\na receber:\nJoão 300 dia 05/06\ncliente 500`;
    await sendTelegramGroup(ajuda);
    return;
  }

  // Balanço de dívidas
  if (textLower === 'dividas' || textLower === 'dívidas' || textLower === '/dividas') {
    await sendTelegramGroup(formatarBalancoDividas(db));
    return;
  }

  // Marcar dívida como paga: "paguei nubank" | "paguei DIV-123"
  const pagueiMatch = textLower.match(/^paguei\s+(.+)/);
  if (pagueiMatch) {
    const termo = pagueiMatch[1].trim();
    const dividas = getDividas(db, true);
    const encontrada = dividas.find(d =>
      d.id === termo || d.descricao.toLowerCase().includes(termo)
    );
    if (encontrada) {
      marcarDividaPaga(db, encontrada.id);
      const restante = getDividas(db, true).reduce((s, d) => s + d.valor, 0);
      await sendTelegramGroup(
        `✅ *${encontrada.descricao}* marcada como paga!\n` +
        `Valor quitado: R$${encontrada.valor.toFixed(2)}\n` +
        `💰 Ainda a pagar: R$${restante.toFixed(2)}`
      );
    } else {
      await sendTelegramGroup(`Dívida não encontrada: "${termo}"\nVeja suas dívidas com: *dividas*`);
    }
    return;
  }

  // Marcar recebimento: "recebi joao" | "recebi REC-123"
  // (só se não for parseável como transação normal)
  const recebiMatch = textLower.match(/^recebi\s+(?![\d])(.+)/);
  if (recebiMatch) {
    const termo = recebiMatch[1].trim();
    const lista = getAReceber(db, true);
    const encontrado = lista.find(r =>
      r.id === termo || r.descricao.toLowerCase().includes(termo)
    );
    if (encontrado) {
      marcarRecebido(db, encontrado.id);
      const restante = getAReceber(db, true).reduce((s, r) => s + r.valor, 0);
      await sendTelegramGroup(
        `💚 *${encontrado.descricao}* marcado como recebido!\n` +
        `Valor: R$${encontrado.valor.toFixed(2)}\n` +
        `📥 Ainda a receber: R$${restante.toFixed(2)}`
      );
      return;
    }
    // Se não achou na lista, deixa cair no parser de transação abaixo
  }

  // ===== SITUAÇÃO FINANCEIRA COMPLETA =====
  if (isSituacaoFinanceira(texto)) {
    await processarSituacaoCompleta(texto, db, sendTelegramGroup);
    return;
  }

  // ===== REGISTRO DE DÍVIDAS EM LOTE =====
  const lote = parseMensagemDividasAReceber(texto);
  if (lote) {
    let msg = `📋 *Dívidas e recebimentos registrados:*\n\n`;
    let totalDiv = 0, totalRec = 0;

    if (lote.dividas.length > 0) {
      msg += `🔴 *Dívidas:*\n`;
      for (const d of lote.dividas) {
        addDivida(db, d);
        const venc = d.vencimento ? ` (vence ${d.vencimento.slice(8, 10)}/${d.vencimento.slice(5, 7)})` : '';
        msg += `• ${d.descricao}: R$${d.valor.toFixed(2)}${venc}\n`;
        totalDiv += d.valor;
      }
      msg += `Total: *R$${totalDiv.toFixed(2)}*\n\n`;
    }

    if (lote.aReceber.length > 0) {
      msg += `🟢 *A receber:*\n`;
      for (const r of lote.aReceber) {
        addAReceber(db, r);
        const data = r.dataRecebimento ? ` (dia ${r.dataRecebimento.slice(8, 10)}/${r.dataRecebimento.slice(5, 7)})` : '';
        msg += `• ${r.descricao}: R$${r.valor.toFixed(2)}${data}\n`;
        totalRec += r.valor;
      }
      msg += `Total: *R$${totalRec.toFixed(2)}*\n\n`;
    }

    const saldo = totalRec - totalDiv;
    const emoji = saldo >= 0 ? '💚' : '🔴';
    msg += `${emoji} Saldo líquido: *R$${saldo.toFixed(2)}*\n`;
    msg += `\nDigite *dividas* para ver o balanço completo.`;
    await sendTelegramGroup(msg);
    return;
  }

  // ===== REGISTRAR TRANSAÇÃO =====
  const transacao = await parseMensagemFinanceira(texto, senderName);
  if (!transacao) return;

  const entrada = addTransacao(db, transacao);
  const emoji = transacao.tipo === 'receita' ? '💵' : '💸';
  const tipoLabel = transacao.tipo === 'receita' ? 'Receita' : 'Despesa';

  let confirmacao = `${emoji} *${tipoLabel} registrada*\nR$${entrada.valor.toFixed(2)} — ${capitalize(entrada.categoria)}\n📝 ${entrada.descricao}\n👤 ${entrada.quem}`;

  if (transacao.tipo === 'despesa') {
    // Total da categoria no mês
    const totalCategoria = db.state.financas.transacoes
      .filter(t => t.mes === mesAtual() && t.tipo === 'despesa' && t.categoria === entrada.categoria)
      .reduce((sum, t) => sum + t.valor, 0);
    confirmacao += `\n\n📊 ${capitalize(entrada.categoria)} em ${nomeMes(mesAtual())}: *R$${totalCategoria.toFixed(2)}*`;

    // Orçamento da categoria
    const prog = getProgressoOrcamento(db, entrada.categoria, mesAtual());
    if (prog.limite > 0) {
      const pct = (prog.gasto / prog.limite) * 100;
      const { emoji: eOrc } = statusOrcamento(pct);
      confirmacao += `\n${eOrc} Orçamento: ${barraProgresso(pct, 8)} ${pct.toFixed(0)}% (R$${prog.gasto.toFixed(2)} de R$${prog.limite.toFixed(2)})`;
      if (pct >= 100) {
        confirmacao += `\n🚨 *Limite de ${capitalize(entrada.categoria)} ultrapassado!*`;
      } else if (pct >= 80) {
        confirmacao += `\n⚠️ Só restam R$${(prog.limite - prog.gasto).toFixed(2)} no orçamento!`;
      }
    }

    // Comparativo com mês anterior
    const comp = getComparativoCategoria(db, entrada.categoria);
    if (comp && comp.valorAnterior > 0) {
      const varEmoji = comp.variacao <= 0 ? '🟢' : comp.variacao <= 20 ? '🟡' : '🔴';
      const varSinal = comp.variacao > 0 ? '+' : '';
      confirmacao += `\n${varEmoji} vs ${nomeMes(mesAnterior())}: ${varSinal}${comp.variacao}%`;
    }
  }

  if (transacao.tipo === 'receita') {
    // Plano de pagamento automático
    const plano = gerarPlanoPagamento(entrada.valor, db);
    confirmacao += `\n\n📋 *Plano Buffett para o mês:*\n`;
    confirmacao += `• 💰 Poupar primeiro: R$${plano.poupar.toFixed(2)} (20%)\n`;
    confirmacao += `• 🏠 Necessidades: R$${plano.necessidades.toFixed(2)} (50%)\n`;
    confirmacao += `• 🎯 Desejos: R$${plano.desejos.toFixed(2)} (30%)\n`;
    if (plano.gastoAtual > 0) {
      confirmacao += `\n📊 Já gasto este mês: R$${plano.gastoAtual.toFixed(2)}\n`;
      confirmacao += `💳 Disponível restante: *R$${plano.disponivelRestante.toFixed(2)}*`;
    }
  }

  await sendTelegramGroup(confirmacao);
}

module.exports = {
  parseMensagemFinanceira,
  addTransacao,
  getTransacoesMes,
  getTransacoesHoje,
  getResumoMensal,
  analisarGastosDesnecessarios,
  processarMensagemGrupo,
  formatarResumo,
  gerarRelatorioDiario,
  gerarRelatorioSemanal,
  gerarRelatorioFimMes,
  gerarProjecaoMes,
  setOrcamento,
  getProgressoOrcamento,
  calcularStreak,
  CATEGORIAS,
  // Situação financeira completa
  isSituacaoFinanceira,
  parseSituacaoFinanceira,
  processarSituacaoCompleta,
  // Dívidas & A Receber
  addDivida,
  getDividas,
  marcarDividaPaga,
  deleteDivida,
  addAReceber,
  getAReceber,
  marcarRecebido,
  deleteAReceber,
  formatarBalancoDividas,
};

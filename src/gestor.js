'use strict';

// ============================================================
// GESTOR DE PROJETOS — JARVIS
// Agente CEO do sistema: Claude Sonnet + tools
// Capacidades:
// - Chat inteligente com Miron
// - Ler e editar código do sistema
// - Detectar e corrigir erros automaticamente
// - Notificar no Telegram antes de qualquer deploy
// - Fazer push no GitHub após autorização
// - Base de conhecimento: copywriters, tráfego, funis
// ============================================================

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');
const { callClaude, httpRequest } = require('./services');
const { addGestorLog, addGestorChat, getGestorChat, getGestorLogs } = require('./database');
const financas = require('./financas');

const ROOT_DIR = path.resolve(__dirname, '..');

// ----- Base de conhecimento (Copywriters + Tráfego + Funis) -----
const KNOWLEDGE_BASE = `
## EUGENE SCHWARTZ — 5 NÍVEIS DE CONSCIÊNCIA
Regra mestra: Quanto menos consciente o público, mais indireta a abordagem.
N1-Mais consciente: Conhece o produto, falta oferta → "50% OFF só hoje"
N2-Consciente do produto: Sabe mas não convencido → Provas, testemunhos
N3-Consciente da solução: Não conhece a sua → "Existe um método que..."
N4-Consciente do problema: Sente a dor → "Cansado de...?"
N5-Inconsciente: Não sabe que tem problema → História, curiosidade
Copy não cria desejo — canaliza desejos que já existem.

## DAN KENNEDY — PAS + FASCINATIONS
Framework PAS: Problem → Agitate (pior que imaginava) → Solve
Fascination: "O segredo de [X] que [resultado] (e por que ninguém te conta)"
Bullets magnéticos: "AVISO: Se você [situação], NUNCA faça [coisa] antes de ler"
Estrutura sales letter: Pre-head → Headline → Lead emotiva → PAS → Credenciais → Solução → Fascinations → Provas → Oferta empilhada → Garantia agressiva → Escassez → CTA → P.S.

## PEDRO SOBRAL — META ADS
3 campanhas obrigatórias: audiência (sempre ativo) + captação + vendas
Framework HOOK-FILTRO-CTA: Hook(história/contra-intuitivo) → Filtro(qualifica) → CTA(ação)
Prioridade: Remarketing > Público testado > Lookalike > Aberto > Interesses
Orçamento: 10% faturamento=testando | 20%=crescendo | 30%+=escalando
Ajustar a cada 2 dias. Criativos novos a cada 2-3 dias.

## ALEX HORMOZI — GRAND SLAM OFFER
Valor = (Dream Outcome × Probabilidade) / (Tempo × Esforço)
Oferta tão boa que a pessoa se sente estúpida em dizer não.
CAC:LTGP mínimo 1:3. Close rate >20% é saudável.
Garantia reversa: "Se não entregar [resultado] em [prazo], devolvo + pago R$X"

## RUSSELL BRUNSON — VALUE LADDER + HOOK-STORY-OFFER
Value Ladder: Grátis → R$7-47 → R$97-497 → R$997-5k → R$10k+
Hook-Story-Offer em TUDO: Hook(atenção) → Story(conexão/Epiphany Bridge) → Offer(irresistível)
Frontend paga CAC. Lucro vem de upsells. EPC > CPC = funil saudável.

## REGRAS DE OURO DO TRÁFEGO
1. Criativo É o novo targeting — invista mais em criativo que segmentação
2. Volume de testes > qualidade individual — quem testa mais, vence
3. Oferta > tudo — oferta fraca não é salva por criativo incrível
4. UGC supera produção profissional na maioria dos testes
5. Matar rápido (48h sem sinal = mata), escalar rápido (ROAS bom = escala já)
6. Remarketing tem ROAS 5-15x vs 2-3x tráfego frio
7. Broad targeting funciona melhor que hiper-segmentação em 2024+

## FUNIS QUICK REFERENCE
Começando/lista: Squeeze Page (Tráfego → Captura → Isca → Sequência)
Cobrir CAC: Tripwire (Lead → OTO R$7-97 → Upsell → Core offer)
Produto R$300-2k: Webinar (Registro → 90min → Oferta)
Lançamento: PLF 3 vídeos gratuitos + abertura 5-7 dias
High ticket: Application (Conteúdo → Formulário → Call → Fechamento)
Transformação: Challenge (5-7 dias → Oferta)
`;

// ----- Ferramentas do Gestor -----
const GESTOR_TOOLS = [
  {
    name: 'ler_arquivo',
    description: 'Lê o conteúdo de um arquivo do sistema central-vendas',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo ao root do projeto (ex: src/agents/logzz.js)' },
      },
      required: ['caminho'],
    },
  },
  {
    name: 'editar_arquivo',
    description: 'Edita ou cria um arquivo no sistema. SEMPRE notifique Miron no Telegram antes de fazer deploy.',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo ao root do projeto' },
        conteudo: { type: 'string', description: 'Novo conteúdo completo do arquivo' },
        motivo: { type: 'string', description: 'Explicação do que foi corrigido/adicionado' },
      },
      required: ['caminho', 'conteudo', 'motivo'],
    },
  },
  {
    name: 'listar_arquivos',
    description: 'Lista arquivos de um diretório do projeto',
    input_schema: {
      type: 'object',
      properties: {
        diretorio: { type: 'string', description: 'Diretório relativo ao root (ex: src/ ou src/agents/)' },
      },
      required: ['diretorio'],
    },
  },
  {
    name: 'notificar_telegram',
    description: 'Envia mensagem para o Miron no Telegram. Use SEMPRE antes de fazer push/deploy.',
    input_schema: {
      type: 'object',
      properties: {
        mensagem: { type: 'string', description: 'Mensagem a enviar para o Miron' },
      },
      required: ['mensagem'],
    },
  },
  {
    name: 'push_github',
    description: 'Faz commit e push no GitHub para deploy automático. Requer autorização prévia do Miron.',
    input_schema: {
      type: 'object',
      properties: {
        mensagem_commit: { type: 'string', description: 'Mensagem do commit' },
        arquivos_modificados: { type: 'array', items: { type: 'string' }, description: 'Lista de arquivos modificados' },
      },
      required: ['mensagem_commit', 'arquivos_modificados'],
    },
  },
  {
    name: 'ver_logs',
    description: 'Visualiza logs de erro e eventos do sistema',
    input_schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Número de entradas a retornar (default 20)' },
      },
    },
  },
  {
    name: 'status_agentes',
    description: 'Verifica status de conexão dos agentes WhatsApp (info e logzz)',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_conversas',
    description: 'Lista todas as conversas ativas de um agente com resumo do último texto',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente' },
      },
      required: ['agente'],
    },
  },
  {
    name: 'ler_conversa',
    description: 'Lê o histórico completo de mensagens de um cliente específico',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente' },
        phone: { type: 'string', description: 'Número do cliente (ex: 5562991819645)' },
      },
      required: ['agente', 'phone'],
    },
  },
  {
    name: 'enviar_mensagem_whatsapp',
    description: 'Envia uma mensagem WhatsApp para um cliente como se fosse o agente. Use para intervenções manuais.',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente envia' },
        phone: { type: 'string', description: 'Número do cliente' },
        mensagem: { type: 'string', description: 'Texto da mensagem' },
      },
      required: ['agente', 'phone', 'mensagem'],
    },
  },
  {
    name: 'pausar_atendimento',
    description: 'Pausa ou retoma o atendimento automático de um cliente específico',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente' },
        phone: { type: 'string', description: 'Número do cliente' },
        acao: { type: 'string', enum: ['pausar', 'retomar'], description: 'pausar ou retomar' },
      },
      required: ['agente', 'phone', 'acao'],
    },
  },
  {
    name: 'atualizar_instrucao',
    description: 'Atualiza as instruções manuais do dono para um agente (prioridade máxima no prompt)',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente' },
        instrucao: { type: 'string', description: 'Nova instrução (vazio para limpar)' },
      },
      required: ['agente', 'instrucao'],
    },
  },
  {
    name: 'ver_pedidos_logzz',
    description: 'Visualiza pedidos COD da Logzz (produto físico, pago na entrega)',
    input_schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Quantidade de pedidos (default 20)' },
      },
    },
  },
  {
    name: 'ver_resumo_financeiro',
    description: 'Mostra o resumo financeiro mensal: receitas, despesas, saldo, taxa de economia e gastos por categoria',
    input_schema: {
      type: 'object',
      properties: {
        mes: { type: 'string', description: 'Mês no formato YYYY-MM (ex: 2026-05). Se omitido, usa o mês atual.' },
      },
    },
  },
  {
    name: 'registrar_transacao',
    description: 'Registra manualmente uma receita ou despesa no controle financeiro familiar',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['receita', 'despesa'], description: 'Tipo da transação' },
        valor: { type: 'number', description: 'Valor em reais' },
        categoria: { type: 'string', description: 'Categoria: alimentação, transporte, moradia, saúde, educação, lazer, roupas, contas, trabalho, outros' },
        descricao: { type: 'string', description: 'Descrição do gasto ou receita' },
        quem: { type: 'string', description: 'Quem fez: Miron ou Esposa' },
      },
      required: ['tipo', 'valor', 'categoria', 'descricao', 'quem'],
    },
  },
  {
    name: 'analisar_gastos_desnecessarios',
    description: 'Analisa os gastos do mês atual e identifica o que pode ser cortado para economizar mais, com base nos princípios dos maiores investidores do mundo',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_transacoes',
    description: 'Lista as transações financeiras registradas no mês',
    input_schema: {
      type: 'object',
      properties: {
        mes: { type: 'string', description: 'Mês YYYY-MM. Se omitido, usa o mês atual.' },
        tipo: { type: 'string', enum: ['todas', 'receita', 'despesa'], description: 'Filtrar por tipo' },
        limite: { type: 'number', description: 'Máximo de registros (default 30)' },
      },
    },
  },
  {
    name: 'definir_meta_economia',
    description: 'Define a meta de economia mensal para o casal',
    input_schema: {
      type: 'object',
      properties: {
        valor: { type: 'number', description: 'Valor mensal a economizar em reais' },
      },
      required: ['valor'],
    },
  },
  {
    name: 'disparar_remarketing',
    description: 'Dispara mensagem de remarketing para toda a base de um agente ou para um subconjunto filtrado. Envia as mensagens de verdade via WhatsApp com delay entre cada envio.',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: ['info', 'logzz', 'rafael'], description: 'Qual agente vai disparar' },
        mensagem: { type: 'string', description: 'Texto da mensagem a enviar. Use {nome} para personalizar com o nome do cliente.' },
        filtro: {
          type: 'string',
          enum: ['todos', 'com_link', 'sem_link', 'sem_resposta_24h'],
          description: 'todos=toda a base não pausada; com_link=quem recebeu link mas não confirmou; sem_link=quem ainda não recebeu link; sem_resposta_24h=sem resposta há mais de 24h',
        },
        delay_segundos: { type: 'number', description: 'Delay entre mensagens em segundos (default 3, min 1, max 10)' },
      },
      required: ['agente', 'mensagem'],
    },
  },
];

// ----- Execução de ferramentas -----
async function executeTool(name, input) {
  switch (name) {
    case 'ler_arquivo': {
      const filePath = path.resolve(ROOT_DIR, input.caminho);
      // Segurança: só permite leitura dentro do root do projeto
      if (!filePath.startsWith(ROOT_DIR)) return 'Acesso negado: fora do diretório do projeto';
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.slice(0, 8000); // limite para não explodir o contexto
      } catch (e) {
        return `Erro ao ler arquivo: ${e.message}`;
      }
    }

    case 'editar_arquivo': {
      const filePath = path.resolve(ROOT_DIR, input.caminho);
      if (!filePath.startsWith(ROOT_DIR)) return 'Acesso negado: fora do diretório do projeto';
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, input.conteudo, 'utf8');
        addGestorLog('edit', `Arquivo editado: ${input.caminho} — ${input.motivo}`);
        return `Arquivo ${input.caminho} salvo com sucesso. Motivo: ${input.motivo}`;
      } catch (e) {
        return `Erro ao editar arquivo: ${e.message}`;
      }
    }

    case 'listar_arquivos': {
      const dirPath = path.resolve(ROOT_DIR, input.diretorio);
      if (!dirPath.startsWith(ROOT_DIR)) return 'Acesso negado';
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items.map(i => `${i.isDirectory() ? '[DIR]' : '[ARQ]'} ${i.name}`).join('\n');
      } catch (e) {
        return `Erro ao listar: ${e.message}`;
      }
    }

    case 'notificar_telegram': {
      const result = await sendTelegram(input.mensagem);
      addGestorLog('telegram', `Mensagem enviada: ${input.mensagem.slice(0, 100)}`);
      return result ? 'Mensagem enviada no Telegram com sucesso' : 'Erro ao enviar Telegram (verifique TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID)';
    }

    case 'push_github': {
      return await doPushGithub(input.mensagem_commit, input.arquivos_modificados);
    }

    case 'ver_logs': {
      const logs = getGestorLogs(input.limite || 20);
      if (!logs.length) return 'Nenhum log registrado ainda';
      return logs.map(l => `[${new Date(l.ts).toLocaleTimeString('pt-BR')}] [${l.tipo.toUpperCase()}] ${l.msg}`).join('\n');
    }

    case 'status_agentes': {
      try {
        const baileys = require('./baileys');
        const status = baileys.getAllStatus();
        return JSON.stringify(status, null, 2);
      } catch (e) {
        return `Erro ao verificar status: ${e.message}`;
      }
    }

    case 'listar_conversas': {
      const db = require('./database');
      const convs = db.getAllConvs(input.agente);
      if (!convs.length) return `Nenhuma conversa em ${input.agente}`;
      return convs.slice(0, 50).map(c =>
        `${c.pushName || c.phone} (${c.phone}) | ${c.totalMsgs} msgs | ${c.pausado ? 'PAUSADO' : 'ativo'} | "${c.ultimoTexto}"`
      ).join('\n');
    }

    case 'ler_conversa': {
      const db = require('./database');
      const conv = db.getConv(input.agente, input.phone);
      const msgs = conv.msgs || [];
      if (!msgs.length) return `Nenhuma mensagem encontrada para ${input.phone}`;
      return msgs.slice(-40).map(m => {
        const ts = new Date(m.ts).toLocaleString('pt-BR');
        const quem = m.role === 'user' ? 'CLIENTE' : 'AGENTE';
        return `[${ts}] ${quem}: ${(m.text || '').slice(0, 300)}`;
      }).join('\n');
    }

    case 'enviar_mensagem_whatsapp': {
      try {
        const db = require('./database');
        const baileys = require('./baileys');
        const sessionId = CONFIG.sessionIds[input.agente];
        if (!sessionId) return `Agente ${input.agente} inválido`;
        const originalJid = db.state.phoneLidMap.get(input.phone) || null;
        await baileys.sendText(sessionId, input.phone, input.mensagem, originalJid);
        db.addMsg(input.agente, input.phone, 'assistant', input.mensagem);
        addGestorLog('send', `Jarvis enviou para ${input.phone} via ${input.agente}: ${input.mensagem.slice(0, 80)}`);
        return `Mensagem enviada para ${input.phone}`;
      } catch (e) {
        return `Erro ao enviar: ${e.message}`;
      }
    }

    case 'pausar_atendimento': {
      const db = require('./database');
      if (input.acao === 'pausar') {
        db.pausePhone(input.agente, input.phone);
      } else {
        db.resumePhone(input.agente, input.phone);
      }
      const acao = input.acao === 'pausar' ? 'Pausado' : 'Retomado';
      addGestorLog('control', `${acao} atendimento: ${input.phone} (${input.agente})`);
      return `Atendimento ${input.acao === 'pausar' ? 'pausado' : 'retomado'} para ${input.phone}`;
    }

    case 'atualizar_instrucao': {
      const db = require('./database');
      db.setInstrucao(input.agente, input.instrucao || '');
      addGestorLog('instrucao', `Instrução do agente ${input.agente} atualizada`);
      return `Instrução do agente ${input.agente} atualizada: "${(input.instrucao || '(limpa)').slice(0, 100)}"`;
    }

    case 'ver_pedidos_logzz': {
      const db = require('./database');
      const pedidos = db.getPedidos();
      if (!pedidos.length) return 'Nenhum pedido registrado';
      return pedidos.slice(0, input.limite || 20).map(p =>
        `${p.id} | ${p.nome || '?'} | ${p.phone} | ${p.status} | ${new Date(p.criadoEm).toLocaleDateString('pt-BR')}`
      ).join('\n');
    }

    case 'ver_resumo_financeiro': {
      const db = require('./database');
      const resumo = financas.getResumoMensal(db, input.mes);
      return financas.formatarResumo(resumo);
    }

    case 'registrar_transacao': {
      const db = require('./database');
      const entrada = financas.addTransacao(db, input);
      addGestorLog('financas', `Transação registrada: ${input.tipo} R$${input.valor} - ${input.descricao} (${input.quem})`);
      return `✅ ${input.tipo === 'receita' ? 'Receita' : 'Despesa'} registrada: R$${parseFloat(input.valor).toFixed(2)} — ${input.categoria} — ${input.descricao} (${input.quem}) — ID: ${entrada.id}`;
    }

    case 'analisar_gastos_desnecessarios': {
      const db = require('./database');
      const analise = await financas.analisarGastosDesnecessarios(db);
      return analise;
    }

    case 'listar_transacoes': {
      const db = require('./database');
      const tipo = input.tipo || 'todas';
      const limite = input.limite || 30;
      let transacoes = financas.getTransacoesMes(db, input.mes);
      if (tipo !== 'todas') transacoes = transacoes.filter(t => t.tipo === tipo);
      transacoes = transacoes.slice(0, limite);
      if (!transacoes.length) return 'Nenhuma transação registrada neste período';
      return transacoes.map(t =>
        `[${t.data}] ${t.tipo === 'receita' ? '💵' : '💸'} R$${t.valor.toFixed(2)} — ${t.categoria} — ${t.descricao} (${t.quem})`
      ).join('\n');
    }

    case 'definir_meta_economia': {
      const db = require('./database');
      db.state.financas.metas.economiasMensal = parseFloat(input.valor);
      db.saveDB().catch(() => {});
      addGestorLog('financas', `Meta de economia definida: R$${input.valor}/mês`);
      return `🎯 Meta de economia definida: R$${parseFloat(input.valor).toFixed(2)}/mês`;
    }

    case 'disparar_remarketing': {
      const db = require('./database');
      const baileys = require('./baileys');
      const { CONFIG } = require('./config');

      const agente = input.agente;
      const sessionId = CONFIG.sessionIds[agente];
      const convMap = db.state.conversations[agente];
      if (!convMap || convMap.size === 0) return `Nenhuma conversa encontrada para o agente ${agente}`;

      if (baileys.getState(sessionId) !== 'connected') return `Agente ${agente} não está conectado no WhatsApp`;

      const filtro = input.filtro || 'todos';
      const delayMs = Math.min(10, Math.max(1, input.delay_segundos || 3)) * 1000;
      const agora = Date.now();
      const VINTE_QUATRO_H = 24 * 60 * 60 * 1000;

      const alvos = [];
      for (const [phone, conv] of convMap.entries()) {
        if (db.isPaused(agente, phone)) continue;
        if (filtro === 'com_link' && !conv.linkEnviadoEm) continue;
        if (filtro === 'sem_link' && conv.linkEnviadoEm) continue;
        if (filtro === 'sem_resposta_24h') {
          const ultimaMsg = (conv.msgs || []).filter(m => m.role === 'user').at(-1);
          if (!ultimaMsg || (agora - new Date(ultimaMsg.ts || 0).getTime()) < VINTE_QUATRO_H) continue;
        }
        alvos.push({ phone, nome: conv.pushName || '' });
      }

      if (alvos.length === 0) return `Nenhum cliente encontrado com filtro "${filtro}"`;

      let enviados = 0;
      const erros = [];
      addGestorLog('remarketing', `Disparando remarketing para ${alvos.length} clientes do agente ${agente}`);

      for (const { phone, nome } of alvos) {
        try {
          const texto = input.mensagem.replace(/\{nome\}/gi, nome || 'amigo');
          const originalJid = db.state.phoneLidMap?.get(phone) || null;
          await baileys.sendText(sessionId, phone, texto, originalJid);
          db.addMsg(agente, phone, 'assistant', texto);
          enviados++;
          await new Promise(r => setTimeout(r, delayMs));
        } catch (e) {
          erros.push(`${phone}: ${e.message}`);
        }
      }

      const resumo = `Remarketing disparado: ${enviados}/${alvos.length} mensagens enviadas.${erros.length ? ` Erros (${erros.length}): ${erros.slice(0, 3).join('; ')}` : ''}`;
      addGestorLog('remarketing', resumo);
      sendTelegram(`📣 *Remarketing ${agente}*\n${resumo}`).catch(() => {});
      return resumo;
    }

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}

// ----- Telegram -----
async function sendTelegram(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) {
    console.warn('[GESTOR] Telegram não configurado (TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausente)');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { chat_id: chatId, text, parse_mode: 'Markdown' });
    return res.status === 200;
  } catch (e) {
    console.error('[GESTOR] Erro Telegram:', e.message);
    return false;
  }
}

// ----- GitHub Push -----
async function doPushGithub(commitMsg, arquivos) {
  const { token, repo } = CONFIG.github;
  if (!token || !repo) return 'GitHub não configurado (GITHUB_TOKEN ou GITHUB_REPO ausente)';

  try {
    const { Octokit } = require('@octokit/rest');
    const [owner, repoName] = repo.split('/');
    const octokit = new Octokit({ auth: token });

    // Buscar SHA da branch main
    const { data: refData } = await octokit.git.getRef({ owner, repo: repoName, ref: 'heads/main' });
    const baseSha = refData.object.sha;

    // Buscar tree base
    const { data: baseCommit } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: baseSha });
    const baseTreeSha = baseCommit.tree.sha;

    // Criar blobs para cada arquivo modificado
    const treeItems = [];
    for (const filePath of arquivos) {
      const absPath = path.resolve(ROOT_DIR, filePath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      const { data: blob } = await octokit.git.createBlob({ owner, repo: repoName, content, encoding: 'utf-8' });
      treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha });
    }

    if (treeItems.length === 0) return 'Nenhum arquivo válido para commit';

    // Criar nova tree
    const { data: newTree } = await octokit.git.createTree({ owner, repo: repoName, base_tree: baseTreeSha, tree: treeItems });

    // Criar commit
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo: repoName,
      message: `[Jarvis] ${commitMsg}`,
      tree: newTree.sha,
      parents: [baseSha],
    });

    // Atualizar branch
    await octokit.git.updateRef({ owner, repo: repoName, ref: 'heads/main', sha: newCommit.sha });

    addGestorLog('deploy', `Push realizado: ${commitMsg} (${treeItems.length} arquivos)`);
    return `✅ Push realizado com sucesso! Commit: ${newCommit.sha.slice(0, 7)} — Railway iniciará o deploy automaticamente.`;

  } catch (e) {
    addGestorLog('error', `Erro no push GitHub: ${e.message}`);
    return `Erro no push: ${e.message}`;
  }
}

// ----- System prompt do Gestor -----
function buildGestorSystemPrompt() {
  return `Você é JARVIS, o Gestor de Projetos inteligente do sistema Central Vendas.
Você é o CEO digital da operação — responsável por tudo que acontece no sistema.

## SUAS RESPONSABILIDADES
1. Responder dúvidas do Miron sobre vendas, marketing, estratégia
2. Ter visibilidade total: ver conversas, status dos agentes, pedidos, logs
3. Controlar agentes: pausar/retomar clientes, enviar mensagens, atualizar instruções
4. Detectar e corrigir bugs no código do sistema
5. Notificar o Miron no Telegram ANTES de qualquer deploy
6. Aguardar autorização para push no GitHub

## CONTROLE TOTAL DOS AGENTES
- Para ver conversas de um agente: use listar_conversas
- Para ler uma conversa específica: use ler_conversa (informe agente e phone)
- Para enviar mensagem para um cliente: use enviar_mensagem_whatsapp
- Para pausar/retomar atendimento automático: use pausar_atendimento
- Para mudar instrução do dono (ex: "hoje foque em conversão"): use atualizar_instrucao
- Para ver pedidos Logzz: use ver_pedidos_logzz
- Para disparar remarketing para a base (enviar mensagens de verdade): use disparar_remarketing — esta ferramenta envia as mensagens via WhatsApp de verdade. NUNCA use atualizar_instrucao como substituto de remarketing. Se o Miron pedir remarketing, use disparar_remarketing.

## FLUXO PARA CORREÇÕES DE CÓDIGO
1. Ler arquivos relevantes com ler_arquivo
2. Editar com editar_arquivo
3. Notificar Miron no Telegram com resumo + pedir autorização
4. Após autorização: fazer push_github

## REGRAS DE OURO
- NUNCA faz deploy sem autorização explícita do Miron
- Para ações nos agentes (pausar, enviar msg, instruções): executa imediatamente sem pedir autorização
- SEMPRE usa as ferramentas de verdade — nunca diz "fiz X" sem realmente ter executado
- Em erros críticos, notifica imediatamente no Telegram

## BASE DE CONHECIMENTO — VENDAS E MARKETING
${KNOWLEDGE_BASE}

## BASE DE CONHECIMENTO — FINANÇAS PESSOAIS (Warren Buffett, Ray Dalio, Charlie Munger, Dave Ramsey)
- "Pague a si mesmo primeiro" — separe poupança ANTES de gastar
- Juros compostos são a oitava maravilha — nunca interrompa
- Zero dívidas de consumo. Fundo de emergência é sagrado.
- Orçamento mensal escrito: todo real tem destino
- Ativo coloca dinheiro no bolso. Passivo tira.
- Gastos sem necessidade: delivery frequente, assinaturas esquecidas, compras por impulso, roupas sem necessidade
- Benchmarks saudáveis: Moradia ≤30%, Alimentação ≤15%, Poupança ≥20%

## CONTEXTO DO SISTEMA
- Sistema: Central Vendas (Node.js 20 + Express + Baileys + Claude)
- Agente Info-Produtos: vende cursos digitais Kiwify via WhatsApp
- Agente Logzz: vende produtos físicos COD (pago na entrega)
- Gestor: você mesmo — controla tudo
- Deploy: Railway via GitHub push automático
- Stack: Node.js, Express, @whiskeysockets/baileys v7, @anthropic-ai/sdk, ioredis
`;
}

// ----- API principal do Gestor -----
async function chat(userMessage) {
  addGestorChat('user', userMessage);

  const history = getGestorChat(30).map(m => ({ role: m.role, content: m.content }));

  // Garantir que termina com mensagem do usuário
  if (history.at(-1)?.role !== 'user') {
    history.push({ role: 'user', content: userMessage });
  }

  let response = await callClaude(buildGestorSystemPrompt(), history, {
    tools: GESTOR_TOOLS,
    maxTokens: 4096,
  });

  let finalText = '';
  // currentHistory acumula cada turno para que chamadas encadeadas de ferramentas mantenham contexto
  let currentHistory = [...history];

  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const textBlocks = response.content.filter(b => b.type === 'text');

    if (textBlocks.length > 0) finalText += textBlocks.map(b => b.text).join('\n');

    const results = [];
    for (const tu of toolUseBlocks) {
      console.log(`[JARVIS] Executando ferramenta: ${tu.name}`, JSON.stringify(tu.input).slice(0, 120));
      const result = await executeTool(tu.name, tu.input);
      console.log(`[JARVIS] Resultado de ${tu.name}: ${String(result).slice(0, 120)}`);
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: String(result),
      });
    }

    // Acumula turno no histórico (corrige bug onde iterações anteriores eram descartadas)
    currentHistory = [
      ...currentHistory,
      { role: 'assistant', content: response.content },
      { role: 'user', content: results },
    ];

    response = await callClaude(buildGestorSystemPrompt(), currentHistory, {
      tools: GESTOR_TOOLS,
      maxTokens: 4096,
    });
  }

  // Pegar texto final
  const finalBlocks = response.content.filter(b => b.type === 'text');
  finalText += finalBlocks.map(b => b.text).join('\n');

  addGestorChat('assistant', finalText);
  addGestorLog('chat', `Resposta gerada para: ${userMessage.slice(0, 80)}`);

  return finalText;
}

// ----- Scheduler de finanças -----
function initFinancasScheduler() {
  const { botToken, grupoFinancasId } = CONFIG.telegram;
  if (!botToken || !grupoFinancasId) return;

  const TelegramBot = require('node-telegram-bot-api');
  // Usa o mesmo token mas sem polling (já tem no listener)
  const bot = new TelegramBot(botToken);

  async function enviarGrupo(mensagem) {
    try {
      await bot.sendMessage(grupoFinancasId, mensagem, { parse_mode: 'Markdown' });
    } catch (_) {
      await bot.sendMessage(grupoFinancasId, mensagem);
    }
  }

  let ultimoDiario = '';
  let ultimoSemanal = '';
  let ultimoMensal = '';

  setInterval(async () => {
    try {
      // Hora BRT = UTC - 3
      const agora = new Date();
      const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
      const hora = brt.getHours();
      const min = brt.getMinutes();
      const diaSemana = brt.getDay(); // 0 = domingo
      const diaStr = brt.toISOString().slice(0, 10);
      const mesStr = brt.toISOString().slice(0, 7);
      const ultimoDiaMes = new Date(brt.getFullYear(), brt.getMonth() + 1, 0).getDate();
      const diaDoMes = brt.getDate();

      const db = require('./database');

      // Relatório diário às 22h BRT
      if (hora === 22 && min < 5 && ultimoDiario !== diaStr) {
        ultimoDiario = diaStr;
        const relatorio = financas.gerarRelatorioDiario(db);
        await enviarGrupo(relatorio);
        console.log('[JARVIS-FINANCAS] Relatório diário enviado');
      }

      // Relatório semanal domingo às 20h BRT
      if (diaSemana === 0 && hora === 20 && min < 5 && ultimoSemanal !== diaStr) {
        ultimoSemanal = diaStr;
        const relatorio = financas.gerarRelatorioSemanal(db);
        await enviarGrupo(relatorio);
        console.log('[JARVIS-FINANCAS] Relatório semanal enviado');
      }

      // Fechamento do mês — último dia às 21h BRT
      if (diaDoMes === ultimoDiaMes && hora === 21 && min < 5 && ultimoMensal !== mesStr) {
        ultimoMensal = mesStr;
        const relatorio = financas.gerarRelatorioFimMes(db);
        await enviarGrupo(relatorio);
        console.log('[JARVIS-FINANCAS] Relatório de fechamento enviado');
      }
    } catch (e) {
      console.error('[JARVIS-FINANCAS] Erro no scheduler:', e.message);
    }
  }, 60 * 1000); // verifica a cada minuto

  console.log('[JARVIS-FINANCAS] Scheduler ativo (diário 22h, semanal dom 20h, mensal último dia 21h)');
}

// ----- Telegram Listener -----
function initTelegramListener() {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) {
    console.warn('[JARVIS] Telegram listener não iniciado: variáveis ausentes');
    return;
  }

  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: true });

    bot.on('message', async (msg) => {
      const msgChatId = String(msg.chat.id);
      const texto = msg.text;
      if (!texto) return;

      // Grupo de finanças familiares
      if (CONFIG.telegram.grupoFinancasId && msgChatId === String(CONFIG.telegram.grupoFinancasId)) {
        const senderName = msg.from?.first_name || 'Desconhecido';
        console.log(`[JARVIS-FINANCAS] Grupo: ${senderName}: ${texto.slice(0, 80)}`);
        try {
          const db = require('./database');
          await financas.processarMensagemGrupo(texto, senderName, db, async (mensagem) => {
            try {
              await bot.sendMessage(msgChatId, mensagem, { parse_mode: 'Markdown' });
            } catch (_) {
              await bot.sendMessage(msgChatId, mensagem);
            }
          }, msgChatId);
        } catch (e) {
          console.error('[JARVIS-FINANCAS] Erro:', e.message);
        }
        return;
      }

      // Chat privado do Miron — comandos do gestor
      if (msgChatId !== String(chatId)) return;
      console.log(`[JARVIS] Telegram recebido: ${texto.slice(0, 80)}`);

      try {
        const resposta = await chat(texto);
        // Telegram limita 4096 chars por mensagem
        const partes = resposta.match(/[\s\S]{1,4000}/g) || [resposta];
        for (const parte of partes) {
          try {
            await bot.sendMessage(msg.chat.id, parte, { parse_mode: 'Markdown' });
          } catch (_) {
            await bot.sendMessage(msg.chat.id, parte);
          }
        }
      } catch (e) {
        console.error('[JARVIS] Erro ao processar mensagem Telegram:', e.message);
        try { await bot.sendMessage(msg.chat.id, `⚠️ Erro: ${e.message}`); } catch (_) {}
      }
    });

    let _pollingErrors = 0;
    bot.on('polling_error', (err) => {
      console.error('[JARVIS] Polling error:', err.message);
      _pollingErrors++;
      if (_pollingErrors >= 3) {
        _pollingErrors = 0;
        console.error('[JARVIS] Polling falhou 3x — reiniciando...');
        bot.stopPolling()
          .then(() => bot.startPolling())
          .catch(e => console.error('[JARVIS] Falha ao reiniciar polling:', e.message));
      }
    });

    console.log('[JARVIS] @jarvisistema_bot pronto para receber mensagens');
  } catch (e) {
    console.error('[JARVIS] Falha ao iniciar listener Telegram:', e.message);
  }
}

// ----- Monitor de erros em tempo real -----
function initErrorMonitor() {
  process.on('uncaughtException', async (error) => {
    const msg = `🚨 ERRO CRÍTICO: ${error.message}\n${error.stack?.slice(0, 500)}`;
    console.error('[JARVIS] Erro não capturado:', error);
    addGestorLog('error', msg);
    await sendTelegram(`🚨 *Central Vendas — Erro Crítico*\n\n${error.message}\n\nJarvis analisando e corrigindo...`);
  });

  process.on('unhandledRejection', async (reason) => {
    const msg = `⚠️ Promise rejeitada: ${String(reason).slice(0, 300)}`;
    console.error('[JARVIS] Promise rejeitada:', reason);
    addGestorLog('warning', msg);
  });

  initTelegramListener();
  initFinancasScheduler();
  console.log('[JARVIS] Monitor de erros ativo');
}

// ----- Relatório de saúde -----
async function healthCheck() {
  const checks = [];

  // Check agentes WhatsApp
  try {
    const baileys = require('./baileys');
    const status = baileys.getAllStatus();
    for (const [id, s] of Object.entries(status)) {
      checks.push(`${id}: ${s.state}`);
      if (s.state === 'disconnected') {
        addGestorLog('warning', `Agente ${id} desconectado`);
      }
    }
  } catch (e) {
    checks.push(`baileys: erro (${e.message})`);
  }

  return checks.join(' | ');
}

module.exports = { chat, sendTelegram, initErrorMonitor, healthCheck, addGestorLog };

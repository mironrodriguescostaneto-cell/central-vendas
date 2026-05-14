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
        caminho: { type: 'string', description: 'Caminho relativo ao root do projeto (ex: src/agents/info-produtos.js)' },
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
        aguardar_autorizacao: { type: 'boolean', description: 'Se true, aguarda resposta de autorização antes de continuar' },
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
        mensagem_commit: { type: 'string', description: 'Mensagem do commit descrevendo o que foi corrigido' },
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
    description: 'Verifica status de conexão e saúde dos agentes WhatsApp',
    input_schema: {
      type: 'object',
      properties: {},
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
2. Detectar e corrigir bugs automaticamente no sistema
3. Analisar o sistema em tempo real e reportar problemas
4. Notificar o Miron no Telegram ANTES de fazer qualquer deploy
5. Aguardar autorização do Miron para fazer push no GitHub
6. Salvar logs de tudo que acontece

## FLUXO OBRIGATÓRIO PARA DEPLOY
1. Identificar o problema/melhoria
2. Ler os arquivos relevantes com ler_arquivo
3. Editar os arquivos com editar_arquivo
4. Notificar o Miron no Telegram com RESUMO do que foi feito + pedir autorização
5. Aguardar o Miron dizer "pode fazer o deploy" ou "autorizado"
6. Fazer push_github com os arquivos modificados

## REGRAS DE OURO
- NUNCA faz deploy sem autorização explícita do Miron
- SEMPRE explica o que vai mudar antes de mudar
- SEMPRE salva logs de erros e correções
- Responde de forma direta e concisa
- Em erros críticos (sistema caiu), notifica imediatamente no Telegram

## BASE DE CONHECIMENTO
${KNOWLEDGE_BASE}

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
  const toolResults = [];

  // Loop de execução de ferramentas
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const textBlocks = response.content.filter(b => b.type === 'text');

    if (textBlocks.length > 0) finalText += textBlocks.map(b => b.text).join('\n');

    // Executar todas as ferramentas
    const results = [];
    for (const tu of toolUseBlocks) {
      console.log(`[JARVIS] Executando ferramenta: ${tu.name}`);
      const result = await executeTool(tu.name, tu.input);
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: String(result),
      });
    }

    // Continuar conversa com resultados
    const nextHistory = [
      ...history,
      { role: 'assistant', content: response.content },
      { role: 'user', content: results },
    ];

    response = await callClaude(buildGestorSystemPrompt(), nextHistory, {
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
      if (String(msg.chat.id) !== String(chatId)) return;
      const texto = msg.text;
      if (!texto) return;

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

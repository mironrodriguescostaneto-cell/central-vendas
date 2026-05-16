'use strict';

// Helper tolerante a espaços nos nomes de variáveis (bug do Railway)
function env(name, fallback = '') {
  const val = process.env[name] ?? process.env[name.trim()] ?? fallback;
  return typeof val === 'string' ? val.trim() : val;
}

const CONFIG = {
  port: parseInt(env('PORT', '3000')),
  dashboardPassword: env('DASHBOARD_PASSWORD', '1234'),
  jwtSecret: env('JWT_SECRET', 'central-vendas-secret-2026'),

  anthropicKey: env('ANTHROPIC_API_KEY'),
  geminiKey: env('GEMINI_API_KEY'),
  groqKey: env('GROQ_API_KEY'),
  redisUrl: env('REDIS_URL'),

  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
  },

  github: {
    token: env('GITHUB_TOKEN'),
    repo: env('GITHUB_REPO', 'mironrodriguescostaneto-cell/central-vendas'),
  },

  railway: {
    apiKey: env('RAILWAY_API_KEY'),
  },

  // Agentes de vendas
  agents: {
    info: {
      id: 'info',
      name: env('INFO_AGENT_NAME', 'Sofia'),
      numero: env('INFO_NUMERO'),
      provider: env('INFO_PROVIDER', 'baileys'),
      zapi: {
        instance: env('INFO_ZAPI_INSTANCE'),
        token: env('INFO_ZAPI_TOKEN'),
        clientToken: env('INFO_ZAPI_CLIENT_TOKEN'),
      },
      media: {
        foto1: env('INFO_FOTO1'),
        video1: env('INFO_VIDEO1'),
      },
      produtos: {
        principal: {
          nome: 'Curso Principal',
          link: env('INFO_PRODUTO_LINK', 'https://kiwify.app/ncJcJee'),
          preco: parseFloat(env('INFO_PRODUTO_PRECO', '297')),
        },
        downsell: {
          nome: 'Produto Downsell',
          link: env('INFO_DOWNSELL_LINK', 'https://kiwify.app/HJyLHa4'),
          preco: parseFloat(env('INFO_DOWNSELL_PRECO', '47')),
        },
      },
    },

    logzz: {
      id: 'logzz',
      name: env('LOGZZ_AGENT_NAME', 'Lucas'),
      numero: env('LOGZZ_NUMERO'),
      provider: env('LOGZZ_PROVIDER', 'baileys'),
      zapi: {
        instance: env('LOGZZ_ZAPI_INSTANCE'),
        token: env('LOGZZ_ZAPI_TOKEN'),
        clientToken: env('LOGZZ_ZAPI_CLIENT_TOKEN'),
      },
      media: {
        foto1: env('LOGZZ_FOTO1'),
        video1: env('LOGZZ_VIDEO1'),
      },
      logzzToken: env('LOGZZ_TOKEN'),
      produto: {
        nome: env('LOGZZ_PRODUTO_NOME', 'Produto COD'),
        preco: parseFloat(env('LOGZZ_PRODUTO_PRECO', '0')),
        piso: parseFloat(env('LOGZZ_PRODUTO_PISO', '0')),
      },
    },

    rafael: {
      id: 'rafael',
      name: env('RAFAEL_AGENT_NAME', 'Rafael'),
      numero: env('RAFAEL_NUMERO'),
      provider: env('RAFAEL_PROVIDER', 'baileys'),
    },
  },

  // IDs usados para controle de sessão Baileys
  sessionIds: {
    info: 'info-session',
    logzz: 'logzz-session',
    rafael: 'rafael-session',
  },
};

module.exports = { CONFIG, env };

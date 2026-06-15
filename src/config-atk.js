// ============================================================
// CONFIG-ATK — Shim de configuração para agentes Atacadão
// Mapeia env vars para o mesmo formato que o ATK usa
// ============================================================
'use strict';

function env(name, fallback = '') {
  if (process.env[name]) return process.env[name].trim();
  for (const key of Object.keys(process.env)) {
    if (key.trim() === name) return process.env[key].trim();
  }
  return fallback;
}

const CONFIG = {
  get ANTHROPIC_API_KEY() { return env('ANTHROPIC_API_KEY'); },
  get GEMINI_API_KEY()    { return env('GEMINI_API_KEY'); },
  get GROQ_API_KEY()      { return env('GROQ_API_KEY'); },
  get GITHUB_TOKEN()      { return env('GITHUB_TOKEN'); },
  get DASHBOARD_PASSWORD(){ return env('DASHBOARD_PASSWORD', '1234'); },

  SEU_WHATSAPP:    env('SEU_WHATSAPP', '5562991819645'),
  LARA_NUMERO:     env('LARA_NUMERO', '5562991819645'),
  GRUPO_PEDIDOS:   env('GRUPO_PEDIDOS', ''),
  DELAY_RESPOSTA:  parseInt(env('DELAY_RESPOSTA', '10000')),
  PORT:            parseInt(env('PORT', '3000')),

  CLAUDE_MODEL:      env('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
  GEMINI_MODEL:      env('GEMINI_MODEL', 'gemini-2.5-flash'),
  JARVIS_MODEL:      env('JARVIS_MODEL', 'claude-sonnet-4-20250514'),
  CLAUDE_MAX_TOKENS: parseInt(env('CLAUDE_MAX_TOKENS', '800')),
  CLAUDE_TIMEOUT:    parseInt(env('CLAUDE_TIMEOUT', '25000')),

  FREIGHT_MULTIPLIER: parseFloat(env('FREIGHT_MULTIPLIER', '2')),
  FREIGHT_MIN:        parseInt(env('FREIGHT_MIN', '15')),
  FREIGHT_MAX_KM:     parseInt(env('FREIGHT_MAX_KM', '30')),
  AUTO_SAVE_INTERVAL: parseInt(env('AUTO_SAVE_INTERVAL', '30000')),
  STORE_LAT:  parseFloat(env('STORE_LAT', '-16.6939')),
  STORE_LNG:  parseFloat(env('STORE_LNG', '-49.2648')),

  get EVOLUTION_API_URL() { return env('EVOLUTION_API_URL'); },
  get EVOLUTION_API_KEY() { return env('EVOLUTION_API_KEY'); },

  AGENTS: {
    pedro: {
      name: 'Pedro',
      product: 'Uni TV V10',
      price: 360,
      floorPrice: 340,
      get provider() { return env('PEDRO_PROVIDER', 'baileys'); },
      get numero()   { return env('PEDRO_NUMERO'); },
      get zapi()     { return { instance: env('PEDRO_ZAPI_INSTANCE'), token: env('PEDRO_ZAPI_TOKEN'), clientToken: env('PEDRO_ZAPI_CLIENT_TOKEN') }; },
      get media()    { return { foto1: env('PEDRO_FOTO1', 'https://drive.google.com/uc?export=download&id=1kcy56QgpZOi2jxExFkk8EvAMoAAqmvvP'), video1: env('PEDRO_VIDEO1', 'https://drive.google.com/uc?export=download&id=1LKyr7s9ozYguj7f3elJD7LZhUGeWNWPM'), audio1: env('PEDRO_AUDIO1') }; },
      pauseCmd:  'PEDRO_PARA',
      resumeCmd: 'PEDRO_INICIA',
    },
    rodrigo: {
      name: 'Rodrigo',
      product: 'Furadeira 48V',
      price: 160,
      floorPrice: 140,
      get provider() { return env('RODRIGO_PROVIDER', 'baileys'); },
      get numero()   { return env('RODRIGO_NUMERO'); },
      get zapi()     { return { instance: env('RODRIGO_ZAPI_INSTANCE'), token: env('RODRIGO_ZAPI_TOKEN'), clientToken: env('RODRIGO_ZAPI_CLIENT_TOKEN') }; },
      get media()    { return { foto1: env('RODRIGO_FOTO1', 'https://drive.google.com/uc?export=download&id=1HRoGVxHKA55L26V2DtV7KnB7aa3F47nZ'), video1: env('RODRIGO_VIDEO1', 'https://drive.google.com/uc?export=download&id=1VJkn1vPHf0Fd6u-KsbawMaxalgxccRBz'), audio1: env('RODRIGO_AUDIO1') }; },
      pauseCmd:  'RODRIGO_PARA',
      resumeCmd: 'RODRIGO_INICIA',
    },
  },

  validate() {
    const hasGemini = !!env('GEMINI_API_KEY');
    const hasAnthropic = !!env('ANTHROPIC_API_KEY');
    if (hasGemini && hasAnthropic) console.log('[ATK] ✅ AI: Gemini (principal) + Claude (fallback)');
    else if (hasGemini)    console.warn('[ATK] ⚠️  AI: Só Gemini — sem fallback Claude');
    else if (hasAnthropic) console.warn('[ATK] ⚠️  AI: Só Claude — sem Gemini');
    else console.error('[ATK] ❌ AI: Nenhum provider configurado');
  },
};

module.exports = CONFIG;

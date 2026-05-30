// ============================================================
// MIGRATE-ATK-DATA — Migração de dados do Atacadão
// Lê dados do Redis ATK (atacadao:db) e salva em formato
// compatível com database-atk.js na Central Vendas.
//
// Também migra sessões Baileys de pedro e rodrigo para o
// namespace da Central (baileys:cv:pedro:auth).
//
// USO: node scripts/migrate-atk-data.js
// ============================================================
'use strict';

require('dotenv').config();
const IORedis = require('ioredis');
const fs = require('fs');
const path = require('path');

const ATK_REDIS_KEY    = 'atacadao:db';
const ATK_PEDRO_AUTH   = 'baileys:pedro:auth';
const ATK_RODRIGO_AUTH = 'baileys:rodrigo:auth';
const CVN_PEDRO_AUTH   = 'baileys:cv:pedro:auth';
const CVN_RODRIGO_AUTH = 'baileys:cv:rodrigo:auth';

async function main() {
  const REDIS_URL = process.env.REDIS_URL || process.env.ATK_REDIS_URL;
  if (!REDIS_URL) {
    console.error('❌ REDIS_URL não configurada. Configure a URL do Redis no .env ou ambiente.');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   MIGRAÇÃO DE DADOS — ATK → Central Vendas   ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 15000 });
  redis.on('error', e => console.error('[REDIS] Erro:', e.message));

  try {
    // ── 1. Verificar se dados ATK existem no Redis ──────────
    console.log('🔍 Verificando dados ATK no Redis...');
    const atkRaw = await redis.get(ATK_REDIS_KEY);

    if (!atkRaw) {
      // Tentar backup local
      const backupDir = path.join(__dirname, '..', '..', 'backups-atacadao');
      const files = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.startsWith('backup-atacadao-db-')) : [];
      if (files.length === 0) {
        console.error('❌ Nenhum dado ATK encontrado no Redis nem em backups locais.');
        console.error('   Execute o backup primeiro: node C:/Users/Miron/atacadao-sistema/backup-redis.js');
        process.exit(1);
      }
      const latestBackup = path.join(backupDir, files.sort().at(-1));
      console.log(`⚠️  Redis vazio — usando backup local: ${latestBackup}`);
      const data = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
      await processData(data, redis);
    } else {
      console.log(`✅ Dados ATK encontrados no Redis (${(atkRaw.length / 1024).toFixed(1)} KB)`);
      const data = JSON.parse(atkRaw);
      await processData(data, redis);
    }

    // ── 2. Migrar sessões Baileys ───────────────────────────
    console.log('\n🔄 Migrando sessões Baileys...');
    for (const [srcKey, dstKey, agentId] of [
      [ATK_PEDRO_AUTH,   CVN_PEDRO_AUTH,   'Pedro'],
      [ATK_RODRIGO_AUTH, CVN_RODRIGO_AUTH, 'Rodrigo'],
    ]) {
      const existing = await redis.get(dstKey);
      if (existing) {
        console.log(`⏭️  ${agentId}: sessão já migrada (${dstKey} existe) — pulando`);
        continue;
      }
      const srcData = await redis.get(srcKey);
      if (srcData) {
        await redis.set(dstKey, srcData);
        console.log(`✅ ${agentId}: sessão migrada (${srcKey} → ${dstKey}) — não precisa re-escanear QR`);
      } else {
        console.log(`⚠️  ${agentId}: sessão não encontrada (${srcKey}) — precisará escanear QR no primeiro deploy`);
      }
    }

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ✅ MIGRAÇÃO CONCLUÍDA COM SUCESSO           ║');
    console.log('╚══════════════════════════════════════════════╝\n');

  } finally {
    await redis.quit();
  }
}

async function processData(data, redis) {
  // ── Estatísticas do dado de origem ──────────────────────
  function cnt(v) {
    if (!v) return 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  console.log('\n📊 DADOS A MIGRAR:');
  console.log(`   Conversas Pedro:    ${cnt(data.conversas_pedro)}`);
  console.log(`   Conversas Rodrigo:  ${cnt(data.conversas_rodrigo)}`);
  console.log(`   Pausados Pedro:     ${cnt(data.pausadosManuais_pedro)}`);
  console.log(`   Pausados Rodrigo:   ${cnt(data.pausadosManuais_rodrigo)}`);
  console.log(`   Vendas (CRM):       ${cnt(data.sales)}`);
  console.log(`   Pedidos:            ${cnt(data.pedidos)}`);
  console.log(`   Ofertas ativas:     ${cnt(data.activeOffers)}`);
  console.log(`   Caixas:             ${cnt(data.caixas)}`);
  console.log(`   Preço Pedro:        R$${data.agentCatalog?.pedro?.precoVenda || '?'}`);
  console.log(`   Preço Rodrigo:      R$${data.agentCatalog?.rodrigo?.precoVenda || '?'}`);

  // ── Verificar se já migrou (evitar sobrescrever) ─────────
  const existingAtk = await redis.get(ATK_REDIS_KEY);
  if (existingAtk) {
    const existing = JSON.parse(existingAtk);
    const existingPedroCnt = cnt(existing.conversas_pedro);
    const newPedroCnt = cnt(data.conversas_pedro);

    // Se já tem dados no mesmo formato e mesma quantidade, provavelmente já está migrado
    if (existingPedroCnt > 0 && existingPedroCnt === newPedroCnt) {
      console.log('\n⚠️  Os dados já parecem estar na chave atacadao:db.');
      console.log('   O database-atk.js lê diretamente desta chave — nenhuma ação necessária!');
      return;
    }
  }

  // ── Salvar no Redis (mesmo key que o database-atk.js lê) ──
  console.log('\n💾 Salvando dados no Redis (atacadao:db)...');
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  await redis.set(ATK_REDIS_KEY, json);

  // Verificar que salvou corretamente
  const verify = await redis.get(ATK_REDIS_KEY);
  if (!verify) {
    console.error('❌ Falha ao verificar dados salvos!');
    process.exit(1);
  }
  const verifyParsed = JSON.parse(verify);
  console.log(`✅ Dados salvos e verificados — Pedro: ${cnt(verifyParsed.conversas_pedro)} conversas | Rodrigo: ${cnt(verifyParsed.conversas_rodrigo)} conversas`);
}

main().catch(e => {
  console.error('❌ Erro na migração:', e.message);
  process.exit(1);
});

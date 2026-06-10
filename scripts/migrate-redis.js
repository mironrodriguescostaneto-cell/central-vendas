/**
 * Migração Redis: athletic-trust → crescimento-cortês
 *
 * Uso:
 *   node scripts/migrate-redis.js <REDIS_URL_NOVO>
 *
 * Exemplo:
 *   node scripts/migrate-redis.js redis://default:SENHA@host.railway.app:PORT
 */

const { createClient } = require('redis');

const OLD_REDIS_URL = 'redis://default:zWICbFUsIQwNBOcZHwgcnfAAAqxMPsLy@yamabiko.proxy.rlwy.net:54374';
const NEW_REDIS_URL = process.argv[2];

if (!NEW_REDIS_URL) {
  console.error('Uso: node scripts/migrate-redis.js <REDIS_URL_NOVO>');
  process.exit(1);
}

async function migrate() {
  console.log('🔌 Conectando ao Redis antigo...');
  const oldClient = createClient({ url: OLD_REDIS_URL });
  oldClient.on('error', e => console.error('Redis antigo erro:', e));
  await oldClient.connect();
  console.log('✅ Redis antigo conectado');

  console.log('🔌 Conectando ao Redis novo...');
  const newClient = createClient({ url: NEW_REDIS_URL });
  newClient.on('error', e => console.error('Redis novo erro:', e));
  await newClient.connect();
  console.log('✅ Redis novo conectado');

  // Listar todas as chaves
  console.log('\n📋 Listando chaves no Redis antigo...');
  const keys = await oldClient.keys('*');
  console.log(`   Encontradas ${keys.length} chaves: ${keys.join(', ')}`);

  if (keys.length === 0) {
    console.log('⚠️  Nenhuma chave encontrada no Redis antigo.');
    await oldClient.disconnect();
    await newClient.disconnect();
    return;
  }

  // Migrar cada chave
  let migrated = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      const type = await oldClient.type(key);
      console.log(`\n🔄 Migrando "${key}" (tipo: ${type})...`);

      if (type === 'string') {
        const value = await oldClient.get(key);
        const ttl = await oldClient.ttl(key);
        await newClient.set(key, value);
        if (ttl > 0) await newClient.expire(key, ttl);

      } else if (type === 'hash') {
        const value = await oldClient.hGetAll(key);
        if (Object.keys(value).length > 0) {
          await newClient.hSet(key, value);
        }

      } else if (type === 'list') {
        const value = await oldClient.lRange(key, 0, -1);
        if (value.length > 0) {
          await newClient.rPush(key, value);
        }

      } else if (type === 'set') {
        const value = await oldClient.sMembers(key);
        if (value.length > 0) {
          await newClient.sAdd(key, value);
        }

      } else if (type === 'zset') {
        const value = await oldClient.zRangeWithScores(key, 0, -1);
        if (value.length > 0) {
          const members = value.map(v => ({ score: v.score, value: v.value }));
          await newClient.zAdd(key, members);
        }
      }

      console.log(`   ✅ "${key}" migrada`);
      migrated++;
    } catch (err) {
      console.error(`   ❌ Falha em "${key}": ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log(`✅ Migradas: ${migrated}/${keys.length}`);
  if (failed > 0) console.log(`❌ Falhas: ${failed}`);
  console.log('========================================\n');

  // Verificar dados críticos no novo Redis
  console.log('🔍 Verificando dados no novo Redis...');
  const cvnDb = await newClient.get('central:db');
  const atkDb = await newClient.get('atacadao:db');

  if (cvnDb) {
    const parsed = JSON.parse(cvnDb);
    const convCount = Object.keys(parsed.conversations || {}).reduce((sum, agent) => {
      return sum + (Object.keys(parsed.conversations[agent] || {}).length);
    }, 0);
    console.log(`✅ CVN: ${convCount} conversas migradas`);
  } else {
    console.log('⚠️  CVN: chave central:db não encontrada');
  }

  if (atkDb) {
    const parsed = JSON.parse(atkDb);
    const pedroCt = Object.keys(parsed.conversations?.pedro || {}).length;
    const rodrigoCt = Object.keys(parsed.conversations?.rodrigo || {}).length;
    console.log(`✅ ATK: Pedro=${pedroCt} conversas, Rodrigo=${rodrigoCt} conversas`);
  } else {
    console.log('⚠️  ATK: chave atacadao:db não encontrada');
  }

  await oldClient.disconnect();
  await newClient.disconnect();
  console.log('\n🎉 Migração concluída!');
}

migrate().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

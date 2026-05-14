'use strict';

// Uso: node scripts/upload-session.js <agentId> <railwayUrl> <password>
// Ex:  node scripts/upload-session.js logzz https://central-vendas-production.up.railway.app 1234

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const [,, agentId, baseUrl, password] = process.argv;

if (!agentId || !baseUrl || !password) {
  console.error('Uso: node scripts/upload-session.js <agentId> <railwayUrl> <password>');
  process.exit(1);
}

const LOCAL_BASE = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp';
const sessionId = agentId === 'logzz' ? 'logzz-session' : 'info-session';
const authDir = path.join(LOCAL_BASE, `baileys_cv_${sessionId}`);

if (!fs.existsSync(authDir)) {
  console.error(`Diretório de sessão não encontrado: ${authDir}`);
  process.exit(1);
}

const files = {};
for (const file of fs.readdirSync(authDir)) {
  // Pular LID mappings — não são necessários para reconexão
  if (file.startsWith('lid-mapping')) continue;
  files[file] = fs.readFileSync(path.join(authDir, file)).toString('base64');
}

console.log(`Lidos ${Object.keys(files).length} arquivos de ${authDir}`);

const lib = baseUrl.startsWith('https') ? https : http;

function request(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (baseUrl.startsWith('https') ? 443 : 80),
      path: u.pathname,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Fazendo login em', baseUrl);
  const loginRes = await request(`${baseUrl}/api/login`, 'POST', { password });
  if (!loginRes.body.token) {
    console.error('Login falhou:', loginRes.body);
    process.exit(1);
  }
  const token = loginRes.body.token;
  console.log('Login OK. Enviando sessão...');

  const uploadRes = await request(
    `${baseUrl}/admin/upload-session`,
    'POST',
    { agentId, files },
    { Authorization: `Bearer ${token}` }
  );

  if (uploadRes.body.ok) {
    console.log(`✅ Upload concluído! ${uploadRes.body.filesWritten} arquivos enviados.`);
    console.log('O Railway vai reconectar automaticamente. Aguarde 10-15 segundos.');
  } else {
    console.error('❌ Erro no upload:', uploadRes.body);
  }
}

main().catch(console.error);

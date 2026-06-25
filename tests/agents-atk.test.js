'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const agents = require('../src/agents-atk');

test('lead sem texto legivel recebe abertura curta e deterministica', () => {
  const reply = agents.buildPedroInitialReply('[Cliente iniciou conversa pelo anuncio, mas o WhatsApp nao entregou texto legivel]');
  assert.equal(reply, 'Oi! Sou o Pedro. Trabalho com o Uni TV V10 por R$360. Quer que eu te mostre como ele funciona?');
  assert.ok(reply.length <= 160);
});

test('pergunta de instalacao responde apenas instalacao', () => {
  const reply = agents.buildPedroFaqReply('audit-install', 'Sim voce monta instalacao e vem ate a residencia?');
  assert.match(reply, /Nao fazemos instalacao na residencia/);
  assert.doesNotMatch(reply, /S10|ESPN|8K|garantia/);
});

test('pergunta generica de preco informa valor oficial do V10', () => {
  const reply = agents.buildPedroFaqReply('audit-price', '[Audio]: Quanto esta custando esse aparelho seu?');
  assert.equal(reply, 'O Uni TV V10 custa R$360 a vista.');
});

test('pergunta sobre outro modelo volta para V10 unico', () => {
  const reply = agents.buildPedroFaqReply('audit-second-price', '[Audio]: Tem um de 360 e o outro de quanto?');
  assert.match(reply, /R\$360/);
  assert.doesNotMatch(reply, /R\$400/);
  assert.doesNotMatch(reply, /S10/);
});

test('preco inventado e corrigido para V10', () => {
  const repaired = agents.repairPedroCatalogPrices(
    'audit-repair',
    'Quanto custa?',
    'O V10 fica R$360 e o S10 preto fica R$40'
  );
  assert.equal(repaired, 'O Uni TV V10 custa R$360 a vista.');
});

test('precos oficiais nao sao alterados', () => {
  const response = 'O Uni TV V10 custa R$360 a vista.';
  assert.equal(agents.repairPedroCatalogPrices('audit-valid', 'Obrigado', response), response);
});

test('preco sem nome do produto usa V10 unico', () => {
  agents.rememberPedroProductChoice('audit-selected-v10', 'Quero o V10');
  const repaired = agents.repairPedroCatalogPrices('audit-selected-v10', 'E o valor?', 'Fica R$40 a vista.');
  assert.match(repaired, /R\$360/);
  assert.doesNotMatch(repaired, /R\$40\b/);
});

test('respostas cortadas sao rejeitadas', () => {
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-1', 'Quanto custa?', 'O V10 fica R$36'), false);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-2', 'O aparelho funciona?', 'O Uni TV V10 e o modelo que'), false);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-3', 'Obrigada', 'Entendi! Voce esta pesquisando, ne? Pra'), false);
});

test('respostas seguras satisfazem a intencao', () => {
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-ok-price', 'Quanto custa?', 'O Uni TV V10 custa R$360 a vista.'), true);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-ok-install', 'Voce instala na residencia?', 'Nao fazemos instalacao na residencia. O aparelho vai configurado.'), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const agents = require('../src/agents-atk');

test('lead sem texto legivel recebe abertura curta e deterministica', () => {
  const reply = agents.buildPedroInitialReply('[Cliente iniciou conversa pelo anuncio, mas o WhatsApp nao entregou texto legivel]');
  assert.equal(reply, 'Oi! Sou o Pedro. Tenho o V10 por R$360 e o novo S10 por R$400. Quer ver o tradicional ou o lancamento?');
  assert.ok(reply.length <= 160);
});

test('pergunta de instalacao responde apenas instalacao', () => {
  const reply = agents.buildPedroFaqReply('audit-install', 'Sim voce monta instalacao e vem ate a residencia?');
  assert.match(reply, /Nao fazemos instalacao na residencia/);
  assert.doesNotMatch(reply, /S10|ESPN|8K|garantia/);
});

test('pergunta generica de preco informa os dois valores oficiais', () => {
  const reply = agents.buildPedroFaqReply('audit-price', '[Audio]: Quanto esta custando esse aparelho seu?');
  assert.equal(reply, 'O V10 custa R$360 e o S10 preto custa R$400 a vista.');
});

test('pergunta sobre segundo modelo preserva R$400', () => {
  const reply = agents.buildPedroFaqReply('audit-second-price', '[Audio]: Tem um de 360 e o outro de quanto?');
  assert.match(reply, /R\$360/);
  assert.match(reply, /R\$400/);
});

test('preco S10 de dois digitos e corrigido antes do envio', () => {
  const repaired = agents.repairPedroCatalogPrices(
    'audit-repair',
    'Quanto custa?',
    'O V10 fica R$360 e o S10 preto fica R$40'
  );
  assert.equal(repaired, 'O V10 custa R$360 e o S10 preto custa R$400 a vista.');
});

test('precos oficiais nao sao alterados', () => {
  const response = 'O V10 custa R$360 e o S10 preto custa R$400 a vista.';
  assert.equal(agents.repairPedroCatalogPrices('audit-valid', 'Obrigado', response), response);
});

test('preco sem nome do produto usa o modelo selecionado', () => {
  agents.rememberPedroProductChoice('audit-selected-s10', 'Quero o S10');
  const repaired = agents.repairPedroCatalogPrices('audit-selected-s10', 'E o valor?', 'Fica R$40 a vista.');
  assert.match(repaired, /R\$400/);
  assert.doesNotMatch(repaired, /R\$40\b/);
});

test('respostas cortadas sao rejeitadas', () => {
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-1', 'Quanto custa?', 'O V10 fica R$360 e o S10 preto fica R$40'), false);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-2', 'O outro custa quanto?', 'O V10 custa R$360. O S10 preto e o modelo novo'), false);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-3', 'Obrigada', 'Entendi! Voce esta pesquisando, ne? Pra'), false);
});

test('respostas seguras satisfazem a intencao', () => {
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-ok-price', 'Quanto custa?', 'O V10 custa R$360 e o S10 preto custa R$400 a vista.'), true);
  assert.equal(agents.isAgentResponseComplete('pedro', 'audit-ok-install', 'Voce instala na residencia?', 'Nao fazemos instalacao na residencia. O aparelho vai configurado.'), true);
});

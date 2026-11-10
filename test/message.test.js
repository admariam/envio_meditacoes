import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyMessage } from '../src/shared/message.js';

test('monta a mensagem no formato exigido e calcula o dia da semana', () => {
  const message = buildDailyMessage({
    date: '2026-11-30',
    title: 'Título da meditação',
    url: 'https://exemplo.com/meditacao.html'
  });
  assert.equal(
    message,
    'Segunda-feira, 30/11/2026\nTítulo da meditação\nhttps://exemplo.com/meditacao.html'
  );
});

test('não usa dia da semana fornecido no texto importado', () => {
  const record = {
    date: '2026-12-05',
    title: 'Sábado',
    url: 'https://exemplo.com/sabado.html',
    weekday: 'Segunda'
  };
  assert.match(buildDailyMessage(record), /^Sábado, 05\/12\/2026\n/);
});

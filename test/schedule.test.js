import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissingDates,
  parseScheduleText,
  serializeScheduleJson,
  serializeScheduleTxt,
  validateScheduleJson
} from '../src/shared/schedule.js';
import { readFixture } from './helpers.js';

test('importa o formato do arquivo de exemplo', async () => {
  const text = await readFixture('exemplo-valido.txt');
  const parsed = parseScheduleText(text, { sourceName: 'exemplo-valido.txt' });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.duplicates.length, 0);
  assert.equal(parsed.records.length, 5);
  assert.deepEqual(parsed.records[0], {
    date: '2026-11-30',
    title: 'Título da meditação 1',
    url: 'https://exemplo.com/meditacao-01.html'
  });
});

test('aponta erros por linha e não descarta silenciosamente', async () => {
  const text = await readFixture('invalido.txt');
  const parsed = parseScheduleText(text);
  assert.equal(parsed.records.length, 0);
  const byLine = new Map(parsed.errors.map((error) => [error.line, error.code]));
  assert.equal(byLine.get(1), 'DATA_INVALIDA');
  assert.equal(byLine.get(2), 'URL_INVALIDA');
  assert.equal(byLine.get(3), 'TITULO_AUSENTE');
  assert.equal(byLine.get(4), 'FORMATO_INVALIDO');
  assert.equal(byLine.get(5), 'DATA_META_DIVERGENTE');
});

test('detecta datas duplicadas e informa as duas linhas', async () => {
  const text = await readFixture('duplicado.txt');
  const parsed = parseScheduleText(text);
  assert.equal(parsed.duplicates.length, 1);
  assert.deepEqual(parsed.duplicates[0].lines, [1, 2]);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.errors.filter((error) => error.code === 'DATA_DUPLICADA').length, 2);
});

test('recalcula o dia da semana e avisa quando o texto importado diverge', () => {
  const parsed = parseScheduleText(
    '2026-11-30  https://exemplo.com/x.html  (Terça · 30/11 · Título)\n'
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings[0].code, 'DIA_SEMANA_INCORRETO');
});

test('preserva separador no título após os dois primeiros campos', () => {
  const parsed = parseScheduleText(
    '2026-11-30  https://exemplo.com/x.html  (Segunda · 30/11 · Título · parte 2)\n'
  );
  assert.equal(parsed.records[0].title, 'Título · parte 2');
});

test('encontra datas faltantes no intervalo informado', () => {
  const records = [
    { date: '2026-11-30', title: 'A', url: 'https://exemplo.com/a' },
    { date: '2026-12-02', title: 'C', url: 'https://exemplo.com/c' }
  ];
  assert.deepEqual(findMissingDates(records, '2026-11-30', '2026-12-02'), ['2026-12-01']);
});

test('exporta TXT legível e JSON privado com round-trip', async () => {
  const text = await readFixture('exemplo-valido.txt');
  const parsed = parseScheduleText(text);
  const txt = serializeScheduleTxt(parsed.records);
  const roundTrip = parseScheduleText(txt);
  assert.deepEqual(roundTrip.records, parsed.records);
  const json = serializeScheduleJson(parsed.records);
  const fromJson = validateScheduleJson(json);
  assert.equal(fromJson.errors.length, 0);
  assert.deepEqual(fromJson.records, parsed.records);
});

test('validação de JSON aponta duplicidades e registros inválidos', () => {
  const result = validateScheduleJson({
    records: [
      { date: '2026-12-01', title: 'A', url: 'https://exemplo.com/a' },
      { date: '2026-12-01', title: 'B', url: 'https://exemplo.com/b' },
      { date: '2026-02-30', title: '', url: 'javascript:alert(1)' }
    ]
  });
  assert.ok(result.errors.some((error) => error.code === 'DATA_DUPLICADA'));
  assert.ok(result.errors.some((error) => error.code === 'DATA_INVALIDA'));
  assert.ok(result.errors.some((error) => error.code === 'URL_INVALIDA'));
});

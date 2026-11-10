import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateBr,
  getLocalDate,
  getSendWindow,
  getZonedParts,
  parseIsoDate,
  parseTime,
  weekdayLongPt,
  weekdayShortPt,
  enumerateDates
} from '../src/shared/dates.js';

test('valida datas ISO reais', () => {
  assert.equal(parseIsoDate('2026-11-30').iso, '2026-11-30');
  assert.equal(parseIsoDate('2024-02-29').iso, '2024-02-29');
  assert.equal(parseIsoDate('2026-02-29'), null);
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('30/11/2026'), null);
});

test('calcula dia da semana em português a partir da data', () => {
  assert.equal(weekdayLongPt('2026-11-30'), 'Segunda-feira');
  assert.equal(weekdayShortPt('2026-11-30'), 'Segunda');
  assert.equal(weekdayLongPt('2026-12-05'), 'Sábado');
  assert.equal(weekdayLongPt('2026-12-06'), 'Domingo');
  assert.equal(formatDateBr('2026-11-30'), '30/11/2026');
});

test('converte instante para data e hora em America/Sao_Paulo', () => {
  assert.equal(getLocalDate(new Date('2026-11-30T08:59:59Z'), 'America/Sao_Paulo'), '2026-11-30');
  assert.equal(getZonedParts(new Date('2026-11-30T09:00:00Z'), 'America/Sao_Paulo').hour, 6);
  assert.equal(getZonedParts(new Date('2026-11-30T09:00:00Z'), 'America/Sao_Paulo').minute, 0);
});

test('respeita mudança de horário oficial', () => {
  const parts = getZonedParts(new Date('2026-03-08T07:00:00Z'), 'America/New_York');
  assert.equal(parts.hour, 3);
  assert.equal(parts.date, '2026-03-08');
});

test('calcula janela de envio e atraso', () => {
  const before = getSendWindow(new Date('2026-11-30T08:59:00Z'), 'America/Sao_Paulo', '06:00', 180);
  assert.equal(before.status, 'before');
  const ok = getSendWindow(new Date('2026-11-30T09:00:00Z'), 'America/Sao_Paulo', '06:00', 180);
  assert.equal(ok.status, 'ok');
  const late = getSendWindow(new Date('2026-11-30T13:00:00Z'), 'America/Sao_Paulo', '06:00', 180);
  assert.equal(late.status, 'late');
});

test('interpreta horário e enumera datas', () => {
  assert.deepEqual(parseTime('06:00'), { hour: 6, minute: 0, minutes: 360 });
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime('6:00'), null);
  assert.deepEqual(enumerateDates('2026-11-30', '2026-12-02'), ['2026-11-30', '2026-12-01', '2026-12-02']);
});

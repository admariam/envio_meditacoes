import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGroupId, maskGroupId, validateConfig } from '../src/shared/config.js';
import { GROUP_A, GROUP_B, makeConfig } from './helpers.js';

test('aceita configuração com dois grupos e padrões', () => {
  const result = validateConfig(makeConfig());
  assert.equal(result.ok, true);
  assert.equal(result.config.timezone, 'America/Sao_Paulo');
  assert.equal(result.config.sendTime, '06:00');
  assert.equal(result.config.groups.length, 2);
});

test('rejeita contatos, convites e IDs inválidos', () => {
  assert.equal(isValidGroupId(GROUP_A), true);
  assert.equal(isValidGroupId('5511999999999@s.whatsapp.net'), false);
  assert.equal(isValidGroupId('https://chat.whatsapp.com/abc'), false);
  const result = validateConfig(
    makeConfig({
      groups: [
        { id: GROUP_A, label: 'A' },
        { id: '5511999999999@s.whatsapp.net', label: 'Contato' }
      ]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'GRUPO_ID_INVALIDO'));
});

test('rejeita menos de dois grupos e IDs duplicados', () => {
  const one = validateConfig(makeConfig({ groups: [{ id: GROUP_A, label: 'A' }] }));
  assert.ok(one.errors.some((error) => error.code === 'POUCOS_GRUPOS'));
  const duplicate = validateConfig(
    makeConfig({
      groups: [
        { id: GROUP_A, label: 'A' },
        { id: GROUP_A, label: 'B' }
      ]
    })
  );
  assert.ok(duplicate.errors.some((error) => error.code === 'GRUPO_DUPLICADO'));
});

test('valida horário, fuso e janela', () => {
  const result = validateConfig(
    makeConfig({ sendTime: '25:00', timezone: 'Marte/Olympus', maxDelayMinutes: 999 })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'HORARIO_INVALIDO'));
  assert.ok(result.errors.some((error) => error.code === 'FUSO_INVALIDO'));
  assert.ok(result.errors.some((error) => error.code === 'JANELA_INVALIDA'));
});

test('mascara ID de grupo sem expor o valor completo', () => {
  const masked = maskGroupId(GROUP_A);
  assert.notEqual(masked, GROUP_A);
  assert.ok(masked.endsWith('@g.us'));
  assert.ok(!masked.includes('0000000000'));
});

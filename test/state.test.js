import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  getDelivery,
  markFailed,
  markSending,
  markSent,
  markUnknown,
  summarizeState,
  validateState
} from '../src/lib/state.js';
import { GROUP_A, GROUP_B } from './helpers.js';
import { groupFingerprint } from '../src/lib/identity.js';

test('identificador de grupo é estável e não expõe o JID', () => {
  const id = groupFingerprint(GROUP_A);
  assert.equal(id, groupFingerprint(GROUP_A));
  assert.notEqual(id, groupFingerprint(GROUP_B));
  assert.equal(id.length, 16);
  assert.ok(!id.includes('@'));
});

test('registra tentativa, sucesso, falha e estado incerto', () => {
  const state = emptyState();
  const fingerprint = groupFingerprint(GROUP_A);
  const group = { id: GROUP_A, label: 'Grupo A' };
  markSending(state, '2026-11-30', group, fingerprint, '2026-11-30T09:00:00.000Z');
  assert.equal(getDelivery(state, '2026-11-30', fingerprint).status, 'sending');
  markSent(state, '2026-11-30', group, fingerprint, '2026-11-30T09:00:05.000Z', 'msg-1');
  assert.equal(getDelivery(state, '2026-11-30', fingerprint).status, 'sent');
  markFailed(state, '2026-11-30', group, fingerprint, '2026-11-30T09:01:00.000Z', {
    code: 'SEND_FAILED',
    message: 'Falha 120363000000000001@g.us'
  });
  assert.equal(getDelivery(state, '2026-11-30', fingerprint).status, 'failed');
  assert.ok(!getDelivery(state, '2026-11-30', fingerprint).lastError.message.includes(GROUP_A));
  markUnknown(state, '2026-11-30', group, fingerprint, '2026-11-30T09:02:00.000Z', {
    code: 'ACK_TIMEOUT',
    message: 'incerto'
  });
  assert.equal(getDelivery(state, '2026-11-30', fingerprint).status, 'unknown');
});

test('estado inválido falha de forma segura', () => {
  assert.throws(() => validateState({ version: 1, runs: [] }), /deliveries/);
  assert.throws(
    () =>
      validateState({
        version: 1,
        deliveries: {
          '2026-11-30': {
            abc: { status: 'sent', attempts: 1, label: 'X' }
          }
        },
        runs: []
      }),
    /identificador/
  );
  assert.throws(
    () =>
      validateState({
        version: 1,
        deliveries: {
          '2026-11-30': {
            '0123456789abcdef': { status: 'sent', attempts: 1, label: 'X', messageId: '' }
          }
        },
        runs: []
      }),
    /sem confirmação/
  );
});

test('resume contagens do estado', () => {
  const state = emptyState();
  const group = { id: GROUP_A, label: 'A' };
  const fingerprint = groupFingerprint(GROUP_A);
  markSent(state, '2026-11-30', group, fingerprint, '2026-11-30T09:00:00.000Z', 'msg');
  assert.deepEqual(summarizeState(state).counts, { sent: 1, failed: 0, unknown: 0, sending: 0 });
});

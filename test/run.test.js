import test from 'node:test';
import assert from 'node:assert/strict';
import { runDaily } from '../src/lib/run.js';
import { MemoryStateStore } from '../src/lib/state-store.js';
import { getDelivery, hasRunWithReason } from '../src/lib/state.js';
import { groupFingerprint } from '../src/lib/identity.js';
import { StateError } from '../src/lib/errors.js';
import { FakeWhatsApp, GROUP_A, GROUP_B, makeConfig, makeRecord, makeSchedule } from './helpers.js';

const DATE = '2026-11-30';
const NOW = new Date('2026-11-30T09:00:00Z');
const MESSAGE = 'Segunda-feira, 30/11/2026\nMeditação de 2026-11-30\nhttps://exemplo.com/2026-11-30.html';

test('envia uma vez por grupo e não reenvia em execução agendada posterior', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp();
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord(DATE)]);
  const first = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(first.outcome, 'sent_all');
  assert.equal(first.counts.sent, 2);
  assert.equal(whatsapp.sent.length, 2);
  assert.deepEqual(whatsapp.sent.map((item) => item.text), [MESSAGE, MESSAGE]);
  assert.equal(whatsapp.sent[0].groupId, GROUP_A);
  assert.equal(whatsapp.sent[1].groupId, GROUP_B);
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_A)).status, 'sent');
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_B)).status, 'sent');

  const second = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(second.outcome, 'already_attempted');
  assert.equal(whatsapp.sent.length, 2);
  assert.equal(whatsapp.connectCalls, 1);
});

test('não envia antes da janela e não grava estado', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp();
  const result = await runDaily({
    config: makeConfig(),
    schedule: makeSchedule([makeRecord(DATE)]),
    stateStore,
    whatsapp,
    now: new Date('2026-11-30T08:59:00Z'),
    scheduled: true,
    dryRun: false
  });
  assert.equal(result.outcome, 'before_window');
  assert.equal(whatsapp.connectCalls, 0);
  assert.equal(stateStore.saves, 0);
});

test('registra janela perdida uma vez e não envia', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp();
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord(DATE)]);
  const first = await runDaily({
    config,
    schedule,
    stateStore,
    whatsapp,
    now: new Date('2026-11-30T13:00:00Z'),
    scheduled: true,
    dryRun: false
  });
  assert.equal(first.outcome, 'missed_window');
  assert.equal(whatsapp.connectCalls, 0);
  assert.equal(hasRunWithReason(stateStore.state, DATE, 'MISSED_WINDOW'), true);
  const second = await runDaily({
    config,
    schedule,
    stateStore,
    whatsapp,
    now: new Date('2026-11-30T14:00:00Z'),
    scheduled: true,
    dryRun: false
  });
  assert.equal(second.outcome, 'already_recorded');
  assert.equal(stateStore.state.runs.length, 1);
});

test('data sem registro não envia e registra o motivo', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp();
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord('2026-12-01')]);
  const first = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(first.outcome, 'not_scheduled');
  assert.equal(whatsapp.sent.length, 0);
  assert.equal(hasRunWithReason(stateStore.state, DATE, 'NOT_SCHEDULED'), true);
  const second = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(second.outcome, 'already_recorded');
  assert.equal(stateStore.state.runs.length, 1);
});

test('falha em um grupo permite retry somente do grupo com falha', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp({ failFor: [GROUP_B] });
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord(DATE)]);
  const first = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(first.outcome, 'partial');
  assert.equal(first.exitCode, 1);
  assert.equal(whatsapp.sent.length, 1);
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_A)).status, 'sent');
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_B)).status, 'failed');

  const second = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(second.outcome, 'already_attempted');
  assert.equal(whatsapp.sent.length, 1);

  whatsapp.failFor.delete(GROUP_B);
  const retry = await runDaily({
    config,
    schedule,
    stateStore,
    whatsapp,
    now: NOW,
    scheduled: false,
    manual: true,
    targetDate: DATE,
    retryFailed: true,
    dryRun: false
  });
  assert.equal(retry.outcome, 'sent_all');
  assert.equal(retry.counts.sent, 1);
  assert.equal(retry.counts.alreadySent, 1);
  assert.equal(whatsapp.sent.length, 2);
  assert.equal(whatsapp.sent[1].groupId, GROUP_B);
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_A)).attempts, 1);
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_B)).attempts, 2);
});

test('ack incerto não é considerado sucesso e pode ser repetido manualmente', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp({ ackTimeoutFor: [GROUP_A] });
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord(DATE)]);
  const first = await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  assert.equal(first.outcome, 'partial');
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_A)).status, 'unknown');
  assert.equal(getDelivery(stateStore.state, DATE, groupFingerprint(GROUP_B)).status, 'sent');

  whatsapp.ackTimeoutFor.delete(GROUP_A);
  const retry = await runDaily({
    config,
    schedule,
    stateStore,
    whatsapp,
    now: NOW,
    scheduled: false,
    manual: true,
    targetDate: DATE,
    retryFailed: true,
    dryRun: false
  });
  assert.equal(retry.outcome, 'sent_all');
  assert.equal(retry.counts.sent, 1);
  assert.equal(whatsapp.sent.length, 2);
});

test('dry-run monta a prévia e nunca conecta, envia ou grava estado', async () => {
  const stateStore = new MemoryStateStore();
  const forbidden = {
    connect: () => {
      throw new Error('conexão proibida em dry-run');
    },
    sendToGroup: () => {
      throw new Error('envio proibido em dry-run');
    },
    close: () => {
      throw new Error('fechamento proibido em dry-run');
    }
  };
  const result = await runDaily({
    config: makeConfig(),
    schedule: makeSchedule([makeRecord(DATE)]),
    stateStore,
    whatsapp: forbidden,
    now: NOW,
    scheduled: false,
    manual: true,
    targetDate: DATE,
    dryRun: true
  });
  assert.equal(result.outcome, 'dry_run');
  assert.equal(result.messagePreview, MESSAGE);
  assert.equal(result.groups.length, 2);
  assert.equal(stateStore.saves, 0);
  assert.equal(stateStore.state.deliveries[DATE], undefined);
});

test('dry-run para data sem registro informa e não grava', async () => {
  const stateStore = new MemoryStateStore();
  const result = await runDaily({
    config: makeConfig(),
    schedule: makeSchedule([]),
    stateStore,
    whatsapp: null,
    now: NOW,
    scheduled: false,
    manual: true,
    targetDate: DATE,
    dryRun: true
  });
  assert.equal(result.outcome, 'not_scheduled');
  assert.equal(stateStore.saves, 0);
});

test('não envia se o estado não puder ser gravado antes do envio', async () => {
  const stateStore = new MemoryStateStore();
  stateStore.save = async () => {
    throw new StateError('falha simulada de gravação');
  };
  const whatsapp = new FakeWhatsApp();
  await assert.rejects(
    () =>
      runDaily({
        config: makeConfig(),
        schedule: makeSchedule([makeRecord(DATE)]),
        stateStore,
        whatsapp,
        now: NOW,
        scheduled: true,
        dryRun: false
      }),
    /gravação|registrar/
  );
  assert.equal(whatsapp.sent.length, 0);
  assert.equal(whatsapp.closeCalls, 1);
});

test('envio agendado posterior não transforma sucesso em janela perdida', async () => {
  const stateStore = new MemoryStateStore();
  const whatsapp = new FakeWhatsApp();
  const config = makeConfig();
  const schedule = makeSchedule([makeRecord(DATE)]);
  await runDaily({ config, schedule, stateStore, whatsapp, now: NOW, scheduled: true, dryRun: false });
  const late = await runDaily({
    config,
    schedule,
    stateStore,
    whatsapp,
    now: new Date('2026-11-30T13:00:00Z'),
    scheduled: true,
    dryRun: false
  });
  assert.equal(late.outcome, 'already_attempted');
  assert.equal(whatsapp.sent.length, 2);
});

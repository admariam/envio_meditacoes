import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AckTimeoutError, SendError } from '../src/lib/errors.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export async function readFixture(name) {
  return readFile(path.join(dirname, 'fixtures', name), 'utf8');
}

export const GROUP_A = '120363000000000001@g.us';
export const GROUP_B = '120363000000000002@g.us';

export function makeConfig(overrides = {}) {
  return {
    version: 1,
    timezone: 'America/Sao_Paulo',
    sendTime: '06:00',
    maxDelayMinutes: 180,
    groups: [
      { id: GROUP_A, label: 'Grupo A' },
      { id: GROUP_B, label: 'Grupo B' }
    ],
    schedulePeriod: null,
    requireAck: false,
    ackTimeoutSeconds: 30,
    sendDelayMs: 0,
    ...overrides
  };
}

export function makeSchedule(records) {
  return { records, errors: [], warnings: [], duplicates: [], stats: {} };
}

export function makeRecord(date = '2026-11-30', overrides = {}) {
  return {
    date,
    title: `Meditação de ${date}`,
    url: `https://exemplo.com/${date}.html`,
    ...overrides
  };
}

export class FakeWhatsApp {
  constructor({ failFor = [], ackTimeoutFor = [] } = {}) {
    this.failFor = new Set(failFor);
    this.ackTimeoutFor = new Set(ackTimeoutFor);
    this.connectCalls = 0;
    this.closeCalls = 0;
    this.sent = [];
  }

  async connect() {
    this.connectCalls += 1;
  }

  async sendToGroup(groupId, text) {
    if (this.failFor.has(groupId)) throw new SendError('SEND_FAILED', 'Falha simulada de envio.');
    if (this.ackTimeoutFor.has(groupId)) throw new AckTimeoutError(`fake-${this.sent.length + 1}`);
    const messageId = `fake-message-${this.sent.length + 1}`;
    this.sent.push({ groupId, text, messageId });
    return { messageId, ackStatus: null };
  }

  async close() {
    this.closeCalls += 1;
  }
}

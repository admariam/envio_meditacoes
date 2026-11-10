import { isValidIsoDate } from '../shared/dates.js';
import { safeError } from './errors.js';
import { StateError } from './errors.js';

export const DELIVERY_STATUSES = new Set(['sending', 'sent', 'failed', 'unknown']);

export function emptyState() {
  return {
    version: 1,
    updatedAt: null,
    deliveries: {},
    runs: []
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new StateError('Estado de envios inválido.');
  }
  if (state.version !== 1) {
    throw new StateError('Versão de estado não suportada.');
  }
  if (!state.deliveries || typeof state.deliveries !== 'object' || Array.isArray(state.deliveries)) {
    throw new StateError('Estado de envios sem "deliveries" válido.');
  }
  if (!Array.isArray(state.runs)) {
    throw new StateError('Estado de envios sem "runs" válido.');
  }
  for (const [date, groups] of Object.entries(state.deliveries)) {
    if (!isValidIsoDate(date)) throw new StateError('Estado contém data inválida.');
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
      throw new StateError('Estado contém entregas inválidas.');
    }
    for (const [fingerprint, delivery] of Object.entries(groups)) {
      if (!/^[a-f0-9]{16}$/.test(fingerprint)) {
        throw new StateError('Estado contém identificador de grupo inválido.');
      }
      if (!delivery || typeof delivery !== 'object') {
        throw new StateError('Estado contém entrega inválida.');
      }
      if (!DELIVERY_STATUSES.has(delivery.status)) {
        throw new StateError('Estado contém status de entrega inválido.');
      }
      if (!Number.isInteger(delivery.attempts) || delivery.attempts < 0) {
        throw new StateError('Estado contém contador de tentativas inválido.');
      }
      if (delivery.status === 'sent' && (typeof delivery.messageId !== 'string' || !delivery.messageId)) {
        throw new StateError('Estado indica envio concluído sem confirmação da biblioteca.');
      }
      if (typeof delivery.label !== 'string') {
        throw new StateError('Estado contém nome de grupo inválido.');
      }
    }
  }
  for (const run of state.runs) {
    if (!run || typeof run !== 'object' || !isValidIsoDate(run.date)) {
      throw new StateError('Estado contém histórico de execução inválido.');
    }
  }
  return state;
}

export function getDelivery(state, date, fingerprint) {
  return state.deliveries?.[date]?.[fingerprint] ?? null;
}

export function getStatus(state, date, fingerprint) {
  return getDelivery(state, date, fingerprint)?.status ?? null;
}

export function ensureDelivery(state, date, group, fingerprint, nowIso) {
  if (!state.deliveries[date]) state.deliveries[date] = {};
  if (!state.deliveries[date][fingerprint]) {
    state.deliveries[date][fingerprint] = {
      label: group.label,
      status: 'sending',
      attempts: 0,
      firstAttemptAt: nowIso,
      lastAttemptAt: nowIso,
      sentAt: null,
      messageId: null,
      lastError: null
    };
  }
  return state.deliveries[date][fingerprint];
}

export function markSending(state, date, group, fingerprint, nowIso) {
  const delivery = ensureDelivery(state, date, group, fingerprint, nowIso);
  delivery.label = group.label;
  delivery.status = 'sending';
  delivery.attempts += 1;
  delivery.lastAttemptAt = nowIso;
  delivery.messageId = null;
  delivery.sentAt = null;
  delivery.lastError = null;
  return delivery;
}

export function markSent(state, date, group, fingerprint, nowIso, messageId) {
  const delivery = ensureDelivery(state, date, group, fingerprint, nowIso);
  delivery.label = group.label;
  delivery.status = 'sent';
  delivery.messageId = String(messageId);
  delivery.sentAt = nowIso;
  delivery.lastAttemptAt = nowIso;
  delivery.lastError = null;
  return delivery;
}

export function markFailed(state, date, group, fingerprint, nowIso, error) {
  const delivery = ensureDelivery(state, date, group, fingerprint, nowIso);
  delivery.label = group.label;
  delivery.status = 'failed';
  delivery.lastAttemptAt = nowIso;
  delivery.lastError = safeError(error);
  return delivery;
}

export function markUnknown(state, date, group, fingerprint, nowIso, error) {
  const delivery = ensureDelivery(state, date, group, fingerprint, nowIso);
  delivery.label = group.label;
  delivery.status = 'unknown';
  delivery.lastAttemptAt = nowIso;
  delivery.lastError = safeError(error);
  return delivery;
}

export function addRun(state, run) {
  state.runs.push(run);
  if (state.runs.length > 2000) {
    state.runs = state.runs.slice(-2000);
  }
  return run;
}

export function hasLiveRunForDate(state, date) {
  return state.runs.some(
    (run) =>
      run.date === date &&
      run.mode === 'live' &&
      !['NOT_SCHEDULED', 'MISSED_WINDOW', 'BEFORE_WINDOW'].includes(run.reasonCode)
  );
}

export function hasRunWithReason(state, date, reasonCode) {
  return state.runs.some((run) => run.date === date && run.reasonCode === reasonCode);
}

export function getLastRun(state) {
  return state.runs.length > 0 ? state.runs[state.runs.length - 1] : null;
}

export function summarizeState(state) {
  const counts = { sent: 0, failed: 0, unknown: 0, sending: 0 };
  for (const groups of Object.values(state.deliveries)) {
    for (const delivery of Object.values(groups)) {
      if (counts[delivery.status] !== undefined) counts[delivery.status] += 1;
    }
  }
  return {
    version: state.version,
    dates: Object.keys(state.deliveries).length,
    runs: state.runs.length,
    counts
  };
}

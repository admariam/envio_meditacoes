import { getLocalDate, getSendWindow, isValidIsoDate } from '../shared/dates.js';
import { buildDailyMessage } from '../shared/message.js';
import { getRecordForDate } from '../shared/schedule.js';
import { AppError, ConfigError, StateError, safeError, sanitizeText } from './errors.js';
import { groupFingerprint } from './identity.js';
import {
  addRun,
  getDelivery,
  hasLiveRunForDate,
  hasRunWithReason,
  markFailed,
  markSent,
  markSending,
  markUnknown
} from './state.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRun({ date, mode, event, startedAt, result, reasonCode = null, groups, counts }) {
  return {
    id: `${date}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    mode,
    event,
    startedAt,
    finishedAt: new Date().toISOString(),
    result,
    reasonCode,
    counts,
    groups: groups.map((group) => ({
      fingerprint: group.fingerprint,
      label: group.label,
      status: group.status,
      errorCode: group.errorCode ?? null
    }))
  };
}

function countGroups(groups) {
  return {
    sent: groups.filter((group) => group.status === 'sent' && group.action === 'sent').length,
    alreadySent: groups.filter((group) => group.action === 'already_sent').length,
    failed: groups.filter((group) => group.status === 'failed').length,
    unknown: groups.filter((group) => group.status === 'unknown').length,
    skipped: groups.filter((group) => group.action === 'retry_required' || group.action === 'uncertain_skip').length,
    planned: groups.filter((group) => group.action === 'would_send').length
  };
}

function outcomeFor(groups) {
  const failed = groups.some((group) => group.status === 'failed' || group.status === 'unknown');
  const success = groups.some((group) => group.status === 'sent' || group.action === 'already_sent');
  if (!failed) return 'sent_all';
  return success ? 'partial' : 'failed';
}

export async function runDaily({
  config,
  schedule,
  stateStore,
  whatsapp,
  now = new Date(),
  dryRun = false,
  scheduled = false,
  manual = !scheduled,
  targetDate = null,
  retryFailed = false,
  showMessage = false,
  logger = null,
  sleep = defaultSleep
}) {
  if (!config || !schedule || !stateStore) throw new ConfigError('Configuração, programação e armazenamento de estado são obrigatórios.');
  const startedAt = new Date().toISOString();
  const localDate = getLocalDate(now, config.timezone);
  const requestedDate = targetDate ? String(targetDate).trim() : null;
  if (requestedDate && !isValidIsoDate(requestedDate)) {
    throw new ConfigError('A data de destino deve estar no formato YYYY-MM-DD.');
  }
  const date = scheduled ? localDate : requestedDate || localDate;
  if (scheduled && requestedDate && requestedDate !== localDate) {
    throw new ConfigError('Execução agendada sempre usa a data local atual.');
  }
  if (!dryRun && !scheduled) {
    if (date > localDate) throw new ConfigError('Não é permitido enviar para uma data futura.');
    if (date < localDate && !retryFailed) {
      throw new ConfigError('Para data passada, use a opção explícita de nova tentativa de falhas.');
    }
  }
  const mode = dryRun ? 'dry-run' : 'live';
  const event = scheduled ? 'scheduled' : 'manual';
  const loggerSafe = {
    info: (message) => logger?.info?.(sanitizeText(message)),
    warn: (message) => logger?.warn?.(sanitizeText(message))
  };

  if (scheduled && !dryRun) {
    const window = getSendWindow(now, config.timezone, config.sendTime, config.maxDelayMinutes);
    if (window.status === 'before') {
      return {
        outcome: 'before_window',
        exitCode: 0,
        date,
        localDate,
        mode,
        dryRun,
        scheduled,
        manual,
        reasonCode: 'BEFORE_WINDOW',
        messagePreview: null,
        groups: [],
        counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
        connectionOpened: false,
        runRecorded: false
      };
    }
    if (window.status === 'late') {
      const loaded = await stateStore.load();
      let state = loaded.state;
      let revision = loaded.revision;
      const hasAttempt = hasLiveRunForDate(state, date) || Object.keys(state.deliveries?.[date] ?? {}).length > 0;
      if (hasAttempt) {
        return {
          outcome: 'already_attempted',
          exitCode: 0,
          date,
          localDate,
          mode,
          dryRun,
          scheduled,
          manual,
          reasonCode: 'ALREADY_ATTEMPTED',
          messagePreview: null,
          groups: [],
          counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
          connectionOpened: false,
          runRecorded: false
        };
      }
      if (hasRunWithReason(state, date, 'MISSED_WINDOW')) {
        return {
          outcome: 'already_recorded',
          exitCode: 0,
          date,
          localDate,
          mode,
          dryRun,
          scheduled,
          manual,
          reasonCode: 'MISSED_WINDOW',
          messagePreview: null,
          groups: [],
          counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
          connectionOpened: false,
          runRecorded: false
        };
      }
      const groups = [];
      const counts = { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 };
      addRun(
        state,
        makeRun({
          date,
          mode,
          event,
          startedAt,
          result: 'missed_window',
          reasonCode: 'MISSED_WINDOW',
          groups,
          counts
        })
      );
      await stateStore.save(state, { revision });
      loggerSafe.warn(`Execução fora da janela de ${config.maxDelayMinutes} minutos; nada foi enviado.`);
      return {
        outcome: 'missed_window',
        exitCode: 0,
        date,
        localDate,
        mode,
        dryRun,
        scheduled,
        manual,
        reasonCode: 'MISSED_WINDOW',
        messagePreview: null,
        groups,
        counts,
        connectionOpened: false,
        runRecorded: true
      };
    }
  }

  const loaded = await stateStore.load();
  let state = loaded.state;
  let revision = loaded.revision;

  if (scheduled && !dryRun && hasLiveRunForDate(state, date)) {
    return {
      outcome: 'already_attempted',
      exitCode: 0,
      date,
      localDate,
      mode,
      dryRun,
      scheduled,
      manual,
      reasonCode: 'ALREADY_ATTEMPTED',
      messagePreview: null,
      groups: [],
      counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
      connectionOpened: false,
      runRecorded: false
    };
  }

  const record = getRecordForDate(schedule.records, date);
  if (!record) {
    if (dryRun) {
      return {
        outcome: 'not_scheduled',
        exitCode: 0,
        date,
        localDate,
        mode,
        dryRun,
        scheduled,
        manual,
        reasonCode: 'NOT_SCHEDULED',
        messagePreview: null,
        groups: [],
        counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
        connectionOpened: false,
        runRecorded: false
      };
    }
    if (hasRunWithReason(state, date, 'NOT_SCHEDULED')) {
      return {
        outcome: 'already_recorded',
        exitCode: 0,
        date,
        localDate,
        mode,
        dryRun,
        scheduled,
        manual,
        reasonCode: 'NOT_SCHEDULED',
        messagePreview: null,
        groups: [],
        counts: { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 },
        connectionOpened: false,
        runRecorded: false
      };
    }
    const groups = [];
    const counts = { sent: 0, alreadySent: 0, failed: 0, unknown: 0, skipped: 0, planned: 0 };
    addRun(
      state,
      makeRun({ date, mode, event, startedAt, result: 'not_scheduled', reasonCode: 'NOT_SCHEDULED', groups, counts })
    );
    await stateStore.save(state, { revision });
    loggerSafe.warn('Data sem registro na programação; nenhuma mensagem foi enviada.');
    return {
      outcome: 'not_scheduled',
      exitCode: 0,
      date,
      localDate,
      mode,
      dryRun,
      scheduled,
      manual,
      reasonCode: 'NOT_SCHEDULED',
      messagePreview: null,
      groups,
      counts,
      connectionOpened: false,
      runRecorded: true
    };
  }

  const message = buildDailyMessage(record);
  const groups = config.groups.map((group, index) => {
    const fingerprint = groupFingerprint(group.id);
    const delivery = getDelivery(state, date, fingerprint);
    let action = 'would_send';
    let status = delivery?.status ?? null;
    let reasonCode = null;
    if (delivery?.status === 'sent') {
      action = 'already_sent';
      reasonCode = 'ALREADY_SENT';
    } else if (delivery?.status === 'sending') {
      action = retryFailed ? 'would_send' : 'uncertain_skip';
      reasonCode = retryFailed ? null : 'UNCERTAIN_PREVIOUS_ATTEMPT';
    } else if (delivery?.status === 'failed' || delivery?.status === 'unknown') {
      action = retryFailed ? 'would_send' : 'retry_required';
      reasonCode = retryFailed ? null : 'RETRY_REQUIRED';
    }
    return {
      index: index + 1,
      label: group.label,
      fingerprint,
      group,
      action,
      status,
      errorCode: delivery?.lastError?.code ?? null,
      reasonCode,
      delivery
    };
  });

  const counts = countGroups(groups);
  if (dryRun) {
    return {
      outcome: 'dry_run',
      exitCode: 0,
      date,
      localDate,
      mode,
      dryRun,
      scheduled,
      manual,
      reasonCode: null,
      messagePreview: message,
      groups: groups.map(({ group, delivery, ...rest }) => rest),
      counts,
      connectionOpened: false,
      runRecorded: false
    };
  }

  const toSend = groups.filter((group) => group.action === 'would_send');
  if (toSend.length === 0) {
    const run = makeRun({
      date,
      mode,
      event,
      startedAt,
      result: 'skipped',
      reasonCode: 'NO_PENDING_GROUPS',
      groups,
      counts
    });
    addRun(state, run);
    await stateStore.save(state, { revision });
    return {
      outcome: 'skipped',
      exitCode: 0,
      date,
      localDate,
      mode,
      dryRun,
      scheduled,
      manual,
      reasonCode: 'NO_PENDING_GROUPS',
      messagePreview: showMessage ? message : null,
      groups: groups.map(({ group, delivery, ...rest }) => rest),
      counts,
      connectionOpened: false,
      runRecorded: true
    };
  }

  let connectionOpened = false;
  let stateSaveFailed = false;
  try {
    try {
      await whatsapp.connect();
      connectionOpened = true;
    } catch (error) {
      const failure = safeError(error);
      for (const target of groups) {
        if (target.status === null) target.status = 'failed';
        if (target.action === 'would_send') target.action = 'failed';
        target.errorCode = failure.code;
      }
      const failureCounts = countGroups(groups);
      addRun(
        state,
        makeRun({
          date,
          mode,
          event,
          startedAt,
          result: 'failed',
          reasonCode: 'CONNECT_FAILED',
          groups,
          counts: failureCounts
        })
      );
      await stateStore.save(state, { revision });
      loggerSafe.warn(`Falha de conexão: ${failure.message}`);
      return {
        outcome: 'failed',
        exitCode: 1,
        date,
        localDate,
        mode,
        dryRun,
        scheduled,
        manual,
        reasonCode: 'CONNECT_FAILED',
        messagePreview: showMessage ? message : null,
        groups: groups.map(({ group, delivery, ...rest }) => rest),
        counts: failureCounts,
        connectionOpened: false,
        runRecorded: true,
        error: failure
      };
    }

    for (let index = 0; index < groups.length; index += 1) {
      const target = groups[index];
      if (target.action !== 'would_send') continue;
      markSending(state, date, target.group, target.fingerprint, new Date().toISOString());
      try {
        revision = (await stateStore.save(state, { revision })).revision;
      } catch (error) {
        stateSaveFailed = true;
        throw new StateError('Não foi possível registrar o início do envio; nenhuma mensagem foi enviada para este grupo.');
      }
      try {
        const result = await whatsapp.sendToGroup(target.group.id, message);
        markSent(state, date, target.group, target.fingerprint, new Date().toISOString(), result.messageId);
        target.action = 'sent';
        target.status = 'sent';
        target.errorCode = null;
        try {
          revision = (await stateStore.save(state, { revision })).revision;
        } catch (error) {
          stateSaveFailed = true;
          throw new StateError('O envio foi confirmado, mas o estado não pôde ser salvo. Nenhum novo envio será tentado automaticamente.');
        }
        loggerSafe.info(`Grupo ${target.index}: envio confirmado.`);
      } catch (error) {
        if (error instanceof StateError && stateSaveFailed) throw error;
        const failure = safeError(error);
        if (error?.sent) {
          markUnknown(state, date, target.group, target.fingerprint, new Date().toISOString(), error);
          target.status = 'unknown';
          target.action = 'unknown';
          loggerSafe.warn(`Grupo ${target.index}: envio incerto (${failure.code}).`);
        } else {
          markFailed(state, date, target.group, target.fingerprint, new Date().toISOString(), error);
          target.status = 'failed';
          target.action = 'failed';
          loggerSafe.warn(`Grupo ${target.index}: falha (${failure.code}).`);
        }
        target.errorCode = failure.code;
        try {
          revision = (await stateStore.save(state, { revision })).revision;
        } catch (saveError) {
          stateSaveFailed = true;
          throw new StateError('Falha ao registrar o resultado do envio. Nenhum novo envio será tentado automaticamente.');
        }
      }
      if (index < groups.length - 1 && config.sendDelayMs > 0) await sleep(config.sendDelayMs);
    }
  } finally {
    try {
      await whatsapp.close();
    } catch {
      // A sessão pode ser salva mesmo se o encerramento falhar.
    }
  }

  const finalCounts = countGroups(groups);
  const outcome = outcomeFor(groups);
  const run = makeRun({
    date,
    mode,
    event,
    startedAt,
    result: outcome,
    reasonCode: null,
    groups,
    counts: finalCounts
  });
  addRun(state, run);
  try {
    await stateStore.save(state, { revision });
  } catch (error) {
    throw new StateError('O envio terminou, mas o histórico não pôde ser salvo. Verifique o estado antes de tentar novamente.');
  }
  return {
    outcome,
    exitCode: outcome === 'sent_all' ? 0 : 1,
    date,
    localDate,
    mode,
    dryRun,
    scheduled,
    manual,
    reasonCode: null,
    messagePreview: showMessage ? message : null,
    groups: groups.map(({ group, delivery, ...rest }) => rest),
    counts: finalCounts,
    connectionOpened,
    runRecorded: true
  };
}

export { AppError };

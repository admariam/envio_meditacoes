import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { validateConfig } from './shared/config.js';
import { validateScheduleJson } from './shared/schedule.js';
import { ConfigError, safeError, sanitizeText } from './lib/errors.js';
import { createWhatsAppGateway } from './lib/whatsapp.js';
import { PrivateRepoStore } from './lib/private-repo.js';
import { FileStateStore, GitHubStateStore, MemoryStateStore } from './lib/state-store.js';
import { loadSessionInto, removeAuthDir, saveSessionFrom } from './lib/session.js';
import { runDaily } from './lib/run.js';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'não', 'nao', 'off'].includes(normalized)) return false;
  return fallback;
}

function envBool(name, fallback = false) {
  return parseBool(process.env[name], fallback);
}

async function readJsonFile(filePath, label) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new ConfigError(`Não foi possível ler ${label}.`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new ConfigError(`${label} não contém JSON válido.`);
  }
}

function validationMessage(errors, label) {
  const lines = errors.slice(0, 20).map((item) => {
    const prefix = item.line ? `linha ${item.line}: ` : '';
    return `${prefix}${item.message}`;
  });
  const suffix = errors.length > 20 ? `\n… e mais ${errors.length - 20} erro(s).` : '';
  return `${label} inválida:\n${lines.join('\n')}${suffix}`;
}

async function loadPrivateConfig(repo) {
  const configFile = await repo.getFile('data/config.json');
  if (!configFile) {
    throw new ConfigError('Crie data/config.json no repositório privado de configuração.');
  }
  let configJson;
  try {
    configJson = JSON.parse(configFile.content.toString('utf8'));
  } catch {
    throw new ConfigError('data/config.json não contém JSON válido.');
  }
  const configResult = validateConfig(configJson);
  if (!configResult.ok) throw new ConfigError(validationMessage(configResult.errors, 'Configuração'));
  const scheduleFile = await repo.getFile('data/schedule.json');
  if (!scheduleFile) {
    throw new ConfigError('Crie data/schedule.json no repositório privado de configuração.');
  }
  let scheduleJson;
  try {
    scheduleJson = JSON.parse(scheduleFile.content.toString('utf8'));
  } catch {
    throw new ConfigError('data/schedule.json não contém JSON válido.');
  }
  const scheduleResult = validateScheduleJson(scheduleJson);
  if (scheduleResult.errors.length > 0) {
    throw new ConfigError(validationMessage(scheduleResult.errors, 'Programação'));
  }
  return { config: configResult.config, schedule: scheduleResult, repo };
}

async function loadLocalConfig(configFile, scheduleFile) {
  const configJson = await readJsonFile(configFile, 'o arquivo de configuração');
  const configResult = validateConfig(configJson);
  if (!configResult.ok) throw new ConfigError(validationMessage(configResult.errors, 'Configuração'));
  const scheduleJson = await readJsonFile(scheduleFile, 'o arquivo de programação');
  const scheduleResult = validateScheduleJson(scheduleJson);
  if (scheduleResult.errors.length > 0) {
    throw new ConfigError(validationMessage(scheduleResult.errors, 'Programação'));
  }
  return { config: configResult.config, schedule: scheduleResult, repo: null };
}

function buildSummary(report) {
  const lines = [
    '## Envio de meditações',
    '',
    `- Data: ${report.date}`,
    `- Modo: ${report.mode}`,
    `- Resultado: ${report.outcome}`,
    `- Enviados nesta execução: ${report.counts.sent}`,
    `- Já enviados: ${report.counts.alreadySent}`,
    `- Falhas: ${report.counts.failed}`,
    `- Incertos: ${report.counts.unknown}`,
    `- Ignorados: ${report.counts.skipped}`,
    `- A enviar na simulação: ${report.counts.planned}`,
    '',
    '| Grupo | Estado |',
    '| --- | --- |',
    ...report.groups.map((group) => `| Grupo ${group.index} | ${group.status ?? group.action} |`)
  ];
  if (report.reasonCode) lines.push('', `Motivo: ${report.reasonCode}`);
  lines.push('', 'Sem IDs, links, títulos ou conteúdo de mensagens neste resumo.');
  return `${lines.join('\n')}\n`;
}

async function appendSummary(report) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    await fs.appendFile(summaryPath, buildSummary(report), 'utf8');
  } catch {
    // Não falha o envio por causa do resumo.
  }
}

function printSanitizedReport(report, { json = false } = {}) {
  const safeReport = {
    date: report.date,
    mode: report.mode,
    outcome: report.outcome,
    reasonCode: report.reasonCode,
    counts: report.counts,
    groups: report.groups.map((group) => ({
      index: group.index,
      status: group.status,
      action: group.action,
      errorCode: group.errorCode ?? null
    })),
    runRecorded: report.runRecorded
  };
  if (json) {
    console.log(JSON.stringify(safeReport, null, 2));
    return;
  }
  console.log(`Data: ${report.date} | Modo: ${report.mode} | Resultado: ${report.outcome}`);
  if (report.reasonCode) console.log(`Motivo: ${report.reasonCode}`);
  for (const group of report.groups) {
    console.log(
      `Grupo ${group.index}: ${group.status ?? group.action}${group.errorCode ? ` (${group.errorCode})` : ''}`
    );
  }
  console.log(
    `Enviados: ${report.counts.sent} | Já enviados: ${report.counts.alreadySent} | Falhas: ${report.counts.failed} | Incertos: ${report.counts.unknown} | Ignorados: ${report.counts.skipped} | A enviar na simulação: ${report.counts.planned}`
  );
  if (report.messagePreview && !process.env.GITHUB_ACTIONS) {
    console.log('\n--- Prévia da mensagem (não enviada) ---');
    console.log(report.messagePreview);
    console.log('--- fim da prévia ---');
  } else if (report.messagePreview) {
    console.log('Prévia omitida nos logs do GitHub Actions por privacidade.');
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      live: { type: 'boolean' },
      scheduled: { type: 'boolean' },
      'confirm-live': { type: 'boolean' },
      'retry-failed': { type: 'boolean' },
      date: { type: 'string' },
      'config-file': { type: 'string' },
      'schedule-file': { type: 'string' },
      'state-file': { type: 'string' },
      'session-dir': { type: 'string' },
      'show-message': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' }
    },
    allowPositionals: false
  });
  if (values.help) {
    console.log('Uso: node src/run-daily.js [--dry-run|--live] [--scheduled] [--date YYYY-MM-DD] ...');
    return 0;
  }
  const scheduled = values.scheduled || process.env.GITHUB_EVENT_NAME === 'schedule';
  let dryRun;
  if (scheduled) dryRun = false;
  else if (values.live) dryRun = false;
  else if (values['dry-run']) dryRun = true;
  else dryRun = envBool('INPUT_DRY_RUN', true);
  const confirmLive = scheduled || values['confirm-live'] || envBool('INPUT_CONFIRM_LIVE', false);
  if (!dryRun && !confirmLive) {
    throw new ConfigError('Envio real exige confirmação explícita (--confirm-live ou input confirm_live=true).');
  }
  if (!dryRun && process.env.ALLOW_LIVE_SEND !== 'confirm-send') {
    throw new ConfigError('Envio real bloqueado: defina ALLOW_LIVE_SEND=confirm-send no ambiente do runner.');
  }
  const targetDate = scheduled ? null : values.date || process.env.INPUT_TARGET_DATE || null;
  const retryFailed = scheduled ? false : values['retry-failed'] || envBool('INPUT_RETRY_FAILED', false);
  const configFile = values['config-file'];
  const scheduleFile = values['schedule-file'];
  const stateFile = values['state-file'];
  const localMode = Boolean(configFile || scheduleFile || stateFile || values['session-dir']);
  if ((configFile || scheduleFile) && (!configFile || !scheduleFile)) {
    throw new ConfigError('Informe --config-file e --schedule-file juntos.');
  }

  let config;
  let schedule;
  let repo = null;
  let stateStore;
  let localSessionDir = null;
  if (configFile && scheduleFile) {
    const loaded = await loadLocalConfig(configFile, scheduleFile);
    config = loaded.config;
    schedule = loaded.schedule;
    if (stateFile) stateStore = new FileStateStore(stateFile, { readOnly: dryRun });
    else if (dryRun) stateStore = new MemoryStateStore();
    else throw new ConfigError('Para envio real local, informe --state-file para preservar a idempotência.');
    localSessionDir = values['session-dir'] ?? null;
    if (!dryRun && !localSessionDir) {
      throw new ConfigError('Para envio real local, informe --session-dir com uma sessão existente.');
    }
  } else {
    const repoName = process.env.PRIVATE_CONFIG_REPO;
    const token = process.env.PRIVATE_CONFIG_TOKEN;
    if (!repoName || !token) {
      throw new ConfigError(
        'Configure PRIVATE_CONFIG_REPO e PRIVATE_CONFIG_TOKEN, ou use --config-file/--schedule-file para um teste local.'
      );
    }
    repo = new PrivateRepoStore({
      repo: repoName,
      token,
      branch: process.env.PRIVATE_CONFIG_BRANCH || 'main'
    });
    const loaded = await loadPrivateConfig(repo);
    config = loaded.config;
    schedule = loaded.schedule;
    stateStore = new GitHubStateStore({ repo });
  }

  if (localMode && !dryRun && !localSessionDir) {
    throw new ConfigError('Envio real local exige --session-dir.');
  }

  const tempAuthDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'meditacoes-baileys-auth');
  let lazy = null;
  let realGateway = null;
  let sessionLoaded = false;
  const usePrivateSession = Boolean(repo) && !localSessionDir;
  if (!dryRun) {
    if (usePrivateSession) {
      await removeAuthDir(tempAuthDir);
      lazy = {
        async connect() {
          if (!realGateway) {
            await loadSessionInto(tempAuthDir, { repo, env: process.env });
            sessionLoaded = true;
            realGateway = await createWhatsAppGateway({
              authDir: tempAuthDir,
              allowedGroupIds: config.groups.map((group) => group.id),
              requireAck: config.requireAck,
              ackTimeoutSeconds: config.ackTimeoutSeconds
            });
          }
          await realGateway.connect();
        },
        async sendToGroup(groupId, text) {
          if (!realGateway) throw new Error('WhatsApp não conectado.');
          return realGateway.sendToGroup(groupId, text);
        },
        async close() {
          if (realGateway) await realGateway.close();
        }
      };
    } else {
      realGateway = await createWhatsAppGateway({
        authDir: localSessionDir,
        allowedGroupIds: config.groups.map((group) => group.id),
        requireAck: config.requireAck,
        ackTimeoutSeconds: config.ackTimeoutSeconds
      });
      lazy = realGateway;
    }
  }

  let exitCode = 0;
  let report = null;
  try {
    report = await runDaily({
      config,
      schedule,
      stateStore,
      whatsapp: lazy,
      dryRun,
      scheduled,
      manual: !scheduled,
      targetDate,
      retryFailed,
      showMessage: values['show-message'] || Boolean(values.json)
    });
    printSanitizedReport(report, { json: Boolean(values.json) });
    await appendSummary(report);
    exitCode = report.exitCode;
  } finally {
    if (realGateway) {
      try {
        await realGateway.close();
      } catch {
        // Encerramento best-effort.
      }
    }
    if (!dryRun && usePrivateSession && sessionLoaded) {
      try {
        await saveSessionFrom(tempAuthDir, { repo, env: process.env });
        console.log('Sessão Baileys cifrada atualizada no repositório privado.');
      } catch (error) {
        console.error(`Aviso: não foi possível salvar a sessão cifrada: ${safeError(error).code}`);
        exitCode = 1;
      }
    }
    if (!dryRun && usePrivateSession) {
      await removeAuthDir(tempAuthDir);
    }
  }
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const failure = safeError(error);
    console.error(`Erro (${failure.code}): ${sanitizeText(failure.message)}`);
    if (process.env.DEBUG === 'true' && error?.stack) console.error(error.stack);
    process.exitCode = error?.exitCode ?? 2;
  });

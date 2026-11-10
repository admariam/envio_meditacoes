import { isValidIsoDate, isValidTime, isValidTimeZone, parseIsoDate } from './dates.js';

const GROUP_ID_RE = /^\d{6,40}(?:-\d{2,40})?@g\.us$/;
const ALLOWED_KEYS = new Set([
  'version',
  'timezone',
  'sendTime',
  'maxDelayMinutes',
  'groups',
  'schedulePeriod',
  'requireAck',
  'ackTimeoutSeconds',
  'sendDelayMs'
]);

function issue(field, code, message) {
  return { field, code, message };
}

export function isValidGroupId(value) {
  const id = String(value ?? '').trim();
  return GROUP_ID_RE.test(id);
}

export function maskGroupId(value) {
  const id = String(value ?? '').trim();
  if (!isValidGroupId(id)) return 'ID inválido';
  const local = id.replace(/@g\.us$/, '');
  return `••••${local.slice(-4)}@g.us`;
}

export function validateGroup(group, index) {
  const errors = [];
  const label = String(group?.label ?? '').trim();
  const id = String(group?.id ?? '').trim();
  if (!label) errors.push(issue(`groups[${index}].label`, 'GRUPO_SEM_NOME', `Grupo ${index + 1}: informe um nome.`));
  if (label.length > 80) {
    errors.push(issue(`groups[${index}].label`, 'GRUPO_NOME_LONGO', `Grupo ${index + 1}: nome maior que 80 caracteres.`));
  }
  if (/[\u0000-\u001f\u007f]/u.test(label)) {
    errors.push(issue(`groups[${index}].label`, 'GRUPO_NOME_INVALIDO', `Grupo ${index + 1}: nome inválido.`));
  }
  if (!isValidGroupId(id)) {
    errors.push(
      issue(
        `groups[${index}].id`,
        'GRUPO_ID_INVALIDO',
        `Grupo ${index + 1}: use o ID/JID completo de um grupo, terminado em @g.us. Convites e contatos não são aceitos.`
      )
    );
  }
  return { errors, group: { id, label } };
}

export function validateConfig(value) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      config: null,
      errors: [issue(null, 'CONFIG_INVALIDA', 'A configuração deve ser um objeto JSON.')],
      warnings
    };
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(issue(key, 'CAMPO_DESCONHECIDO', `Campo desconhecido na configuração: ${key}.`));
    }
  }
  if (value.version !== 1) {
    errors.push(issue('version', 'VERSAO_INVALIDA', 'A configuração deve ter "version": 1.'));
  }
  const timezone = String(value.timezone ?? 'America/Sao_Paulo').trim();
  if (!isValidTimeZone(timezone)) {
    errors.push(issue('timezone', 'FUSO_INVALIDO', 'Fuso horário IANA inválido.'));
  }
  const sendTime = String(value.sendTime ?? '06:00').trim();
  if (!isValidTime(value.sendTime ?? '06:00')) {
    errors.push(issue('sendTime', 'HORARIO_INVALIDO', 'Horário inválido; use HH:MM entre 00:00 e 23:59.'));
  }
  const maxDelayMinutes = value.maxDelayMinutes ?? 180;
  if (!Number.isInteger(maxDelayMinutes) || maxDelayMinutes < 0 || maxDelayMinutes > 720) {
    errors.push(issue('maxDelayMinutes', 'JANELA_INVALIDA', 'A janela de atraso deve ser um inteiro entre 0 e 720 minutos.'));
  }
  const groupsInput = value.groups;
  const groups = [];
  if (!Array.isArray(groupsInput)) {
    errors.push(issue('groups', 'GRUPOS_INVALIDOS', 'A configuração deve conter uma lista de grupos.'));
  } else {
    if (groupsInput.length < 2) {
      errors.push(issue('groups', 'POUCOS_GRUPOS', 'Configure pelo menos dois grupos.'));
    }
    if (groupsInput.length > 50) {
      errors.push(issue('groups', 'MUITOS_GRUPOS', 'O limite é de 50 grupos.'));
    }
    const seen = new Map();
    for (let index = 0; index < groupsInput.length; index += 1) {
      const result = validateGroup(groupsInput[index], index);
      errors.push(...result.errors);
      const normalized = result.group;
      if (normalized.id) {
        if (seen.has(normalized.id)) {
          errors.push(
            issue(
              `groups[${index}].id`,
              'GRUPO_DUPLICADO',
              `Grupo ${index + 1}: o mesmo ID já está no Grupo ${seen.get(normalized.id) + 1}.`
            )
          );
        } else {
          seen.set(normalized.id, index);
        }
      }
      groups.push(normalized);
    }
  }
  let schedulePeriod = null;
  if (value.schedulePeriod !== undefined && value.schedulePeriod !== null) {
    const start = String(value.schedulePeriod?.start ?? '').trim();
    const end = String(value.schedulePeriod?.end ?? '').trim();
    if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
      errors.push(issue('schedulePeriod', 'INTERVALO_INVALIDO', 'O intervalo esperado deve ter datas ISO válidas.'));
    } else {
      const first = parseIsoDate(start).iso;
      const last = parseIsoDate(end).iso;
      if (first > last) {
        errors.push(issue('schedulePeriod', 'INTERVALO_INVALIDO', 'A data inicial do intervalo é posterior à final.'));
      } else {
        schedulePeriod = { start: first, end: last };
      }
    }
  }
  const requireAck = value.requireAck ?? false;
  if (typeof requireAck !== 'boolean') {
    errors.push(issue('requireAck', 'ACK_INVALIDO', '"requireAck" deve ser true ou false.'));
  }
  const ackTimeoutSeconds = value.ackTimeoutSeconds ?? 30;
  if (!Number.isInteger(ackTimeoutSeconds) || ackTimeoutSeconds < 5 || ackTimeoutSeconds > 120) {
    errors.push(issue('ackTimeoutSeconds', 'ACK_TIMEOUT_INVALIDO', 'O timeout de confirmação deve ficar entre 5 e 120 segundos.'));
  }
  const sendDelayMs = value.sendDelayMs ?? 2000;
  if (!Number.isInteger(sendDelayMs) || sendDelayMs < 0 || sendDelayMs > 60000) {
    errors.push(issue('sendDelayMs', 'INTERVALO_ENVIO_INVALIDO', 'O intervalo entre envios deve ficar entre 0 e 60000 ms.'));
  }
  if (sendTime === '06:00') {
    // Padrão documentado; nenhuma ação necessária.
  }
  const config = {
    version: 1,
    timezone,
    sendTime,
    maxDelayMinutes,
    groups,
    schedulePeriod,
    requireAck,
    ackTimeoutSeconds,
    sendDelayMs
  };
  return { ok: errors.length === 0, config, errors, warnings };
}

export function serializeConfigJson(config) {
  const normalized = {
    version: 1,
    timezone: config.timezone,
    sendTime: config.sendTime,
    maxDelayMinutes: config.maxDelayMinutes,
    groups: config.groups.map((group) => ({ id: group.id, label: group.label })),
    schedulePeriod: config.schedulePeriod ?? null,
    requireAck: config.requireAck,
    ackTimeoutSeconds: config.ackTimeoutSeconds,
    sendDelayMs: config.sendDelayMs
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

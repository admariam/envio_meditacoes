import {
  formatDateBr,
  formatDayMonth,
  isValidIsoDate,
  parseIsoDate,
  weekdayShortPt,
  weekdayMatches,
  enumerateDates,
  compareIsoDates
} from './dates.js';

const LINE_RE = /^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+\((.+)\)\s*$/u;
const MAX_LINE_LENGTH = 5000;
const MAX_RECORDS = 5000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2048;

function issue(line, code, message) {
  return { line, code, message };
}

export function validateUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return 'URL ausente.';
  if (url.length > MAX_URL_LENGTH) return `URL maior que ${MAX_URL_LENGTH} caracteres.`;
  if (/\s/.test(url)) return 'URL não pode conter espaços.';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'URL inválida.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL deve usar http ou https.';
  }
  if (parsed.username || parsed.password) {
    return 'URL não pode conter usuário ou senha.';
  }
  return null;
}

function validateMeta(date, meta) {
  const errors = [];
  const warnings = [];
  const parts = String(meta ?? '').split(/\s*[·•]\s*/u);
  if (parts.length < 3) {
    errors.push(issue(null, 'META_INVALIDA', 'Use o formato (Dia da semana · DD/MM · Título).'));
    return { errors, warnings, title: '' };
  }
  const providedWeekday = parts[0].trim();
  const dayMonth = parts[1].trim();
  const title = parts.slice(2).join(' · ').trim();
  const dm = /^(\d{2})\/(\d{2})$/.exec(dayMonth);
  if (!dm) {
    errors.push(issue(null, 'DATA_META_INVALIDA', 'A data entre parênteses deve estar no formato DD/MM.'));
  } else {
    const parsed = parseIsoDate(date);
    if (parsed && (Number(dm[1]) !== parsed.day || Number(dm[2]) !== parsed.month)) {
      errors.push(
        issue(
          null,
          'DATA_META_DIVERGENTE',
          `A data "${dayMonth}" não corresponde à data ${formatDateBr(date)}.`
        )
      );
    }
  }
  if (!title) {
    errors.push(issue(null, 'TITULO_AUSENTE', 'O título da meditação não pode ficar vazio.'));
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(issue(null, 'TITULO_LONGO', `O título excede ${MAX_TITLE_LENGTH} caracteres.`));
  } else if (/[\u0000-\u001f\u007f]/u.test(title)) {
    errors.push(issue(null, 'TITULO_INVALIDO', 'O título contém caracteres de controle.'));
  }
  if (providedWeekday && !weekdayMatches(date, providedWeekday)) {
    warnings.push(
      issue(
        null,
        'DIA_SEMANA_INCORRETO',
        `O dia informado ("${providedWeekday}") não corresponde a ${weekdayShortPt(date)}; o dia será recalculado.`
      )
    );
  }
  return { errors, warnings, title };
}

export function validateScheduleRecord(input, options = {}) {
  const line = options.line ?? null;
  const errors = [];
  const warnings = [];
  const record = {
    date: String(input?.date ?? '').trim(),
    title: String(input?.title ?? '').trim(),
    url: String(input?.url ?? '').trim()
  };
  if (!isValidIsoDate(record.date)) {
    errors.push(issue(line, 'DATA_INVALIDA', 'Data inválida. Use YYYY-MM-DD e uma data real do calendário.'));
  }
  if (!record.title) {
    errors.push(issue(line, 'TITULO_AUSENTE', 'Título ausente.'));
  } else if (record.title.length > MAX_TITLE_LENGTH) {
    errors.push(issue(line, 'TITULO_LONGO', `Título maior que ${MAX_TITLE_LENGTH} caracteres.`));
  } else if (/[\u0000-\u001f\u007f]/u.test(record.title)) {
    errors.push(issue(line, 'TITULO_INVALIDO', 'Título contém caracteres de controle.'));
  }
  const urlError = validateUrl(record.url);
  if (urlError) errors.push(issue(line, 'URL_INVALIDA', urlError));
  return { record, errors, warnings };
}

export function parseScheduleLine(rawLine, lineNumber) {
  const text = String(rawLine ?? '').trim();
  if (!text) return { blank: true, errors: [], warnings: [], record: null };
  if (text.length > MAX_LINE_LENGTH) {
    return {
      blank: false,
      record: null,
      warnings: [],
      errors: [issue(lineNumber, 'LINHA_LONGA', `A linha excede ${MAX_LINE_LENGTH} caracteres.`)]
    };
  }
  const match = LINE_RE.exec(text);
  if (!match) {
    return {
      blank: false,
      record: null,
      warnings: [],
      errors: [
        issue(
          lineNumber,
          'FORMATO_INVALIDO',
          'Linha fora do formato esperado: YYYY-MM-DD  URL  (Dia · DD/MM · Título).'
        )
      ]
    };
  }
  const date = match[1];
  const url = match[2];
  const meta = match[3];
  const base = validateScheduleRecord({ date, url, title: '' }, { line: lineNumber });
  const errors = base.errors.filter((item) => item.code !== 'TITULO_AUSENTE');
  const warnings = [];
  if (!isValidIsoDate(date)) {
    return { blank: false, record: null, errors, warnings };
  }
  const metaResult = validateMeta(date, meta);
  errors.push(...metaResult.errors.map((item) => ({ ...item, line: lineNumber })));
  warnings.push(...metaResult.warnings.map((item) => ({ ...item, line: lineNumber })));
  const record = { date, title: metaResult.title, url };
  if (errors.length > 0) {
    return { blank: false, record: null, errors, warnings };
  }
  return { blank: false, record, errors: [], warnings };
}

export function parseScheduleText(text, options = {}) {
  const sourceName = options.sourceName ?? 'arquivo';
  const normalized = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const errors = [];
  const warnings = [];
  const duplicates = [];
  const byDate = new Map();
  let blankLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const result = parseScheduleLine(lines[index], lineNumber);
    if (result.blank) {
      blankLines += 1;
      continue;
    }
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (!result.record) continue;
    const previous = byDate.get(result.record.date);
    if (previous) {
      const linesInvolved = [previous.line, lineNumber];
      duplicates.push({
        date: result.record.date,
        lines: linesInvolved,
        records: [previous.record, result.record]
      });
      errors.push(
        issue(
          lineNumber,
          'DATA_DUPLICADA',
          `Data ${result.record.date} duplicada; também aparece na linha ${previous.line}.`
        )
      );
      errors.push(
        issue(
          previous.line,
          'DATA_DUPLICADA',
          `Data ${result.record.date} duplicada; também aparece na linha ${lineNumber}.`
        )
      );
      byDate.set(result.record.date, { ...previous, duplicate: true });
      continue;
    }
    byDate.set(result.record.date, {
      line: lineNumber,
      record: result.record,
      duplicate: false
    });
  }
  const records = [...byDate.values()]
    .filter((entry) => !entry.duplicate)
    .map((entry) => entry.record)
    .sort((a, b) => compareIsoDates(a.date, b.date));
  if (records.length === 0 && errors.length === 0) {
    errors.push(issue(null, 'SEM_REGISTROS', `Nenhum registro encontrado em ${sourceName}.`));
  }
  if (records.length > MAX_RECORDS) {
    errors.push(issue(null, 'MUITOS_REGISTROS', `O arquivo excede ${MAX_RECORDS} registros.`));
  }
  return {
    records,
    errors: dedupeErrors(errors),
    warnings,
    duplicates,
    stats: {
      lines: lines.length,
      blankLines,
      records: records.length,
      errors: errors.length,
      warnings: warnings.length,
      duplicates: duplicates.length
    }
  };
}

function dedupeErrors(errors) {
  const seen = new Set();
  return errors.filter((item) => {
    const key = `${item.line}:${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateRecords(records) {
  const errors = [];
  const warnings = [];
  const valid = [];
  const seen = new Map();
  if (!Array.isArray(records)) {
    return {
      records: [],
      errors: [issue(null, 'FORMATO_JSON', 'A programação deve ser uma lista de registros.')],
      warnings
    };
  }
  for (let index = 0; index < records.length; index += 1) {
    const result = validateScheduleRecord(records[index], { line: index + 1 });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.errors.length > 0) continue;
    const previous = seen.get(result.record.date);
    if (previous) {
      errors.push(
        issue(index + 1, 'DATA_DUPLICADA', `Data ${result.record.date} duplicada; já existe no registro ${previous}.`)
      );
      errors.push(
        issue(previous, 'DATA_DUPLICADA', `Data ${result.record.date} duplicada; também no registro ${index + 1}.`)
      );
      continue;
    }
    seen.set(result.record.date, index + 1);
    valid.push(result.record);
  }
  valid.sort((a, b) => compareIsoDates(a.date, b.date));
  return { records: valid, errors: dedupeErrors(errors), warnings };
}

export function validateScheduleJson(value) {
  let payload = value;
  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value);
    } catch {
      return {
        records: [],
        errors: [issue(null, 'JSON_INVALIDO', 'O arquivo de programação não é um JSON válido.')],
        warnings: []
      };
    }
  }
  const records = Array.isArray(payload) ? payload : payload?.records;
  if (!Array.isArray(records)) {
    return {
      records: [],
      errors: [issue(null, 'FORMATO_JSON', 'JSON deve conter um array "records".')],
      warnings: []
    };
  }
  return validateRecords(records);
}

export function findDuplicateDates(records) {
  const byDate = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const date = records[index]?.date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(index + 1);
  }
  return [...byDate.entries()]
    .filter(([, positions]) => positions.length > 1)
    .map(([date, positions]) => ({ date, positions }));
}

export function findMissingDates(records, start, end) {
  const dates = new Set(records.map((record) => record.date));
  return enumerateDates(start, end).filter((date) => !dates.has(date));
}

export function getRecordForDate(records, date) {
  if (!isValidIsoDate(date)) throw new Error('Data de consulta inválida.');
  const matches = records.filter((record) => record.date === date);
  if (matches.length > 1) throw new Error('Há mais de um registro para a data consultada.');
  return matches[0] ?? null;
}

export function serializeScheduleTxt(records) {
  return `${[...records]
    .sort((a, b) => compareIsoDates(a.date, b.date))
    .map(
      (record) =>
        `${record.date}  ${record.url}  (${weekdayShortPt(record.date)} · ${formatDayMonth(record.date)} · ${record.title})`
    )
    .join('\n')}\n`;
}

export function serializeScheduleJson(records) {
  return `${JSON.stringify(
    {
      version: 1,
      records: [...records]
        .sort((a, b) => compareIsoDates(a.date, b.date))
        .map((record) => ({ date: record.date, title: record.title, url: record.url }))
    },
    null,
    2
  )}\n`;
}

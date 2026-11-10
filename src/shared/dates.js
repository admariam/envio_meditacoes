const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
}

export function isValidIsoDate(value) {
  return parseIsoDate(value) !== null;
}

export function requireIsoDate(value, fieldName = 'data') {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error(`${fieldName} inválida: use o formato ISO YYYY-MM-DD.`);
  return parsed.iso;
}

export function compareIsoDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDaysIso(value, days) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error('Data inválida para cálculo.');
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return date.toISOString().slice(0, 10);
}

export function enumerateDates(start, end, maxDays = 3660) {
  const first = parseIsoDate(start);
  const last = parseIsoDate(end);
  if (!first || !last) throw new Error('Intervalo de datas inválido.');
  if (first.iso > last.iso) throw new Error('A data inicial deve ser anterior ou igual à final.');
  const dates = [];
  let cursor = first.iso;
  while (cursor <= last.iso) {
    dates.push(cursor);
    if (dates.length > maxDays) {
      throw new Error(`O intervalo excede o limite de ${maxDays} dias.`);
    }
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

export function isValidTime(value) {
  return parseTime(value) !== null;
}

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    second,
    minutes: hour * 60 + minute
  };
}

export function getLocalDate(instant, timeZone) {
  return getZonedParts(instant, timeZone).date;
}

export function getSendWindow(instant, timeZone, sendTime, maxDelayMinutes = 180) {
  const local = getZonedParts(instant, timeZone);
  const time = parseTime(sendTime);
  if (!time) throw new Error('Horário de envio inválido.');
  const delay = local.minutes - time.minutes;
  if (delay < 0) return { status: 'before', local, delay };
  if (delay > maxDelayMinutes) return { status: 'late', local, delay };
  return { status: 'ok', local, delay };
}

export function formatDateBr(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error('Data inválida para formatação.');
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
}

export function formatDayMonth(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error('Data inválida para formatação.');
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}`;
}

function utcDateForWeekday(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error('Data inválida para cálculo do dia da semana.');
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

export function weekdayLongPt(value) {
  const name = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC'
  }).format(utcDateForWeekday(value));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function weekdayShortPt(value) {
  return weekdayLongPt(value).replace(/-feira$/i, '');
}

export function normalizeWeekday(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/-feira$/g, '')
    .trim();
}

export function weekdayMatches(isoDate, providedWeekday) {
  const provided = normalizeWeekday(providedWeekday);
  if (!provided) return false;
  return normalizeWeekday(weekdayShortPt(isoDate)) === provided;
}

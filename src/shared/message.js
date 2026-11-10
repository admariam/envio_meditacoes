import { formatDateBr, weekdayLongPt } from './dates.js';

export function buildDailyMessage(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Registro inválido para montar a mensagem.');
  }
  const date = String(record.date ?? '');
  const title = String(record.title ?? '').trim();
  const url = String(record.url ?? '').trim();
  if (!date || !title || !url) {
    throw new Error('Registro incompleto para montar a mensagem.');
  }
  return `${weekdayLongPt(date)}, ${formatDateBr(date)}\n${title}\n${url}`;
}

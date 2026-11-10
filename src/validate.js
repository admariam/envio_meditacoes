import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { validateConfig } from './shared/config.js';
import { validateScheduleJson, findMissingDates } from './shared/schedule.js';
import { validateState } from './lib/state.js';
import { isValidIsoDate } from './shared/dates.js';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function printErrors(label, errors) {
  if (errors.length === 0) {
    console.log(`${label}: OK`);
    return false;
  }
  console.error(`${label}: ${errors.length} erro(s)`);
  for (const error of errors.slice(0, 50)) {
    const prefix = error.line ? `linha ${error.line}: ` : error.field ? `${error.field}: ` : '';
    console.error(`- ${prefix}${error.message}`);
  }
  if (errors.length > 50) console.error(`- … e mais ${errors.length - 50}.`);
  return true;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      schedule: { type: 'string' },
      state: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      help: { type: 'boolean' }
    },
    allowPositionals: false
  });
  if (values.help || !values.config || !values.schedule) {
    console.log('Uso: node src/validate.js --config config.private.json --schedule schedule.private.json [--state state.private.json] [--from YYYY-MM-DD --to YYYY-MM-DD]');
    return values.help ? 0 : 2;
  }
  let failed = false;
  let config;
  try {
    const configResult = validateConfig(await readJson(values.config));
    failed = printErrors('Configuração', configResult.errors) || failed;
    config = configResult.config;
  } catch {
    console.error('Configuração: arquivo inválido ou inexistente.');
    return 2;
  }
  let schedule;
  try {
    const scheduleResult = validateScheduleJson(await readJson(values.schedule));
    failed = printErrors('Programação', scheduleResult.errors) || failed;
    schedule = scheduleResult;
  } catch {
    console.error('Programação: arquivo inválido ou inexistente.');
    return 2;
  }
  if (values.state) {
    try {
      validateState(await readJson(values.state));
      console.log('Estado: OK');
    } catch (error) {
      console.error(`Estado: ${error.message}`);
      failed = true;
    }
  }
  if (values.from || values.to) {
    if (!isValidIsoDate(values.from) || !isValidIsoDate(values.to)) {
      console.error('Intervalo: use --from e --to com datas ISO válidas.');
      return 2;
    }
    const missing = findMissingDates(schedule.records, values.from, values.to);
    console.log(`Datas faltantes (${values.from} a ${values.to}): ${missing.length}`);
    for (const date of missing.slice(0, 100)) console.log(`- ${date}`);
    if (missing.length > 100) console.log(`- … e mais ${missing.length - 100}.`);
  }
  if (config?.schedulePeriod && schedule) {
    const missing = findMissingDates(schedule.records, config.schedulePeriod.start, config.schedulePeriod.end);
    console.log(`Datas faltantes no intervalo configurado: ${missing.length}`);
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Erro: ${error.message}`);
    process.exitCode = 2;
  });

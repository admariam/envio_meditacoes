import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseScheduleText, findMissingDates, serializeScheduleJson, serializeScheduleTxt } from './shared/schedule.js';
import { decodeTextBuffer } from './shared/text.js';
import { isValidIsoDate } from './shared/dates.js';

function printIssues(title, items, limit = 200) {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const item of items.slice(0, limit)) {
    const prefix = item.line ? `Linha ${item.line}: ` : '';
    console.log(`- ${prefix}${item.message ?? item.code}`);
  }
  if (items.length > limit) console.log(`- … e mais ${items.length - limit}.`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string' },
      txt: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'require-complete': { type: 'boolean' },
      help: { type: 'boolean' }
    },
    allowPositionals: false
  });
  if (values.help || !values.file) {
    console.log(
      'Uso: node src/import-schedule.js --file links-meditacoes.txt [--out schedule.private.json] [--txt programacao.txt] [--from YYYY-MM-DD --to YYYY-MM-DD] [--require-complete]'
    );
    return values.help ? 0 : 2;
  }
  if ((values.from && !values.to) || (!values.from && values.to)) {
    throw new Error('Informe --from e --to juntos.');
  }
  if (values.from && !isValidIsoDate(values.from)) throw new Error('--from inválida.');
  if (values.to && !isValidIsoDate(values.to)) throw new Error('--to inválida.');
  let buffer;
  try {
    buffer = await fs.readFile(values.file);
  } catch {
    throw new Error('Não foi possível ler o arquivo informado.');
  }
  const { text, encoding } = decodeTextBuffer(buffer);
  const parsed = parseScheduleText(text, { sourceName: values.file });
  console.log(`Arquivo: ${values.file}`);
  console.log(`Codificação detectada: ${encoding}`);
  console.log(
    `Linhas: ${parsed.stats.lines} | Registros válidos: ${parsed.records.length} | Erros: ${parsed.errors.length} | Avisos: ${parsed.warnings.length} | Duplicidades: ${parsed.duplicates.length}`
  );
  if (parsed.duplicates.length > 0) {
    console.log('\nDatas duplicadas:');
    for (const duplicate of parsed.duplicates) {
      console.log(`- ${duplicate.date}: linhas ${duplicate.lines.join(', ')}`);
    }
  }
  printIssues('Erros', parsed.errors);
  printIssues('Avisos', parsed.warnings);

  let missing = [];
  if (values.from && values.to) {
    missing = findMissingDates(parsed.records, values.from, values.to);
    console.log(`\nDatas faltantes no intervalo ${values.from} a ${values.to}: ${missing.length}`);
    for (const date of missing.slice(0, 100)) console.log(`- ${date}`);
    if (missing.length > 100) console.log(`- … e mais ${missing.length - 100}.`);
  }

  const blocked = parsed.errors.length > 0 || parsed.duplicates.length > 0;
  if (blocked) {
    console.error('\nImportação bloqueada: corrija os erros e duplicidades. Nenhum arquivo foi gravado.');
    return 1;
  }
  if (values['require-complete'] && values.from && values.to && missing.length > 0) {
    console.error('\nImportação bloqueada: há datas faltantes no intervalo e --require-complete foi usado.');
    return 1;
  }
  if (values.out) {
    await fs.writeFile(values.out, serializeScheduleJson(parsed.records), { encoding: 'utf8', mode: 0o600 });
    console.log(`\nProgramação JSON gravada em ${values.out} (arquivo privado; não publique).`);
  }
  if (values.txt) {
    await fs.writeFile(values.txt, serializeScheduleTxt(parsed.records), { encoding: 'utf8', mode: 0o600 });
    console.log(`Cópia legível gravada em ${values.txt} (arquivo privado; não publique).`);
  }
  console.log('\nImportação validada com sucesso.');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Erro: ${error.message}`);
    process.exitCode = 2;
  });

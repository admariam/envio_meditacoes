import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: { dir: { type: 'string' } },
    allowPositionals: false
  });
  const dir = values.dir ?? path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'meditacoes-baileys-auth');
  const base = path.resolve(process.env.RUNNER_TEMP || os.tmpdir());
  const target = path.resolve(dir);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('Recusado: a limpeza só pode remover pastas temporárias do runner.');
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
  console.log('Sessão temporária removida.');
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

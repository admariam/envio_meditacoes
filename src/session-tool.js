import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { packAuthDir, encryptSessionBuffer, encodeSessionSecret } from './lib/session.js';

async function writePrivateFile(filePath, content, force) {
  try {
    await fs.access(filePath);
    if (!force) throw new Error('O arquivo de saída já existe. Use --force somente se quiser substituí-lo.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
      'key-env': { type: 'string' },
      help: { type: 'boolean' }
    },
    allowPositionals: true
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log('Uso: node src/session-tool.js pack --dir .baileys-auth --out session.b64 [--force]');
    console.log('     node src/session-tool.js seal --dir .baileys-auth --out session.enc.b64 [--force]');
    return values.help ? 0 : 2;
  }
  const dir = values.dir ?? '.baileys-auth';
  if (command === 'pack') {
    const out = values.out ?? 'session.b64';
    const bundle = await packAuthDir(dir);
    await writePrivateFile(out, encodeSessionSecret(bundle), Boolean(values.force));
    console.log(`Pacote de sessão gravado em ${out}.`);
    console.log('Esse arquivo contém a sessão. Guarde-o como Secret e apague-o do disco depois.');
    console.log('Nunca faça commit, upload público ou cole o conteúdo em logs/chat.');
    return 0;
  }
  if (command === 'seal') {
    const out = values.out ?? 'session.enc.b64';
    const keyEnv = values['key-env'] ?? 'SESSION_ENCRYPTION_KEY';
    const key = process.env[keyEnv];
    if (!key) throw new Error(`A variável ${keyEnv} não está definida neste terminal.`);
    const bundle = await packAuthDir(dir);
    const encrypted = encryptSessionBuffer(bundle, key).toString('base64');
    await writePrivateFile(out, encrypted, Boolean(values.force));
    console.log(`Sessão cifrada gravada em ${out}.`);
    console.log('Envie esse arquivo ao repositório privado como data/session.enc.b64. Não publique.');
    return 0;
  }
  throw new Error('Comando inválido. Use "pack" ou "seal".');
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Erro: ${error.message}`);
    process.exitCode = 2;
  });

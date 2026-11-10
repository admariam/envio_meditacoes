#!/usr/bin/env node
/**
 * Monta o site público em _site.
 *
 * Somente docs/ e src/shared/ entram no build. O script também falha se
 * encontrar caminhos ou conteúdo que jamais devem ser publicados.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '_site');
const sources = [
  { from: path.join(root, 'docs'), to: outDir },
  { from: path.join(root, 'src', 'shared'), to: path.join(outDir, 'shared') }
];

const requiredFiles = [
  'index.html',
  'styles.css',
  'app.js',
  '.nojekyll',
  'shared/config.js',
  'shared/dates.js',
  'shared/message.js',
  'shared/schedule.js',
  'shared/text.js'
];

const forbiddenPaths = [
  { label: 'diretório .git', re: /(^|\/)\.git(\/|$)/ },
  { label: 'node_modules', re: /(^|\/)node_modules(\/|$)/ },
  { label: 'diretório data', re: /(^|\/)data(\/|$)/ },
  { label: 'diretório private', re: /(^|\/)private(\/|$)/ },
  { label: 'arquivo .env', re: /(^|\/)\.env(?:\.|$)/ },
  { label: 'credenciais Baileys', re: /(^|\/)creds\.json$/i },
  { label: 'sessão Baileys', re: /(^|\/)session[^/]*\.(?:json|b64|enc|enc\.b64)$/i },
  { label: 'configuração privada', re: /(^|\/)(?:config|schedule|state)\.private\.json$/i },
  { label: 'programação privada', re: /(^|\/)links-meditacoes\.txt$/i }
];

const secretPatterns = [
  { label: 'token do GitHub', re: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/ },
  { label: 'chave privada PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'JID de grupo real', re: /\b\d{6,40}(?:-\d{2,40})?@g\.us\b/ }
];

const browserForbidden = [
  { label: 'localStorage', re: /\blocalStorage\s*(?:\.|\[)/ },
  { label: 'sessionStorage', re: /\bsessionStorage\s*(?:\.|\[)/ },
  { label: 'IndexedDB', re: /\bindexedDB\s*\./ },
  { label: 'document.cookie', re: /\bdocument\s*\.\s*cookie\b/ },
  { label: 'fetch()', re: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', re: /\bWebSocket\b/ },
  { label: 'EventSource', re: /\bEventSource\b/ },
  { label: 'sendBeacon', re: /\bsendBeacon\b/ }
];

const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;

function relativeName(absolute) {
  return path.relative(outDir, absolute).split(path.sep).join('/');
}

function isInside(parent, target) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`);
}

async function copyTree(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`Link simbólico recusado no build público: ${source}`);
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true, mode: 0o755 });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Tipo de arquivo recusado no build público: ${source}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await fs.copyFile(source, destination);
}

async function listFiles(directory) {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`Link simbólico encontrado no build público: ${relativeName(absolute)}`);
    }
    if (stat.isDirectory()) {
      files.push(...(await listFiles(absolute)));
    } else if (stat.isFile()) {
      files.push(absolute);
    } else {
      throw new Error(`Tipo de arquivo encontrado no build público: ${relativeName(absolute)}`);
    }
  }
  return files;
}

async function resolveImport(fromFile, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(fromFile), clean);
  if (!isInside(outDir, base)) return null;
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.html')
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Tenta o próximo candidato.
    }
  }
  return null;
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  for (const source of sources) {
    await copyTree(source.from, source.to);
  }
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', { encoding: 'utf8' });

  const errors = [];
  const files = await listFiles(outDir);

  for (const file of files) {
    const name = relativeName(file);
    for (const forbidden of forbiddenPaths) {
      if (forbidden.re.test(name)) errors.push(`${name}: ${forbidden.label} não pode ser publicado.`);
    }
    const content = await fs.readFile(file, 'utf8');
    for (const secret of secretPatterns) {
      if (secret.re.test(content)) errors.push(`${name}: possível ${secret.label} no build público.`);
    }
    if (name.endsWith('.js')) {
      for (const forbidden of browserForbidden) {
        if (forbidden.re.test(content)) {
          errors.push(`${name}: uso de ${forbidden.label} não é permitido na interface pública.`);
        }
      }
      importRe.lastIndex = 0;
      let match;
      while ((match = importRe.exec(content)) !== null) {
        const resolved = await resolveImport(file, match[1]);
        if (!resolved) {
          errors.push(`${name}: import relativo não encontrado: ${match[1]}`);
        }
      }
    }
  }

  for (const required of requiredFiles) {
    if (!files.some((file) => relativeName(file) === required)) {
      errors.push(`Arquivo obrigatório ausente no build: ${required}`);
    }
  }

  const index = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
  for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'none'"]) {
    if (!index.includes(directive)) errors.push(`CSP pública sem a diretiva obrigatória: ${directive}`);
  }

  if (errors.length > 0) {
    console.error('Build público recusado:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const bytes = (
    await Promise.all(files.map(async (file) => (await fs.stat(file)).size))
  ).reduce((total, size) => total + size, 0);
  console.log(`Build público criado em _site (${files.length} arquivos, ${(bytes / 1024).toFixed(1)} KiB).`);
  console.log('Nenhum dado privado, sessão ou segredo foi incluído.');
}

main().catch((error) => {
  console.error(`Falha no build público: ${error.message}`);
  process.exitCode = 1;
});

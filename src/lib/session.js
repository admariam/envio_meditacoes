import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { AppError, SessionMissingError, StateError } from './errors.js';

const BUNDLE_VERSION = 1;
const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 300;
const MAGIC = Buffer.from('MDS1');

function keyBuffer(keyB64) {
  let key;
  try {
    key = Buffer.from(String(keyB64 ?? '').trim(), 'base64');
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new AppError('SESSION_KEY_INVALIDA', 'SESSION_ENCRYPTION_KEY deve ser base64 de exatamente 32 bytes.');
  }
  return key;
}

function assertSafeRelative(fileName) {
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    fileName.length > 240 ||
    fileName.includes('\\') ||
    fileName.startsWith('/') ||
    fileName.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new StateError('Arquivo de sessão contém caminho inválido.');
  }
}

async function collectFiles(root, current = '') {
  const absolute = path.join(root, current);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new StateError('A sessão contém link simbólico; não será empacotada.');
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, relative)));
      continue;
    }
    if (!entry.isFile()) continue;
    assertSafeRelative(relative);
    const content = await fs.readFile(path.join(root, relative));
    files.push([relative, content]);
    if (files.length > MAX_FILES) throw new StateError('A sessão contém arquivos demais.');
  }
  return files;
}

export async function packAuthDir(authDir) {
  const credsPath = path.join(authDir, 'creds.json');
  try {
    await fs.access(credsPath);
  } catch {
    throw new SessionMissingError('A pasta de sessão não contém creds.json.');
  }
  const files = await collectFiles(authDir);
  const map = {};
  let total = 0;
  for (const [name, content] of files) {
    total += content.length;
    if (total > MAX_BUNDLE_BYTES) throw new StateError('A sessão excede o limite de tamanho.');
    map[name] = content.toString('base64');
  }
  const json = JSON.stringify({ version: BUNDLE_VERSION, files: map });
  const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  if (compressed.length > MAX_BUNDLE_BYTES) throw new StateError('A sessão compactada excede o limite de tamanho.');
  return compressed;
}

export async function unpackAuthBundle(bundle, authDir) {
  if (!Buffer.isBuffer(bundle) || bundle.length === 0 || bundle.length > MAX_BUNDLE_BYTES) {
    throw new StateError('Pacote de sessão inválido ou grande demais.');
  }
  let payload;
  try {
    payload = JSON.parse(gunzipSync(bundle).toString('utf8'));
  } catch {
    throw new StateError('Não foi possível descompactar o pacote de sessão.');
  }
  if (!payload || payload.version !== BUNDLE_VERSION || !payload.files || typeof payload.files !== 'object') {
    throw new StateError('Formato de pacote de sessão não suportado.');
  }
  const names = Object.keys(payload.files);
  if (names.length === 0 || names.length > MAX_FILES) throw new StateError('Pacote de sessão sem arquivos válidos.');
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  for (const name of names) {
    assertSafeRelative(name);
    const content = Buffer.from(String(payload.files[name]), 'base64');
    const target = path.resolve(authDir, name);
    const root = path.resolve(authDir);
    if (!target.startsWith(`${root}${path.sep}`)) throw new StateError('Caminho de sessão fora da pasta temporária.');
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, content, { mode: 0o600 });
  }
  try {
    await fs.access(path.join(authDir, 'creds.json'));
  } catch {
    throw new StateError('Pacote de sessão não contém creds.json.');
  }
}

export function decodeSessionSecret(secretB64) {
  const value = String(secretB64 ?? '').trim();
  if (!value) throw new SessionMissingError('BAILEYS_SESSION_B64 não configurado.');
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value)) {
    throw new StateError('BAILEYS_SESSION_B64 não está em base64 válido.');
  }
  return Buffer.from(value, 'base64');
}

export function encodeSessionSecret(bundle) {
  return Buffer.from(bundle).toString('base64');
}

export function encryptSessionBuffer(bundle, keyB64) {
  const key = keyBuffer(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('meditacoes-session-v1'));
  const encrypted = Buffer.concat([cipher.update(bundle), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, encrypted]);
}

export function decryptSessionBuffer(encrypted, keyB64) {
  if (!Buffer.isBuffer(encrypted) || encrypted.length < MAGIC.length + 12 + 16) {
    throw new StateError('Arquivo de sessão cifrado inválido.');
  }
  if (!encrypted.subarray(0, 4).equals(MAGIC)) {
    throw new StateError('Formato de sessão cifrada não reconhecido.');
  }
  const key = keyBuffer(keyB64);
  const iv = encrypted.subarray(4, 16);
  const tag = encrypted.subarray(16, 32);
  const data = encrypted.subarray(32);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('meditacoes-session-v1'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new StateError('Não foi possível decifrar a sessão. Verifique SESSION_ENCRYPTION_KEY.');
  }
}

export async function loadSessionInto(authDir, { repo = null, env = process.env } = {}) {
  if (repo) {
    const file = await repo.getFile('data/session.enc.b64');
    if (file) {
      const key = env.SESSION_ENCRYPTION_KEY;
      if (!key) throw new AppError('SESSION_KEY_AUSENTE', 'SESSION_ENCRYPTION_KEY não configurada para abrir a sessão cifrada.');
      const bundle = decryptSessionBuffer(
        Buffer.from(file.content.toString('utf8').trim(), 'base64'),
        key
      );
      await unpackAuthBundle(bundle, authDir);
      return { source: 'private-repo' };
    }
  }
  if (env.BAILEYS_SESSION_B64) {
    await unpackAuthBundle(decodeSessionSecret(env.BAILEYS_SESSION_B64), authDir);
    return { source: 'secret' };
  }
  throw new SessionMissingError(
    'Nenhuma sessão Baileys encontrada no repositório privado nem em BAILEYS_SESSION_B64. Nada foi criado.'
  );
}

export async function saveSessionFrom(authDir, { repo, env = process.env } = {}) {
  if (!repo) throw new AppError('REPO_AUSENTE', 'Repositório privado não configurado para salvar a sessão.');
  const key = env.SESSION_ENCRYPTION_KEY;
  if (!key) throw new AppError('SESSION_KEY_AUSENTE', 'SESSION_ENCRYPTION_KEY não configurada para cifrar a sessão.');
  const bundle = await packAuthDir(authDir);
  const encrypted = encryptSessionBuffer(bundle, key);
  const current = await repo.getFile('data/session.enc.b64');
  await repo.putFile('data/session.enc.b64', encrypted.toString('base64'), {
    sha: current?.sha ?? null,
    message: 'chore: atualizar sessão Baileys cifrada'
  });
  return { bytes: encrypted.length };
}

export async function removeAuthDir(authDir) {
  await fs.rm(authDir, { recursive: true, force: true, maxRetries: 3 });
}

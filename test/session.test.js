import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  decryptSessionBuffer,
  encryptSessionBuffer,
  loadSessionInto,
  packAuthDir,
  removeAuthDir,
  saveSessionFrom,
  unpackAuthBundle
} from '../src/lib/session.js';
import { randomBytes } from 'node:crypto';
import { SessionMissingError } from '../src/lib/errors.js';

const KEY = randomBytes(32).toString('base64');

async function makeAuthDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'meditacoes-session-test-'));
  await writeFile(path.join(dir, 'creds.json'), JSON.stringify({ me: { id: 'teste' } }), 'utf8');
  await writeFile(path.join(dir, 'app-state-sync-key-1.json'), JSON.stringify({ key: 'x' }), 'utf8');
  return dir;
}

test('empacota e restaura a sessão sem alterar os arquivos', async () => {
  const source = await makeAuthDir();
  const target = await mkdtemp(path.join(os.tmpdir(), 'meditacoes-session-target-'));
  const bundle = await packAuthDir(source);
  await unpackAuthBundle(bundle, target);
  assert.equal(
    await readFile(path.join(target, 'creds.json'), 'utf8'),
    await readFile(path.join(source, 'creds.json'), 'utf8')
  );
  assert.equal(await readFile(path.join(target, 'app-state-sync-key-1.json'), 'utf8'), '{"key":"x"}');
  await removeAuthDir(source);
  await removeAuthDir(target);
});

test('cifra e decifra a sessão e rejeita chave errada', async () => {
  const source = await makeAuthDir();
  const bundle = await packAuthDir(source);
  const encrypted = encryptSessionBuffer(bundle, KEY);
  const decrypted = decryptSessionBuffer(encrypted, KEY);
  assert.deepEqual(decrypted, bundle);
  assert.throws(() => decryptSessionBuffer(encrypted, randomBytes(32).toString('base64')), /decifrar/);
  await removeAuthDir(source);
});

test('rejeita caminho perigoso dentro do pacote', async () => {
  const malicious = gzipSync(
    Buffer.from(JSON.stringify({ version: 1, files: { '../fora.json': Buffer.from('x').toString('base64') } }))
  );
  const target = await mkdtemp(path.join(os.tmpdir(), 'meditacoes-session-target-'));
  await assert.rejects(() => unpackAuthBundle(malicious, target), /caminho inválido/);
  await removeAuthDir(target);
});

test('sessão ausente falha sem criar pasta', async () => {
  const target = path.join(os.tmpdir(), `meditacoes-ausente-${Date.now()}`);
  await assert.rejects(() => loadSessionInto(target, { repo: null, env: {} }), SessionMissingError);
  await assert.rejects(() => access(target));
});

test('salva e carrega sessão cifrada do repositório privado', async () => {
  const source = await makeAuthDir();
  const files = new Map();
  const repo = {
    async getFile(name) {
      if (!files.has(name)) return null;
      return { content: Buffer.from(files.get(name), 'utf8'), sha: 'sha-1' };
    },
    async putFile(name, content) {
      files.set(name, Buffer.from(content).toString('utf8'));
      return { sha: 'sha-2' };
    }
  };
  await saveSessionFrom(source, { repo, env: { SESSION_ENCRYPTION_KEY: KEY } });
  assert.ok(files.has('data/session.enc.b64'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'meditacoes-session-load-'));
  const result = await loadSessionInto(target, { repo, env: { SESSION_ENCRYPTION_KEY: KEY } });
  assert.equal(result.source, 'private-repo');
  assert.equal(await readFile(path.join(target, 'creds.json'), 'utf8'), '{"me":{"id":"teste"}}');
  await removeAuthDir(source);
  await removeAuthDir(target);
});

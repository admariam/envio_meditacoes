import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateRepoStore } from '../src/lib/private-repo.js';
import { StateConflictError } from '../src/lib/errors.js';

const TOKEN = 'token-super-secreto-que-nao-pode-vazar';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

test('lê arquivo base64 do repositório privado', async () => {
  const calls = [];
  const store = new PrivateRepoStore({
    repo: 'owner/private',
    token: TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, {
        content: Buffer.from('{"ok":true}').toString('base64'),
        encoding: 'base64',
        sha: 'abc'
      });
    }
  });
  const file = await store.getFile('data/config.json');
  assert.equal(file.content.toString('utf8'), '{"ok":true}');
  assert.equal(file.sha, 'abc');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(calls[0].url, /ref=main/);
});

test('arquivo ausente retorna null e erro 401 não expõe token', async () => {
  const store = new PrivateRepoStore({
    repo: 'owner/private',
    token: TOKEN,
    fetchImpl: async () => jsonResponse(404, { message: 'Not Found' })
  });
  assert.equal(await store.getFile('data/state.json'), null);

  const denied = new PrivateRepoStore({
    repo: 'owner/private',
    token: TOKEN,
    fetchImpl: async () => jsonResponse(401, { message: 'Bad credentials' })
  });
  await assert.rejects(
    () => denied.getFile('data/state.json'),
    (error) => {
      assert.equal(error.code, 'GITHUB_AUTH');
      assert.ok(!String(error.message).includes(TOKEN));
      return true;
    }
  );
});

test('grava JSON com SHA e sinaliza conflito', async () => {
  let bodySeen;
  const store = new PrivateRepoStore({
    repo: 'owner/private',
    token: TOKEN,
    fetchImpl: async (url, options) => {
      bodySeen = JSON.parse(options.body);
      return jsonResponse(200, { content: { sha: 'novo-sha' } });
    }
  });
  const result = await store.putJson('data/state.json', { version: 1 }, { sha: 'sha-antigo' });
  assert.equal(result.sha, 'novo-sha');
  assert.equal(bodySeen.sha, 'sha-antigo');
  assert.equal(bodySeen.branch, 'main');

  const conflict = new PrivateRepoStore({
    repo: 'owner/private',
    token: TOKEN,
    fetchImpl: async () => jsonResponse(409, { message: 'Conflict' })
  });
  await assert.rejects(() => conflict.putJson('data/state.json', {}), StateConflictError);
});

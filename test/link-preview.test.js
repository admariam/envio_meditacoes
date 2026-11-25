import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkPreview } from '../src/lib/link-preview.js';

const MESSAGE = 'Quarta-feira, 25/11/2026\nTítulo\nhttps://exemplo.org/meditacao/25-11-2026';

test('sem link na mensagem não há prévia', async () => {
  let called = false;
  const result = await buildLinkPreview('Só texto', { getInfo: async () => { called = true; } });
  assert.equal(result.kind, 'none');
  assert.equal(result.linkPreview, null);
  assert.equal(called, false);
});

test('usa o primeiro link e devolve imagem grande quando o upload funciona', async () => {
  const urls = [];
  const result = await buildLinkPreview(MESSAGE, {
    uploadImage: async () => ({}),
    getInfo: async (url) => {
      urls.push(url);
      return { title: 'T', jpegThumbnail: Buffer.from('x'), highQualityThumbnail: {} };
    }
  });
  assert.deepEqual(urls, ['https://exemplo.org/meditacao/25-11-2026']);
  assert.equal(result.kind, 'image_hq');
});

test('se o upload falha, cai para a miniatura pequena', async () => {
  let calls = 0;
  const result = await buildLinkPreview(MESSAGE, {
    uploadImage: async () => ({}),
    getInfo: async (_url, opts) => {
      calls += 1;
      if (opts.uploadImage) throw new Error('upload falhou');
      return { title: 'T', jpegThumbnail: Buffer.from('x') };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.kind, 'image');
});

test('página sem imagem rende só o título', async () => {
  const result = await buildLinkPreview(MESSAGE, { getInfo: async () => ({ title: 'T' }) });
  assert.equal(result.kind, 'text_only');
});

test('erro em tudo não impede o envio: devolve sem prévia', async () => {
  const result = await buildLinkPreview(MESSAGE, {
    uploadImage: async () => ({}),
    getInfo: async () => {
      throw new Error('rede');
    }
  });
  assert.deepEqual(result, { linkPreview: null, kind: 'none' });
});

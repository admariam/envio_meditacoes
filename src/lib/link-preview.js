import { extractUrlFromText, getUrlInfo } from '@whiskeysockets/baileys';

// Monta a prévia (miniatura) do link da mensagem a partir das metatags da
// página (og:title, og:description, og:image). Nunca lança erro: se a prévia
// não puder ser montada, a mensagem segue só com o texto.

const THUMBNAIL_WIDTH_PX = 192;
const FETCH_TIMEOUT_MS = 10000;
const STEP_TIMEOUT_MS = 30000;

export const PREVIEW_LABELS = {
  image_hq: 'com imagem grande',
  image: 'com imagem pequena',
  text_only: 'só título, sem imagem (a página não tem og:image ou a imagem não carregou)',
  none: 'sem prévia (link ausente ou página sem título)'
};

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function classify(info) {
  if (!info) return 'none';
  if (info.highQualityThumbnail) return 'image_hq';
  if (info.jpegThumbnail) return 'image';
  return 'text_only';
}

/**
 * @param {string} text mensagem completa; usa o primeiro link encontrado
 * @param {{ uploadImage?: Function, getInfo?: Function }} [options]
 *   uploadImage: função de upload do Baileys (sock.waUploadToServer), para a
 *   imagem grande. Sem ela, gera só a miniatura pequena.
 * @returns {Promise<{ linkPreview: object | null, kind: keyof PREVIEW_LABELS }>}
 */
export async function buildLinkPreview(text, { uploadImage, getInfo = getUrlInfo } = {}) {
  const url = extractUrlFromText(String(text ?? ''));
  if (!url) return { linkPreview: null, kind: 'none' };
  const base = { thumbnailWidth: THUMBNAIL_WIDTH_PX, fetchOpts: { timeout: FETCH_TIMEOUT_MS } };

  if (uploadImage) {
    try {
      const info = await withTimeout(getInfo(url, { ...base, uploadImage }), STEP_TIMEOUT_MS);
      if (info) return { linkPreview: info, kind: classify(info) };
    } catch {
      // Tenta de novo sem upload, só com a miniatura pequena.
    }
  }
  try {
    const info = await withTimeout(getInfo(url, base), STEP_TIMEOUT_MS);
    if (info) return { linkPreview: info, kind: classify(info) };
  } catch {
    // Sem prévia; a mensagem vai só com o texto.
  }
  return { linkPreview: null, kind: 'none' };
}

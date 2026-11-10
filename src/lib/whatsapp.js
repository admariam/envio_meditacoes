import { promises as fs } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WAMessageStatus
} from '@whiskeysockets/baileys';
import {
  AckTimeoutError,
  GroupValidationError,
  SendError,
  SessionLoggedOutError,
  SessionMissingError,
  SessionRequiresQrError,
  sanitizeText
} from './errors.js';

const silentLogger = pino({ level: 'silent' });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SendError(code, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function assertSessionDir(authDir) {
  try {
    await fs.access(path.join(authDir, 'creds.json'));
  } catch {
    throw new SessionMissingError('A pasta de sessão temporária não contém creds.json.');
  }
}

export async function createWhatsAppGateway({
  authDir,
  allowedGroupIds,
  requireAck = false,
  ackTimeoutSeconds = 30,
  connectTimeoutMs = 60000,
  groupMetadataTimeoutMs = 30000,
  logger = silentLogger
}) {
  await assertSessionDir(authDir);
  const allowed = new Set(allowedGroupIds.map((id) => String(id).trim()));
  let sock = null;
  let isOpen = false;
  let connecting = null;

  async function disposeSocket() {
    const current = sock;
    sock = null;
    isOpen = false;
    if (!current) return;
    try {
      current.ev.removeAllListeners('connection.update');
      current.ev.removeAllListeners('creds.update');
      current.end(undefined);
    } catch {
      // Encerramento best-effort; não chamamos logout.
    }
    await delay(300);
  }

  async function openOnce() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest?.version;
    } catch {
      version = undefined;
    }
    const socket = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: silentLogger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnline: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 1000,
      maxMsgRetryCount: 2,
      getMessage: async () => undefined
    });
    sock = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      if (update.connection === 'open') isOpen = true;
      if (update.connection === 'close') isOpen = false;
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(new SendError('CONNECT_TIMEOUT', 'Tempo esgotado ao conectar ao WhatsApp.'));
      }, connectTimeoutMs);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.ev.off('connection.update', onUpdate);
        if (error) reject(error);
        else resolve();
      };
      const onUpdate = (update) => {
        if (update.qr) {
          finish(new SessionRequiresQrError());
          return;
        }
        if (update.connection === 'open') {
          isOpen = true;
          finish();
          return;
        }
        if (update.connection === 'close') {
          const statusCode = update.lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            finish(new SessionLoggedOutError());
          } else {
            finish(
              new SendError(
                'CONNECTION_CLOSED',
                `Conexão encerrada antes de abrir${statusCode ? ` (status ${statusCode})` : ''}.`
              )
            );
          }
        }
      };
      socket.ev.on('connection.update', onUpdate);
    });
    if (isOpen) return;
    throw new SendError('CONNECTION_CLOSED', 'A conexão não abriu.');
  }

  async function connect() {
    if (isOpen) return;
    if (connecting) return connecting;
    connecting = (async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await openOnce();
          return;
        } catch (error) {
          lastError = error;
          await disposeSocket();
          if (
            error instanceof SessionLoggedOutError ||
            error instanceof SessionRequiresQrError ||
            error instanceof SessionMissingError
          ) {
            throw error;
          }
          if (attempt < 3) await delay(1000 * attempt);
        }
      }
      throw lastError ?? new SendError('CONNECTION_FAILED', 'Não foi possível conectar ao WhatsApp.');
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  async function assertGroup(groupId) {
    const jid = String(groupId ?? '').trim();
    if (!jid.endsWith('@g.us') || !allowed.has(jid)) {
      throw new GroupValidationError('Destino não está na lista de grupos configurados.');
    }
    if (!sock || !isOpen) throw new SendError('NOT_CONNECTED', 'WhatsApp não está conectado.');
    let metadata;
    try {
      metadata = await withTimeout(
        sock.groupMetadata(jid),
        groupMetadataTimeoutMs,
        'GROUP_METADATA_TIMEOUT',
        'Tempo esgotado ao validar o grupo.'
      );
    } catch (error) {
      if (error instanceof SendError) throw error;
      throw new GroupValidationError('Não foi possível confirmar que o destino é um grupo válido.');
    }
    if (!metadata || String(metadata.id) !== jid) {
      throw new GroupValidationError('O destino não foi confirmado como o grupo configurado.');
    }
    return metadata;
  }

  function waitForAck(messageId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock?.ev.off('messages.update', onUpdate);
        if (error) reject(error);
        else resolve(status);
      };
      const timer = setTimeout(() => {
        finish(new AckTimeoutError(messageId));
      }, timeoutMs);
      const onUpdate = (updates) => {
        const list = Array.isArray(updates) ? updates : [updates];
        for (const entry of list) {
          if (entry?.key?.id !== messageId) continue;
          const status = entry?.update?.status;
          if (typeof status === 'number' && status >= WAMessageStatus.SERVER_ACK) {
            finish(null, status);
            return;
          }
        }
      };
      sock?.ev.on('messages.update', onUpdate);
    });
  }

  async function sendToGroup(groupId, text) {
    const jid = String(groupId ?? '').trim();
    await connect();
    await assertGroup(jid);
    let result;
    try {
      result = await sock.sendMessage(jid, { text });
    } catch (error) {
      throw new SendError(
        'SEND_FAILED',
        `A biblioteca não confirmou o envio: ${sanitizeText(error?.message ?? error)}`
      );
    }
    const messageId = result?.key?.id;
    const remoteJid = result?.key?.remoteJid;
    if (!messageId || typeof messageId !== 'string') {
      throw new SendError('SEND_UNCONFIRMED', 'A biblioteca não retornou o identificador da mensagem.');
    }
    if (remoteJid && String(remoteJid) !== jid) {
      throw new SendError('SEND_WRONG_DESTINATION', 'A biblioteca confirmou um destino diferente do grupo configurado.', {
        sent: true,
        messageId
      });
    }
    if (requireAck) {
      const ackStatus = await waitForAck(messageId, ackTimeoutSeconds * 1000);
      return { messageId, ackStatus };
    }
    return { messageId, ackStatus: null };
  }

  async function ensureConnected() {
    await connect();
  }

  async function close() {
    await disposeSocket();
  }

  return {
    connect,
    ensureConnected,
    sendToGroup,
    close,
    get connected() {
      return isOpen;
    },
    logger
  };
}

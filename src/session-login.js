import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RESTARTS = 3;

const REASON_NAMES = new Map([
  [DisconnectReason.loggedOut, 'loggedOut'],
  [DisconnectReason.forbidden, 'forbidden'],
  [DisconnectReason.timedOut, 'timedOut'],
  [DisconnectReason.multideviceMismatch, 'multideviceMismatch'],
  [DisconnectReason.connectionClosed, 'connectionClosed'],
  [DisconnectReason.connectionReplaced, 'connectionReplaced'],
  [DisconnectReason.badSession, 'badSession'],
  [DisconnectReason.unavailableService, 'unavailableService'],
  [DisconnectReason.restartRequired, 'restartRequired']
]);

const HINTS = new Map([
  [
    DisconnectReason.loggedOut,
    'O WhatsApp encerrou a sessão. Remova o dispositivo antigo em "Aparelhos conectados" e crie uma sessão nova.'
  ],
  [
    DisconnectReason.forbidden,
    'A conexão foi recusada. Verifique se a biblioteca está atualizada e tente novamente.'
  ],
  [
    DisconnectReason.timedOut,
    'Verifique internet, VPN/proxy e se o relógio do sistema está sincronizado.'
  ],
  [
    DisconnectReason.multideviceMismatch,
    'Pode haver incompatibilidade de versão. Atualize a biblioteca e tente novamente.'
  ],
  [
    DisconnectReason.connectionClosed,
    'Verifique internet, firewall, VPN/proxy e o relógio do sistema. Se o QR nunca apareceu, tente atualizar a biblioteca.'
  ],
  [
    DisconnectReason.connectionReplaced,
    'Outra conexão assumiu esta sessão. Feche outras instâncias e tente novamente.'
  ],
  [
    DisconnectReason.badSession,
    'A sessão local ficou inválida. Preserve a pasta atual e crie uma sessão nova.'
  ],
  [
    DisconnectReason.unavailableService,
    'O serviço do WhatsApp está indisponível no momento. Tente novamente em alguns minutos.'
  ]
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeClose(statusCode) {
  if (!statusCode) {
    return {
      message: 'Conexão encerrada antes da conclusão do login.',
      hint: HINTS.get(DisconnectReason.connectionClosed)
    };
  }
  const name = REASON_NAMES.get(statusCode);
  return {
    message: `Conexão encerrada antes da conclusão do login (código ${statusCode}${name ? ` - ${name}` : ''}).`,
    hint: HINTS.get(statusCode)
  };
}

async function pathHasFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  if (process.env.CI) {
    throw new Error('Este comando é somente local e não pode ser executado no GitHub Actions.');
  }
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      'new-session': { type: 'boolean' },
      resume: { type: 'boolean' },
      help: { type: 'boolean' }
    },
    allowPositionals: false
  });
  if (values.help) {
    console.log('Uso: node src/session-login.js --new-session [--dir .baileys-auth]');
    console.log('     node src/session-login.js --resume [--dir .baileys-auth]');
    console.log('--new-session cria uma sessão nova; --resume retoma uma sessão interrompida.');
    console.log('Nenhum dos dois deve ser executado no CI.');
    return 0;
  }
  if (values['new-session'] && values.resume) {
    throw new Error('Escolha apenas uma opção: --new-session ou --resume.');
  }
  if (!values['new-session'] && !values.resume) {
    throw new Error(
      'Criação de sessão não autorizada. Use --new-session para criar uma sessão nova ou --resume para retomar uma sessão interrompida.'
    );
  }
  const dir = path.resolve(values.dir ?? '.baileys-auth');
  if (values.resume) {
    try {
      await fs.access(path.join(dir, 'creds.json'));
    } catch {
      throw new Error(`Não há sessão para retomar em ${dir} (creds.json não encontrado).`);
    }
    console.log(`Retomando a sessão local existente em ${dir}. Nenhum arquivo será apagado.`);
  } else {
    try {
      await fs.access(path.join(dir, 'creds.json'));
      throw new Error(
        `Já existe uma sessão em ${dir}. Ela não será alterada nem substituída. ` +
          'Se a tentativa anterior falhou, preserve a pasta renomeando-a (ex.: .baileys-auth.falha-AAAAMMDD-HHMM) e use uma pasta nova.'
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (await pathHasFiles(dir)) {
      throw new Error(
        `A pasta de destino ${dir} já tem arquivos. Escolha uma pasta vazia para não sobrescrever nada.`
      );
    }
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  let version;
  try {
    version = (await fetchLatestBaileysVersion())?.version;
  } catch {
    version = undefined;
  }

  let activeSocket = null;
  let settled = false;
  let restarts = 0;

  const finish = (error, resolve, reject, timer) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve();
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(
        new Error(
          'Tempo esgotado aguardando o login (5 minutos). ' +
            'Se o QR não apareceu, verifique internet, VPN/proxy, firewall e o relógio do sistema.'
        ),
        resolve,
        reject,
        timer
      );
    }, LOGIN_TIMEOUT_MS);

    const dispose = async (socket) => {
      try {
        socket.ev.removeAllListeners('connection.update');
        socket.ev.removeAllListeners('creds.update');
        socket.end(undefined);
      } catch {
        // Encerramento best-effort; nunca chamamos logout.
      }
      await delay(500);
    };

    const start = async () => {
      if (settled) return;
      const { state, saveCreds } = await useMultiFileAuthState(dir);
      const socket = makeWASocket({
        auth: state,
        ...(version ? { version } : {}),
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        markOnline: false,
        syncFullHistory: false
      });
      activeSocket = socket;
      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', (update) => {
        void (async () => {
          if (settled) return;
          if (update.qr) {
            console.log('\nEscaneie o QR Code com o WhatsApp (somente nesta sessão local):\n');
            qrcode.generate(update.qr, { small: true });
          }
          if (update.connection === 'open') {
            await saveCreds().catch(() => undefined);
            console.log('\nSessão aberta localmente. Nenhuma mensagem foi enviada.');
            console.log('Agora empacote/cifre a sessão e guarde-a no local privado indicado no README.');
            finish(null, resolve, reject, timer);
            return;
          }
          if (update.connection !== 'close') return;
          const statusCode = update.lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.restartRequired) {
            restarts += 1;
            if (restarts > MAX_RESTARTS) {
              const { message, hint } = describeClose(statusCode);
              finish(new Error(`${message}\nO WhatsApp pediu reinício várias vezes. ${hint ?? ''}`), resolve, reject, timer);
              return;
            }
            console.log(`\nO WhatsApp pediu reinício (código 515). Reconectando (${restarts}/${MAX_RESTARTS})...`);
            await dispose(socket);
            if (settled) return;
            try {
              await start();
            } catch (error) {
              finish(error, resolve, reject, timer);
            }
            return;
          }
          const { message, hint } = describeClose(statusCode);
          finish(new Error(hint ? `${message}\nDica: ${hint}` : message), resolve, reject, timer);
        })();
      });
    };

    console.log('Aguardando QR Code local. Nenhuma mensagem será enviada.');
    console.log('Não execute este comando no GitHub Actions nem grave a tela com a sessão.');
    start().catch((error) => finish(error, resolve, reject, timer));
  }).finally(async () => {
    if (activeSocket) {
      try {
        activeSocket.ev.removeAllListeners('connection.update');
        activeSocket.ev.removeAllListeners('creds.update');
        activeSocket.end(undefined);
      } catch {
        // best-effort
      }
    }
    await delay(500);
  });
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

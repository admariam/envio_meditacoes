export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.safeMessage = options.safeMessage ?? message;
    this.exitCode = options.exitCode ?? 2;
    this.details = options.details ?? null;
  }
}

export class ConfigError extends AppError {
  constructor(message, options = {}) {
    super('CONFIG_ERROR', message, { exitCode: 2, ...options });
    this.name = 'ConfigError';
  }
}

export class StateError extends AppError {
  constructor(message, options = {}) {
    super('STATE_ERROR', message, { exitCode: 2, ...options });
    this.name = 'StateError';
  }
}

export class StateConflictError extends StateError {
  constructor(message = 'O estado foi alterado por outra execução.') {
    super(message, { safeMessage: message });
    this.name = 'StateConflictError';
  }
}

export class SessionMissingError extends AppError {
  constructor(message = 'Sessão Baileys ausente. Nenhuma sessão será criada automaticamente.') {
    super('SESSION_MISSING', message, { exitCode: 2 });
    this.name = 'SessionMissingError';
  }
}

export class SessionRequiresQrError extends AppError {
  constructor(message = 'A sessão precisa de novo login por QR. O runner não criará nem exibirá uma nova sessão.') {
    super('SESSION_REQUIRES_QR', message, { exitCode: 2 });
    this.name = 'SessionRequiresQrError';
  }
}

export class SessionLoggedOutError extends AppError {
  constructor(message = 'O WhatsApp encerrou a sessão (logged out). Nenhuma nova sessão foi criada.') {
    super('SESSION_LOGGED_OUT', message, { exitCode: 2 });
    this.name = 'SessionLoggedOutError';
  }
}

export class GroupValidationError extends AppError {
  constructor(message = 'Destino não é um grupo configurado válido.') {
    super('GROUP_VALIDATION', message, { exitCode: 1 });
    this.name = 'GroupValidationError';
  }
}

export class SendError extends AppError {
  constructor(code, message, options = {}) {
    super(code, message, { exitCode: 1, ...options });
    this.name = 'SendError';
    this.sent = options.sent ?? false;
    this.messageId = options.messageId ?? null;
  }
}

export class AckTimeoutError extends SendError {
  constructor(messageId) {
    super('ACK_TIMEOUT', 'O envio foi aceito pela biblioteca, mas a confirmação do servidor não chegou no prazo.', {
      sent: true,
      messageId
    });
    this.name = 'AckTimeoutError';
  }
}

export function sanitizeText(value, maxLength = 500) {
  let text = String(value ?? '');
  text = text
    .replace(/\b\d{6,40}(?:-\d{2,40})?@g\.us\b/gi, '[grupo]')
    .replace(/\b[A-Za-z0-9._%+-]+@s\.whatsapp\.net\b/gi, '[contato]')
    .replace(/\b\d{10,16}\b/g, '[número]')
    .replace(/((?:authorization|bearer|token|secret|senha|password|key)\s*[:=]\s*)\S+/gi, '$1[redigido]');
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
  return text;
}

export function safeError(error) {
  if (!error) return { code: 'ERRO_DESCONHECIDO', message: 'Erro desconhecido.' };
  const code = typeof error.code === 'string' ? error.code : 'ERRO';
  const message = sanitizeText(error.safeMessage ?? error.message ?? String(error));
  return { code, message };
}

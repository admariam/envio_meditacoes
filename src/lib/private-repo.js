import { AppError, StateConflictError, StateError } from './errors.js';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'meditacoes-whatsapp-sender';

function isValidRepo(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value ?? ''));
}

function encodePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PrivateRepoStore {
  constructor({ repo, token, branch = 'main', fetchImpl = globalThis.fetch, logger = null }) {
    if (!isValidRepo(repo)) {
      throw new AppError('REPO_INVALIDO', 'PRIVATE_CONFIG_REPO deve estar no formato owner/repo.');
    }
    if (!token) {
      throw new AppError('TOKEN_AUSENTE', 'PRIVATE_CONFIG_TOKEN não configurado.');
    }
    this.repo = repo;
    this.token = token;
    this.branch = branch || 'main';
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async _request(path, options = {}) {
    const url = new URL(`https://api.github.com/repos/${this.repo}/contents/${encodePath(path)}`);
    if (options.method !== 'PUT') url.searchParams.set('ref', this.branch);
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(options.headers ?? {})
    };
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers,
          body: options.body,
          signal: AbortSignal.timeout(20000)
        });
      } catch (error) {
        lastError = new AppError('GITHUB_REDE', 'Falha de rede ao acessar o repositório privado.');
        if (attempt < 3) {
          await sleep(500 * attempt);
          continue;
        }
        throw lastError;
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * attempt;
        if (attempt < 3) {
          await sleep(Math.min(waitMs, 5000));
          continue;
        }
      }
      return response;
    }
    throw lastError ?? new AppError('GITHUB_API', 'Falha ao acessar o repositório privado.');
  }

  async _readBody(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async getFile(path) {
    const response = await this._request(path, { method: 'GET' });
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        'GITHUB_AUTH',
        'O token do repositório privado não tem permissão de leitura. Verifique o PAT e o repositório.'
      );
    }
    if (!response.ok) {
      const body = await this._readBody(response);
      const safeMessage = typeof body?.message === 'string' ? body.message.slice(0, 200) : `HTTP ${response.status}`;
      throw new AppError('GITHUB_API', `Falha ao ler arquivo privado: ${safeMessage}`);
    }
    const data = await this._readBody(response);
    if (data && data.encoding === 'none' && data.type === 'file') {
      // Arquivos acima de 1 MB vêm sem conteúdo; é preciso pedir o formato bruto.
      const raw = await this._request(path, { method: 'GET', headers: { Accept: 'application/vnd.github.raw' } });
      if (!raw.ok) throw new AppError('GITHUB_API', `Falha ao ler arquivo privado grande: HTTP ${raw.status}`);
      return { content: Buffer.from(await raw.arrayBuffer()), sha: data.sha, path };
    }
    if (!data || data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new AppError('GITHUB_RESPOSTA', 'Resposta inesperada do GitHub ao ler arquivo privado.');
    }
    return {
      content: Buffer.from(data.content.replace(/\n/g, ''), 'base64'),
      sha: data.sha,
      path
    };
  }

  async putFile(path, content, { sha = null, message = 'chore: atualizar dados privados' } = {}) {
    const body = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: this.branch
    };
    if (sha) body.sha = sha;
    const response = await this._request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (response.status === 409 || response.status === 422) {
      throw new StateConflictError('Conflito ao gravar o arquivo privado; recarregue o estado e tente novamente.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        'GITHUB_AUTH',
        'O token do repositório privado não tem permissão de escrita. Verifique o PAT e o repositório.'
      );
    }
    if (!response.ok) {
      const data = await this._readBody(response);
      const safeMessage = typeof data?.message === 'string' ? data.message.slice(0, 200) : `HTTP ${response.status}`;
      throw new AppError('GITHUB_API', `Falha ao gravar arquivo privado: ${safeMessage}`);
    }
    const data = await this._readBody(response);
    return { sha: data?.content?.sha ?? null };
  }

  async getJson(path) {
    const file = await this.getFile(path);
    if (!file) return { value: null, sha: null };
    try {
      return { value: JSON.parse(file.content.toString('utf8')), sha: file.sha };
    } catch {
      throw new StateError(`O arquivo privado ${path} não contém JSON válido.`);
    }
  }

  async putJson(path, value, options = {}) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    return this.putFile(path, content, options);
  }
}

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { emptyState, validateState } from './state.js';
import { StateConflictError, StateError } from './errors.js';

export class MemoryStateStore {
  constructor(state = emptyState()) {
    this.state = validateState(structuredClone(state));
    this.revision = 'memory-0';
    this.saves = 0;
  }

  async load() {
    return { state: structuredClone(this.state), revision: this.revision };
  }

  async save(state, { revision } = {}) {
    if (revision !== undefined && revision !== null && revision !== this.revision) {
      throw new StateConflictError();
    }
    this.state = validateState(structuredClone(state));
    this.saves += 1;
    this.revision = `memory-${this.saves}`;
    return { revision: this.revision };
  }
}

export class GitHubStateStore {
  constructor({ repo, logger = null }) {
    this.repo = repo;
    this.logger = logger;
  }

  async load() {
    const file = await this.repo.getFile('data/state.json');
    if (!file) return { state: emptyState(), revision: null };
    let parsed;
    try {
      parsed = JSON.parse(file.content.toString('utf8'));
    } catch {
      throw new StateError('O estado remoto não contém JSON válido. Nenhum envio será feito.');
    }
    return { state: validateState(parsed), revision: file.sha };
  }

  async save(state, { revision = null } = {}) {
    const payload = structuredClone(state);
    payload.updatedAt = new Date().toISOString();
    const result = await this.repo.putJson('data/state.json', payload, {
      sha: revision,
      message: 'chore: atualizar estado privado de envios'
    });
    return { revision: result.sha };
  }
}

export class FileStateStore {
  constructor(filePath, { readOnly = false } = {}) {
    this.filePath = filePath;
    this.readOnly = readOnly;
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      return {
        state: validateState(parsed),
        revision: createHash('sha256').update(content).digest('hex')
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: emptyState(), revision: null };
      if (error instanceof StateError) throw error;
      throw new StateError('O arquivo de estado local não contém JSON válido.');
    }
  }

  async save(state, { revision = null } = {}) {
    if (this.readOnly) throw new StateError('O estado local está em modo somente leitura.');
    const current = await this.load();
    if (revision !== null && current.revision !== revision) throw new StateConflictError();
    const payload = structuredClone(state);
    payload.updatedAt = new Date().toISOString();
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.filePath);
    return { revision: createHash('sha256').update(content).digest('hex') };
  }
}

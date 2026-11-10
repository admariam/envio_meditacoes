import {
  isValidGroupId,
  maskGroupId,
  serializeConfigJson,
  validateConfig
} from './shared/config.js';
import {
  findDuplicateDates,
  findMissingDates,
  getRecordForDate,
  parseScheduleText,
  serializeScheduleJson,
  serializeScheduleTxt,
  validateRecords,
  validateScheduleRecord
} from './shared/schedule.js';
import { buildDailyMessage } from './shared/message.js';
import { decodeTextBuffer } from './shared/text.js';
import { formatDateBr, getLocalDate, isValidIsoDate, weekdayShortPt } from './shared/dates.js';

const $ = (id) => document.getElementById(id);

const app = {
  groups: [
    { id: '', label: 'Grupo 1' },
    { id: '', label: 'Grupo 2' }
  ],
  sendTime: '06:00',
  timezone: 'America/Sao_Paulo',
  maxDelayMinutes: 180,
  rangeStart: '',
  rangeEnd: '',
  records: [],
  importMeta: { errors: [], warnings: [], duplicates: [], source: null, encoding: null },
  editingIndex: null,
  stateData: null
};

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (value === true) element.setAttribute(key, '');
      else element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined) element.append(child);
  }
  return element;
}

function clear(element) {
  if (element) element.replaceChildren();
}

function setStatus(element, type, content) {
  if (!element) return;
  element.className = `status${type ? ` ${type}` : ''}`;
  clear(element);
  if (content instanceof Node) element.append(content);
  else element.textContent = content ?? '';
}

function setStatusList(element, type, intro, items) {
  const wrapper = node('div');
  wrapper.append(node('p', { text: intro }));
  const list = node('ul');
  for (const item of items) list.append(node('li', { text: item }));
  wrapper.append(list);
  setStatus(element, type, wrapper);
}

function setIssues(container, title, items, type, render) {
  if (!container) return;
  clear(container);
  if (!items || items.length === 0) {
    container.className = 'issues';
    return;
  }
  container.className = `issues ${type}`;
  container.append(node('h3', { text: `${title} (${items.length})` }));
  const list = node('ul');
  for (const item of items) {
    list.append(node('li', { text: render ? render(item) : String(item) }));
  }
  container.append(list);
}

function download(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function currentConfig() {
  return {
    version: 1,
    timezone: app.timezone.trim(),
    sendTime: app.sendTime,
    maxDelayMinutes: Number(app.maxDelayMinutes),
    groups: app.groups.map((group) => ({ id: group.id.trim(), label: group.label.trim() })),
    schedulePeriod:
      app.rangeStart || app.rangeEnd ? { start: app.rangeStart, end: app.rangeEnd } : null,
    requireAck: false,
    ackTimeoutSeconds: 30,
    sendDelayMs: 2000
  };
}

function updateTimezoneOutput() {
  const output = $('dry-timezone');
  if (output) output.textContent = app.timezone || 'America/Sao_Paulo';
}

function todayInConfiguredZone() {
  try {
    return getLocalDate(new Date(), app.timezone || 'America/Sao_Paulo');
  } catch {
    return getLocalDate(new Date(), 'America/Sao_Paulo');
  }
}

function renderGroups() {
  const container = $('groups-list');
  clear(container);
  app.groups.forEach((group, index) => {
    const labelInput = node('input', {
      attrs: {
        type: 'text',
        maxlength: '80',
        autocomplete: 'off',
        'aria-label': `Nome do grupo ${index + 1}`
      }
    });
    labelInput.value = group.label;
    const labelField = node('label', { className: 'field' }, [
      node('span', { text: `Nome do grupo ${index + 1}` }),
      labelInput
    ]);

    const idInput = node('input', {
      attrs: {
        type: 'password',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        placeholder: '1203630...@g.us',
        'aria-label': `ID do grupo ${index + 1}`
      }
    });
    idInput.value = group.id;
    const toggle = node('button', {
      className: 'button secondary small',
      text: 'Mostrar',
      attrs: { type: 'button', 'aria-label': `Mostrar ou ocultar ID do grupo ${index + 1}` }
    });
    const idWrap = node('div', { className: 'id-wrap' }, [idInput, toggle]);
    const idField = node('label', { className: 'field' }, [
      node('span', { text: `ID/JID do grupo ${index + 1}` }),
      idWrap
    ]);

    const remove = node('button', {
      className: 'button danger small',
      text: 'Remover',
      attrs: { type: 'button', 'aria-label': `Remover grupo ${index + 1}` }
    });
    remove.disabled = app.groups.length <= 2;

    const mask = node('span', { className: 'mask' });
    const maskHint = node('span', { text: 'Este campo não é salvo no navegador.' });
    const meta = node('div', { className: 'group-meta' }, [
      node('span', { text: 'Identificação segura: ' }),
      mask,
      maskHint
    ]);

    const updateMask = () => {
      const value = idInput.value.trim();
      if (!value) mask.textContent = 'aguardando ID';
      else if (isValidGroupId(value)) mask.textContent = maskGroupId(value);
      else mask.textContent = 'ID inválido';
    };
    updateMask();

    labelInput.addEventListener('input', () => {
      app.groups[index].label = labelInput.value;
    });
    idInput.addEventListener('input', () => {
      app.groups[index].id = idInput.value;
      updateMask();
    });
    toggle.addEventListener('click', () => {
      const showing = idInput.type === 'text';
      idInput.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? 'Mostrar' : 'Ocultar';
    });
    remove.addEventListener('click', () => {
      if (app.groups.length <= 2) return;
      app.groups.splice(index, 1);
      renderGroups();
    });

    container.append(node('div', { className: 'group-card' }, [labelField, idField, remove, meta]));
  });
  const add = $('add-group');
  if (add) add.disabled = app.groups.length >= 50;
}

function validateConfigNow() {
  const result = validateConfig(currentConfig());
  const status = $('config-status');
  if (result.ok) {
    const label = result.config.groups.length === 1 ? 'grupo' : 'grupos';
    setStatus(status, 'ok', `Configuração válida: ${result.config.groups.length} ${label}, envio às ${result.config.sendTime} em ${result.config.timezone}.`);
  } else {
    setStatusList(
      status,
      'error',
      'Corrija os campos abaixo. Nenhum ID de grupo é exibido nas mensagens de erro.',
      result.errors.map((error) => error.message)
    );
  }
  return result;
}

function renderRecords() {
  const body = $('records-body');
  clear(body);
  const count = $('records-count');
  if (count) count.textContent = `${app.records.length} registro${app.records.length === 1 ? '' : 's'}`;
  const empty = $('records-empty');
  if (empty) empty.hidden = app.records.length > 0;

  app.records.forEach((record, index) => {
    if (app.editingIndex === index) {
      const dateInput = node('input', { className: 'row-input', attrs: { type: 'date', 'aria-label': 'Data' } });
      dateInput.value = record.date;
      const titleInput = node('input', { className: 'row-input', attrs: { type: 'text', maxlength: '300', 'aria-label': 'Título' } });
      titleInput.value = record.title;
      const urlInput = node('input', { className: 'row-input', attrs: { type: 'url', maxlength: '2048', 'aria-label': 'URL' } });
      urlInput.value = record.url;
      const save = node('button', { className: 'button small', text: 'Salvar', attrs: { type: 'button' } });
      const cancel = node('button', { className: 'button secondary small', text: 'Cancelar', attrs: { type: 'button' } });
      save.addEventListener('click', () => {
        const candidate = { date: dateInput.value, title: titleInput.value, url: urlInput.value };
        const validation = validateScheduleRecord(candidate, { line: index + 1 });
        const duplicate =
          validation.errors.length === 0 &&
          app.records.some((item, itemIndex) => itemIndex !== index && item.date === validation.record.date);
        if (validation.errors.length > 0) {
          setStatusList($('record-form-status'), 'error', 'O registro não foi salvo:', validation.errors.map((error) => error.message));
          return;
        }
        if (duplicate) {
          setStatus($('record-form-status'), 'error', 'Já existe outro registro com essa data. Corrija o conflito antes de salvar.');
          return;
        }
        app.records[index] = validation.record;
        app.records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        app.editingIndex = null;
        renderRecords();
        setStatus($('record-form-status'), 'ok', 'Registro atualizado.');
      });
      cancel.addEventListener('click', () => {
        app.editingIndex = null;
        renderRecords();
      });
      const row = node('tr', {}, [
        node('td', {}, [dateInput]),
        node('td', { text: 'Recalculado ao salvar' }),
        node('td', {}, [titleInput]),
        node('td', {}, [urlInput]),
        node('td', { className: 'actions-cell' }, [save, node('span', { text: ' ' }), cancel])
      ]);
      body.append(row);
      return;
    }

    const edit = node('button', { className: 'button secondary small', text: 'Editar', attrs: { type: 'button' } });
    const remove = node('button', { className: 'button danger small', text: 'Excluir', attrs: { type: 'button' } });
    edit.addEventListener('click', () => {
      app.editingIndex = index;
      renderRecords();
    });
    remove.addEventListener('click', () => {
      if (!window.confirm(`Excluir o registro de ${record.date}?`)) return;
      app.records.splice(index, 1);
      app.editingIndex = null;
      renderRecords();
      setStatus($('record-form-status'), 'ok', 'Registro excluído da memória desta página.');
    });
    body.append(
      node('tr', {}, [
        node('td', { text: record.date }),
        node('td', { text: weekdayShortPt(record.date) }),
        node('td', { text: record.title }),
        node('td', { className: 'url', text: record.url }),
        node('td', { className: 'actions-cell' }, [edit, node('span', { text: ' ' }), remove])
      ])
    );
  });
}

function renderImportIssues() {
  const { errors, warnings, duplicates } = app.importMeta;
  setIssues($('import-errors'), 'Erros de importação', errors, 'error', (item) => {
    const prefix = item.line ? `Linha ${item.line}: ` : '';
    return `${prefix}${item.message}`;
  });
  setIssues($('import-warnings'), 'Avisos', warnings, 'warn', (item) => {
    const prefix = item.line ? `Linha ${item.line}: ` : '';
    return `${prefix}${item.message}`;
  });
  setIssues(
    $('import-duplicates'),
    'Datas duplicadas',
    duplicates,
    'error',
    (item) => `Data ${item.date} nas linhas ${item.lines.join(' e ')}. Corrija o conflito.`
  );
  const status = $('import-status');
  if (errors.length > 0 || duplicates.length > 0) {
    setStatus(
      status,
      'error',
      `Importação com ${errors.length} erro(s) e ${duplicates.length} data(s) duplicada(s). A exportação está bloqueada até corrigir e reimportar.`
    );
  } else if (warnings.length > 0) {
    setStatus(status, 'warn', `Importação válida com ${warnings.length} aviso(s). O dia da semana será recalculado.`);
  } else {
    setStatus(status, 'ok', `Importação válida: ${app.records.length} registro(s).`);
  }
}

function applyImport(parsed, source, encoding) {
  app.records = parsed.records.map((record) => ({ ...record }));
  app.importMeta = {
    errors: parsed.errors,
    warnings: parsed.warnings,
    duplicates: parsed.duplicates,
    source,
    encoding
  };
  app.editingIndex = null;
  renderRecords();
  renderImportIssues();
  if (encoding) {
    const status = $('import-status');
    const current = status.textContent ?? '';
    status.textContent = `${current} Codificação detectada: ${encoding}.`;
  }
}

function scheduleValidationErrors() {
  return validateRecords(app.records).errors;
}

function ensureExportableSchedule() {
  if (app.records.length === 0) {
    setStatus($('export-status'), 'error', 'Não há registros para exportar.');
    return null;
  }
  if (app.importMeta.errors.length > 0 || app.importMeta.duplicates.length > 0) {
    setStatus(
      $('export-status'),
      'error',
      'A importação tem erros ou datas duplicadas. Corrija o arquivo e reimporte, ou limpe os avisos após revisar manualmente.'
    );
    return null;
  }
  const errors = scheduleValidationErrors();
  if (errors.length > 0) {
    setStatusList($('export-status'), 'error', 'A programação tem conflitos:', errors.map((error) => error.message));
    return null;
  }
  return app.records;
}

function checkMissingDates() {
  const start = $('range-start').value;
  const end = $('range-end').value;
  const status = $('missing-status');
  const list = $('missing-list');
  clear(list);
  list.hidden = true;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    setStatus(status, 'error', 'Informe as duas datas do intervalo esperado.');
    return;
  }
  if (start > end) {
    setStatus(status, 'error', 'A data inicial não pode ser posterior à final.');
    return;
  }
  const missing = findMissingDates(app.records, start, end);
  if (missing.length === 0) {
    setStatus(status, 'ok', 'Nenhuma data faltante no intervalo informado.');
    return;
  }
  setStatus(
    status,
    'warn',
    `${missing.length} data(s) sem registro no intervalo. Essas datas não serão preenchidas automaticamente e não gerarão envio.`
  );
  list.hidden = false;
  for (const date of missing) list.append(node('li', { text: date }));
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return date.toLocaleString('pt-BR', {
      timeZone: app.timezone || 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  } catch {
    return date.toISOString();
  }
}

function renderState() {
  const data = app.stateData;
  const summary = $('state-summary');
  const runsBody = $('state-runs-body');
  const deliveriesBody = $('state-deliveries-body');
  clear(summary);
  clear(runsBody);
  clear(deliveriesBody);
  const empty = $('state-empty');
  if (!data) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'Nenhum histórico carregado.';
    }
    return;
  }
  if (empty) empty.hidden = true;
  const deliveries = [];
  const counts = { sent: 0, failed: 0, unknown: 0, sending: 0 };
  for (const [date, groups] of Object.entries(data.deliveries ?? {})) {
    for (const delivery of Object.values(groups ?? {})) {
      if (counts[delivery.status] !== undefined) counts[delivery.status] += 1;
      deliveries.push({
        date,
        label: delivery.label ?? 'Grupo',
        status: delivery.status ?? 'desconhecido',
        attempts: delivery.attempts ?? 0,
        sentAt: delivery.sentAt,
        errorCode: delivery.lastError?.code ?? '—'
      });
    }
  }
  deliveries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.label.localeCompare(b.label)));
  const boxes = [
    ['Entregas', deliveries.length],
    ['Enviadas', counts.sent],
    ['Falhas', counts.failed],
    ['Incertas', counts.unknown],
    ['Em andamento', counts.sending],
    ['Execuções', data.runs.length]
  ];
  for (const [label, value] of boxes) {
    summary.append(node('div', { className: 'summary-box' }, [node('strong', { text: String(value) }), node('span', { text: label })]));
  }
  const runs = [...data.runs].slice(-30).reverse();
  for (const run of runs) {
    runsBody.append(
      node('tr', {}, [
        node('td', { text: run.date ?? '—' }),
        node('td', { text: run.mode ?? '—' }),
        node('td', { text: run.result ?? '—' }),
        node('td', { text: String(Array.isArray(run.groups) ? run.groups.length : 0) }),
        node('td', { text: formatTimestamp(run.startedAt) })
      ])
    );
  }
  for (const delivery of deliveries) {
    deliveriesBody.append(
      node('tr', {}, [
        node('td', { text: delivery.date }),
        node('td', { text: delivery.label }),
        node('td', {}, [node('span', { className: `badge ${delivery.status}`, text: delivery.status })]),
        node('td', { text: String(delivery.attempts) }),
        node('td', { text: formatTimestamp(delivery.sentAt) }),
        node('td', { text: delivery.errorCode })
      ])
    );
  }
  setStatus($('state-status'), 'ok', `Histórico carregado localmente: ${deliveries.length} entrega(s), ${data.runs.length} execução(ões).`);
}

function loadStateFile(file) {
  return file.text().then((text) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('O arquivo não contém JSON válido.');
    }
    if (!data || data.version !== 1 || typeof data.deliveries !== 'object' || Array.isArray(data.deliveries) || !Array.isArray(data.runs)) {
      throw new Error('O arquivo não parece ser um state.json válido (version 1, deliveries, runs).');
    }
    app.stateData = data;
    renderState();
  });
}

function simulateDryRun() {
  const status = $('dry-status');
  const preview = $('dry-preview');
  preview.hidden = true;
  preview.textContent = '';
  const configResult = validateConfigNow();
  if (!configResult.ok) {
    setStatus(status, 'error', 'Corrija a configuração antes de simular.');
    return;
  }
  const date = $('dry-date').value;
  if (!isValidIsoDate(date)) {
    setStatus(status, 'error', 'Escolha uma data válida.');
    return;
  }
  let record;
  try {
    record = getRecordForDate(app.records, date);
  } catch {
    setStatus(status, 'error', 'Há mais de um registro para essa data. Corrija a duplicidade antes de simular.');
    return;
  }
  if (!record) {
    setStatus(
      status,
      'warn',
      `A data ${date} não está programada. No envio real, nada seria enviado e o motivo NOT_SCHEDULED seria registrado.`
    );
    return;
  }
  try {
    const message = buildDailyMessage(record);
    preview.textContent = message;
    preview.hidden = false;
    setStatus(
      status,
      'ok',
      `Simulação local concluída para ${configResult.config.groups.length} grupo(s). Nenhuma conexão com o WhatsApp foi feita e nenhum estado foi gravado.`
    );
  } catch {
    setStatus(status, 'error', 'Não foi possível montar a mensagem para essa data.');
  }
}

function setupActionsLink() {
  const host = window.location.hostname;
  if (!host.endsWith('.github.io')) return;
  const owner = host.split('.')[0];
  const parts = window.location.pathname.split('/').filter(Boolean);
  const repo = parts[0];
  const link = $('actions-link');
  if (!owner || !repo || !link) return;
  link.href = `https://github.com/${owner}/${repo}/actions/workflows/daily-send.yml`;
  link.hidden = false;
}

function bindEvents() {
  $('send-time').addEventListener('input', (event) => {
    app.sendTime = event.target.value;
  });
  $('timezone').addEventListener('input', (event) => {
    app.timezone = event.target.value;
    updateTimezoneOutput();
  });
  $('max-delay').addEventListener('input', (event) => {
    app.maxDelayMinutes = event.target.value;
  });
  $('range-start').addEventListener('input', (event) => {
    app.rangeStart = event.target.value;
  });
  $('range-end').addEventListener('input', (event) => {
    app.rangeEnd = event.target.value;
  });
  $('add-group').addEventListener('click', () => {
    if (app.groups.length >= 50) return;
    app.groups.push({ id: '', label: `Grupo ${app.groups.length + 1}` });
    renderGroups();
  });
  $('validate-config').addEventListener('click', validateConfigNow);
  $('export-config').addEventListener('click', () => {
    const result = validateConfigNow();
    if (!result.ok) {
      setStatus($('config-status'), 'error', 'A configuração precisa estar válida antes de exportar.');
      return;
    }
    download(serializeConfigJson(result.config), 'config.private.json', 'application/json');
    setStatus($('config-status'), 'warn', 'Configuração exportada. O arquivo contém IDs privados; mantenha-o somente no repositório privado.');
  });
  $('check-missing').addEventListener('click', checkMissingDates);

  $('schedule-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const decoded = decodeTextBuffer(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseScheduleText(decoded.text, { sourceName: file.name });
      applyImport(parsed, file.name, decoded.encoding);
    } catch {
      setStatus($('import-status'), 'error', 'Não foi possível ler o arquivo selecionado.');
    } finally {
      event.target.value = '';
    }
  });
  $('import-text').addEventListener('click', () => {
    const text = $('schedule-text').value;
    if (!text.trim()) {
      setStatus($('import-status'), 'error', 'Cole o conteúdo antes de importar.');
      return;
    }
    applyImport(parseScheduleText(text, { sourceName: 'texto colado' }), 'texto colado', 'texto');
  });
  $('clear-import-errors').addEventListener('click', () => {
    app.importMeta = { errors: [], warnings: [], duplicates: [], source: app.importMeta.source, encoding: app.importMeta.encoding };
    renderImportIssues();
    setStatus($('import-status'), 'warn', 'Avisos de importação limpos. A exportação ainda valida a programação atual.');
  });

  $('record-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const candidate = {
      date: $('record-date').value,
      title: $('record-title').value,
      url: $('record-url').value
    };
    const validation = validateScheduleRecord(candidate, { line: app.records.length + 1 });
    if (validation.errors.length > 0) {
      setStatusList($('record-form-status'), 'error', 'O registro não foi adicionado:', validation.errors.map((error) => error.message));
      return;
    }
    if (app.records.some((record) => record.date === validation.record.date)) {
      setStatus($('record-form-status'), 'error', 'Já existe um registro com essa data. Corrija o conflito.');
      return;
    }
    app.records.push(validation.record);
    app.records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    $('record-date').value = '';
    $('record-title').value = '';
    $('record-url').value = '';
    renderRecords();
    setStatus($('record-form-status'), 'ok', 'Registro adicionado à memória desta página.');
  });

  $('export-txt').addEventListener('click', () => {
    const records = ensureExportableSchedule();
    if (!records) return;
    download(serializeScheduleTxt(records), 'programacao-meditacoes.txt', 'text/plain;charset=utf-8');
    setStatus($('export-status'), 'warn', 'Cópia legível exportada. Ela contém a programação privada; não publique.');
  });
  $('export-schedule').addEventListener('click', () => {
    const records = ensureExportableSchedule();
    if (!records) return;
    download(serializeScheduleJson(records), 'schedule.private.json', 'application/json');
    setStatus($('export-status'), 'warn', 'Programação exportada. Envie ao repositório privado como data/schedule.json; não publique.');
  });
  $('clear-schedule').addEventListener('click', () => {
    if (!window.confirm('Limpar toda a programação desta página? Os arquivos já exportados não serão apagados.')) return;
    app.records = [];
    app.importMeta = { errors: [], warnings: [], duplicates: [], source: null, encoding: null };
    app.editingIndex = null;
    renderRecords();
    renderImportIssues();
    setStatus($('export-status'), 'ok', 'Programação limpa da memória desta página.');
  });

  $('state-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadStateFile(file);
    } catch (error) {
      app.stateData = null;
      renderState();
      setStatus($('state-status'), 'error', error.message);
    } finally {
      event.target.value = '';
    }
  });
  $('clear-state').addEventListener('click', () => {
    app.stateData = null;
    renderState();
    setStatus($('state-status'), 'ok', 'Histórico carregado removido da memória desta página.');
  });

  $('simulate').addEventListener('click', simulateDryRun);
  $('today-button').addEventListener('click', () => {
    const date = todayInConfiguredZone();
    $('dry-date').value = date;
    setStatus($('dry-status'), 'ok', `Data definida para hoje no fuso ${app.timezone}: ${date}.`);
  });

  setupActionsLink();
}

function init() {
  $('send-time').value = app.sendTime;
  $('timezone').value = app.timezone;
  $('max-delay').value = String(app.maxDelayMinutes);
  updateTimezoneOutput();
  $('dry-date').value = todayInConfiguredZone();
  renderGroups();
  renderRecords();
  renderImportIssues();
  renderState();
  bindEvents();
  setStatus($('config-status'), '', 'Preencha os dois IDs de grupo e clique em "Validar configuração".');
}

init();

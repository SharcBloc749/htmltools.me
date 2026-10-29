import { createEditor } from './editor.js';
import { defaultWorkspace, validateWorkspace, validateName, fileType, extension, makeFile, templates, nextName, safeArchiveName, uid, byteSize, contentSize, MAX_FILE_BYTES, MAX_PROJECT_BYTES, renameWorkspaceFile, isHTML } from './workspace.js';
import { loadWorkspace, saveWorkspace, loadSettings, saveSettings, defaults, clearRetiredAssistant } from './storage.js';
import { importFiles, zipFiles, downloadBlob, fileBytes } from './archive.js';
import { buildPreview, pythonPreview, loadPythonAssets, escapeHTML } from './preview.js';
import { reference } from './reference.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const symbol = file => {
  const type = fileType(file.name)[1];
  return `<span class="file-symbol ${type}" aria-hidden="true">${({ html: '&lt;&gt;', css: '#', javascript: 'JS', typescript: 'TS', jsx: 'JX', tsx: 'TX', python: 'py', markdown: 'M↓', json: '{}', xml: '◇' })[type] || (file.binary ? '▧' : '≡')}</span>`;
};
let toastTimeout;
export function toast(message, duration = 3500) {
  clearTimeout(toastTimeout); $('toast').textContent = message; $('toast').classList.add('show');
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), duration);
}
let workspace, editor, settings = loadSettings();
let revision = 0, savedRevision = 0, saveTimer, saveQueue = Promise.resolve();
let saveFailure = false;
const selected = new Set();
let fileDialogMode = 'new', renameId, lastSelectionIndex = 0, menuFileId, menuTrigger;
let runNumber = 0, previewToken = '', pythonPayload = null, autoRunTimer, logs = [], renderLogsFrame;
let referenceCategory = 'all';
const frame = $('preview-frame');
const activeFile = () => workspace.files.find(file => file.id === workspace.activeId);
const entryFile = () => workspace.files.find(file => file.id === workspace.entryId);
const humanSize = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

function showDialog(id) { closeMenu(); $(id).showModal(); }
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
function confirmAction(title, description, label = 'Delete') {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog'); $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-accept').textContent = label;
    dialog.returnValue = ''; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); showDialog('confirm-dialog');
  });
}
function markChanged() {
  revision++; $('save-status').textContent = 'Saving…'; $('save-status').classList.remove('error');
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400);
}
async function persist() {
  clearTimeout(saveTimer);
  const snapshot = structuredClone(workspace), savedAt = revision;
  saveQueue = saveQueue.catch(() => {}).then(() => saveWorkspace(snapshot));
  try {
    await saveQueue; savedRevision = Math.max(savedRevision, savedAt); saveFailure = false;
    if (savedRevision === revision) { $('save-status').textContent = 'Saved locally'; $('save-status').classList.remove('error'); }
    return true;
  } catch {
    saveFailure = true; $('save-status').textContent = 'Not saved · download a backup'; $('save-status').classList.add('error');
    toast('Local save failed. Your work is still open — download a backup before leaving.', 6500); return false;
  }
}
window.addEventListener('beforeunload', event => {
  if (workspace && (revision > savedRevision || saveFailure)) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && workspace && revision > savedRevision) persist(); });

function renderProject() {
  $('project-name').innerHTML = escapeHTML(workspace.name) + icon('edit'); $('project-name').title = `Rename “${workspace.name}”`;
  document.title = `${workspace.name} · Advanced · HTMLTools`;
  $('file-count').textContent = workspace.files.length;
  $('entry-file').replaceChildren(...workspace.files.map(file => {
    const option = document.createElement('option'); option.value = file.id; option.textContent = file.name; return option;
  }));
  $('entry-file').value = workspace.entryId;
  if (!previewToken) $('preview-file').textContent = entryFile().name;
  renderExplorer(); renderTabs();
}
function renderExplorer() {
  const query = $('file-search').value.toLowerCase();
  const files = workspace.files.filter(file => file.name.toLowerCase().includes(query));
  $('file-list').innerHTML = files.length ? files.map(file => `<div class="file-row ${file.id === workspace.activeId ? 'active' : ''} ${selected.has(file.id) ? 'selected' : ''}" data-file="${escapeHTML(file.id)}"><input type="checkbox" data-select="${escapeHTML(file.id)}" aria-label="Select ${escapeHTML(file.name)}" ${selected.has(file.id) ? 'checked' : ''}><button class="file-open" data-open="${escapeHTML(file.id)}" title="${escapeHTML(file.name)}" ${file.id === workspace.activeId ? 'aria-current="true"' : ''}>${symbol(file)}<span class="file-name-text">${escapeHTML(file.name)}</span>${file.id === workspace.entryId ? '<span class="entry-indicator" title="Entry file" aria-label="Entry file"></span>' : ''}</button><button class="icon-button file-more" data-menu="${escapeHTML(file.id)}" aria-label="Actions for ${escapeHTML(file.name)}" aria-haspopup="menu" title="File actions">${icon('more')}</button></div>`).join('') : '<div class="files-empty">No matching files.</div>';
  $('explorer-selection').hidden = !selected.size; $('selection-label').textContent = `${selected.size} selected`;
  const allSelected = selected.size === workspace.files.length;
  $('select-files').setAttribute('aria-label', allSelected ? 'Clear file selection' : 'Select all files'); $('select-files').title = allSelected ? 'Clear file selection' : 'Select all files';
}
function renderTabs() {
  const scroll = $('file-tabs').scrollLeft;
  $('file-tabs').innerHTML = workspace.files.map(file => `<button class="file-tab ${file.id === workspace.activeId ? 'active' : ''}" id="tab-${escapeHTML(file.id)}" role="tab" aria-selected="${file.id === workspace.activeId}" aria-controls="editor-host" tabindex="${file.id === workspace.activeId ? 0 : -1}" data-open="${escapeHTML(file.id)}" title="${escapeHTML(file.name)}">${symbol(file)}<span>${escapeHTML(file.name)}</span></button>`).join('');
  $('file-tabs').scrollLeft = scroll; $('editor-host').setAttribute('aria-labelledby', 'tab-' + workspace.activeId);
  $('language-label').textContent = activeFile().binary ? 'Image' : fileType(activeFile().name)[0];
}
function openFile(id, focus = false) {
  const file = workspace.files.find(item => item.id === id); if (!file) return;
  const changed = workspace.activeId !== id; workspace.activeId = id;
  editor.open(file, focus); renderExplorer(); renderTabs();
  if (changed) { $('tab-' + id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); markChanged(); }
  if (window.matchMedia('(max-width:760px)').matches) toggleFiles(false);
}
$('file-list').addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) {
    if (event.ctrlKey || event.metaKey) { const id = open.dataset.open; selected.has(id) ? selected.delete(id) : selected.add(id); renderExplorer(); }
    else openFile(open.dataset.open);
  }
  const checkbox = event.target.closest('[data-select]');
  if (checkbox) {
    const index = workspace.files.findIndex(file => file.id === checkbox.dataset.select);
    if (event.shiftKey) for (let i = Math.min(index, lastSelectionIndex); i <= Math.max(index, lastSelectionIndex); i++) checkbox.checked ? selected.add(workspace.files[i].id) : selected.delete(workspace.files[i].id);
    else checkbox.checked ? selected.add(checkbox.dataset.select) : selected.delete(checkbox.dataset.select);
    lastSelectionIndex = index; const focusedId = checkbox.dataset.select; renderExplorer();
    $('file-list').querySelector(`[data-select="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }
  const menu = event.target.closest('[data-menu]'); if (menu) openMenu(menu.dataset.menu, menu);
});
$('file-list').addEventListener('dblclick', event => { const target = event.target.closest('[data-open]'); if (target) showFileDialog('rename', target.dataset.open); });
$('file-list').addEventListener('contextmenu', event => {
  const row = event.target.closest('[data-file]'); if (!row) return;
  event.preventDefault(); openMenu(row.dataset.file, row.querySelector('[data-menu]'), { x: event.clientX, y: event.clientY });
});
$('file-search').addEventListener('input', renderExplorer);
$('file-tabs').addEventListener('click', event => { const tab = event.target.closest('[data-open]'); if (tab) openFile(tab.dataset.open); });
$('file-tabs').addEventListener('keydown', event => {
  const current = workspace.files.findIndex(file => file.id === workspace.activeId); let index;
  if (event.key === 'ArrowLeft') index = (current - 1 + workspace.files.length) % workspace.files.length;
  if (event.key === 'ArrowRight') index = (current + 1) % workspace.files.length;
  if (event.key === 'Home') index = 0; if (event.key === 'End') index = workspace.files.length - 1;
  if (index !== undefined) { event.preventDefault(); openFile(workspace.files[index].id); $('tab-' + workspace.activeId).focus(); }
});
$('select-files').onclick = () => { if (selected.size === workspace.files.length) selected.clear(); else workspace.files.forEach(file => selected.add(file.id)); renderExplorer(); };
$('clear-selection').onclick = () => { selected.clear(); renderExplorer(); };
$('entry-file').onchange = () => { workspace.entryId = $('entry-file').value; markChanged(); renderExplorer(); if (settings.autoRun) scheduleRun(); };
function toggleFiles(force) {
  const show = force ?? !$('workspace-layout').classList.contains('files-open');
  $('workspace-layout').classList.toggle('files-open', show); $('toggle-files').setAttribute('aria-expanded', String(show));
}
$('toggle-files').onclick = () => toggleFiles();
document.addEventListener('pointerdown', event => { if (!event.target.closest('#explorer, #toggle-files, #file-menu, dialog')) toggleFiles(false); });

function showFileDialog(mode = 'new', id) {
  fileDialogMode = mode; renameId = id; const file = workspace.files.find(item => item.id === id);
  $('file-dialog-title').textContent = mode === 'rename' ? 'A new name. Same idea.' : 'A fresh file. A fresh possibility.';
  $('file-template-group').hidden = mode === 'rename'; $('file-name').value = file?.name || 'untitled.txt'; $('file-template').value = 'txt';
  $('file-submit').innerHTML = (mode === 'rename' ? 'Rename file' : 'Create file') + icon(mode === 'rename' ? 'edit' : 'plus');
  $('file-error').hidden = true; updateFileTypeHint(); showDialog('file-dialog'); $('file-name').focus();
  $('file-name').setSelectionRange(0, $('file-name').value.lastIndexOf('.') > 0 ? $('file-name').value.lastIndexOf('.') : $('file-name').value.length);
}
function updateFileTypeHint() {
  $('file-type-hint').textContent = fileDialogMode === 'rename' ? 'Local web file references update automatically. Python imports may need updating.' : `${fileType($('file-name').value)[0]} · ${fileType($('file-name').value)[2]}. Folder paths are welcome.`;
}
$('file-name').oninput = updateFileTypeHint;
$('file-template').onchange = () => {
  const type = $('file-template').value; const base = $('file-name').value.replace(/\.[^/.]*$/, '') || 'untitled';
  $('file-name').value = base + '.' + type; updateFileTypeHint();
};
for (const id of ['new-file', 'add-file-button']) $(id).onclick = () => showFileDialog();
$('file-form').onsubmit = event => {
  event.preventDefault();
  try {
    const name = validateName($('file-name').value, workspace.files, fileDialogMode === 'rename' ? renameId : undefined);
    if (fileDialogMode === 'rename') workspace.files = renameWorkspaceFile(workspace, renameId, name);
    else {
      const file = makeFile(name, templates[$('file-template').value] || '');
      validateWorkspace({ ...workspace, files: [...workspace.files, file] }); workspace.files.push(file); workspace.activeId = file.id; workspace.entryId = file.id;
    }
    $('file-dialog').close(); if (window.matchMedia('(max-width:760px)').matches) toggleFiles(false); markChanged(); renderProject(); editor.open(activeFile(), true);
    toast(fileDialogMode === 'rename' ? 'Renamed. Local web references updated.' : `“${name}” is ready. It’s now your entry file.`);
  } catch (error) { $('file-error').textContent = error.message; $('file-error').hidden = false; }
};
$('project-name').onclick = () => { $('project-name-input').setCustomValidity(''); $('project-name-input').value = workspace.name; showDialog('name-dialog'); $('project-name-input').select(); };
$('project-name-input').oninput = () => $('project-name-input').setCustomValidity('');
$('name-form').onsubmit = event => {
  event.preventDefault(); const name = $('project-name-input').value.trim();
  if (!name) { $('project-name-input').setCustomValidity('Give your project a name.'); $('project-name-input').reportValidity(); return; }
  workspace.name = name; markChanged(); renderProject(); $('name-dialog').close();
};
$('settings-new-project').onclick = () => { $('settings-dialog').close(); $('new-project').click(); };
$('new-project').onclick = async () => {
  if (!await confirmAction('Make room for a fresh start?', 'This replaces the workspace saved in this browser. Download your current files first if you want to keep them.', 'Start fresh')) return;
  stopPreview(false); selected.clear(); workspace = defaultWorkspace(); markChanged(); renderProject(); editor.open(activeFile()); clearConsole(); toast('A fresh start. Make it yours.'); run();
};

function closeMenu(restoreFocus = false) { $('file-menu').hidden = true; menuTrigger?.setAttribute('aria-expanded', 'false'); if (restoreFocus) menuTrigger?.focus(); }
function openMenu(id, trigger, point) {
  menuFileId = id; menuTrigger = trigger; trigger.setAttribute('aria-expanded', 'true'); const file = workspace.files.find(item => item.id === id);
  const menu = $('file-menu');
  menu.innerHTML = [['play', 'Run / preview this file', 'run'], ['edit', 'Rename', 'rename'], ['copy', 'Duplicate', 'duplicate'], ['download', 'Download this file', 'download'], ['trash', 'Delete', 'delete']].map(([image, label, action]) => `${action === 'delete' ? '<hr>' : ''}<button role="menuitem" data-action="${action}" class="${action === 'delete' ? 'danger' : ''}">${icon(image)}${label}</button>`).join('');
  menu.setAttribute('aria-label', `Actions for ${file.name}`); menu.hidden = false;
  const rect = trigger.getBoundingClientRect(); const x = point?.x ?? rect.right; const y = point?.y ?? rect.bottom + 3;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 10)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 10)) + 'px';
  menu.querySelector('button').focus();
}
document.addEventListener('pointerdown', event => { if (!event.target.closest('#file-menu, [data-menu]')) closeMenu(); });
$('file-menu').addEventListener('keydown', event => {
  const items = [...$('file-menu').querySelectorAll('button')]; const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  if (event.key === 'Tab') closeMenu();
});
$('file-menu').onclick = async event => {
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  const file = workspace.files.find(item => item.id === menuFileId); closeMenu(true);
  if (action === 'rename') showFileDialog('rename', file.id);
  if (action === 'download') openDownload([file.id]);
  if (action === 'run') { workspace.entryId = file.id; openFile(file.id); markChanged(); renderProject(); setView(window.innerWidth <= 760 ? 'preview' : 'split'); run(); }
  if (action === 'duplicate') {
    try {
      const copy = { ...file, id: uid(), name: nextName(file.name, workspace.files) };
      validateWorkspace({ ...workspace, files: [...workspace.files, copy] }); workspace.files.push(copy); workspace.activeId = copy.id; markChanged(); renderProject(); editor.open(copy, true); toast('Duplicated as “' + copy.name + '”.');
    } catch (error) { toast(error.message); }
  }
  if (action === 'delete' && await confirmAction(`Delete “${file.name}”?`, 'This removes the file from this workspace. There is no recycle bin; download a copy first if you need it. References to this file are not removed.')) {
    workspace.files = workspace.files.filter(item => item.id !== file.id); selected.delete(file.id); editor.forget(file.id);
    if (!workspace.files.length) workspace.files.push(makeFile('untitled.txt'));
    if (workspace.activeId === file.id) workspace.activeId = workspace.files[0].id;
    if (workspace.entryId === file.id) workspace.entryId = workspace.files.find(item => isHTML(item.name))?.id || workspace.files[0].id;
    markChanged(); renderProject(); editor.open(activeFile(), true); toast('File deleted.');
  }
};

$('import-button').onclick = () => $('import-input').click();
async function importInputs(inputs) {
  if (!inputs.length) return; $('import-button').disabled = true;
  try {
    const files = await importFiles(inputs); if (!files.length) throw new Error('No importable files were found.');
    const existing = new Map(workspace.files.map(file => [file.name.toLowerCase(), file]));
    const duplicates = files.filter(file => existing.has(file.name.toLowerCase()));
    if (duplicates.length && !await confirmAction(`Replace ${duplicates.length} existing file${duplicates.length === 1 ? '' : 's'}?`, `The import contains matching filenames: ${duplicates.map(file => file.name).slice(0, 5).join(', ')}${duplicates.length > 5 ? ', …' : ''}. Matching files will be replaced; other files are kept.`, 'Replace files')) return;
    const updated = [...workspace.files];
    for (const file of files) {
      const match = existing.get(file.name.toLowerCase());
      if (match) updated[updated.findIndex(item => item.id === match.id)] = { ...file, id: match.id };
      else updated.push(file);
    }
    const first = updated.find(file => file.name === files.find(item => /(^|\/)index\.html?$/i.test(item.name))?.name) || updated.find(file => file.name === files[0].name);
    validateWorkspace({ ...workspace, files: updated }); workspace.files = updated; workspace.activeId = first.id; workspace.entryId = first.id;
    markChanged(); renderProject(); editor.open(activeFile()); toast(`Imported ${files.length} file${files.length === 1 ? '' : 's'}. Folder paths kept.`);
  } catch (error) { toast(error.message || 'The import could not be read.', 6500); }
  finally { $('import-button').disabled = false; $('import-input').value = ''; }
}
$('import-input').onchange = event => importInputs([...event.target.files]);
let dragDepth = 0;
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files') && !document.querySelector('dialog[open]')) { event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', event => { if ([...event.dataTransfer.types].includes('Files')) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; } });
document.addEventListener('drop', event => { if (![...event.dataTransfer.types].includes('Files')) return; event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; if (!document.querySelector('dialog[open]')) importInputs([...event.dataTransfer.files]); });

let downloadIds = new Set(), preferZip = false, downloadNameEdited = false;
function openDownload(ids) {
  downloadIds = new Set(ids || (selected.size ? selected : workspace.files.map(file => file.id))); preferZip = false; downloadNameEdited = false;
  $('download-files').innerHTML = workspace.files.map(file => `<label class="download-file"><input type="checkbox" data-download-id="${escapeHTML(file.id)}" ${downloadIds.has(file.id) ? 'checked' : ''}>${symbol(file)}<span class="download-file-name">${escapeHTML(file.name)}</span><span class="size">${humanSize(fileBytes(file).length)}</span></label>`).join('');
  $('download-error').hidden = true; updateDownload(); showDialog('download-dialog');
}
function updateDownload() {
  const count = downloadIds.size; const zip = count > 1 || preferZip;
  $('download-count').textContent = `${count} file${count === 1 ? '' : 's'} selected`; $('download-submit').disabled = !count;
  $('download-as-zip').checked = zip; $('download-as-zip').disabled = count !== 1;
  if (!downloadNameEdited) $('download-name').value = zip || count !== 1 ? safeArchiveName(workspace.name) + '.zip' : workspace.files.find(file => downloadIds.has(file.id)).name.split('/').pop();
  $('download-submit').querySelector('span').textContent = count > 1 || zip ? 'Download ZIP' : 'Download file';
}
$('download-button').onclick = () => openDownload(); $('download-selection').onclick = () => openDownload([...selected]);
$('download-files').onchange = event => { const input = event.target.closest('[data-download-id]'); if (!input) return; input.checked ? downloadIds.add(input.dataset.downloadId) : downloadIds.delete(input.dataset.downloadId); downloadNameEdited = false; updateDownload(); };
$('download-select-all').onclick = () => { downloadIds = new Set(workspace.files.map(file => file.id)); $('download-files').querySelectorAll('input').forEach(input => { input.checked = true; }); downloadNameEdited = false; updateDownload(); };
$('download-select-none').onclick = () => { downloadIds.clear(); $('download-files').querySelectorAll('input').forEach(input => { input.checked = false; }); downloadNameEdited = false; updateDownload(); };
$('download-name').oninput = () => { downloadNameEdited = true; };
$('download-as-zip').onchange = () => { preferZip = $('download-as-zip').checked; downloadNameEdited = false; updateDownload(); };
$('download-form').onsubmit = event => {
  event.preventDefault(); const files = workspace.files.filter(file => downloadIds.has(file.id)); if (!files.length) return;
  try {
    let name = $('download-name').value.trim();
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(name)) throw new Error('Choose a download filename without folders or special characters.');
    const zip = files.length > 1 || preferZip;
    if (zip && !/\.zip$/i.test(name)) name += '.zip';
    const bytes = zip ? zipFiles(files) : fileBytes(files[0]);
    downloadBlob(new Blob([bytes], { type: zip ? 'application/zip' : 'application/octet-stream' }), name);
    $('download-dialog').close(); toast(`${files.length} file${files.length === 1 ? '' : 's'} downloaded${zip ? ' as a ZIP' : ''}.`);
  } catch (error) { $('download-error').textContent = error.message; $('download-error').hidden = false; }
};

function renderSettings() {
  $('setting-font').value = settings.fontSize; $('setting-tab').value = settings.tabSize; $('setting-wrap').checked = settings.wordWrap;
  $('setting-auto').checked = settings.autoRun; $('auto-run').checked = settings.autoRun; $('setting-clear').checked = settings.clearConsole;
  $('wrap-toggle').textContent = settings.wordWrap ? 'Wrap' : 'No wrap'; $('wrap-toggle').setAttribute('aria-pressed', String(settings.wordWrap));
}
function applySettings() {
  editor?.refresh(settings); renderSettings();
  try { saveSettings(settings); } catch { toast('Preferences could not be saved in this browser.'); }
  if (!settings.autoRun) clearTimeout(autoRunTimer);
}
$('settings-button').onclick = () => { renderSettings(); showDialog('settings-dialog'); };
for (const id of ['setting-font', 'setting-tab', 'setting-wrap', 'setting-auto', 'setting-clear']) $(id).onchange = () => {
  settings = { fontSize: Number($('setting-font').value), tabSize: Number($('setting-tab').value), wordWrap: $('setting-wrap').checked, autoRun: $('setting-auto').checked, clearConsole: $('setting-clear').checked }; applySettings();
};
$('auto-run').onchange = () => { settings.autoRun = $('auto-run').checked; applySettings(); if (settings.autoRun) { scheduleRun(); if (extension(entryFile().name) === 'py') toast('Python is always run manually. Auto-run is enabled for other file types.'); } };
$('reset-settings').onclick = () => { settings = { ...defaults }; applySettings(); toast('Preferences restored.'); };
$('wrap-toggle').onclick = () => { settings.wordWrap = !settings.wordWrap; applySettings(); };
$('help-button').onclick = () => showDialog('help-dialog');
$('find-button').onclick = () => { setPage('editor'); if ($('workbench').dataset.view === 'preview') setView('code'); editor.find(); };
function setPage(page) {
  $('editor-page').hidden = page !== 'editor'; $('reference-page').hidden = page !== 'reference';
  for (const item of ['editor', 'reference']) { $('nav-' + item).classList.toggle('active', item === page); if (item === page) $('nav-' + item).setAttribute('aria-current', 'page'); else $('nav-' + item).removeAttribute('aria-current'); }
  if (page === 'editor') editor?.view.requestMeasure();
}
$('nav-editor').onclick = $('back-to-editor').onclick = () => setPage('editor');
$('nav-reference').onclick = () => { renderReference(); setPage('reference'); };
function setView(view) {
  if (view === 'split' && window.matchMedia('(max-width:760px)').matches) view = 'code';
  $('workbench').dataset.view = view;
  document.querySelectorAll('[data-view].icon-button').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  editor?.view.requestMeasure();
}
document.querySelectorAll('[data-view].icon-button').forEach(button => { button.onclick = () => setView(button.dataset.view); });
window.matchMedia('(max-width:760px)').addEventListener('change', event => { if (event.matches && $('workbench').dataset.view === 'split') setView('code'); });
$('preview-size').onchange = () => {
  const size = $('preview-size').value; frame.style.width = size === 'full' ? '100%' : size + 'px'; $('preview-stage').classList.toggle('sized', size !== 'full');
  $('preview-stage').style.justifyContent = size !== 'full' && Number(size) > $('preview-stage').clientWidth ? 'flex-start' : 'center';
};

function clearConsole() { logs = []; renderConsole(); }
function log(level, message) {
  if (!['log', 'info', 'warn', 'error'].includes(level)) level = 'log';
  logs.push({ level, message: String(message).slice(0, 16000), time: new Date().toLocaleTimeString([], { hour12: false }) });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  if (!renderLogsFrame) renderLogsFrame = requestAnimationFrame(() => { renderLogsFrame = null; renderConsole(); });
}
function renderConsole() {
  const output = $('console-output'), filter = $('console-filter').value;
  const nearBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 35;
  const visible = logs.filter(item => filter === 'all' || item.level === filter || filter === 'log' && item.level === 'info');
  output.innerHTML = visible.length ? visible.map(item => `<div class="console-entry ${item.level}"><span class="console-level">${item.level}</span><span class="console-message">${escapeHTML(item.message)}</span><time>${escapeHTML(item.time)}</time></div>`).join('') : `<div class="console-empty">${logs.length ? 'No messages at this level.' : 'A clean slate. Console output will appear here.'}</div>`;
  $('console-count').textContent = logs.length; const errors = logs.filter(item => item.level === 'error').length;
  $('console-summary').textContent = errors ? `${errors} error${errors === 1 ? '' : 's'}` : '';
  if (nearBottom || visible.length <= 1) output.scrollTop = output.scrollHeight;
}
$('clear-console').onclick = clearConsole; $('console-filter').onchange = renderConsole;
$('console-toggle').onclick = () => { const collapsed = $('console-pane').classList.toggle('collapsed'); $('console-toggle').setAttribute('aria-expanded', String(!collapsed)); $('horizontal-resizer').hidden = collapsed; };
function runtimeStatus(message, state = '') {
  $('runtime-status').textContent = message; $('preview-dot').className = 'status-dot' + (state ? ' ' + state : '');
}
function stopPreview(notify = true) {
  runNumber++; previewToken = ''; pythonPayload = null; clearTimeout(autoRunTimer);
  frame.srcdoc = ''; $('preview-placeholder').hidden = false;
  $('preview-placeholder').querySelector('h2').textContent = 'A moment to pause.'; $('preview-placeholder').querySelector('p').textContent = 'Preview stopped. Your files are right where you left them.';
  $('stop-button').disabled = true; $('run-button').disabled = false; $('run-button').querySelector('span').textContent = 'Run';
  runtimeStatus('Preview stopped'); if (notify) toast('Preview stopped.');
}
function scheduleRun() {
  clearTimeout(autoRunTimer); if (!settings.autoRun || extension(entryFile().name) === 'py') return;
  autoRunTimer = setTimeout(() => run(true), 900);
}
async function run(automatic = false) {
  if (!workspace) return;
  const currentRun = ++runNumber; clearTimeout(autoRunTimer); const entry = structuredClone(entryFile()); const files = structuredClone(workspace.files);
  previewToken = uid(); const token = previewToken; pythonPayload = null;
  if (settings.clearConsole) clearConsole();
  // Navigating the iframe also terminates any worker owned by its old document.
  frame.srcdoc = ''; $('stop-button').disabled = false; $('run-button').disabled = true;
  $('run-button').querySelector('span').textContent = 'Building…'; $('preview-file').textContent = entry.name;
  $('preview-placeholder').querySelector('h2').textContent = extension(entry.name) === 'py' ? 'A little Python, coming right up.' : 'Bringing your idea to life…';
  $('preview-placeholder').querySelector('p').textContent = extension(entry.name) === 'py' ? 'Loading the local Python runtime. The first run takes a moment.' : 'Building project files locally. Nothing is uploaded.';
  $('preview-placeholder').hidden = false; runtimeStatus(extension(entry.name) === 'py' ? 'Loading Python…' : 'Building locally…');
  if (!automatic && window.matchMedia('(max-width:760px)').matches) setView('preview');
  try {
    if (extension(entry.name) === 'py') {
      const assets = await loadPythonAssets(); if (currentRun !== runNumber) return;
      // Copies are transferred into the sandbox; the cached runtime stays available.
      pythonPayload = { assets: Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, value.slice(0)])), files, entry: entry.name };
      frame.srcdoc = pythonPreview(token, entry); runtimeStatus('Running Python…', 'running');
    } else {
      const result = await buildPreview(entry, files, token); if (currentRun !== runNumber) return;
      result.warnings.forEach(warning => log('warn', warning)); frame.srcdoc = result.html; runtimeStatus(`${result.mode} · ${entry.name}`, 'running');
    }
    $('preview-placeholder').hidden = true;
  } catch (error) {
    if (currentRun !== runNumber) return;
    const message = error.errors?.map(item => `${item.location ? `${item.location.file}:${item.location.line}:${item.location.column + 1} · ` : ''}${item.text}`).join('\n') || error.message || String(error);
    log('error', message); runtimeStatus('Could not run · check console', 'error');
    $('preview-placeholder').querySelector('h2').textContent = 'A small bump. Nothing lost.'; $('preview-placeholder').querySelector('p').textContent = 'Check the console below for details, make a change, and try again.';
    $('preview-placeholder').hidden = false; $('console-pane').classList.remove('collapsed'); $('horizontal-resizer').hidden = false; $('console-toggle').setAttribute('aria-expanded', 'true');
  } finally {
    if (currentRun === runNumber) { $('run-button').disabled = false; $('run-button').querySelector('span').textContent = 'Run'; }
  }
}
window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== frame.contentWindow || !data || data.workspaceToken !== previewToken || !previewToken) return;
  if (data.type === 'console' && typeof data.message === 'string') { log(data.level, data.message); if (data.level === 'error') $('preview-dot').classList.add('error'); }
  if (data.type === 'finished') { runtimeStatus(data.failed ? 'Python stopped with an error' : 'Python finished', data.failed ? 'error' : ''); $('stop-button').disabled = true; }
  if (data.type === 'python-ready' && pythonPayload) {
    frame.contentWindow.postMessage({ workspaceToken: previewToken, type: 'python-init', ...pythonPayload }, '*', Object.values(pythonPayload.assets)); pythonPayload = null;
  }
  if (data.type === 'navigate') {
    const file = workspace.files.find(item => item.id === data.id); if (!file) return;
    workspace.entryId = file.id; markChanged(); renderProject(); run();
  }
});
$('run-button').onclick = () => run(); $('refresh-preview').onclick = () => run(); $('stop-button').onclick = () => stopPreview();

// Pointer capture + keyboard resizing work across the preview iframe and on touch screens.
function addResizer(id, horizontal) {
  const handle = $(id); let dragging = false;
  function update(event) {
    if (horizontal) {
      const rect = $('output-pane').getBoundingClientRect(); const height = Math.max(90, Math.min(500, rect.height - 100, rect.bottom - event.clientY));
      document.documentElement.style.setProperty('--console-height', height + 'px'); handle.setAttribute('aria-valuenow', Math.round(height));
    } else {
      const rect = $('workbench').getBoundingClientRect(); const percent = Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100));
      document.documentElement.style.setProperty('--split', percent + '%'); handle.setAttribute('aria-valuenow', Math.round(percent));
    }
  }
  handle.addEventListener('pointerdown', event => { if (event.button !== 0) return; dragging = true; handle.setPointerCapture(event.pointerId); handle.classList.add('dragging'); document.body.classList.add('resizing'); document.body.classList.toggle('horizontal', horizontal); event.preventDefault(); });
  handle.addEventListener('pointermove', event => { if (dragging) update(event); });
  const finish = () => { dragging = false; handle.classList.remove('dragging'); document.body.classList.remove('resizing', 'horizontal'); editor?.view.requestMeasure(); };
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish); handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', event => {
    const valid = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']; if (!valid.includes(event.key)) return;
    event.preventDefault(); const value = Number(handle.getAttribute('aria-valuenow'));
    const next = Math.max(horizontal ? 90 : 25, Math.min(horizontal ? 500 : 75, value + (event.key === 'ArrowUp' ? 20 : event.key === 'ArrowDown' ? -20 : event.key === 'ArrowRight' ? 5 : -5)));
    handle.setAttribute('aria-valuenow', next); document.documentElement.style.setProperty(horizontal ? '--console-height' : '--split', next + (horizontal ? 'px' : '%'));
  });
}
addResizer('vertical-resizer', false); addResizer('horizontal-resizer', true);

function renderReference() {
  const query = $('reference-search').value.toLowerCase();
  const items = reference.map((item, index) => ({ ...item, index })).filter(item => (referenceCategory === 'all' || item.c === referenceCategory) && (!query || [item.n, item.d, item.e].some(value => value.toLowerCase().includes(query))));
  $('reference-grid').innerHTML = items.length ? items.map(item => `<button class="reference-card" data-reference="${item.index}" title="Copy example"><span class="reference-card-heading"><strong>${escapeHTML(item.n)}</strong><span class="ref-category">${({ js: 'JavaScript', ts: 'TypeScript', py: 'Python', md: 'Markdown' })[item.c] || item.c.toUpperCase()}</span></span><p>${escapeHTML(item.d)}</p><pre>${escapeHTML(item.e)}</pre><span class="copy-hint">${icon('copy')}Copy example</span></button>`).join('') : '<div class="reference-empty">No matching ideas. Try another search.</div>';
}
$('reference-search').oninput = renderReference;
$('reference-filters').onclick = event => {
  const button = event.target.closest('[data-category]'); if (!button) return; referenceCategory = button.dataset.category;
  $('reference-filters').querySelectorAll('button').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); renderReference();
};
$('reference-grid').onclick = async event => {
  const button = event.target.closest('[data-reference]'); if (!button) return;
  try { await navigator.clipboard.writeText(reference[button.dataset.reference].e); toast('Example copied. Make it your own.'); }
  catch { toast('Copy was blocked. Allow clipboard access to copy examples.'); }
};

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeMenu(); toggleFiles(false); }
  if (document.querySelector('dialog[open]') || !workspace) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key === 'Enter') { event.preventDefault(); run(); }
  else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); if (event.shiftKey) openDownload(); else persist().then(ok => { if (ok) toast('Saved on this device.'); }); }
  else if (modifier && event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); showFileDialog(); }
  else if (event.key === 'F2' && !$('editor-page').hidden) { event.preventDefault(); showFileDialog('rename', workspace.activeId); }
  else if (event.key === '?' && !event.target.closest('input, textarea, [contenteditable="true"]')) { event.preventDefault(); showDialog('help-dialog'); }
});

async function init() {
  clearRetiredAssistant();
  let freshWorkspace = false, restoreFailed = false;
  try { const saved = await loadWorkspace(); workspace = saved ? validateWorkspace(saved) : defaultWorkspace(); freshWorkspace = !saved; }
  catch (error) { restoreFailed = true; workspace = defaultWorkspace(); toast('Could not restore the saved workspace. A starter is open; existing saved data has not been overwritten. ' + (error.message || ''), 7000); }
  $('editor-host').replaceChildren();
  editor = createEditor($('editor-host'), settings, (id, content) => {
    const file = workspace.files.find(item => item.id === id); if (!file) return;
    const size = byteSize(content);
    const totalSize = workspace.files.reduce((sum, item) => sum + (item.id === id ? size : contentSize(item)), 0);
    if (size > MAX_FILE_BYTES || totalSize > MAX_PROJECT_BYTES) { toast(size > MAX_FILE_BYTES ? 'This file exceeds 2 MiB. The last edit was not applied.' : 'This project exceeds 16 MiB. The last edit was not applied.'); editor.replaceAll(file.content); return; }
    file.content = content; markChanged(); scheduleRun();
  }, (line, column, lines) => { $('cursor-position').textContent = `Ln ${line}, Col ${column}`; $('line-count').textContent = `${lines} line${lines === 1 ? '' : 's'}`; });
  renderProject(); editor.open(activeFile()); renderSettings(); setView(window.matchMedia('(max-width:760px)').matches ? 'code' : 'split');
  $('editor-page').inert = false; $('editor-page').setAttribute('aria-busy', 'false');
  $('run-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ↵' : 'Ctrl ↵';
  if (!restoreFailed) await persist();
  else { $('save-status').textContent = 'Restore failed · saved data untouched'; $('save-status').classList.add('error'); }
  if (new URLSearchParams(location.search).has('download')) openDownload();
  // Account functionality is independent from the local editor and its runtimes.
  import('./auth.js').then(module => module.initializeAuth({ toast, beforeRedirect: persist, showDialog })).catch(() => {
    $('account-button').disabled = false;
    $('account-button').onclick = () => { showDialog('auth-dialog'); $('auth-error').hidden = false; $('auth-error').textContent = 'Sign-in could not load. Please check your connection and reload. Your local editor still works.'; };
  });
  // Restoring arbitrary code must never execute it without the user's consent.
  if (freshWorkspace) run(true);
}
init().catch(error => { $('editor-host').textContent = 'The editor could not open. Please reload this page. ' + error.message; $('save-status').textContent = 'Could not open workspace'; });

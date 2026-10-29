const DB = 'htmltools-advanced';
let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Close other Advanced tabs to finish opening your local workspace.'));
  });
  return dbPromise;
}
export async function loadWorkspace() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('workspace').objectStore('workspace').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveWorkspace(workspace) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    transaction.objectStore('workspace').put(workspace, 'current');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Save interrupted.'));
  });
}
export const defaults = { fontSize: 14, tabSize: 2, wordWrap: false, autoRun: false, clearConsole: true };
export function loadSettings() {
  try {
    const data = JSON.parse(localStorage.getItem('ahr3_settings') || 'null');
    if (data && typeof data === 'object') return {
      fontSize: [12, 13, 14, 15, 16, 18].includes(Number(data.fontSize)) ? Number(data.fontSize) : defaults.fontSize,
      tabSize: Number(data.tabSize) === 4 ? 4 : 2,
      wordWrap: data.wordWrap === true, autoRun: data.autoRun === true, clearConsole: data.clearConsole !== false,
    };
    const old = JSON.parse(localStorage.getItem('ahr2_settings') || '{}');
    return { ...defaults, wordWrap: old.wordwrap === true, autoRun: old.autorun === true, clearConsole: old.clearcon !== false };
  } catch { return { ...defaults }; }
}
export function saveSettings(settings) {
  localStorage.setItem('ahr3_settings', JSON.stringify(settings));
}
// The retired assistant no longer retains API keys or conversation histories.
export function clearRetiredAssistant() {
  try { localStorage.removeItem('ahr2_ai'); localStorage.removeItem('ahr2_aichat'); } catch { /* Storage may be disabled. */ }
}

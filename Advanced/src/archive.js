import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { MAX_FILES, MAX_FILE_BYTES, MAX_PROJECT_BYTES, isImage, normalizePath, makeFile } from './workspace.js';
export function fileBytes(file) {
  return file.binary ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : strToU8(file.content);
}
export function encodeBinary(bytes) {
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(encoded);
}
export function zipFiles(files) {
  if (!files.length) throw new Error('Select at least one file to download.');
  const entries = Object.create(null);
  for (const file of files) entries[normalizePath(file.name)] = fileBytes(file);
  return zipSync(entries, { level: 6 });
}
function decodeFile(name, bytes) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`“${name}” is larger than 2 MiB.`);
  if (isImage(name)) return makeFile(name, encodeBinary(bytes), true);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`“${name}” is not UTF-8 text or a supported image.`); }
  if (text.includes('\0')) throw new Error(`“${name}” appears to be a binary file. Import text files or images instead.`);
  return makeFile(name, text);
}
export async function importFiles(inputs) {
  const output = [];
  let totalBytes = 0;
  for (const input of inputs) {
    if (input.size > MAX_PROJECT_BYTES) throw new Error(`“${input.name}” is too large (16 MiB maximum).`);
    const bytes = new Uint8Array(await input.arrayBuffer());
    if (/\.zip$/i.test(input.name)) {
      // Validate advertised uncompressed sizes before inflating (including ZIP bombs).
      let count = 0, inflated = 0;
      const entries = unzipSync(bytes, { filter: entry => {
        if (entry.name.endsWith('/')) return false;
        if (++count > MAX_FILES || entry.originalSize > MAX_FILE_BYTES || (inflated += entry.originalSize) > MAX_PROJECT_BYTES) {
          throw new Error('ZIP exceeds the limit: 250 files, 2 MiB per file, 16 MiB total.');
        }
        normalizePath(entry.name);
        return true;
      } });
      for (const [name, data] of Object.entries(entries)) { output.push(decodeFile(name, data)); totalBytes += data.length; }
    } else {
      output.push(decodeFile(normalizePath(input.webkitRelativePath || input.name), bytes)); totalBytes += bytes.length;
    }
    if (output.length > MAX_FILES || totalBytes > MAX_PROJECT_BYTES) throw new Error('Import exceeds the limit: 250 files or 16 MiB total.');
  }
  const names = new Set();
  for (const file of output) {
    if (names.has(file.name.toLowerCase())) throw new Error(`The import contains more than one “${file.name}”. No files were imported.`);
    names.add(file.name.toLowerCase());
  }
  return output;
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

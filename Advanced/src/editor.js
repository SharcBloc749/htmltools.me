import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, dropCursor, highlightActiveLine, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, indentMore, indentLess } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { fileType, extension } from './workspace.js';

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: '#f0f0f0' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: '#c1c1c1' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#d5d5d5' },
  { tag: [tags.comment, tags.meta], color: '#929292', fontStyle: 'italic' },
  { tag: [tags.tagName, tags.className, tags.typeName], color: '#dedede' },
  { tag: [tags.attributeName, tags.propertyName], color: '#b5b5b5' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#e7e7e7' },
  { tag: tags.heading, color: '#f5f5f5', fontWeight: '600' },
  { tag: tags.link, color: '#c5c5c5', textDecoration: 'underline' },
  { tag: tags.invalid, color: '#ffa8a8' },
]);
const theme = EditorView.theme({
  '&': { color: '#d0d0d0', backgroundColor: '#111111', height: '100%', fontSize: 'var(--editor-font, 14px)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '18px 0', caretColor: '#fff', minHeight: '100%' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '.cm-gutters': { backgroundColor: '#111111', color: '#898989', border: 'none', minWidth: '49px', paddingRight: '5px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#b3b3b3' },
  '.cm-activeLine': { backgroundColor: '#ffffff06' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#eee' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#ffffff24' },
  '.cm-foldGutter': { width: '12px' },
  '.cm-panels': { backgroundColor: '#1b1b1b', color: '#ddd', borderColor: '#363636' },
  '.cm-panel.cm-search': { padding: '12px', fontFamily: 'var(--font)', fontSize: '13px', lineHeight: '2.3' },
  '.cm-textfield': { backgroundColor: '#101010', color: '#eee', border: '1px solid #444', borderRadius: '4px', maxWidth: '160px' },
  '.cm-button': { background: '#282828', color: '#eee', border: '1px solid #444', borderRadius: '4px' },
  '.cm-searchMatch': { backgroundColor: '#ffffff25', outline: '1px solid #777' },
  '.cm-searchMatch-selected': { backgroundColor: '#ffffff40' },
  '.cm-tooltip': { backgroundColor: '#242424', border: '1px solid #444', color: '#ddd' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#444', color: '#fff' },
  '.cm-matchingBracket': { backgroundColor: '#ffffff20', outline: '1px solid #777' },
}, { dark: true });
function language(name) {
  switch (fileType(name)[1]) {
    case 'html': case 'xml': return html({ autoCloseTags: extension(name) !== 'svg' });
    case 'css': return css();
    case 'javascript': return javascript();
    case 'typescript': return javascript({ typescript: true });
    case 'jsx': return javascript({ jsx: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'json': return json();
    case 'markdown': return markdown();
    case 'python': return python();
    default: return [];
  }
}
export function createEditor(parent, settings, onChange, onCursor) {
  const states = new Map();
  const languageConfig = new Compartment(), wrapConfig = new Compartment(), indentConfig = new Compartment(), readOnlyConfig = new Compartment();
  let activeFile, switching = false;
  const extensions = () => [
    lineNumbers(), highlightActiveLineGutter(), history(), foldGutter(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
    rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
      { key: 'Tab', run: indentMore }, { key: 'Shift-Tab', run: indentLess },
      // Escape, then Tab always leaves the editor (CodeMirror's built-in keyboard escape).
    ]),
    theme, syntaxHighlighting(highlight),
    languageConfig.of(language(activeFile?.name || 'index.html')),
    wrapConfig.of(settings.wordWrap ? EditorView.lineWrapping : []),
    indentConfig.of([indentUnit.of(' '.repeat(settings.tabSize)), EditorState.tabSize.of(settings.tabSize)]),
    readOnlyConfig.of(EditorState.readOnly.of(Boolean(activeFile?.binary))),
    EditorView.contentAttributes.of({ 'aria-label': 'Code editor', spellcheck: 'false' }),
    EditorView.updateListener.of(update => {
      if (switching) return;
      if (update.docChanged && activeFile) onChange(activeFile.id, update.state.doc.toString());
      if (update.selectionSet || update.docChanged) reportCursor();
    }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ extensions: extensions() }) });
  function reportCursor() {
    const position = view.state.selection.main.head;
    const line = view.state.doc.lineAt(position);
    onCursor(line.number, position - line.from + 1, view.state.doc.lines);
  }
  function configure() {
    view.dispatch({ effects: [languageConfig.reconfigure(language(activeFile.name)), wrapConfig.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
      indentConfig.reconfigure([indentUnit.of(' '.repeat(settings.tabSize)), EditorState.tabSize.of(settings.tabSize)]),
      readOnlyConfig.reconfigure(EditorState.readOnly.of(Boolean(activeFile.binary))) ] });
    parent.style.setProperty('--editor-font', settings.fontSize + 'px');
  }
  return {
    view,
    open(file, focus = false) {
      if (activeFile) states.set(activeFile.id, view.state);
      switching = true;
      activeFile = file;
      const content = file.binary ? `Image file: ${file.name}\n\nChoose this file as the entry and press Run to preview it.\nYou can rename, duplicate, or download this image from the Files panel.` : file.content;
      let state = states.get(file.id);
      if (!state || state.doc.toString() !== content) state = EditorState.create({ doc: content, extensions: extensions() });
      view.setState(state); configure(); switching = false; reportCursor();
      if (focus) view.focus();
    },
    refresh(nextSettings) { settings = nextSettings; if (activeFile) configure(); },
    forget(id) { states.delete(id); },
    find() { openSearchPanel(view); },
    replaceAll(content) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }); },
    focus() { view.focus(); },
  };
}

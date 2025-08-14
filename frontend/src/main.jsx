import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './components/App.jsx';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label){
    switch(label){
      case 'json': return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less': return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor': return new HtmlWorker();
      case 'typescript':
      case 'javascript': return new TsWorker();
      default: return new EditorWorker();
    }
  }
};

// Guard against double-invocation when Vite HMR re-evaluates this module.
const rootEl = document.getElementById('root');
let root = rootEl.__reactRoot || null;
if(!root){
  root = createRoot(rootEl);
  rootEl.__reactRoot = root;
}
root.render(<AppShell />);

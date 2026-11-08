/**
 * SymPyStudio kernel worker.
 *
 * Runs Pyodide + SymPy off the main thread so a long computation never freezes the UI.
 * Protocol (postMessage):
 *   main -> worker  { type: 'init', mirrors, pyodideSha384, python: {name: source}, interruptBuffer }
 *   main -> worker  { type: 'call', id, fn, args }
 *   worker -> main  { type: 'status', text }
 *   worker -> main  { type: 'ready' } | { type: 'init-error', message }
 *   worker -> main  { type: 'result', id, ok, value | error, interrupted }
 */
'use strict';

let pyodide = null;

function status(text) {
  self.postMessage({ type: 'status', text });
}

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out ${what} (${ms / 1000}s)`)), ms))
  ]);
}

async function sha384Base64(text) {
  const digest = await crypto.subtle.digest('SHA-384', new TextEncoder().encode(text));
  let bin = '';
  new Uint8Array(digest).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

// Fetch pyodide.js, check it against the pinned hash, then evaluate it.
async function loadPyodideScript(indexURL, expectedSha384) {
  const res = await withTimeout(fetch(`${indexURL}pyodide.js`, { mode: 'cors', credentials: 'omit' }), 20000, 'fetching pyodide.js');
  if (!res.ok) throw new Error(`HTTP ${res.status} for pyodide.js`);
  const text = await res.text();
  if (expectedSha384) {
    const got = await sha384Base64(text);
    if (got !== expectedSha384) {
      throw new Error(`pyodide.js integrity check failed (expected sha384-${expectedSha384}, got sha384-${got})`);
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    importScripts(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function boot(msg) {
  let lastError = null;
  for (let i = 0; i < msg.mirrors.length; i++) {
    const { url, name } = msg.mirrors[i];
    try {
      status(`Connecting to ${name} (${i + 1}/${msg.mirrors.length})...`);
      if (typeof self.loadPyodide !== 'function') {
        await loadPyodideScript(url, msg.pyodideSha384);
      }
      status(`1/3 Loading Python runtime (~10 MB, ${name})...`);
      const py = await withTimeout(self.loadPyodide({ indexURL: url }), 90000, 'loading the Python runtime');
      status(`2/3 Loading SymPy (~16 MB, ${name})...`);
      // Packages from the lock file are checked against their recorded SHA-256 hashes.
      await withTimeout(py.loadPackage(['sympy']), 120000, 'downloading SymPy');
      pyodide = py;
      break;
    } catch (err) {
      lastError = err;
      self.loadPyodide = undefined;
      status(`${name} failed: ${err.message || err}`);
    }
  }
  if (!pyodide) throw lastError || new Error('Could not load Pyodide');

  status('3/3 Initializing CAS...');
  const dir = '/home/pyodide/sympystudio';
  pyodide.FS.mkdirTree(dir);
  pyodide.FS.writeFile(`${dir}/latex_parser.py`, msg.python.latex_parser);
  pyodide.runPython(`import sys\nif ${JSON.stringify(dir)} not in sys.path: sys.path.insert(0, ${JSON.stringify(dir)})`);
  pyodide.runPython(msg.python.bootstrap);
  pyodide.runPython(msg.python.runner);
  if (msg.interruptBuffer) pyodide.setInterruptBuffer(msg.interruptBuffer);
}

function toPlain(value) {
  if (value && typeof value.toJs === 'function') {
    const out = value.toJs({ dict_converter: Object.fromEntries });
    value.destroy();
    return out;
  }
  return value;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      await boot(msg);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', message: String(err && err.message || err) });
    }
    return;
  }
  if (msg.type === 'call') {
    if (!pyodide) {
      self.postMessage({ type: 'result', id: msg.id, ok: false, error: 'Kernel is not ready yet.' });
      return;
    }
    let fn = null;
    try {
      fn = pyodide.globals.get(msg.fn);
      if (!fn) throw new Error(`Unknown kernel function ${msg.fn}`);
      const value = toPlain(fn(...(msg.args || [])));
      self.postMessage({ type: 'result', id: msg.id, ok: true, value });
    } catch (err) {
      const text = String(err && err.message || err);
      self.postMessage({
        type: 'result', id: msg.id, ok: false,
        interrupted: /KeyboardInterrupt/.test(text),
        error: text.split('\n').filter(Boolean).slice(-1)[0] || text
      });
    } finally {
      if (fn && typeof fn.destroy === 'function') fn.destroy();
    }
  }
};

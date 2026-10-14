const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Test the production TypeScript with installed tooling, without installing a runner.
function loadTypescript(relativePath, mocks = {}, globals = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, '..', relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const requireLocal = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), id);
      const target = fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return loadTypescript(path.relative(path.resolve(__dirname, '..'), target), mocks, globals, cache);
    }
    return require(id);
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: requireLocal,
    console, URL, URLSearchParams, Date, ...globals }, { filename });
  return module.exports;
}

module.exports = { loadTypescript };

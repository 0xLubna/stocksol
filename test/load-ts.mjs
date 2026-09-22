// Loads a TypeScript module from src/ for tests without a build step or a new dependency: the
// file is transpiled to CommonJS with the project's own typescript (types erased only) and
// compiled in memory; relative imports load the same way, package imports resolve from the repo.

import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const cache = new Map();

export function loadTs(relOrAbsPath) {
  const abs = resolve(relOrAbsPath);
  if (cache.has(abs)) return cache.get(abs);
  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const fake = abs.replace(/\.ts$/, '.transpiled.cjs');
  const mod = new Module(fake, null);
  mod.filename = fake;
  mod.paths = Module._nodeModulePaths(dirname(fake));
  mod.require = (id) => (id.startsWith('.') ? loadTs(resolve(dirname(abs), `${id}.ts`)) : require(id));
  cache.set(abs, mod.exports);
  mod._compile(js, fake);
  return mod.exports;
}

export const typescriptVersion = ts.version;

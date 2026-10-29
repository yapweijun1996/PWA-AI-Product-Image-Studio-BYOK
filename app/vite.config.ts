import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';

function contractValidators(): Plugin {
  const schemas: Record<string, string> = {
    'virtual:product-validator': 'product.schema.json',
    'virtual:export-manifest-validator': 'export-manifest.schema.json',
  };
  return {
    name: 'contract-validators',
    resolveId(id) {
      return schemas[id] ? `\0${id}` : undefined;
    },
    load(id) {
      const filename = schemas[id.startsWith('\0') ? id.slice(1) : id];
      if (!filename) return;
      const schemaPath = new URL(`../contracts/schemas/${filename}`, import.meta.url);
      this.addWatchFile(schemaPath.pathname);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const ajv = new Ajv2020({ code: { source: true, esm: true }, strict: true });
      addFormats(ajv);
      const source = standalone(ajv, ajv.compile(schema))
        .replace('require("ajv/dist/runtime/ucs2length").default', 'ucs2lengthModule')
        .replace('require("ajv-formats/dist/formats").fullFormats', 'fullFormats');
      if (source.includes('require(') || source.includes('new Function')) {
        throw new Error('Unexpected generated contract validator dependency');
      }
      return `import ucs2lengthModule from 'ajv/dist/runtime/ucs2length.js';\n` +
        `import { fullFormats } from 'ajv-formats/dist/formats.js';\n${source}`;
    },
  };
}

function shellWorker(): Plugin {
  return {
    name: 'shell-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
        .map((name) => `/${name}`);
      const files = ['/index.html', '/manifest.webmanifest', '/icons/icon.svg',
        '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png', ...assets];
      const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
        .replace('__BUILD_ID__', JSON.stringify(randomUUID()))
        .replace('__SHELL_FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
export default defineConfig({ define: { __APP_VERSION__: JSON.stringify(appVersion) }, plugins: [react(), contractValidators(), shellWorker()] });

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({ plugins: [react(), shellWorker()] });

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig, type Plugin} from 'vite';

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

const PDFJS_WASM_FILES = [
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'qcms_bg.wasm',
];

function pdfjsWasmPlugin(): Plugin {
  const wasmDir = path.resolve(CONFIG_DIR, 'node_modules/pdfjs-dist/wasm');
  return {
    name: 'pdfjs-wasm-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs-wasm', (req, res, next) => {
        const cleanName = path.basename((req.url || '').split('?')[0]);
        if (!PDFJS_WASM_FILES.includes(cleanName)) {
          next();
          return;
        }
        const filePath = path.join(wasmDir, cleanName);
        if (!fs.existsSync(filePath)) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          cleanName.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'
        );
        fs.createReadStream(filePath).pipe(res);
      });
    },
    generateBundle() {
      for (const fileName of PDFJS_WASM_FILES) {
        const filePath = path.join(wasmDir, fileName);
        if (fs.existsSync(filePath)) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs-wasm/${fileName}`,
            source: fs.readFileSync(filePath),
          });
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), pdfjsWasmPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(CONFIG_DIR, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

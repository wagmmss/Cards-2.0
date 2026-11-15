import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createGeminiRouter } from './server/routes/gemini';
import { createMediaRouter } from './server/routes/media';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use('/api/gemini', createGeminiRouter());
  app.use('/api', createMediaRouter());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 120 * 1000;
  server.keepAliveTimeout = 65 * 1000;
}

startServer();

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/api.ts';
import { seedIfEmpty } from './server/seed.ts';

dotenv.config();

async function startServer() {
  seedIfEmpty();

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());

  // Mount REST API routes
  app.use('/api', apiRouter);

  // Serve local neural model weights
  app.use('/models', express.static(path.resolve(process.cwd(), 'public/models')));

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PyAttendance AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PyAttendance AI server:', err);
  process.exit(1);
});

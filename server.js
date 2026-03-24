import express from 'express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML files from /public
app.use(express.static(join(__dirname, 'public')));

// Dynamically load and route API handlers
async function loadHandler(path) {
  const mod = await import(pathToFileURL(join(__dirname, path)).href);
  return mod.default;
}

async function loadNamedHandler(path, name) {
  const mod = await import(pathToFileURL(join(__dirname, path)).href);
  return mod[name];
}

// Phase 1 routes
app.all('/api/tap',           async (req, res) => (await loadHandler('api/tap.js'))(req, res));
app.all('/api/auth',          async (req, res) => (await loadHandler('api/auth.js'))(req, res));
app.all('/api/ea',            async (req, res) => (await loadHandler('api/ea.js'))(req, res));
app.all('/api/config',        async (req, res) => (await loadHandler('api/config.js'))(req, res));
app.all('/api/config/public', async (req, res) => (await loadHandler('api/config/public.js'))(req, res));
app.all('/api/device',        async (req, res) => (await loadHandler('api/device.js'))(req, res));
app.all('/api/dev/tap',       async (req, res) => (await loadHandler('api/dev/tap.js'))(req, res));

// Phase 2 routes
app.all('/api/chains',            async (req, res) => (await loadHandler('api/chains.js'))(req, res));
app.all('/api/chains/:id',        async (req, res) => (await loadHandler('api/chains.js'))(req, res));
app.all('/api/chains/:id/steps',  async (req, res) => (await loadHandler('api/chains.js'))(req, res));
app.all('/api/chains/:id/steps/:stepId', async (req, res) => (await loadHandler('api/chains.js'))(req, res));
app.all('/api/chain-execute',     async (req, res) => (await loadHandler('api/chain-execute.js'))(req, res));
app.all('/api/chain-execute/log', async (req, res) => (await loadNamedHandler('api/chain-execute.js', 'actionLogHandler'))(req, res));
app.all('/api/upload',            async (req, res) => (await loadHandler('api/upload.js'))(req, res));

// Phase 3 routes
app.all('/api/briefing',          async (req, res) => (await loadHandler('api/briefing.js'))(req, res));
app.all('/api/morning-briefing',  async (req, res) => (await loadHandler('api/morning-briefing.js'))(req, res));

// Page routes
app.get('/',               (req, res) => res.redirect('/api/tap'));
app.get('/stub',           (req, res) => res.sendFile(join(__dirname, 'public/stub.html')));
app.get('/contact',        (req, res) => res.sendFile(join(__dirname, 'public/contact.html')));
app.get('/ea',             (req, res) => res.sendFile(join(__dirname, 'public/ea.html')));
app.get('/challenge',      (req, res) => res.sendFile(join(__dirname, 'public/challenge.html')));
app.get('/config',         (req, res) => res.sendFile(join(__dirname, 'public/config.html')));
app.get('/chains',         (req, res) => res.sendFile(join(__dirname, 'public/chain-builder.html')));
app.get('/action-log',     (req, res) => res.sendFile(join(__dirname, 'public/action-log.html')));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`> Ready at http://localhost:${PORT}`));

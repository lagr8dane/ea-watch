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

app.all('/api/tap',           async (req, res) => (await loadHandler('api/tap.js'))(req, res));
app.all('/api/auth',          async (req, res) => (await loadHandler('api/auth.js'))(req, res));
app.all('/api/ea',            async (req, res) => (await loadHandler('api/ea.js'))(req, res));
app.all('/api/config',        async (req, res) => (await loadHandler('api/config.js'))(req, res));
app.all('/api/config/public', async (req, res) => (await loadHandler('api/config/public.js'))(req, res));
app.all('/api/device',        async (req, res) => (await loadHandler('api/device.js'))(req, res));
app.all('/api/dev/tap',       async (req, res) => (await loadHandler('api/dev/tap.js'))(req, res));

// Page routes
app.get('/',          (req, res) => res.redirect('/api/tap'));
app.get('/stub',      (req, res) => res.sendFile(join(__dirname, 'public/stub.html')));
app.get('/contact',   (req, res) => res.sendFile(join(__dirname, 'public/contact.html')));
app.get('/ea',        (req, res) => res.sendFile(join(__dirname, 'public/ea.html')));
app.get('/challenge', (req, res) => res.sendFile(join(__dirname, 'public/challenge.html')));
app.get('/config',    (req, res) => res.sendFile(join(__dirname, 'public/config.html')));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`> Ready at http://localhost:${PORT}`));

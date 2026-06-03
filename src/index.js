'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app          = express();
const PORT         = process.env.PORT         || 3015;
const DATA_DIR     = process.env.DATA_DIR     || './data';
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'https://descent.rybun.rocks';

app.use(express.json({ limit: '4mb' }));

// CORS — acepta la app principal y localhost para desarrollo
const ALLOWED = new Set([MAIN_APP_URL, 'http://localhost:5173', 'http://localhost:4173']);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Write-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Helpers ────────────────────────────────────────────────────────────────────
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
const ID_RE    = /^[A-Za-z0-9_]{8}$/;
const SNAP_RE  = /^\d{1,4}$/;

function generateId() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => ID_CHARS[b % ID_CHARS.length]).join('');
}

function shareDir(id)  { return path.join(DATA_DIR, id); }
function ensureData()  { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function readMeta(id) {
  return JSON.parse(fs.readFileSync(path.join(shareDir(id), 'meta.json'), 'utf8'));
}
function writeMeta(id, meta) {
  fs.writeFileSync(path.join(shareDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}
function safeMeta(meta) {
  const { write_token_hash, ...rest } = meta;
  return rest;
}

// ── POST /api/share — crear nuevo share ───────────────────────────────────────
app.post('/api/share', (req, res) => {
  try {
    ensureData();
    const { save, saveMeta, actionHistory, label, private: isPrivate } = req.body || {};
    if (!save || typeof save !== 'object') {
      return res.status(400).json({ error: 'save required' });
    }

    let id, tries = 0;
    do {
      id = generateId();
      if (++tries > 50) return res.status(500).json({ error: 'id generation failed' });
    } while (fs.existsSync(shareDir(id)));

    const writeToken = crypto.randomUUID();
    const now = new Date().toISOString();
    fs.mkdirSync(shareDir(id));

    const meta = {
      id,
      created_at:       now,
      label:            label || saveMeta?.partyName || null,
      private:          isPrivate === true,
      write_token_hash: crypto.createHash('sha256').update(writeToken).digest('hex'),
      snapshot_count:   1,
      snapshots:        [{ n: 0, label: label || null, created_at: now }],
      heroes:           (save.heroes || []).map(h => h.id).filter(Boolean),
      act:              saveMeta?.act ?? 0,
      partyName:        saveMeta?.partyName || null,
      actionCount:      (actionHistory || []).length,
    };

    fs.writeFileSync(
      path.join(shareDir(id), '0.json'),
      JSON.stringify({ save, saveMeta: saveMeta || null, actionHistory: actionHistory || [] })
    );
    writeMeta(id, meta);

    res.json({ id, write_token: writeToken, url: `https://d.rybun.rocks/${id}` });
  } catch (err) {
    console.error('POST /api/share:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// ── POST /api/share/:id — añadir snapshot ─────────────────────────────────────
app.post('/api/share/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    if (!fs.existsSync(shareDir(id))) return res.status(404).json({ error: 'not found' });

    const meta  = readMeta(id);
    const token = req.headers['x-write-token'] || '';
    if (!token) return res.status(401).json({ error: 'write token required' });
    if (crypto.createHash('sha256').update(token).digest('hex') !== meta.write_token_hash) {
      return res.status(403).json({ error: 'invalid token' });
    }

    const { save, saveMeta, actionHistory, label } = req.body || {};
    if (!save || typeof save !== 'object') return res.status(400).json({ error: 'save required' });

    const n   = meta.snapshot_count;
    const now = new Date().toISOString();

    fs.writeFileSync(
      path.join(shareDir(id), `${n}.json`),
      JSON.stringify({ save, saveMeta: saveMeta || null, actionHistory: actionHistory || [] })
    );

    meta.snapshot_count = n + 1;
    meta.snapshots.push({ n, label: label || null, created_at: now });
    meta.actionCount = (actionHistory || []).length;
    writeMeta(id, meta);

    res.json({ n, url: `https://d.rybun.rocks/${id}/${n}` });
  } catch (err) {
    console.error(`POST /api/share/${req.params.id}:`, err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// ── GET /api/share/:id — metadata pública ─────────────────────────────────────
app.get('/api/share/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    if (!fs.existsSync(shareDir(id))) return res.status(404).json({ error: 'not found' });
    res.json(safeMeta(readMeta(id)));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

// ── GET /api/share/:id/:n — datos del snapshot ────────────────────────────────
app.get('/api/share/:id/:n', (req, res) => {
  try {
    const { id, n } = req.params;
    if (!ID_RE.test(id) || !SNAP_RE.test(n)) return res.status(400).json({ error: 'invalid params' });
    const file = path.join(shareDir(id), `${n}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.resolve(file));
  } catch {
    res.status(500).json({ error: 'internal error' });
  }
});

// ── GET /api/feed — feed comunitario ──────────────────────────────────────────
app.get('/api/feed', (req, res) => {
  try {
    ensureData();
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0,  0);

    const entries = fs.readdirSync(DATA_DIR)
      .filter(d => ID_RE.test(d) && fs.existsSync(path.join(DATA_DIR, d, 'meta.json')))
      .map(d => { try { return safeMeta(readMeta(d)); } catch { return null; } })
      .filter(m => m && !m.private)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ total: entries.length, entries: entries.slice(offset, offset + limit) });
  } catch (err) {
    console.error('GET /api/feed:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// ── Redirects de URL corta ─────────────────────────────────────────────────────
app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !fs.existsSync(shareDir(id))) return res.status(404).send('Not found');
  res.redirect(302, `${MAIN_APP_URL}/${id}`);
});

app.get('/:id/:n', (req, res) => {
  const { id, n } = req.params;
  if (!ID_RE.test(id) || !SNAP_RE.test(n)) return res.status(404).send('Not found');
  if (!fs.existsSync(path.join(shareDir(id), `${n}.json`))) return res.status(404).send('Not found');
  res.redirect(302, `${MAIN_APP_URL}/${id}/${n}`);
});

app.listen(PORT, () => console.log(`descent-share :${PORT}  data: ${DATA_DIR}`));

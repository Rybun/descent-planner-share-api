# descent-planner-share-api

Backend API for sharing saved games in the [Descent: Legends of the Dark Planner](https://github.com/Rybun/descent-planner).

Deployed as a Docker container on a self-hosted server, proxied through the planner's nginx.

## Related project

- **Frontend / planner**: [Rybun/descent-planner](https://github.com/Rybun/descent-planner)

---

## Stack

- **Node.js 20** + **Express**
- File-based storage (JSON files, no database)
- Docker / Dockge deployment

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/share` | Create a new share |
| `POST` | `/api/share/:id` | Add a new version (snapshot) to an existing share |
| `GET` | `/api/share/:id` | Get share metadata (public, no write token) |
| `GET` | `/api/share/:id/:n` | Get snapshot data (full save state) |
| `GET` | `/api/feed` | Community feed of public shares |
| `GET` | `/:id` | Short-link redirect → planner app |
| `GET` | `/:id/:n` | Short-link redirect → planner app at specific version |

### POST /api/share — Create share

**Body:**
```json
{
  "save": { ...gameState },
  "saveMeta": { "partyName": "...", "act": 0, "slotGUID": "..." },
  "actionHistory": [ ...actions ],
  "originalState": { ...originalGameState },
  "label": "Session 5",
  "private": false
}
```

**Response:**
```json
{
  "id": "AbCd1234",
  "write_token": "uuid-to-add-versions",
  "url": "https://d.rybun.rocks/AbCd1234"
}
```

- IDs are 8 characters from `[A-Za-z0-9_]` (~248 billion combinations)
- `write_token` is returned only once; store it client-side to add versions later
- `private: true` excludes the share from the community feed

### POST /api/share/:id — Add version

**Headers:** `X-Write-Token: <write_token>`

**Body:** same as `POST /api/share` (save, saveMeta, actionHistory, originalState, label)

**Response:**
```json
{ "n": 1, "url": "https://d.rybun.rocks/AbCd1234/1" }
```

### GET /api/share/:id — Metadata

```json
{
  "id": "AbCd1234",
  "created_at": "2026-06-02T10:00:00.000Z",
  "label": "Session 5",
  "private": false,
  "snapshot_count": 2,
  "snapshots": [
    { "n": 0, "label": null, "created_at": "..." },
    { "n": 1, "label": "After buying sword", "created_at": "..." }
  ],
  "heroes": ["HERO_BRYNN", "HERO_SYRUS"],
  "act": 0,
  "partyName": "The Brave",
  "actionCount": 7
}
```

Note: `write_token_hash` is never exposed.

### GET /api/feed

Query params: `limit` (default 20, max 100), `offset` (default 0)

Returns public shares sorted by creation date (newest first). Private shares are excluded.

---

## Data storage

```
$DATA_DIR/
└── {id}/                   # one folder per share
    ├── meta.json           # public metadata + write_token_hash
    └── {n}.json            # snapshot n (0, 1, 2, ...)
```

Each `{n}.json`:
```json
{
  "save": { ...gameState },
  "saveMeta": { ... },
  "actionHistory": [ ... ],
  "originalState": { ... }
}
```

## Security

- **Write token**: returned once at creation, stored client-side. Server only stores SHA-256 hash.
- **CORS**: only allows requests from `MAIN_APP_URL`, `http://localhost:5173`, `http://localhost:4173`.
- **Port**: bound to `127.0.0.1:3015` only — not exposed directly to the internet; proxied via nginx.

---

## Docker deployment (Dockge)

Stack path on server: `/opt/stacks/descent-share/`

```yaml
services:
  descent-share:
    build: .
    container_name: descent-share
    restart: unless-stopped
    environment:
      - TZ=${TZ}
      - PORT=3015
      - DATA_DIR=/data
      - MAIN_APP_URL=https://descent.rybun.rocks
    volumes:
      - ${DATA_DIR}/descent-share:/data
    ports:
      - "127.0.0.1:3015:3015"
    networks:
      - lb_network
networks:
  lb_network:
    external: true
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3015` | Port the server listens on |
| `DATA_DIR` | `./data` | Directory where share data is stored |
| `MAIN_APP_URL` | `https://descent.rybun.rocks` | Base URL of the planner app (used in redirect responses and CORS) |

### Redeploy after code changes

```bash
scp src/index.js pi5:/opt/stacks/descent-share/src/index.js
ssh pi5 "cd /opt/stacks/descent-share && sudo docker compose up -d --build"
```

---

## Development

```bash
cd src
npm install
PORT=3015 DATA_DIR=./data node index.js
```

Requires Node.js 18+.

## nginx proxy (planner side)

The planner's nginx routes `/api/share` and `/api/feed` to this container:

```nginx
location /api/share {
    proxy_pass http://descent-share:3015/api/share;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
location /api/feed {
    proxy_pass http://descent-share:3015/api/feed;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

# Running and hosting SyncSpace

SyncSpace is two services (`backend/`, `web/`) plus two data stores (MongoDB, Redis). This
covers running everything locally, then hosting it for a public demo.

## Architecture recap

```
Next.js (App Router)  ──HTTP──▶  Express REST API ──▶ MongoDB (users, documents, versions, export jobs)
      │                                │
      └────────WebSocket──────────────▶│──▶ Redis (Yjs cross-instance relay, BullMQ queues)
```

The frontend (`web/`) talks to the Express backend directly over both HTTP and WebSocket from the
browser — Next.js/Vercel is never in the WebSocket connection path, so nothing about hosting the
backend changes based on which frontend framework is in front of it.

The backend serves both the REST API and the `/yjs/:docId` WebSocket upgrade on the **same port** —
there's only one backend process/URL to host, not two.

---

## 1. Running locally

### Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for MongoDB + Redis) — or point at existing local installs of both

### Start MongoDB + Redis

From the repo root:

```bash
docker compose up -d
```

This starts Mongo on `27017` and Redis on `6380` (deliberately not Redis's default `6379`, so it
never collides with another Redis instance already running on your machine), both with named
volumes so data survives a container restart.

> If you already have `syncspace-mongo`/`syncspace-redis` containers running from earlier manual
> `docker run` commands, `docker compose up -d` will fail with a container name conflict. Either
> stop and remove the old ones first (`docker rm -f syncspace-mongo syncspace-redis` — your data
> lives in Mongo/Redis's own volumes either way, so this is safe as long as you're not deleting
> those volumes) or just keep using the containers you already have; the compose file is mainly
> there so a fresh clone of this repo has a one-command way to stand up the same infra.

### Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set `JWT_SECRET` — generate one with:

```bash
openssl rand -hex 32
```

The other defaults in `.env.example` already match `docker-compose.yml` (Mongo on `27017`, Redis on
`6380`), so nothing else needs to change for local dev.

```bash
npm install
npm run dev
```

You should see:

```
MongoDB connected: localhost/syncspace
SyncSpace backend listening on http://localhost:4000
```

### Frontend

In a second terminal:

```bash
cd web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000 — already correct for local dev
npm install
npm run dev
```

Open the printed URL (typically `http://localhost:3000`, or the next free port if something else is
already on it). Register an account, create a document, and open it in a second browser tab/incognito
window to see real-time sync working.

---

## 2. Preparing to host it

The project currently has no git history. Before deploying anywhere, put it on GitHub — every
hosting option below deploys from a GitHub repo.

```bash
cd ~/Desktop/SyncSpace
git add -A
git commit -m "Initial commit"
```

Then create a new **empty** repo on GitHub (no README/license — you already have files) and push:

```bash
git remote add origin git@github.com:<your-username>/syncspace.git
git branch -M main
git push -u origin main
```

`.env`/`.env.local` are already gitignored in both `backend/` and `web/` — real secrets never get
committed.

---

## 3. Hosting the data stores

### MongoDB — MongoDB Atlas (free M0 tier is enough for a portfolio demo)

1. Create a free cluster at https://cloud.mongodb.com.
2. **Database Access** → add a user with a generated password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere) — fine for a demo; a real production
   deployment would instead allowlist only the hosting provider's egress IPs.
4. **Connect → Drivers** → copy the connection string, e.g.
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/syncspace?retryWrites=true&w=majority`
   — this becomes `MONGO_URI`.

### Redis — Upstash (free tier, works well for BullMQ + pub/sub)

1. Create a free database at https://upstash.com.
2. Copy the **TLS** connection URL — it starts with `rediss://` (note the extra `s`). ioredis
   detects `rediss://` automatically and enables TLS; no code change needed.
3. This becomes `REDIS_URL`.

Any Redis add-on from your backend host (Render Key Value, Railway Redis, etc.) works equally well
if you'd rather keep everything under one provider.

---

## 4. Hosting the backend — Render (Web Service)

Render is the easiest fit here: WebSockets work on Render's Web Services out of the box, and it has
a generous free tier.

1. https://dashboard.render.com → **New → Web Service** → connect your GitHub repo.
2. **Root Directory:** `backend`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Health Check Path:** `/health` (already implemented in `app.js`)
6. **Environment variables** (Render's Environment tab):
   | Key | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string |
   | `REDIS_URL` | your Upstash `rediss://...` URL |
   | `JWT_SECRET` | output of `openssl rand -hex 32` |
   | `CLIENT_ORIGIN` | your frontend's deployed URL (set this **after** step 5 below, once you know it) |
   | `PORT` | leave unset — Render injects its own `PORT` and the app already reads `process.env.PORT` |

Deploy. Render gives you a URL like `https://syncspace-backend.onrender.com` — that's your API base
URL for the frontend's `NEXT_PUBLIC_API_URL`.

Note: Render's free tier spins the service down after inactivity: the first request after a while
takes ~30-60s to wake it up. Fine for a portfolio demo; upgrade to a paid instance to avoid it for
something more interview-critical (a live walkthrough).

---

## 5. Hosting the frontend — Vercel

1. https://vercel.com/new → import the same GitHub repo.
2. **Root Directory:** `web`
3. Framework preset: Next.js (auto-detected).
4. **Environment variable:**
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | your Render backend URL from step 4, e.g. `https://syncspace-backend.onrender.com` |
5. Deploy. Vercel gives you a URL like `https://syncspace.vercel.app`.

Vercel is the natural fit here (zero-config Next.js support), but this app doesn't lean on any
Vercel-specific feature — Render's Web Service (`npm run build` then `npm start`) or any other
Node host works identically, since the real-time transport goes straight from the browser to the
Express backend regardless of where the Next.js app itself is hosted.

### Close the loop on CORS

Go back to the Render backend's environment variables and set `CLIENT_ORIGIN` to the Vercel URL
from step 5 (e.g. `https://syncspace.vercel.app`), then redeploy the backend. Until this is set
correctly, the frontend's requests will fail CORS with an error visible in the browser console.

---

## 6. Verifying the deployed app

1. Open the Vercel URL, register an account, create a document, type some content.
2. Open the same document URL in a second browser (or incognito) tab, confirm edits sync live.
3. Open browser dev tools → Network → WS — confirm a WebSocket connection to
   `wss://<your-render-url>/yjs/<docId>` shows status 101 (switching protocols), not a failed
   connection. If it fails, `CLIENT_ORIGIN`/`VITE_API_URL` is the most likely mismatch to check first.
4. Try History → Save version, edit, Restore — confirm content reverts.
5. Try Export → Markdown — confirm the job reaches "done" and downloads correctly.

---

## 7. Optional: demonstrating horizontal scaling (the V3 resume story)

The Redis relay (`redisRelay.js`) exists specifically so more than one backend instance can serve
the same document consistently. To actually demonstrate this rather than just claim it:

- On Render, bump the Web Service's **instance count** to 2 (available on paid plans; Render's
  autoscaling routes different clients to different instances behind its load balancer).
- Open the same document from two different networks/devices (so the load balancer is more likely
  to route them to different instances) and confirm edits still sync — proof that Redis, not
  the shared in-memory Y.Doc, is what's actually keeping them in sync.

This isn't required for a working demo — a single instance is completely sufficient — but it's the
one piece of the architecture that specifically justifies "designed for horizontal scaling" on a
resume, so it's worth doing once to have a screenshot/description of having proven it live rather
than just in local testing.

---

## Troubleshooting

- **CORS error in browser console:** `CLIENT_ORIGIN` on the backend doesn't match the frontend's
  actual deployed origin exactly (scheme + host, no trailing slash).
- **WebSocket never connects (stuck on "Connecting...")::** check `NEXT_PUBLIC_API_URL` was set at
  *build* time on Vercel (Next.js inlines `NEXT_PUBLIC_*` vars via static replacement at build time,
  not read at runtime — changing the env var requires a redeploy, not just a restart). Also a classic
  local-dev gotcha: if something else is already running on port 3000, Next.js silently falls back to
  3001 (or the next free port) — make sure the backend's `CLIENT_ORIGIN` matches whichever port your
  frontend actually landed on, printed in its own terminal output.
- **Backend crashes on boot with a Mongo/Redis connection error:** double-check the connection
  strings were pasted completely (Atlas/Upstash URLs are long and easy to truncate) and that
  Atlas's Network Access allowlist includes `0.0.0.0/0` (or Render's specific egress IPs).
- **BullMQ jobs never complete (export stuck on "queued"):** confirms Redis connectivity — the
  worker runs in the same backend process, so if the API works but jobs never process, the Redis URL
  the process started with is likely wrong or unreachable from Render's network.

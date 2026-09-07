# SyncSpace — Frontend

Next.js (App Router) client for [SyncSpace](../README.md) — real-time text documents and Excalidraw whiteboards. See the [root README](../README.md) for the full architecture, and [`DEPLOYMENT.md`](../DEPLOYMENT.md) for deploying this app.

## Local development

Requires the backend (`../backend`) running, plus MongoDB and Redis (`docker compose up -d` from the repo root).

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` to the backend's base URL (default `http://localhost:4000`).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve a production build |
| `npm run lint` | Lint the codebase |

## Structure

- `src/app/(auth)/` — login/register, unauthenticated layout
- `src/app/(app)/` — dashboard, `documents/[id]` (text editor), `boards/[id]` (whiteboard) — client-side auth-gated
- `src/components/` — shadcn UI primitives plus app components (`document-chrome`, `share-panel`, `version-history-drawer`, `whiteboard/excalidraw-board`)
- `src/realtime/` — `use-yjs-document` (Yjs client + WebSocket provider) and `use-ytext-binding` (Yjs ↔ textarea binding)
- `src/api/` — REST client and shared types

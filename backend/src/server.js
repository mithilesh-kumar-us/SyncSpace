import "dotenv/config";

import { app } from "./app.js";
import { connectDB } from "./config/db.js";
import { startExportWorker } from "./jobs/exportWorker.js";
import { startSnapshotScheduler } from "./jobs/snapshotScheduler.js";
import { attachYjsServer } from "./realtime/yjsServer.js";

const PORT = process.env.PORT || 4000;

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in .env — generate one with: openssl rand -hex 32");
}

await connectDB();

const httpServer = app.listen(PORT, () =>
  console.log(`SyncSpace backend listening on http://localhost:${PORT}`),
);

// The Yjs WebSocket upgrade is attached to the same underlying HTTP server
// Express listens on, not a second port — one process, one port, two protocols.
attachYjsServer(httpServer);

// BullMQ workers run in this same process for now — one Node process per
// instance is enough at this project's scale; splitting workers into a
// separate process is a scaling change to make later if export volume ever
// warrants it, not something to build ahead of need.
startExportWorker();
await startSnapshotScheduler();

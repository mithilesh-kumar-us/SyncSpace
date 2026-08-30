import { Worker } from "bullmq";

import { bullConnection, SNAPSHOT_QUEUE, snapshotQueue } from "../config/queue.js";
import { DocumentVersion } from "../models/DocumentVersion.js";
import { getDirtyRoomSnapshots } from "../realtime/yjsServer.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const TICK_JOB_ID = "auto-snapshot-tick";

// Registers a repeatable BullMQ job that ticks every SNAPSHOT_INTERVAL_MS and
// starts the worker that responds to it. Each tick only snapshots rooms this
// process actually has open in memory and that changed since their last
// snapshot — an idle or already-snapshotted document costs nothing.
//
// In a horizontally-scaled deployment (see V3) each instance runs its own
// copy of this scheduler over its own subset of open rooms. If the same
// document happens to have connections split across two instances, both
// could independently auto-snapshot it around the same time — a harmless
// duplicate version, not a correctness bug, and simpler than coordinating a
// single elected scheduler across instances for what's still a
// portfolio-scale project.
export async function startSnapshotScheduler() {
  await snapshotQueue.add("tick", {}, { repeat: { every: SNAPSHOT_INTERVAL_MS }, jobId: TICK_JOB_ID });

  return new Worker(
    SNAPSHOT_QUEUE,
    async () => {
      for (const { docId, state, markClean } of getDirtyRoomSnapshots()) {
        await DocumentVersion.create({
          document: docId,
          yjsState: state,
          source: "auto",
        });
        markClean();
      }
    },
    { connection: bullConnection },
  );
}

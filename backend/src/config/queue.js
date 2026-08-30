import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6380";

// BullMQ's own docs require this — it uses blocking Redis commands
// internally and needs a connection that never gives up retrying them,
// rather than ioredis's normal retry-limit behavior.
export const bullConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export const EXPORT_QUEUE = "export";
export const SNAPSHOT_QUEUE = "snapshot";

// Created once here and imported everywhere a producer needs to add a job —
// a Queue instance opens its own Redis connections, so building a fresh one
// per request (e.g. inside a controller) would leak connections over time.
export const exportQueue = new Queue(EXPORT_QUEUE, { connection: bullConnection });
export const snapshotQueue = new Queue(SNAPSHOT_QUEUE, { connection: bullConnection });

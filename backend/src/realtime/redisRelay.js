import { randomUUID } from "crypto";

import Redis from "ioredis";

// Redis requires a dedicated connection for subscribe mode — a connection
// that's SUBSCRIBEd can't run normal commands, so publishing needs its own
// separate connection rather than sharing one.
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const pub = new Redis(REDIS_URL);
const sub = new Redis(REDIS_URL);

// Tags every message this process publishes, so when Redis echoes it back
// to our own subscription (which it does — pub/sub has no concept of "not
// to yourself," a process subscribed to a channel receives everything
// published to it, including its own publishes on a different connection)
// we can recognize and skip it instead of re-applying an update we already
// have and re-broadcasting it to our own clients a second time.
const INSTANCE_ID = randomUUID();
const INSTANCE_ID_BYTES = 36; // a UUID string is always exactly 36 characters

function channelFor(docId) {
  return `syncspace:doc:${docId}`;
}

function encodeEnvelope(messageBytes) {
  const idBytes = Buffer.from(INSTANCE_ID, "ascii");
  return Buffer.concat([idBytes, Buffer.from(messageBytes)]);
}

function decodeEnvelope(buffer) {
  const senderInstanceId = buffer.subarray(0, INSTANCE_ID_BYTES).toString("ascii");
  const messageBytes = buffer.subarray(INSTANCE_ID_BYTES);
  return { senderInstanceId, messageBytes };
}

const subscribedDocs = new Map(); // docId -> handler, so unsubscribe can remove the exact listener

export function publishToDoc(docId, messageBytes) {
  pub.publish(channelFor(docId), encodeEnvelope(messageBytes));
}

// onMessage receives raw message bytes exactly as another instance's
// broadcast() would have sent them locally — the caller applies them to its
// own Room the same way it handles a message from a directly-connected
// WebSocket client, just tagged with a "redis" origin instead of a ws.
export function subscribeToDoc(docId, onMessage) {
  const channel = channelFor(docId);
  const handler = (receivedChannel, buffer) => {
    // ioredis's "messageBuffer" event keeps the channel itself as a raw
    // Buffer too (only the string-mode "message" event calls .toString() on
    // it) — comparing it directly against our string channel name would
    // silently never match, dropping every relayed message with no error.
    if (receivedChannel.toString() !== channel) return;
    const { senderInstanceId, messageBytes } = decodeEnvelope(buffer);
    if (senderInstanceId === INSTANCE_ID) return; // our own publish, echoed back — ignore
    onMessage(messageBytes);
  };
  subscribedDocs.set(docId, handler);
  sub.on("messageBuffer", handler);
  sub.subscribe(channel);
}

export function unsubscribeFromDoc(docId) {
  const handler = subscribedDocs.get(docId);
  if (handler) {
    sub.off("messageBuffer", handler);
    subscribedDocs.delete(docId);
  }
  sub.unsubscribe(channelFor(docId));
}

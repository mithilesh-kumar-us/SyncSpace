import jwt from "jsonwebtoken";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import { WebSocketServer } from "ws";
import * as Y from "yjs";

import { Document } from "../models/Document.js";
import { publishToDoc, subscribeToDoc, unsubscribeFromDoc } from "./redisRelay.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const PERSIST_DEBOUNCE_MS = 2000;

// The name the frontend's useYjsDocument hook uses for its root Y.Text
// (ydoc.getText("content")) — every place on the server that reads or
// writes document text has to use this exact same name, since Yjs root
// types are looked up by name and a mismatch silently creates a second,
// unrelated empty type instead of erroring.
export const CONTENT_TYPE = "content";

// The equivalent root-type convention for canvas (whiteboard) documents — a
// Y.Map keyed by Excalidraw element id, built starting in V11/V12. Parallel
// to CONTENT_TYPE: every place that reads/writes shape data must agree on
// this exact name.
export const SHAPES_TYPE = "shapes";

// "redis" is used as a Yjs transaction/awareness origin to mark an update
// that arrived from another backend instance via Redis — never a real ws
// connection, so it can never collide with one (ws objects, not strings).
const REDIS_ORIGIN = "redis";

// One Room per document, kept in memory only while at least one client is
// connected to it — this is the actual "real-time core": every connected
// client's edits flow through this shared Y.Doc, which is the single source
// of truth broadcast back out to everyone else. Rebuilt fresh from MongoDB
// the next time anyone opens the document after the last client leaves.
//
// Horizontal scaling: this process's Room only ever knows about the clients
// directly connected to IT. A second backend instance has its own separate
// Room (and Y.Doc, and connections) for the same docId — Redis pub/sub is
// what keeps those two Rooms' documents consistent, relaying every local
// update to every other instance subscribed to the same docId's channel.
class Room {
  constructor(docId) {
    this.docId = docId;
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.conns = new Map(); // ws -> Set<clientID> (awareness client IDs that connection owns)
    this.saveTimer = null;
    // Set on any real content change, cleared once the periodic snapshot job
    // takes an auto-snapshot — lets that job skip documents nobody has
    // touched since the last one instead of piling up identical versions.
    this.dirtySinceSnapshot = false;

    // "origin" is whatever we pass as the 3rd arg when applying an update —
    // tagging it with the originating connection means we can skip echoing
    // an update straight back to the client that just sent it, and tagging
    // it with REDIS_ORIGIN means we skip re-publishing an update that just
    // arrived FROM Redis back to Redis (which would loop forever between
    // any two subscribed instances).
    this.ydoc.on("update", (update, origin) => {
      const message = encodeSyncUpdate(update);
      this.broadcast(message, origin);
      this.scheduleSave();
      // "persistence" is the initial load from Mongo (see load() below) —
      // that content is already saved by definition, so it shouldn't count
      // as new, unsnapshotted work.
      if (origin !== "persistence") this.dirtySinceSnapshot = true;
      if (origin !== REDIS_ORIGIN) publishToDoc(docId, message);
    });
    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated, removed);
      const message = encodeAwarenessUpdate(this.awareness, changedClients);
      this.broadcast(message, origin);
      if (origin !== REDIS_ORIGIN) publishToDoc(docId, message);

      // origin is the ws connection that triggered this change (see
      // applyAwarenessUpdate(..., ws) below) — recording which client IDs
      // came from which connection here, via the event lib0 already gives
      // us, is what lets removeConnection() clean up presence correctly
      // without needing to hand-decode the raw awareness update ourselves.
      // A Redis-origin change has no local ws to attribute it to, so
      // conns.get(REDIS_ORIGIN) correctly misses and this is skipped.
      const owned = this.conns.get(origin);
      if (owned) {
        for (const id of added.concat(updated)) owned.add(id);
        for (const id of removed) owned.delete(id);
      }
    });

    subscribeToDoc(docId, (messageBytes) => this.applyRemoteMessage(messageBytes));
  }

  // A message relayed from another instance via Redis — decoded and applied
  // exactly like a message from a directly-connected client, just tagged
  // with REDIS_ORIGIN instead of a ws so it's never mistaken for one and
  // never re-published back to Redis (see the "update" listeners above).
  applyRemoteMessage(messageBytes) {
    const decoder = decoding.createDecoder(messageBytes);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      const throwaway = encoding.createEncoder(); // relayed messages are always plain updates, never step1/step2 — nothing to reply with
      syncProtocol.readSyncMessage(decoder, throwaway, this.ydoc, REDIS_ORIGIN);
    } else if (messageType === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, REDIS_ORIGIN);
    }
  }

  async load() {
    const doc = await Document.findById(this.docId).select("yjsState");
    if (doc?.yjsState) {
      Y.applyUpdate(this.ydoc, doc.yjsState, "persistence");
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  async persistNow() {
    const state = Buffer.from(Y.encodeStateAsUpdate(this.ydoc));
    await Document.findByIdAndUpdate(this.docId, { yjsState: state }).catch((err) =>
      console.error(`Failed to persist Yjs state for ${this.docId}:`, err),
    );
  }

  // Used by restore (see restoreDocumentContent below), which needs the
  // Mongo copy updated immediately rather than waiting out the normal
  // debounce — a REST caller expects "restore" to mean it actually happened.
  async saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persistNow();
  }

  getCurrentText() {
    return this.ydoc.getText(CONTENT_TYPE).toString();
  }

  getCurrentState() {
    return Buffer.from(Y.encodeStateAsUpdate(this.ydoc));
  }

  broadcast(message, exceptConn) {
    for (const ws of this.conns.keys()) {
      if (ws !== exceptConn && ws.readyState === ws.OPEN) ws.send(message);
    }
  }

  addConnection(ws) {
    this.conns.set(ws, new Set());
  }

  removeConnection(ws) {
    const clientIDs = this.conns.get(ws);
    this.conns.delete(ws);
    if (clientIDs) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(clientIDs), null);
    }
  }

  get isEmpty() {
    return this.conns.size === 0;
  }
}

function encodeSyncUpdate(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function encodeAwarenessUpdate(awareness, clientIDs) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clientIDs));
  return encoding.toUint8Array(encoder);
}

const rooms = new Map(); // docId -> Room

export async function getOrCreateRoom(docId) {
  let room = rooms.get(docId);
  if (!room) {
    room = new Room(docId);
    rooms.set(docId, room);
    await room.load();
  }
  return room;
}

// Nothing left to broadcast to — free the in-memory doc and drop the Redis
// subscription. The next connection to this docId rebuilds it from MongoDB
// via room.load() and resubscribes. Shared by the ws "close" handler and by
// restoreDocumentContent, which can spin up a room for a document nobody is
// currently connected to and shouldn't leave it resident forever.
function cleanupRoomIfEmpty(docId, room) {
  if (!room.isEmpty) return;
  rooms.delete(docId);
  unsubscribeFromDoc(docId);
}

// The live in-memory copy is more current than Mongo's debounce-saved
// yjsState field (there's up to PERSIST_DEBOUNCE_MS of lag) — callers that
// want the actual latest content, like the version-history and export
// endpoints, should prefer this over reading Document.yjsState directly
// whenever a room happens to be open. Returns null when nobody has this
// document open right now, so the caller can fall back to Mongo.
export function getActiveRoomText(docId) {
  return rooms.get(docId)?.getCurrentText() ?? null;
}

// Same idea as getActiveRoomText, but the raw Yjs state — used when saving a
// manual version snapshot, which needs the actual encoded update rather than
// just the plain text.
export function getActiveRoomState(docId) {
  return rooms.get(docId)?.getCurrentState() ?? null;
}

// One entry per currently-open, changed-since-last-snapshot room, each
// carrying a markClean() the caller runs only after successfully persisting
// a snapshot — so a failed save leaves the flag set and gets retried on the
// next tick instead of silently skipping that document forever.
export function getDirtyRoomSnapshots() {
  const result = [];
  for (const [docId, room] of rooms) {
    if (!room.dirtySinceSnapshot) continue;
    result.push({
      docId,
      state: room.getCurrentState(),
      markClean: () => {
        room.dirtySinceSnapshot = false;
      },
    });
  }
  return result;
}

// Restoring a document to an earlier snapshot is applied as a real Yjs
// transaction against the live room — for text, a full delete-and-reinsert
// of the Y.Text (exactly like a user selecting everything and pasting the
// old content back in); for canvas, clearing and repopulating the shapes
// Y.Map from the snapshot's entries. Either way this reuses every existing
// code path for free: it broadcasts to connected clients, relays over Redis
// to other instances, and schedules the normal Mongo save, all via the same
// ydoc "update" listener a live edit goes through. (It deliberately does
// NOT go through the WebSocket viewer/editor check — restore is invoked
// from the REST layer, which already enforces role there; see
// documentController.js.)
export async function restoreDocumentContent(docId, snapshotState, kind) {
  const room = await getOrCreateRoom(docId);

  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, snapshotState);

  room.ydoc.transact(() => {
    if (kind === "canvas") {
      const liveShapes = room.ydoc.getMap(SHAPES_TYPE);
      const snapshotShapes = snapshotDoc.getMap(SHAPES_TYPE);

      // Never a real Y.Map .delete() here — a currently-open client's
      // reconcileElements() (see excalidraw-board.tsx) keeps any local
      // element that's simply missing from the remote side, since that's
      // the correct behavior for an ordinary incremental live edit still
      // propagating. A restore instead has to tombstone every shape that's
      // not in the snapshot, exactly like a live delete would, so it's
      // still present for reconciliation to compare against and win.
      //
      // Reconciliation is version-based ("higher version wins"), which is
      // right for merging genuinely concurrent live edits but wrong for a
      // restore — a restore must always win regardless of how recently the
      // live scene was edited. Bumping every restored/tombstoned element's
      // version past whatever is currently live forces that outcome.
      let nextVersion = 1;
      for (const value of liveShapes.values()) {
        if (typeof value.version === "number" && value.version >= nextVersion) {
          nextVersion = value.version + 1;
        }
      }

      for (const key of Array.from(liveShapes.keys())) {
        if (snapshotShapes.has(key)) continue;
        const stale = liveShapes.get(key);
        liveShapes.set(key, {
          ...stale,
          isDeleted: true,
          version: nextVersion++,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
        });
      }
      for (const [key, value] of snapshotShapes.entries()) {
        liveShapes.set(key, { ...value, version: nextVersion++, versionNonce: Math.floor(Math.random() * 2 ** 31) });
      }
    } else {
      const restoredText = snapshotDoc.getText(CONTENT_TYPE).toString();
      const liveText = room.ydoc.getText(CONTENT_TYPE);
      liveText.delete(0, liveText.length);
      liveText.insert(0, restoredText);
    }
  }, "restore");

  await room.saveNow();
  cleanupRoomIfEmpty(docId, room);
}

// Verifies the connecting user via the same JWT the REST API uses, then
// resolves their role (owner/editor/viewer/none) via the same getRole() the
// REST layer uses — a single source of truth for "who can do what" shared
// across both transports (see models/Document.js). Returns null for no access.
async function authenticateConnection(docId, token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  const doc = await Document.findById(docId).select("owner collaborators");
  return doc ? doc.getRole(payload.sub) : null;
}

export function attachYjsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/yjs/")) return; // not ours — let other upgrade handlers see it

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url);
    });
  });

  wss.on("connection", async (ws, _req, url) => {
    const docId = url.pathname.replace("/yjs/", "");
    const token = url.searchParams.get("token");

    // A real Yjs client sends its initial syncStep1 the instant its socket
    // opens — which can be before the two awaits below (auth check, room
    // lookup) resolve and we get a chance to attach the real message
    // handler. Node's EventEmitter never queues an emit for a listener
    // added later, so without this buffer that first message is just
    // silently lost and the client never learns the document already has
    // content. Buffering raw frames here, before anything else, closes
    // that window.
    const buffered = [];
    const buffer = (data) => buffered.push(data);
    ws.on("message", buffer);

    const role = await authenticateConnection(docId, token);
    if (!role) {
      ws.off("message", buffer);
      ws.close(4401, "Unauthorized");
      return;
    }

    const room = await getOrCreateRoom(docId);
    room.addConnection(ws);

    // Kick off sync step 1 immediately — this is what lets a newly joined
    // client learn what it's missing without waiting for the next edit.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, room.ydoc);
    ws.send(encoding.toUint8Array(syncEncoder));

    if (room.awareness.getStates().size > 0) {
      ws.send(
        encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys())),
      );
    }

    function handleMessage(data) {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        // Sync sub-messages: step1 (0) is a read-only "here's what I have,
        // send me the diff" request — safe for every role. step2 (1) and
        // update (2) both call Y.applyUpdate under the hood, i.e. they
        // mutate document content, so a viewer's messages of that kind are
        // silently dropped here. This runs even if a viewer's client is
        // tampered with to skip the UI's own read-only restriction, since
        // it's enforced server-side rather than trusted from the client.
        const syncMessageType = decoding.readVarUint(decoder);
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncStep1(decoder, encoder, room.ydoc);
          ws.send(encoding.toUint8Array(encoder));
        } else if (role !== "viewer") {
          syncProtocol.readUpdate(decoder, room.ydoc, ws);
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        // Passing ws as the origin is what lets the Room's "update" listener
        // above attribute these client IDs to this specific connection.
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      }
    }

    ws.off("message", buffer);
    ws.on("message", handleMessage);
    for (const data of buffered) handleMessage(data);

    ws.on("close", () => {
      room.removeConnection(ws);
      cleanupRoomIfEmpty(docId, room);
    });
  });

  return wss;
}

"use client";

import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/^http/, "ws");

const PRESENCE_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#ec4899", "#a855f7", "#eab308"];

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

// One Y.Doc + WebsocketProvider per open document — this is the entire
// client half of the real-time core. The provider speaks the same
// sync/awareness wire protocol our custom backend (realtime/yjsServer.js)
// implements, so this "just works" against it despite not using y-websocket's
// own (explicitly non-production) bundled server.
//
// Deliberately NOT created via useMemo: useMemo is a performance cache, not
// a lifecycle guarantee — React (in Strict Mode especially) can discard and
// recompute a memoized value at any time. A real network connection with a
// paired teardown (provider.destroy()) has to live inside useEffect, whose
// mount/cleanup pairing is the only lifecycle React actually guarantees.
// Next.js's App Router applies the same Strict Mode dev-only double-invoke
// as the original Vite app did, where this exact bug was first hit and fixed —
// getting this wrong again here would silently leave the editor stuck on
// "Connecting..." forever, no error, no network entry.
export function useYjsDocument(docId: string, token: string | null, userName: string) {
  const [ytext, setYtext] = useState<Y.Text | null>(null);
  // The raw Y.Doc, exposed alongside `ytext` so non-text consumers (the
  // whiteboard, from V11 on) can pull their own root type — e.g.
  // `ydoc.getMap(SHAPES_TYPE)` — without this hook needing to know anything
  // content-type-specific itself.
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [connected, setConnected] = useState(false);
  // Distinct from `connected`: this latches true the first time the initial
  // document content finishes loading, and — unlike `connected` — never
  // resets to false again for the lifetime of this hook instance. `connected`
  // toggling off on a dropped connection should show an "offline" indicator,
  // not re-lock the editor; a user should be able to keep typing while
  // offline (their edits queue locally in the Y.Doc and reconcile
  // automatically once the connection returns) rather than being blocked
  // from editing at all just because the network blipped.
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // The raw Awareness instance, exposed alongside `presence` so a
  // whiteboard-specific consumer (V14 on) can set/read extra fields (e.g.
  // `cursor`) this hook doesn't need to know anything about itself — same
  // reasoning as exposing the raw `ydoc` for the shapes Y.Map.
  const [awareness, setAwareness] = useState<Awareness | null>(null);

  useEffect(() => {
    if (!token) return;

    const ydoc = new Y.Doc();
    // WebsocketProvider builds its URL as `${serverUrl}/${roomname}?${params}`
    // — using "yjs/<docId>" as the room name is what makes the resulting
    // path (`/yjs/<docId>`) match the backend's upgrade-handler check.
    const provider = new WebsocketProvider(WS_URL, `yjs/${docId}`, ydoc, { params: { token } });

    const color = PRESENCE_COLORS[provider.awareness.clientID % PRESENCE_COLORS.length];
    provider.awareness.setLocalStateField("user", { name: userName, color });

    const onStatus = ({ status }: { status: string }) => setConnected(status === "connected");
    // WebsocketProvider's `synced` setter emits both a legacy "synced" event
    // and the current "sync" event for the same state change (confirmed in
    // its compiled source — its own .d.ts only documents "sync"), so this is
    // the same signal the original app used, just the type-correct name.
    const onSynced = (isSynced: boolean) => {
      if (isSynced) setHasSyncedOnce(true);
    };
    const onAwarenessChange = () => {
      const states = Array.from(provider.awareness.getStates().entries());
      setPresence(
        states
          .filter(([clientId, state]) => clientId !== provider.awareness.clientID && state.user)
          // The `state.user` check above matters beyond just "don't show
          // half-initialized entries": Yjs's Awareness class broadcasts an
          // empty {} state the instant it's constructed, before our own
          // setLocalStateField call runs. A short-lived connection (e.g. a
          // dev-only React Strict Mode double-mount, where the phantom
          // first-pass connection can be torn down before that follow-up
          // call ever fires) can leave a stale empty-state entry sitting in
          // the shared awareness map with no natural cleanup trigger —
          // filtering on `state.user` here is what keeps that from ever
          // rendering as a phantom "Anonymous" presence pill.
          .map(([clientId, state]) => ({
            clientId,
            name: (state.user?.name as string) ?? "Anonymous",
            color: (state.user?.color as string) ?? "#888",
          })),
      );
    };

    provider.on("status", onStatus);
    provider.on("sync", onSynced);
    provider.awareness.on("change", onAwarenessChange);
    setYtext(ydoc.getText("content"));
    setYdoc(ydoc);
    setAwareness(provider.awareness);

    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSynced);
      provider.awareness.off("change", onAwarenessChange);
      provider.destroy();
      ydoc.destroy();
      setYtext(null);
      setYdoc(null);
      setAwareness(null);
      setConnected(false);
      setHasSyncedOnce(false);
    };
  }, [docId, token, userName]);

  return { ytext, ydoc, awareness, connected, hasSyncedOnce, presence };
}

"use client";

import "@excalidraw/excalidraw/index.css";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  OrderedExcalidrawElement,
  ExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { sceneCoordsToViewportCoords as SceneCoordsToViewportCoords } from "@excalidraw/excalidraw/utils";
import type { ActiveTool, PointerDownState, Zoom } from "@excalidraw/excalidraw/types";

// Matches the backend's SHAPES_TYPE constant in realtime/yjsServer.js — same
// convention as CONTENT_TYPE/"content" for text docs: a literal kept in sync
// by convention between frontend and backend, not a shared imported module.
const SHAPES_TYPE = "shapes";

// Excalidraw touches `window`/canvas at module scope — importing it directly
// in a page or a component tree that could ever render on the server (even
// briefly, during a Next.js build) crashes. `ssr: false` is required here,
// not optional, and is a genuinely different failure mode from the Strict
// Mode WebSocket bug the text editor has to guard against (that one is a
// silent stuck-forever connection; this one is a build/SSR crash).
const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((m) => m.Excalidraw), {
  ssr: false,
});

// A handful of Excalidraw exports are only usable once the module has
// actually loaded client-side (same ssr:false constraint as the component
// itself) — resolved lazily once and cached, same pattern for each.
let modulePromise: Promise<typeof import("@excalidraw/excalidraw")> | null = null;
function getExcalidrawModule() {
  if (!modulePromise) modulePromise = import("@excalidraw/excalidraw");
  return modulePromise;
}

const LOCAL_ORIGIN = "excalidraw-local";
const THROTTLE_MS = 50;

interface Props {
  ydoc: Y.Doc | null;
  awareness: Awareness | null;
  hasSyncedOnce: boolean;
  canEdit: boolean;
}

type ActionType = "dragging" | "drawing" | "resizing" | "selecting";

interface RemoteCursor {
  clientId: number;
  x: number;
  y: number;
  name: string;
  color: string;
  action: ActionType | null;
}

// Everything sceneCoordsToViewportCoords needs to re-project a remote peer's
// scene-space cursor into THIS client's own current viewport — a peer's
// cursor position is meaningless on screen without knowing our own
// independent pan/zoom state at render time.
interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: Zoom;
  offsetLeft: number;
  offsetTop: number;
}

// The two-directional Yjs<->Excalidraw bridge. Element storage: one Y.Map
// keyed by each element's own id, value = the whole element object.
// Never `.delete()` a removed element — Excalidraw already tombstones
// deletions via `isDeleted: true` on the element itself when it reports
// them through onChange, so writing that through is enough; deleting the
// Y.Map key instead would just cause delete/recreate churn against other
// peers instead of a clean CRDT-friendly tombstone update.
export function ExcalidrawBoard({ ydoc, awareness, hasSyncedOnce, canEdit }: Props) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Tracks WHICH excalidrawAPI instance was last hydrated, not just a
  // boolean "have we ever hydrated" flag. React Strict Mode's dev-only
  // double-invoke can mount Excalidraw, hand us its API, get torn down, and
  // remount with a brand-new API instance — a plain boolean ref would stay
  // `true` from the first (now-destroyed) instance and skip hydrating the
  // real one that's actually left on screen. Same root cause as the
  // WebsocketProvider Strict Mode bug documented in use-yjs-document.ts,
  // just resurfacing in a different component.
  const hydratedApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  // The scene version WE last applied via updateScene (either our own
  // initial hydration or a reconciled remote update). onChange fires for
  // every scene mutation, including the one updateScene() itself just
  // caused — comparing against this is what lets local-edit handling tell
  // "the user actually drew something" apart from "we just echoed a remote
  // update back through the same callback." This is a different guard from
  // the transaction-origin check below: onChange has no origin concept at
  // all, so it needs its own signal.
  const lastAppliedVersionRef = useRef<number | null>(null);
  // Per-element dedupe key (`version:versionNonce`) for the last state of
  // each element we've already written into the Y.Map — avoids rewriting
  // elements on every throttle tick when only one shape actually changed.
  const lastSentRef = useRef<Map<string, string>>(new Map());
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingElementsRef = useRef<readonly OrderedExcalidrawElement[] | null>(null);

  // Live cursors (V14). A separate throttle timer/pending-ref pair from the
  // element-sync ones above — cursor broadcasts and shape writes are
  // logically independent streams that just happen to share the same
  // throttle window length.
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // sceneCoordsToViewportCoords is a pure projection function with no
  // window/canvas side effects of its own, but it ships from the exact same
  // SSR-unsafe bundle as the main Excalidraw component (there's no separate
  // "./utils" runtime entry point — only ".d.ts" types are split out), so it
  // still has to come through the same lazy client-only module resolution
  // as restoreElements/reconcileElements above. Cached in a ref (rather than
  // state) since it's only ever read synchronously during the cursor-overlay
  // render, never used to trigger a re-render itself.
  const sceneCoordsToViewportCoordsRef = useRef<typeof SceneCoordsToViewportCoords | null>(null);

  function flushPendingWrite(ydocInstance: Y.Doc) {
    const elements = pendingElementsRef.current;
    pendingElementsRef.current = null;
    if (!elements) return;

    const shapes = ydocInstance.getMap<ExcalidrawElement>(SHAPES_TYPE);
    ydocInstance.transact(() => {
      for (const el of elements) {
        const key = `${el.version}:${el.versionNonce}`;
        if (lastSentRef.current.get(el.id) === key) continue;
        lastSentRef.current.set(el.id, key);
        shapes.set(el.id, el);
      }
    }, LOCAL_ORIGIN);
  }

  // Hydrate the board from whatever's already in the shapes map, once per
  // actual Excalidraw instance, as soon as both the Yjs connection has
  // synced and that instance's imperative API is available.
  useEffect(() => {
    if (!ydoc || !hasSyncedOnce || !excalidrawAPI) return;
    if (hydratedApiRef.current === excalidrawAPI) return;
    hydratedApiRef.current = excalidrawAPI;

    const shapes = ydoc.getMap<ExcalidrawElement>(SHAPES_TYPE);
    const rawElements = Array.from(shapes.values());
    if (rawElements.length === 0) return;

    // Elements straight out of the Y.Map are plain JSON — Excalidraw expects
    // them to go through restoreElements() first (the same normalization it
    // applies when loading a saved/imported scene) to fill in internal
    // bookkeeping. Skipping this looked like it worked for a moment
    // (getSceneElements() showed the right count immediately after
    // updateScene) but the elements were silently dropped again shortly
    // after — Excalidraw's own validation pass rejects unrestored elements.
    getExcalidrawModule().then(({ restoreElements, getSceneVersion, CaptureUpdateAction }) => {
      const restored = restoreElements(rawElements, null);
      lastAppliedVersionRef.current = getSceneVersion(restored);
      excalidrawAPI.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
    });
  }, [ydoc, hasSyncedOnce, excalidrawAPI]);

  // Remote Y.Map change -> reconcile into the local scene. Skips updates
  // this same tab just wrote (tagged with LOCAL_ORIGIN above) — the
  // transaction-origin check is the correct guard here specifically
  // because Yjs observers DO carry provenance, unlike onChange.
  useEffect(() => {
    if (!ydoc || !excalidrawAPI) return;

    const shapes = ydoc.getMap<ExcalidrawElement>(SHAPES_TYPE);
    const onMapChange = (_event: Y.YMapEvent<ExcalidrawElement>, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;

      getExcalidrawModule().then(({ reconcileElements, getSceneVersion, CaptureUpdateAction }) => {
        const remoteElements = Array.from(shapes.values()) as RemoteExcalidrawElement[];
        const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
        const appState = excalidrawAPI.getAppState();
        const reconciled = reconcileElements(localElements, remoteElements, appState);
        lastAppliedVersionRef.current = getSceneVersion(reconciled);
        excalidrawAPI.updateScene({
          elements: reconciled,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      });
    };

    shapes.observe(onMapChange);
    return () => shapes.unobserve(onMapChange);
  }, [ydoc, excalidrawAPI]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      if (cursorThrottleRef.current) clearTimeout(cursorThrottleRef.current);
    };
  }, []);

  useEffect(() => {
    getExcalidrawModule().then(({ sceneCoordsToViewportCoords }) => {
      sceneCoordsToViewportCoordsRef.current = sceneCoordsToViewportCoords;
    });
  }, []);

  // onScrollChange (below) only fires on an actual scroll/zoom action, never
  // on initial mount — without this, viewport would stay null (and the
  // cursor overlay would stay hidden) for anyone who hasn't yet panned or
  // zoomed, even though remote cursor data was already arriving correctly.
  useEffect(() => {
    if (!excalidrawAPI) return;
    const appState = excalidrawAPI.getAppState();
    setViewport({
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
      offsetLeft: appState.offsetLeft,
      offsetTop: appState.offsetTop,
    });
  }, [excalidrawAPI]);

  // Other clients' live pointer positions, read the same way presence names/
  // colors are read in use-yjs-document.ts — filtered to exclude our own
  // clientId and to skip any state that hasn't set a cursor yet (a peer who
  // just connected but hasn't moved their mouse over the canvas).
  useEffect(() => {
    if (!awareness) return;

    const onAwarenessChange = () => {
      const states = Array.from(awareness.getStates().entries());
      setRemoteCursors(
        states
          .filter(
            ([clientId, state]) => clientId !== awareness.clientID && state.cursor && state.user,
          )
          .map(([clientId, state]) => ({
            clientId,
            x: state.cursor.x,
            y: state.cursor.y,
            name: (state.user?.name as string) ?? "Anonymous",
            color: (state.user?.color as string) ?? "#888",
            action: (state.action?.type as ActionType) ?? null,
          })),
      );
    };

    awareness.on("change", onAwarenessChange);
    return () => awareness.off("change", onAwarenessChange);
  }, [awareness]);

  function handleChange(elements: readonly OrderedExcalidrawElement[]) {
    if (!ydoc) return;

    getExcalidrawModule().then(({ getSceneVersion }) => {
      // Our own remote-apply (hydration or reconciled update) echoing back
      // through this same callback — not a real local edit, skip it.
      if (getSceneVersion(elements) === lastAppliedVersionRef.current) return;

      pendingElementsRef.current = elements;
      if (throttleTimerRef.current) return;
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        flushPendingWrite(ydoc);
      }, THROTTLE_MS);
    });
  }

  // Live in-progress actions (V15) — a coarse "Alice is drawing" label, not a
  // new shape-streaming path: V12's bridge already writes any changed element
  // into the Y.Map on every throttled onChange, so in-progress shapes are
  // already visible to peers in real time. This only brackets that same drag
  // with an awareness "action" field peers can render a label from.
  function handlePointerDown(activeTool: ActiveTool, pointerDownState: PointerDownState) {
    if (!awareness) return;
    const elementIds = pointerDownState.hit.allHitElements.map((el) => el.id);
    let type: ActionType;
    if (activeTool.type === "selection") {
      if (pointerDownState.resize.isResizing) type = "resizing";
      else if (pointerDownState.hit.element) type = "dragging";
      else type = "selecting";
    } else {
      type = "drawing";
    }
    awareness.setLocalStateField("action", { type, elementIds });
  }

  function handlePointerUp() {
    // Flush immediately so the final state of a drag/draw is never left
    // sitting in the throttle window if the user stops interacting.
    if (!ydoc) return;
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    flushPendingWrite(ydoc);
    awareness?.setLocalStateField("action", null);
  }

  function handlePointerUpdate(payload: { pointer: { x: number; y: number } }) {
    if (!awareness) return;
    // payload.pointer is already in scene coordinates (Excalidraw does the
    // screen->scene conversion internally before calling this), which is
    // exactly what every OTHER client needs to independently re-project this
    // cursor into its own, unrelated pan/zoom state.
    pendingCursorRef.current = { x: payload.pointer.x, y: payload.pointer.y };
    if (cursorThrottleRef.current) return;
    cursorThrottleRef.current = setTimeout(() => {
      cursorThrottleRef.current = null;
      if (pendingCursorRef.current) awareness.setLocalStateField("cursor", pendingCursorRef.current);
    }, THROTTLE_MS);
  }

  function handleScrollChange(scrollX: number, scrollY: number, zoom: Zoom) {
    if (!excalidrawAPI) return;
    const appState = excalidrawAPI.getAppState();
    setViewport({ scrollX, scrollY, zoom, offsetLeft: appState.offsetLeft, offsetTop: appState.offsetTop });
  }

  const projectCursor = sceneCoordsToViewportCoordsRef.current;

  return (
    <div className="relative h-[calc(100vh-160px)] w-full overflow-hidden rounded-md border">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerUpdate={handlePointerUpdate}
        onScrollChange={handleScrollChange}
        viewModeEnabled={!canEdit}
      />

      {viewport && projectCursor && (
        // z-50: Excalidraw's own UI chrome (toolbar, help button, panels)
        // renders inside the same stacking context with explicit z-indexes
        // of its own — without an explicit z-index here at least as high,
        // those controls silently paint over remote cursors that happen to
        // land underneath them, even though this overlay is a later DOM
        // sibling (DOM order alone doesn't win once any element in the
        // stack sets a real z-index instead of the default "auto").
        <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
          {remoteCursors.map((cursor) => {
            const projected = projectCursor({ sceneX: cursor.x, sceneY: cursor.y }, viewport);
            // sceneCoordsToViewportCoords returns page/client-absolute
            // coordinates (the same frame as getBoundingClientRect()) — this
            // overlay div is positioned relative to the wrapper below, whose
            // own top-left already sits at (offsetLeft, offsetTop) on the
            // page, so that has to be subtracted back out or every cursor
            // renders far outside the wrapper's bounds and gets silently
            // clipped by its `overflow-hidden`.
            const x = projected.x - viewport.offsetLeft;
            const y = projected.y - viewport.offsetTop;
            return (
              <div
                key={cursor.clientId}
                className="absolute flex -translate-x-0.5 -translate-y-0.5 items-center gap-1"
                style={{ left: x, top: y }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill={cursor.color}>
                  <path d="M1 1 L1 14 L5 10.5 L7.5 15 L9.5 14 L7 9.5 L12 9.5 Z" />
                </svg>
                <span
                  className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white"
                  style={{ backgroundColor: cursor.color }}
                >
                  {cursor.action ? `${cursor.name} is ${cursor.action}` : cursor.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

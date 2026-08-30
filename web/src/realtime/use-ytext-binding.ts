"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

// Binds a Y.Text to a plain <textarea> in both directions:
//  - local typing  -> minimal Y.Text delete/insert ops (via prefix/suffix diff,
//    not a full replace, so undo history and other clients see the real edit)
//  - remote update -> textarea value refreshed, cursor position shifted by
//    exactly what the Yjs delta says changed, not just "moved to the end"
//
// A plain textarea can't render *other people's* cursor positions (no rich
// overlay to draw on) — this only keeps the local user's own cursor stable
// against incoming remote edits. Live cursor overlays are the whiteboard's
// job (V14), not this editor's.
export function useYTextBinding(ytext: Y.Text | null) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localOrigin = useRef(Symbol("local"));

  useEffect(() => {
    if (!ytext) return;
    setValue(ytext.toString());

    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === localOrigin.current) {
        // Our own edit already reflects correctly in the DOM (the browser
        // just handled the keystroke) — re-deriving it from ytext.toString()
        // would be redundant and risks a cursor jump for no reason.
        return;
      }

      const textarea = textareaRef.current;
      const prevSelectionStart = textarea?.selectionStart ?? null;
      const prevSelectionEnd = textarea?.selectionEnd ?? null;

      setValue(ytext.toString());

      if (textarea && prevSelectionStart !== null && prevSelectionEnd !== null) {
        const newStart = shiftPosition(event.delta, prevSelectionStart);
        const newEnd = shiftPosition(event.delta, prevSelectionEnd);
        // Applied after React re-renders the new value — see the effect below.
        pendingSelection.current = [newStart, newEnd];
      }
    };

    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const pendingSelection = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (pendingSelection.current && textareaRef.current) {
      const [start, end] = pendingSelection.current;
      textareaRef.current.setSelectionRange(start, end);
      pendingSelection.current = null;
    }
  }, [value]);

  function handleChange(newValue: string) {
    if (!ytext) return; // not connected yet — textarea is disabled in this state, see the Editor page
    const oldValue = ytext.toString();
    const [start, deleteCount, insertText] = diff(oldValue, newValue);

    ytext.doc!.transact(() => {
      if (deleteCount > 0) ytext.delete(start, deleteCount);
      if (insertText) ytext.insert(start, insertText);
    }, localOrigin.current);

    setValue(newValue);
  }

  return { value, handleChange, textareaRef };
}

// Smallest common-prefix/common-suffix diff between two strings — turns a
// full-string textarea onChange into a minimal (position, deleteCount, insertText)
// edit instead of "delete everything, insert everything," which would make
// every keystroke a full-document replace for every other connected client.
function diff(oldStr: string, newStr: string): [number, number, string] {
  let start = 0;
  const maxStart = Math.min(oldStr.length, newStr.length);
  while (start < maxStart && oldStr[start] === newStr[start]) start++;

  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return [start, oldEnd - start, newStr.slice(start, newEnd)];
}

// Given a Yjs delta (array of {retain}/{insert}/{delete} ops) describing a
// remote edit, returns where a cursor at `position` should move to so it
// stays attached to the same surrounding text rather than snapping to 0 or
// the end whenever someone else types.
function shiftPosition(delta: Array<{ retain?: number; insert?: string | object; delete?: number }>, position: number): number {
  let cursor = 0; // position in the OLD text as we walk the delta
  let shift = 0;

  for (const op of delta) {
    if (cursor >= position) break;

    if (op.retain !== undefined) {
      cursor += op.retain;
    } else if (typeof op.insert === "string") {
      if (cursor <= position) shift += op.insert.length;
      cursor += 0; // insert doesn't consume old-text positions
    } else if (op.delete !== undefined) {
      const deleteEnd = cursor + op.delete;
      if (deleteEnd <= position) {
        shift -= op.delete;
      } else if (cursor < position) {
        // The cursor sat inside a range that just got deleted — pull it back
        // to where the deletion started rather than leaving it mid-air.
        shift -= position - cursor;
      }
      cursor += op.delete;
    }
  }

  return Math.max(0, position + shift);
}

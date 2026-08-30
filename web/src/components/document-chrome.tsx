"use client";

import { useState } from "react";

import type { DocumentKind, Role } from "@/api/types";
import { Button } from "@/components/ui/button";
import { SharePanel } from "@/components/share-panel";
import { VersionHistoryDrawer } from "@/components/version-history-drawer";

// Shared title-bar actions (Share + History) for any document type — used by
// the text Editor page and (from V11 on) the whiteboard page, so both share
// one implementation of the share/version-history/export wiring instead of
// duplicating it.
export function DocumentChrome({
  documentId,
  documentTitle,
  kind,
  role,
}: {
  documentId: string;
  documentTitle: string;
  kind: DocumentKind;
  role: Role;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [justRestored, setJustRestored] = useState(false);
  const canEdit = role === "owner" || role === "editor";

  return (
    <>
      <div className="mb-4 flex gap-2">
        {role === "owner" && <SharePanel documentId={documentId} />}
        <Button variant="outline" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
      </div>

      <VersionHistoryDrawer
        documentId={documentId}
        documentTitle={documentTitle}
        kind={kind}
        canEdit={canEdit}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestored={() => {
          setHistoryOpen(false);
          setJustRestored(true);
          setTimeout(() => setJustRestored(false), 4000);
        }}
      />

      {justRestored && (
        <p className="mb-3 text-sm text-primary">Restored — the content below updated live.</p>
      )}
    </>
  );
}

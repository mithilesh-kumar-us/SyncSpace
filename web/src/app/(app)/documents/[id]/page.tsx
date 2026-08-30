"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";

import { api } from "@/api/client";
import type { DocumentSummary, Role } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DocumentChrome } from "@/components/document-chrome";
import { PresenceBadges } from "@/components/presence-badges";
import { useAuth } from "@/context/auth-context";
import { useYjsDocument } from "@/realtime/use-yjs-document";
import { useYTextBinding } from "@/realtime/use-ytext-binding";

export default function EditorPage(props: PageProps<"/documents/[id]">) {
  const { id } = use(props.params);
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [titleStatus, setTitleStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    api
      .get<{ document: DocumentSummary; role: Role }>(`/api/documents/${id}`)
      .then(({ document, role }) => {
        setTitle(document.title);
        setRole(role);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const { ytext, connected, hasSyncedOnce, presence } = useYjsDocument(
    id,
    token,
    user?.name ?? "Anonymous",
  );
  const { value, handleChange, textareaRef } = useYTextBinding(ytext);
  const canEdit = role === "owner" || role === "editor";

  async function handleTitleBlur() {
    if (!canEdit) return;
    setTitleStatus("saving");
    await api.patch(`/api/documents/${id}`, { title });
    setTitleStatus("saved");
  }

  if (loading) return <p className="p-10 text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to documents
      </Link>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleTitleBlur}
        disabled={!canEdit}
        className="my-4 h-auto font-heading text-2xl font-semibold tracking-tight"
      />

      {role && <DocumentChrome documentId={id} documentTitle={title} kind="text" role={role} />}

      <div className="mb-3 flex items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={
              "size-1.5 rounded-full " +
              (connected ? "bg-[#2ea043]" : hasSyncedOnce ? "bg-[#d97706]" : "bg-muted-foreground")
            }
          />
          <span className="text-muted-foreground">
            {connected ? "Live" : hasSyncedOnce ? "Offline — editing queued locally" : "Connecting…"}
          </span>
        </span>
        {role === "viewer" && <Badge variant="secondary">View only</Badge>}
        <PresenceBadges presence={presence} />
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        // Disabled only until the FIRST sync ever completes — once we have
        // real content loaded, a later disconnect should never lock the
        // editor back up. Edits made while offline apply to the local Y.Doc
        // immediately and simply queue; WebsocketProvider auto-reconnects
        // and Yjs's own sync protocol reconciles them the moment it can.
        disabled={!hasSyncedOnce || !canEdit}
        rows={20}
        placeholder={!hasSyncedOnce ? "Connecting..." : canEdit ? "Start writing..." : ""}
        className="w-full resize-y rounded-md border border-input bg-background p-3 font-sans text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <p className="mt-3 text-sm text-muted-foreground">
        {titleStatus === "saving" && "Saving title... "}
        {titleStatus === "saved" && "Title saved. "}
        Content syncs live — no save button needed.
      </p>
    </div>
  );
}

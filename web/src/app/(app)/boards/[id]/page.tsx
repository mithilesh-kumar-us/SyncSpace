"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";

import { api } from "@/api/client";
import type { DocumentSummary, Role } from "@/api/types";
import { Input } from "@/components/ui/input";
import { DocumentChrome } from "@/components/document-chrome";
import { useAuth } from "@/context/auth-context";
import { useYjsDocument } from "@/realtime/use-yjs-document";
import { ExcalidrawBoard } from "@/components/whiteboard/excalidraw-board";

export default function BoardPage(props: PageProps<"/boards/[id]">) {
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
  const { ydoc, awareness, connected, hasSyncedOnce } = useYjsDocument(
    id,
    token,
    user?.name ?? "Anonymous",
  );
  const canEdit = role === "owner" || role === "editor";

  async function handleTitleBlur() {
    if (!canEdit) return;
    setTitleStatus("saving");
    await api.patch(`/api/documents/${id}`, { title });
    setTitleStatus("saved");
  }

  if (loading) return <p className="p-10 text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
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

      {role && <DocumentChrome documentId={id} documentTitle={title} kind="canvas" role={role} />}

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
      </div>

      <ExcalidrawBoard
        ydoc={ydoc}
        awareness={awareness}
        hasSyncedOnce={hasSyncedOnce}
        canEdit={canEdit}
      />

      <p className="mt-3 text-sm text-muted-foreground">
        {titleStatus === "saving" && "Saving title... "}
        {titleStatus === "saved" && "Title saved. "}
        Drawing syncs live — no save button needed.
      </p>
    </div>
  );
}

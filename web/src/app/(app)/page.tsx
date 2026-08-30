"use client";

import { FileText, PenTool, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/api/client";
import type { DocumentKind, DocumentSummary } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ documents: DocumentSummary[] }>("/api/documents")
      .then(({ documents }) => setDocuments(documents))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(kind: DocumentKind) {
    const { document } = await api.post<{ document: DocumentSummary }>("/api/documents", { kind });
    router.push(kind === "canvas" ? `/boards/${document._id}` : `/documents/${document._id}`);
  }

  async function handleDelete(id: string) {
    await api.delete(`/api/documents/${id}`);
    setDocuments((docs) => docs.filter((d) => d._id !== id));
  }

  return (
    <div className="brand-glow">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Your documents
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Text docs and whiteboards, synced live with everyone you share them with.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => handleCreate("text")}>
              <Plus />
              New document
            </Button>
            <Button variant="outline" onClick={() => handleCreate("canvas")}>
              <PenTool />
              New whiteboard
            </Button>
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {!loading && documents.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-20 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <FileText className="size-5" />
            </span>
            <div>
              <p className="font-medium">No documents yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first document or whiteboard above to get started.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <Card
              key={doc._id}
              className="group/doc gap-3 px-5 py-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5"
            >
              <div className="flex items-start justify-between">
                <Link
                  href={doc.kind === "canvas" ? `/boards/${doc._id}` : `/documents/${doc._id}`}
                >
                  <span
                    className={
                      doc.kind === "canvas"
                        ? "flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                        : "flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
                    }
                  >
                    {doc.kind === "canvas" ? (
                      <PenTool className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                </Link>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="uppercase">
                    {doc.role}
                  </Badge>
                  {doc.role === "owner" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(doc._id)}
                      className="opacity-0 transition-opacity group-hover/doc:opacity-100"
                      aria-label="Delete document"
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
              <Link
                href={doc.kind === "canvas" ? `/boards/${doc._id}` : `/documents/${doc._id}`}
                className="font-heading font-medium tracking-tight"
              >
                {doc.title}
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

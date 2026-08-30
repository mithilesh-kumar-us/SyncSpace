"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/api/client";
import type { DocumentKind, ExportFormat, ExportJob, VersionEntry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime } from "@/utils/format-relative-time";

interface Props {
  documentId: string;
  documentTitle: string;
  kind: DocumentKind;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}

export function VersionHistoryDrawer({
  documentId,
  documentTitle,
  kind,
  canEdit,
  open,
  onOpenChange,
  onRestored,
}: Props) {
  // Export (background .txt/.md rendering) only makes sense for text
  // documents — the backend's createExportJob 400s for canvas docs, so the
  // tab is hidden here rather than letting a user hit that error.
  if (kind === "canvas") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Whiteboard</SheetTitle>
            <SheetDescription>Version history.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 px-4">
            <HistoryTab documentId={documentId} canEdit={canEdit} onRestored={onRestored} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Document</SheetTitle>
          <SheetDescription>Version history and export.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="history" className="flex-1 px-4">
          <TabsList>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>
          <TabsContent value="history" className="mt-4">
            <HistoryTab documentId={documentId} canEdit={canEdit} onRestored={onRestored} />
          </TabsContent>
          <TabsContent value="export" className="mt-4">
            <ExportTab documentId={documentId} documentTitle={documentTitle} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function HistoryTab({
  documentId,
  canEdit,
  onRestored,
}: {
  documentId: string;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return api
      .get<{ versions: VersionEntry[] }>(`/api/documents/${documentId}/versions`)
      .then(({ versions }) => setVersions(versions));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/documents/${documentId}/versions`, { label: label.trim() || undefined });
      setLabel("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save version.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    setError(null);
    try {
      await api.post(`/api/documents/${documentId}/versions/${versionId}/restore`);
      setConfirmingId(null);
      onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to restore this version.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <form onSubmit={handleSave} className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name this version (optional)"
            className="flex-1"
          />
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : "Save version"}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {versions === null && <p className="text-sm text-muted-foreground">Loading history…</p>}
      {versions?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No saved versions yet — every edit still syncs live either way.
        </p>
      )}

      <div className="flex flex-col">
        {versions?.map((v) => (
          <div key={v._id} className="flex flex-col gap-1.5 border-b py-3">
            <span className="text-sm font-medium">
              {v.label || (v.source === "auto" ? "Autosaved" : "Untitled version")}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(v.createdAt)} · {v.createdBy ? v.createdBy.name : "Automatic snapshot"}
            </span>

            {canEdit && confirmingId !== v._id && (
              <div>
                <Button variant="outline" size="sm" onClick={() => setConfirmingId(v._id)}>
                  Restore
                </Button>
              </div>
            )}

            {confirmingId === v._id && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                Replace the current content with this version? This can&apos;t be undone, though it
                becomes a new edit anyone can see live.
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleRestore(v._id)}
                    disabled={restoringId === v._id}
                  >
                    {restoringId === v._id ? <Loader2 className="animate-spin" /> : "Yes, restore"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportTab({ documentId, documentTitle }: { documentId: string; documentTitle: string }) {
  const [format, setFormat] = useState<ExportFormat>("md");
  const [job, setJob] = useState<ExportJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopPolling(), []);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function handleExport() {
    stopPolling();
    const { exportJob } = await api.post<{ exportJob: ExportJob }>(`/api/documents/${documentId}/exports`, {
      format,
    });
    setJob(exportJob);

    pollRef.current = setInterval(async () => {
      const { exportJob: updated } = await api.get<{ exportJob: ExportJob }>(
        `/api/documents/${documentId}/exports/${exportJob._id}`,
      );
      setJob(updated);
      if (updated.status === "done" || updated.status === "failed") stopPolling();
    }, 700);
  }

  function handleDownload() {
    if (!job?.resultText) return;
    const blob = new Blob([job.resultText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${documentTitle || "document"}.${job.format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isRunning = job?.status === "queued" || job?.status === "processing";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Export the current content as a file. This runs as a background job — closing this panel
        won&apos;t cancel it.
      </p>

      <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="gap-3">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="md" id="format-md" />
          <Label htmlFor="format-md">Markdown (.md)</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="txt" id="format-txt" />
          <Label htmlFor="format-txt">Plain text (.txt)</Label>
        </div>
      </RadioGroup>

      <Button onClick={handleExport} disabled={isRunning} className="w-fit">
        {isRunning ? <Loader2 className="animate-spin" /> : "Export"}
      </Button>

      {job && (
        <div className="flex items-center gap-2 text-sm">
          {job.status === "queued" && (
            <>
              <Loader2 className="size-4 animate-spin" /> Queued…
            </>
          )}
          {job.status === "processing" && (
            <>
              <Loader2 className="size-4 animate-spin" /> Preparing your export…
            </>
          )}
          {job.status === "done" && (
            <>
              ✓ Ready.
              <Button variant="outline" size="sm" onClick={handleDownload}>
                Download
              </Button>
            </>
          )}
          {job.status === "failed" && (
            <span className="text-destructive">Export failed{job.error ? `: ${job.error}` : "."}</span>
          )}
        </div>
      )}
    </div>
  );
}

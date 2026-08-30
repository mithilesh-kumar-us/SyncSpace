"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "@/api/client";
import type { Collaborator, Role } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Owner-only — the Editor page only renders this when role === "owner", but
// the real access control lives server-side (documentController.js checks
// document.owner on every collaborator route), so this component never has
// to trust that gate itself.
export function SharePanel({ documentId }: { documentId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("editor");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ collaborators: Collaborator[] }>(`/api/documents/${documentId}/collaborators`)
      .then(({ collaborators }) => setCollaborators(collaborators));
  }, [documentId, open]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const added = await api.post<Collaborator>(`/api/documents/${documentId}/collaborators`, {
        email,
        role,
      });
      setCollaborators((cs) => [...cs.filter((c) => c.userId !== added.userId), added]);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to share document.");
    }
  }

  async function handleRemove(userId: string) {
    await api.delete(`/api/documents/${documentId}/collaborators/${userId}`);
    setCollaborators((cs) => cs.filter((c) => c.userId !== userId));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Share
      </Button>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Share this document</SheetTitle>
          <SheetDescription>Add collaborators by email and choose their role.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <form onSubmit={handleShare} className="flex gap-2">
            <Input
              type="email"
              required
              placeholder="Collaborator's email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={role} onValueChange={(v) => setRole(v as Exclude<Role, "owner">)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">Add</Button>
          </form>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {collaborators.length === 0 && (
            <p className="text-sm text-muted-foreground">Not shared with anyone yet.</p>
          )}
          <div className="flex flex-col">
            {collaborators.map((c) => (
              <div
                key={c.userId}
                className="flex items-center justify-between border-b py-2.5 text-sm"
              >
                <span>
                  {c.name} <span className="text-muted-foreground">({c.email})</span> — {c.role}
                </span>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(c.userId)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

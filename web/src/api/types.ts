export interface User {
  _id: string;
  email: string;
  name: string;
}

export type Role = "owner" | "editor" | "viewer";

export type DocumentKind = "text" | "canvas";

export interface DocumentSummary {
  _id: string;
  title: string;
  kind: DocumentKind;
  createdAt: string;
  updatedAt: string;
  owner: string;
  role: Role;
}

export interface Collaborator {
  userId: string;
  name: string;
  email: string;
  role: Exclude<Role, "owner">;
}

export interface VersionEntry {
  _id: string;
  label: string | null;
  source: "manual" | "auto";
  createdBy: { _id: string; name: string; email: string } | null;
  createdAt: string;
}

export type ExportFormat = "txt" | "md";

export interface ExportJob {
  _id: string;
  status: "queued" | "processing" | "done" | "failed";
  format: ExportFormat;
  resultText?: string | null;
  error?: string | null;
}

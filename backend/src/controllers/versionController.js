import * as Y from "yjs";

import { exportQueue } from "../config/queue.js";
import { Document } from "../models/Document.js";
import { DocumentVersion } from "../models/DocumentVersion.js";
import { ExportJob } from "../models/ExportJob.js";
import { getActiveRoomState, restoreDocumentContent } from "../realtime/yjsServer.js";

// A brand-new, never-connected-to document has no yjsState yet — a
// zero-length Buffer fails Mongoose's `required` check on DocumentVersion,
// so an untouched empty doc still needs a real (if tiny) encoded Yjs state
// representing "empty," not a literal empty Buffer.
const EMPTY_YJS_STATE = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

// Prefers the live in-memory room's state (no debounce lag) and only falls
// back to Mongo's last-persisted copy when nobody currently has the
// document open — same reasoning as the export worker's equivalent helper.
async function getCurrentDocumentState(docId) {
  const liveState = getActiveRoomState(docId);
  if (liveState) return liveState;
  const doc = await Document.findById(docId).select("yjsState");
  return doc?.yjsState ?? EMPTY_YJS_STATE;
}

export async function listVersions(req, res) {
  const document = await Document.findById(req.params.id).select("_id owner collaborators");
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });

  const versions = await DocumentVersion.find({ document: document._id })
    .sort({ createdAt: -1 })
    .select("-yjsState")
    .populate("createdBy", "name email")
    .lean();

  res.json({ versions });
}

export async function createVersion(req, res) {
  const document = await Document.findById(req.params.id);
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });
  if (role === "viewer") return res.status(403).json({ error: "Viewers cannot save a version." });

  const state = await getCurrentDocumentState(document._id.toString());
  const created = await DocumentVersion.create({
    document: document._id,
    yjsState: state,
    label: req.body.label?.trim() || null,
    createdBy: req.userId,
    source: "manual",
  });
  const version = await DocumentVersion.findById(created._id)
    .select("-yjsState")
    .populate("createdBy", "name email");

  res.status(201).json({ version });
}

export async function restoreVersion(req, res) {
  const document = await Document.findById(req.params.id).select("_id kind owner collaborators");
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });
  if (role === "viewer") return res.status(403).json({ error: "Viewers cannot restore a version." });

  const version = await DocumentVersion.findOne({
    _id: req.params.versionId,
    document: document._id,
  }).select("yjsState");
  if (!version) return res.status(404).json({ error: "Version not found." });

  await restoreDocumentContent(document._id.toString(), version.yjsState, document.kind);
  res.status(204).send();
}

export async function createExportJob(req, res) {
  const document = await Document.findById(req.params.id).select("_id kind owner collaborators");
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });
  if (document.kind !== "text") {
    return res.status(400).json({ error: "Export is only available for text documents." });
  }

  const { format } = req.body;
  if (!["txt", "md"].includes(format)) {
    return res.status(400).json({ error: "format must be 'txt' or 'md'." });
  }

  const exportJob = await ExportJob.create({
    document: document._id,
    requestedBy: req.userId,
    format,
    status: "queued",
  });
  await exportQueue.add("export", { exportJobId: exportJob._id.toString() });

  res.status(202).json({
    exportJob: { _id: exportJob._id, status: exportJob.status, format: exportJob.format },
  });
}

export async function getExportJob(req, res) {
  const document = await Document.findById(req.params.id).select("_id owner collaborators");
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });

  const exportJob = await ExportJob.findOne({ _id: req.params.exportJobId, document: document._id });
  if (!exportJob) return res.status(404).json({ error: "Export job not found." });

  res.json({ exportJob });
}

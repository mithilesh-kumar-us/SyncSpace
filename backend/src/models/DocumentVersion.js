import mongoose from "mongoose";

// A point-in-time snapshot of a document's Yjs state. Yjs's own update log is
// append-only deltas going back to the document's creation — restoring or
// browsing history from that directly would mean replaying every edit ever
// made. These snapshots exist so "show me the history" and "restore to here"
// are just a Mongo query and a Y.applyUpdate away, not a full replay.
const documentVersionSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    yjsState: { type: Buffer, required: true },
    label: { type: String, trim: true, default: null },
    // null for an auto-snapshot — the periodic job isn't acting on any
    // particular user's behalf.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // "manual" = a user clicked "Save version"; "auto" = the periodic
    // snapshot job took it because the document changed since the last one.
    source: { type: String, enum: ["manual", "auto"], required: true },
  },
  { timestamps: true },
);

documentVersionSchema.index({ document: 1, createdAt: -1 });

export const DocumentVersion = mongoose.model("DocumentVersion", documentVersionSchema);

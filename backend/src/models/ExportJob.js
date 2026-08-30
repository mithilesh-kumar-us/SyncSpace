import mongoose from "mongoose";

// Tracks one async export request end-to-end so the REST layer can return
// immediately (202) and the frontend can poll this row for progress, instead
// of holding a request open while a BullMQ worker does the actual rendering.
const exportJobSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    format: { type: String, enum: ["txt", "md"], required: true },
    status: { type: String, enum: ["queued", "processing", "done", "failed"], default: "queued" },
    resultText: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

export const ExportJob = mongoose.model("ExportJob", exportJobSchema);

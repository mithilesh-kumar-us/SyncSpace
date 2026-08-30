import { Worker } from "bullmq";
import * as Y from "yjs";

import { bullConnection, EXPORT_QUEUE } from "../config/queue.js";
import { Document } from "../models/Document.js";
import { ExportJob } from "../models/ExportJob.js";
import { CONTENT_TYPE, getActiveRoomText } from "../realtime/yjsServer.js";

// Prefers the live in-memory room's content (no debounce lag) and only
// falls back to Mongo's last-persisted copy when nobody currently has the
// document open.
async function getDocumentText(docId) {
  const liveText = getActiveRoomText(docId);
  if (liveText !== null) return liveText;

  const doc = await Document.findById(docId).select("yjsState");
  if (!doc?.yjsState) return "";
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, doc.yjsState);
  return ydoc.getText(CONTENT_TYPE).toString();
}

function renderExport(title, text, format) {
  return format === "md" ? `# ${title}\n\n${text}\n` : text;
}

export function startExportWorker() {
  return new Worker(
    EXPORT_QUEUE,
    async (job) => {
      const exportJob = await ExportJob.findById(job.data.exportJobId).populate("document", "title");
      if (!exportJob) return; // the job row was removed before we got to it

      exportJob.status = "processing";
      await exportJob.save();

      try {
        const text = await getDocumentText(exportJob.document._id.toString());
        exportJob.resultText = renderExport(exportJob.document.title, text, exportJob.format);
        exportJob.status = "done";
      } catch (err) {
        exportJob.status = "failed";
        exportJob.error = err.message;
      }
      await exportJob.save();
    },
    { connection: bullConnection },
  );
}

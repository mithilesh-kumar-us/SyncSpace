import { Document } from "../models/Document.js";
import { User } from "../models/User.js";

// yjsState is a serialized CRDT blob, not something a REST client has any
// use for — the document body is read over the /yjs WebSocket connection
// instead (see realtime/yjsServer.js), never through this endpoint.
const PUBLIC_FIELDS = "-yjsState";

export async function listDocuments(req, res) {
  const documents = await Document.find({
    $or: [{ owner: req.userId }, { "collaborators.user": req.userId }],
  })
    .sort({ updatedAt: -1 })
    .select("title kind owner collaborators updatedAt createdAt")
    .lean();

  res.json({
    documents: documents.map(({ collaborators, ...doc }) => ({
      ...doc,
      // .lean() skips Mongoose's schema-level default, so a pre-V10 document
      // with no `kind` field at all would otherwise come back as `undefined`
      // here rather than falling back to "text".
      kind: doc.kind ?? "text",
      role:
        doc.owner.toString() === req.userId
          ? "owner"
          : collaborators.find((c) => c.user.toString() === req.userId)?.role,
    })),
  });
}

export async function createDocument(req, res) {
  const { title, kind } = req.body;
  if (kind !== undefined && !["text", "canvas"].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'text' or 'canvas'." });
  }
  const created = await Document.create({
    title: title || (kind === "canvas" ? "Untitled whiteboard" : "Untitled document"),
    kind,
    owner: req.userId,
  });
  const document = await Document.findById(created._id).select(PUBLIC_FIELDS);
  res.status(201).json({ document });
}

export async function getDocument(req, res) {
  const document = await Document.findById(req.params.id).select(PUBLIC_FIELDS);
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });
  res.json({ document, role });
}

export async function updateDocument(req, res) {
  // Title is the only field this REST endpoint still owns — document body
  // is exclusively read/written through the real-time Yjs connection now.
  const { title } = req.body;
  if (title === undefined) {
    return res.status(400).json({ error: "Nothing to update — only title can be changed here." });
  }

  const document = await Document.findById(req.params.id);
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });
  if (role === "viewer") return res.status(403).json({ error: "Viewers cannot rename a document." });

  document.title = title;
  await document.save();
  res.json({ document: await Document.findById(document._id).select(PUBLIC_FIELDS) });
}

export async function deleteDocument(req, res) {
  const result = await Document.deleteOne({ _id: req.params.id, owner: req.userId });
  if (result.deletedCount === 0) return res.status(404).json({ error: "Document not found." });
  res.status(204).send();
}

export async function listCollaborators(req, res) {
  const document = await Document.findById(req.params.id).populate("collaborators.user", "name email");
  const role = document?.getRole(req.userId);
  if (!document || !role) return res.status(404).json({ error: "Document not found." });

  res.json({
    collaborators: document.collaborators.map((c) => ({
      userId: c.user._id,
      name: c.user.name,
      email: c.user.email,
      role: c.role,
    })),
  });
}

export async function shareDocument(req, res) {
  const { email, role } = req.body;
  if (!email || !["editor", "viewer"].includes(role)) {
    return res.status(400).json({ error: "email and a valid role ('editor' or 'viewer') are required." });
  }

  const document = await Document.findById(req.params.id);
  if (!document || document.owner.toString() !== req.userId) {
    return res.status(404).json({ error: "Document not found." });
  }

  const targetUser = await User.findOne({ email: email.toLowerCase() });
  if (!targetUser) {
    return res.status(404).json({ error: "No account found with that email." });
  }
  if (targetUser._id.toString() === req.userId) {
    return res.status(400).json({ error: "You already own this document." });
  }

  const existing = document.collaborators.find((c) => c.user.toString() === targetUser._id.toString());
  if (existing) {
    existing.role = role; // re-sharing with a different role just updates it, not a duplicate entry
  } else {
    document.collaborators.push({ user: targetUser._id, role });
  }
  await document.save();

  res.status(201).json({ userId: targetUser._id, name: targetUser.name, email: targetUser.email, role });
}

export async function unshareDocument(req, res) {
  const document = await Document.findById(req.params.id);
  if (!document || document.owner.toString() !== req.userId) {
    return res.status(404).json({ error: "Document not found." });
  }

  document.collaborators = document.collaborators.filter(
    (c) => c.user.toString() !== req.params.userId,
  );
  await document.save();
  res.status(204).send();
}

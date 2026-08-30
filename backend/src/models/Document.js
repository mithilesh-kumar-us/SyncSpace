import mongoose from "mongoose";

const collaboratorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["editor", "viewer"], required: true },
  },
  { _id: false },
);

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, default: "Untitled document" },
    // "text" documents store their body under the Y.Text root name CONTENT_TYPE;
    // "canvas" (whiteboard) documents store shapes under the Y.Map root name
    // SHAPES_TYPE (see realtime/yjsServer.js) — restore/export logic branches
    // on this field since the two content shapes need different handling.
    kind: { type: String, enum: ["text", "canvas"], required: true, default: "text" },
    // Content lives here as a serialized Yjs update (Y.encodeStateAsUpdate),
    // not plain text — as of V2, document body is exclusively synced/edited
    // through the real-time Yjs pipeline (see realtime/yjsServer.js), which
    // is also the only thing that writes to this field now.
    yjsState: { type: Buffer, default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // V4: the owner can always edit/share/delete; everyone else's access is
    // exactly what's listed here, checked via getRole() below — this array
    // is the entire permission model, both for the REST API and (see
    // realtime/yjsServer.js) the WebSocket layer.
    collaborators: { type: [collaboratorSchema], default: [] },
  },
  { timestamps: true },
);

documentSchema.index({ "collaborators.user": 1 });

// The single source of truth for "what can this user do with this
// document" — every route and the WebSocket auth check both call this
// rather than each re-deriving the same owner-or-collaborator logic.
documentSchema.methods.getRole = function (userId) {
  const uid = userId.toString();
  if (this.owner.toString() === uid) return "owner";
  const collaborator = this.collaborators.find((c) => c.user.toString() === uid);
  return collaborator?.role ?? null;
};

export const Document = mongoose.model("Document", documentSchema);

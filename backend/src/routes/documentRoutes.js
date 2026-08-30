import { Router } from "express";

import {
  createDocument,
  deleteDocument,
  getDocument,
  listCollaborators,
  listDocuments,
  shareDocument,
  unshareDocument,
  updateDocument,
} from "../controllers/documentController.js";
import {
  createExportJob,
  createVersion,
  getExportJob,
  listVersions,
  restoreVersion,
} from "../controllers/versionController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const documentRoutes = Router();

documentRoutes.use(requireAuth); // every document route requires a signed-in user

documentRoutes.get("/", asyncHandler(listDocuments));
documentRoutes.post("/", asyncHandler(createDocument));
documentRoutes.get("/:id", asyncHandler(getDocument));
documentRoutes.patch("/:id", asyncHandler(updateDocument));
documentRoutes.delete("/:id", asyncHandler(deleteDocument));

documentRoutes.get("/:id/collaborators", asyncHandler(listCollaborators));
documentRoutes.post("/:id/collaborators", asyncHandler(shareDocument));
documentRoutes.delete("/:id/collaborators/:userId", asyncHandler(unshareDocument));

documentRoutes.get("/:id/versions", asyncHandler(listVersions));
documentRoutes.post("/:id/versions", asyncHandler(createVersion));
documentRoutes.post("/:id/versions/:versionId/restore", asyncHandler(restoreVersion));

documentRoutes.post("/:id/exports", asyncHandler(createExportJob));
documentRoutes.get("/:id/exports/:exportJobId", asyncHandler(getExportJob));

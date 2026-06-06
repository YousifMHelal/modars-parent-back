import type { Request, Response, NextFunction } from "express";
import * as service from "./files.service.js";
import type { FileResult } from "./files.service.js";

// Thin controllers: the principal's family comes from the verified token; the service makes
// the authorization decision. On the S3/R2 backend we 302-redirect to a short-lived signed
// URL; on the local backend we stream the bytes (contracts/files.openapi.yaml).

function respond(res: Response, result: FileResult): void {
  if (result.kind === "signed") {
    res.redirect(302, result.url);
    return;
  }
  res.setHeader("Content-Type", result.contentType);
  result.stream.pipe(res);
}

export async function getLoginCard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    respond(res, await service.getLoginCard(familyId, childId));
  } catch (err) {
    next(err);
  }
}

export async function getAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { messageId, filename } = req.params as { messageId: string; filename: string };
    respond(res, await service.getAttachment(familyId, messageId, filename));
  } catch (err) {
    next(err);
  }
}

export async function getExport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { exportId } = req.params as { exportId: string };
    respond(res, await service.getExport(familyId, exportId));
  } catch (err) {
    next(err);
  }
}

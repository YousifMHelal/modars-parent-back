import type { Request, Response, NextFunction } from "express";
import * as service from "./settings.service.js";
import type {
  AccountUpdateInput,
  NotificationPrefsInput,
  InviteInput,
  AcceptInput,
  ConsentQueryInput,
} from "./settings.schema.js";

// Thin controllers per contracts/settings.openapi.yaml. familyId + parentId come
// from the verified principal; accept is public (token is the credential).

export async function updateAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId, id } = req.principal!;
    await service.updateAccount(familyId, id, req.body as AccountUpdateInput);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function updateNotificationPrefs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId, id } = req.principal!;
    await service.updateNotificationPrefs(familyId, id, req.body as NotificationPrefsInput);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function inviteCoParent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId, id } = req.principal!;
    await service.inviteCoParent(familyId, id, (req.body as InviteInput).email);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function acceptCoParent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tokens = await service.acceptCoParent(req.body as AcceptInput);
    res.status(201).json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function revokeInvitation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { id } = req.params as { id: string };
    await service.revokeInvitation(familyId, id);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── Phase 8: account deletion ─────────────────────────────────────────────────

export async function requestAccountDeletion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    res.status(200).json(await service.requestAccountDeletion(familyId));
  } catch (err) {
    next(err);
  }
}

export async function cancelAccountDeletion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    res.status(200).json(await service.cancelAccountDeletion(familyId));
  } catch (err) {
    next(err);
  }
}

// ── Phase 8: data export ──────────────────────────────────────────────────────

export async function requestDataExport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId, id } = req.principal!;
    res.status(202).json(await service.requestDataExport(familyId, id));
  } catch (err) {
    next(err);
  }
}

export async function listDataExports(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    res.status(200).json(await service.listDataExports(familyId));
  } catch (err) {
    next(err);
  }
}

export async function getDataExport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { id } = req.params as { id: string };
    res.status(200).json(await service.getDataExport(familyId, id));
  } catch (err) {
    next(err);
  }
}

// ── Phase 8: consent history ──────────────────────────────────────────────────

export async function getConsentHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const query: ConsentQueryInput = req.query;
    res.status(200).json(await service.getConsentHistory(familyId, query));
  } catch (err) {
    next(err);
  }
}

import type { Request, Response, NextFunction } from "express";
import * as service from "./notifications.service.js";
import type { RegisterPushTokenInput } from "./notifications.schema.js";

// Thin push-token controllers. The owning family + principal (parent vs child) come from
// the verified session principal, never the request body (Principle I). A parent session
// registers a parent token; a child session registers its own child token.

export async function registerPushToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const principal = req.principal!;
    const { platform, token } = req.body as RegisterPushTokenInput;
    const result = await service.registerPushToken({
      familyId: principal.familyId,
      parentId: principal.type === "parent" ? principal.id : null,
      childId: principal.type === "child" ? principal.id : null,
      platform,
      token,
    });
    res.status(201).json({
      id: result.id,
      platform: result.platform,
      createdAt: result.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

export async function deregisterPushToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const principal = req.principal!;
    const { token } = req.query as { token: string };
    await service.deregisterPushToken(principal.familyId, token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ── In-app notification feed (the dashboard bell) ─────────────────────────────

export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    res.status(200).json(await service.listNotifications(familyId));
  } catch (err) {
    next(err);
  }
}

export async function markNotificationRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { id } = req.params as { id: string };
    await service.markNotificationRead(familyId, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const updated = await service.markAllNotificationsRead(familyId);
    res.status(200).json({ updated });
  } catch (err) {
    next(err);
  }
}

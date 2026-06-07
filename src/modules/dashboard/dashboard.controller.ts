import type { Request, Response, NextFunction } from "express";
import * as service from "./dashboard.service.js";

// Thin controllers: read familyId (and parentId) from the verified principal —
// never from request input — parse :childId, call the service, return JSON.

export async function getHome(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const summary = await service.getHomeSummary(familyId);
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}

export async function getChildren(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const children = await service.listChildren(familyId);
    res.status(200).json({ children });
  } catch (err) {
    next(err);
  }
}

export async function getChildProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const profile = await service.getChildProfile(familyId, childId);
    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
}

export async function getReminders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const reminders = await service.getReminderConfig(familyId);
    res.status(200).json({ reminders });
  } catch (err) {
    next(err);
  }
}

export async function updateReminder(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { id } = req.params as { id: string };
    const { enabled, settings } = req.body as {
      enabled?: boolean;
      settings?: Record<string, unknown>;
    };
    const reminders = await service.updateReminder(familyId, id, { enabled, settings });
    res.status(200).json({ reminders });
  } catch (err) {
    next(err);
  }
}

export async function getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId, id } = req.principal!;
    const settings = await service.getSettings(familyId, id);
    res.status(200).json(settings);
  } catch (err) {
    next(err);
  }
}

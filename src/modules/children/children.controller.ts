import type { Request, Response, NextFunction } from "express";
import * as service from "./children.service.js";
import { mapChildToListItem } from "../dashboard/dashboard.service.js";
import type { CreateChildInput, EditChildInput, CredentialsInput } from "./children.schema.js";

// Thin controllers: familyId comes from the verified principal (never request input);
// :childId is parsed from the validated params. Each maps one action to the service.

export async function createChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const child = await service.createChild(familyId, req.body as CreateChildInput);
    res.status(201).json(await mapChildToListItem(child));
  } catch (err) {
    next(err);
  }
}

export async function checkUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const username = (req.query as { username: string }).username;
    res.status(200).json(await service.checkUsername(username));
  } catch (err) {
    next(err);
  }
}

export async function editChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const child = await service.editChild(familyId, childId, req.body as EditChildInput);
    res.status(200).json(await mapChildToListItem(child));
  } catch (err) {
    next(err);
  }
}

export async function updateCredentials(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    await service.updateCredentials(familyId, childId, req.body as CredentialsInput);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function pauseChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const child = await service.pauseChild(familyId, childId);
    res.status(200).json(await mapChildToListItem(child));
  } catch (err) {
    next(err);
  }
}

export async function reactivateChild(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const child = await service.reactivateChild(familyId, childId);
    res.status(200).json(await mapChildToListItem(child));
  } catch (err) {
    next(err);
  }
}

export async function deleteChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    await service.softDeleteChild(familyId, childId);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function restoreChild(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const child = await service.restoreChild(familyId, childId);
    res.status(200).json(await mapChildToListItem(child));
  } catch (err) {
    next(err);
  }
}

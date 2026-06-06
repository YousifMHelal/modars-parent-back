import type { Request, Response, NextFunction } from "express";
import * as service from "./onboarding.service.js";
import type { RegisterInput, PlanSelectionInput } from "./onboarding.schema.js";

// Thin controllers per contracts/onboarding.openapi.yaml: register (201 + tokens),
// plan (200), state (200). familyId comes from the verified principal.

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tokens = await service.registerOnboarding(req.body as RegisterInput);
    res.status(201).json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function selectPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    await service.selectPlan(familyId, req.body as PlanSelectionInput);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function getState(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    res.status(200).json(await service.getOnboardingState(familyId));
  } catch (err) {
    next(err);
  }
}

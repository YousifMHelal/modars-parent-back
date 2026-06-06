import type { Request, Response, NextFunction } from "express";
import * as service from "./billing.service.js";
import type {
  InitiateInput,
  OverflowUpgradeInput,
  PlanChangeInput,
  PaymentMethodInput,
} from "./billing.schema.js";

// Thin billing controllers: familyId comes from the verified principal (never request
// input); each maps one action to the service and lets the centralized error handler
// shape failures. No controller can activate a subscription — that is webhook-only.

export async function initiate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.initiate(familyId, req.body as InitiateInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function overflowUpgrade(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.overflowUpgrade(familyId, req.body as OverflowUpgradeInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function planChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.planChange(familyId, req.body as PlanChangeInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function changePaymentMethod(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.changePaymentMethod(familyId, req.body as PaymentMethodInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.cancel(familyId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.reactivate(familyId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBillingHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const result = await service.getBillingHistory(familyId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { id } = req.params as { id: string };
    const result = await service.getInvoice(familyId, id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

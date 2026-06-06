import type { Request, Response, NextFunction } from "express";
import * as service from "./rewards.service.js";
import type { CreateRewardInput, EditRewardInput, ListRewardsInput } from "./rewards.schema.js";

// Thin controllers (Principle II): familyId comes from the verified principal (never
// request input); :rewardId from validated params. Each maps one action to the service.

export async function createReward(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const reward = await service.createReward(familyId, req.body as CreateRewardInput);
    res.status(201).json(reward);
  } catch (err) {
    next(err);
  }
}

export async function listRewards(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const filters: ListRewardsInput = {
      ...(typeof req.query.childId === "string" ? { childId: req.query.childId } : {}),
      ...(typeof req.query.status === "string"
        ? { status: req.query.status as ListRewardsInput["status"] }
        : {}),
    };
    const rewards = await service.listRewards(familyId, filters);
    res.status(200).json({ rewards });
  } catch (err) {
    next(err);
  }
}

export async function getReward(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { rewardId } = req.params as { rewardId: string };
    const reward = await service.getReward(familyId, rewardId);
    res.status(200).json(reward);
  } catch (err) {
    next(err);
  }
}

export async function editReward(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { rewardId } = req.params as { rewardId: string };
    const reward = await service.editReward(familyId, rewardId, req.body as EditRewardInput);
    res.status(200).json(reward);
  } catch (err) {
    next(err);
  }
}

export async function fulfillReward(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { rewardId } = req.params as { rewardId: string };
    const reward = await service.fulfillReward(familyId, rewardId);
    res.status(200).json(reward);
  } catch (err) {
    next(err);
  }
}

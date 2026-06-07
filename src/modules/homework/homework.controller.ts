import type { Request, Response, NextFunction } from "express";
import * as service from "./homework.service.js";
import { displayDate, homeworkDaysInfo } from "../../lib/time.js";
import type { HomeworkItem } from "../dashboard/dashboard.schema.js";
import type { Homework } from "../../generated/prisma/client.js";
import type { CreateHomeworkBody } from "./homework.schema.js";

// Map a persisted Homework row to the dashboard's HomeworkItem display shape so the FE
// can render the new item directly (same shape getChildProfile returns).
function toHomeworkItem(hw: Homework, now: Date): HomeworkItem {
  return {
    id: hw.id,
    subject: hw.subject,
    topic: hw.topic,
    deadline: displayDate(hw.deadline, "short"),
    status: hw.status.toLowerCase() as HomeworkItem["status"],
    daysInfo: homeworkDaysInfo(hw.deadline, hw.status, now),
  };
}

// Thin controller: familyId comes from the verified principal; :childId from validated params.
export async function createHomework(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { familyId } = req.principal!;
    const { childId } = req.params as { childId: string };
    const hw = await service.createHomework(familyId, childId, req.body as CreateHomeworkBody);
    res.status(201).json(toHomeworkItem(hw, new Date()));
  } catch (err) {
    next(err);
  }
}

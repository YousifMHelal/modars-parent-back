-- CreateEnum
CREATE TYPE "RewardGoalMetric" AS ENUM ('XP', 'SESSIONS');

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "goalMetric" "RewardGoalMetric";

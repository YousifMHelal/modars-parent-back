-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "Family" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "requestedByParentId" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExport_familyId_idx" ON "DataExport"("familyId");

-- CreateIndex
CREATE INDEX "DataExport_status_expiresAt_idx" ON "DataExport"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_requestedByParentId_fkey" FOREIGN KEY ("requestedByParentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "loginCardUrl" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CoParentInvitation" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoParentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoParentInvitation_familyId_idx" ON "CoParentInvitation"("familyId");

-- CreateIndex
CREATE INDEX "CoParentInvitation_tokenHash_idx" ON "CoParentInvitation"("tokenHash");

-- AddForeignKey
ALTER TABLE "CoParentInvitation" ADD CONSTRAINT "CoParentInvitation_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoParentInvitation" ADD CONSTRAINT "CoParentInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

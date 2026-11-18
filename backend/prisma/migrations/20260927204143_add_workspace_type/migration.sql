-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('EDTECH', 'MANUFACTURING');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "workspaceType" "WorkspaceType" NOT NULL DEFAULT 'EDTECH';

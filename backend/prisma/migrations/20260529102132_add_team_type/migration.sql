-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('MEMBER', 'MANAGER');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "type" "TeamType" NOT NULL DEFAULT 'MEMBER';

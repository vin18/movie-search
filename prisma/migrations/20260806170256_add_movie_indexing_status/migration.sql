-- CreateEnum
CREATE TYPE "IndexingStatus" AS ENUM ('PENDING', 'INDEXED');

-- AlterTable
ALTER TABLE "movies" ADD COLUMN     "indexingStatus" "IndexingStatus" NOT NULL DEFAULT 'PENDING';

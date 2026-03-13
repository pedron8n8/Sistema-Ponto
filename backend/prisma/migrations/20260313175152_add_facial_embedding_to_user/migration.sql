-- AlterTable
ALTER TABLE "User" ADD COLUMN     "facialEmbedding" JSONB,
ADD COLUMN     "facialEmbeddingUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "facialThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.45;

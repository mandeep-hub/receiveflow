/*
  Warnings:

  - Added the required column `epCount` to the `Receiving` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- AlterTable
ALTER TABLE "Receiving" ADD COLUMN "epCount" INTEGER NOT NULL DEFAULT 0;

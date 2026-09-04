/*
  Warnings:

  - The primary key for the `Product` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `articleNo` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Product` table. All the data in the column will be lost.
  - The `id` column on the `Product` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[articleNumber]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `articleNumber` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Product_articleNo_key";

-- AlterTable
ALTER TABLE "Product" DROP CONSTRAINT "Product_pkey",
DROP COLUMN "articleNo",
DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "articleNumber" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Product_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_articleNumber_key" ON "Product"("articleNumber");

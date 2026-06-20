-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable: adiciona tipo e valor de desconto à venda
ALTER TABLE "sale"
  ADD COLUMN "discountType"  "DiscountType",
  ADD COLUMN "discountValue" INTEGER NOT NULL DEFAULT 0;

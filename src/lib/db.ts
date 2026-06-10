import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Cacheia o cliente também em produção: em serverless o módulo pode ser
// reavaliado, e sem isso cada avaliação abriria um novo pool de conexões.
globalForPrisma.prisma = db;

import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { injectWorkspaceId, UNSCOPED_MODELS } from "./nested-writes";

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

const CREATE_OPS = new Set(["create", "createMany"]);
const SINGLE_TARGET_OPS = new Set(["update", "delete"]);

function withWhere(args: Record<string, unknown>, workspaceId: string) {
  const where = (args.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, workspaceId } };
}

export function scopedDb(workspaceId: string): PrismaClient {
  return db.$extends({
    model: {
      $allModels: {
        async findUnique(this: unknown, args: Record<string, unknown>) {
          const ctx = Prisma.getExtensionContext(this) as {
            findFirst: (a: unknown) => Promise<unknown>;
          };
          return ctx.findFirst(args);
        },
        async findUniqueOrThrow(this: unknown, args: Record<string, unknown>) {
          const ctx = Prisma.getExtensionContext(this) as {
            findFirstOrThrow: (a: unknown) => Promise<unknown>;
          };
          return ctx.findFirstOrThrow(args);
        },
      },
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) return query(args);

          const typed = (args ?? {}) as Record<string, unknown>;

          if (WHERE_OPS.has(operation) || SINGLE_TARGET_OPS.has(operation)) {
            return query(withWhere(typed, workspaceId) as never);
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === "createMany") {
              const data = typed.data;
              const rows = Array.isArray(data) ? data : [data];
              return query({
                ...typed,
                data: rows.map((row) => ({ ...(row as object), workspaceId })),
              } as never);
            }
            return query({
              ...typed,
              data: injectWorkspaceId(model, typed.data ?? {}, workspaceId),
            } as never);
          }

          if (operation === "upsert") {
            return query({
              ...withWhere(typed, workspaceId),
              create: injectWorkspaceId(model, typed.create ?? {}, workspaceId),
            } as never);
          }

          return query(typed);
        },
      },
    },
  }) as unknown as PrismaClient;
}

import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { injectIntoNestedWrites, injectWorkspaceId, UNSCOPED_MODELS } from "./nested-writes";

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

const CREATE_MANY_OPS = new Set(["createMany", "createManyAndReturn"]);
const CREATE_OPS = new Set(["create", ...CREATE_MANY_OPS]);
const SINGLE_TARGET_OPS = new Set(["update", "delete"]);
const UPSERT_OPS = new Set(["upsert"]);

export const SCOPED_OPERATIONS = new Set([
  ...WHERE_OPS,
  ...CREATE_OPS,
  ...SINGLE_TARGET_OPS,
  ...UPSERT_OPS,
]);

export function unsupportedOperation(model: string, operation: string): never {
  throw new Error(
    `A operação "${operation}" não é suportada pelo client escopado por workspace (model "${model}"). ` +
      `O client escopado só executa operações para as quais sabe injetar o workspaceId; qualquer outra rodaria ` +
      `sem escopo e poderia ler ou alterar dados de outros workspaces. ` +
      `Se você precisa dessa operação, adicione o tratamento explícito dela em src/server/tenant/extension.ts.`,
  );
}

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

          if (!SCOPED_OPERATIONS.has(operation)) unsupportedOperation(model, operation);

          const typed = (args ?? {}) as Record<string, unknown>;

          if (operation === "update") {
            return query({
              ...withWhere(typed, workspaceId),
              data: injectIntoNestedWrites(model, typed.data ?? {}, workspaceId),
            } as never);
          }

          if (WHERE_OPS.has(operation) || SINGLE_TARGET_OPS.has(operation)) {
            return query(withWhere(typed, workspaceId) as never);
          }

          if (CREATE_OPS.has(operation)) {
            if (CREATE_MANY_OPS.has(operation)) {
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

          if (UPSERT_OPS.has(operation)) {
            return query({
              ...withWhere(typed, workspaceId),
              create: injectWorkspaceId(model, typed.create ?? {}, workspaceId),
              update: injectIntoNestedWrites(model, typed.update ?? {}, workspaceId),
            } as never);
          }

          return unsupportedOperation(model, operation);
        },
      },
    },
  }) as unknown as PrismaClient;
}

import { Prisma } from "@prisma/client";

export const UNSCOPED_MODELS = new Set([
  "User",
  "Session",
  "Account",
  "Verification",
  "AllowedEmail",
  "Workspace",
  "Member",
  "Invitation",
]);

const relationTargets = new Map<string, Map<string, string>>();

for (const model of Prisma.dmmf.datamodel.models) {
  const relations = new Map<string, string>();
  for (const field of model.fields) {
    if (field.kind === "object") relations.set(field.name, field.type);
  }
  relationTargets.set(model.name, relations);
}

const NESTED_CREATE_KEYS = ["create", "createMany"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function injectIntoPayload(model: string, payload: unknown, workspaceId: string): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => injectIntoPayload(model, entry, workspaceId));
  }
  if (!isPlainObject(payload)) return payload;
  return injectWorkspaceId(model, payload, workspaceId);
}

export function injectWorkspaceId(
  modelName: string,
  data: unknown,
  workspaceId: string,
): unknown {
  if (!isPlainObject(data)) return data;

  const relations = relationTargets.get(modelName) ?? new Map<string, string>();
  const result: Record<string, unknown> = { ...data };

  if (!UNSCOPED_MODELS.has(modelName)) result.workspaceId = workspaceId;

  for (const [key, value] of Object.entries(data)) {
    const target = relations.get(key);
    if (!target || UNSCOPED_MODELS.has(target) || !isPlainObject(value)) continue;

    const nested: Record<string, unknown> = { ...value };

    for (const createKey of NESTED_CREATE_KEYS) {
      const payload = nested[createKey];
      if (payload === undefined) continue;
      if (createKey === "createMany" && isPlainObject(payload)) {
        nested[createKey] = {
          ...payload,
          data: injectIntoPayload(target, payload.data, workspaceId),
        };
      } else {
        nested[createKey] = injectIntoPayload(target, payload, workspaceId);
      }
    }

    const connectOrCreate = nested.connectOrCreate;

    if (isPlainObject(connectOrCreate)) {
      nested.connectOrCreate = {
        ...connectOrCreate,
        create: injectIntoPayload(target, connectOrCreate.create, workspaceId),
      };
    } else if (Array.isArray(connectOrCreate)) {
      nested.connectOrCreate = connectOrCreate.map((entry) => {
        if (!isPlainObject(entry)) return entry;
        return { ...entry, create: injectIntoPayload(target, entry.create, workspaceId) };
      });
    }

    result[key] = nested;
  }

  return result;
}

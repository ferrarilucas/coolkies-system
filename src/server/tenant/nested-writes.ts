import { Prisma } from "@prisma/client";

export const TENANCY_CONTROL_PLANE_MODELS = new Set(["Member", "Invitation"]);

export const UNSCOPED_MODELS = new Set([
  "User",
  "Session",
  "Account",
  "Verification",
  "AllowedEmail",
  "Workspace",
  "Subscription",
  ...TENANCY_CONTROL_PLANE_MODELS,
]);

const relationTargets = new Map<string, Map<string, string>>();

for (const model of Prisma.dmmf.datamodel.models) {
  const relations = new Map<string, string>();
  for (const field of model.fields) {
    if (field.kind === "object") relations.set(field.name, field.type);
  }
  relationTargets.set(model.name, relations);
}

const NO_RELATIONS = new Map<string, string>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapEntries(
  payload: unknown,
  transform: (entry: Record<string, unknown>) => unknown,
): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => (isPlainObject(entry) ? transform(entry) : entry));
  }
  if (!isPlainObject(payload)) return payload;
  return transform(payload);
}

function injectIntoPayload(model: string, payload: unknown, workspaceId: string): unknown {
  return mapEntries(payload, (entry) => injectWorkspaceId(model, entry, workspaceId));
}

function walkPayload(model: string, payload: unknown, workspaceId: string): unknown {
  return mapEntries(payload, (entry) => injectIntoNestedWrites(model, entry, workspaceId));
}

function walkTargetedUpdate(
  model: string,
  entry: Record<string, unknown>,
  workspaceId: string,
): unknown {
  if (entry.data === undefined) return injectIntoNestedWrites(model, entry, workspaceId);
  return { ...entry, data: walkPayload(model, entry.data, workspaceId) };
}

function walkRelationOps(
  target: string,
  value: Record<string, unknown>,
  workspaceId: string,
): Record<string, unknown> {
  const nested: Record<string, unknown> = { ...value };

  if (nested.create !== undefined) {
    nested.create = injectIntoPayload(target, nested.create, workspaceId);
  }

  if (nested.createMany !== undefined) {
    const payload = nested.createMany;
    nested.createMany = isPlainObject(payload)
      ? { ...payload, data: injectIntoPayload(target, payload.data, workspaceId) }
      : injectIntoPayload(target, payload, workspaceId);
  }

  if (nested.connectOrCreate !== undefined) {
    nested.connectOrCreate = mapEntries(nested.connectOrCreate, (entry) =>
      entry.create === undefined
        ? entry
        : { ...entry, create: injectIntoPayload(target, entry.create, workspaceId) },
    );
  }

  if (nested.upsert !== undefined) {
    nested.upsert = mapEntries(nested.upsert, (entry) => {
      const next: Record<string, unknown> = { ...entry };
      if (next.create !== undefined) {
        next.create = injectIntoPayload(target, next.create, workspaceId);
      }
      if (next.update !== undefined) {
        next.update = walkPayload(target, next.update, workspaceId);
      }
      return next;
    });
  }

  if (nested.update !== undefined) {
    nested.update = mapEntries(nested.update, (entry) =>
      walkTargetedUpdate(target, entry, workspaceId),
    );
  }

  if (nested.updateMany !== undefined) {
    nested.updateMany = mapEntries(nested.updateMany, (entry) =>
      walkTargetedUpdate(target, entry, workspaceId),
    );
  }

  return nested;
}

function walkRelations(
  modelName: string,
  data: Record<string, unknown>,
  workspaceId: string,
): Record<string, unknown> {
  const relations = relationTargets.get(modelName) ?? NO_RELATIONS;
  const result: Record<string, unknown> = { ...data };

  for (const [key, value] of Object.entries(data)) {
    const target = relations.get(key);
    if (!target || UNSCOPED_MODELS.has(target) || !isPlainObject(value)) continue;
    result[key] = walkRelationOps(target, value, workspaceId);
  }

  return result;
}

export function injectWorkspaceId(
  modelName: string,
  data: unknown,
  workspaceId: string,
): unknown {
  if (!isPlainObject(data)) return data;

  const result = walkRelations(modelName, data, workspaceId);

  if (!UNSCOPED_MODELS.has(modelName)) result.workspaceId = workspaceId;

  return result;
}

export function injectIntoNestedWrites(
  modelName: string,
  data: unknown,
  workspaceId: string,
): unknown {
  if (!isPlainObject(data)) return data;

  return walkRelations(modelName, data, workspaceId);
}

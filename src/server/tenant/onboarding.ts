import type { MemberRole } from "@prisma/client";
import { db } from "@/lib/db";
import { MISSION_IDS, type MissionId, type OnboardingProgress } from "@/lib/onboarding/missions";
import { isSectorKey } from "@/lib/onboarding/sectors";
import { canSeeMissions, type OnboardingState } from "@/lib/onboarding/visibility";

type ProgressRow = Record<MissionId, boolean | null>;

export async function getOnboardingProgress(workspaceId: string): Promise<OnboardingProgress> {
  const rows = await db.$queryRaw<ProgressRow[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM "purchase_item" pi
        JOIN "item" i ON i."id" = pi."itemId"
        WHERE pi."workspaceId" = ${workspaceId} AND i."productionInput"
      ) AS "compra-insumo",
      EXISTS (SELECT 1 FROM "purchase" WHERE "workspaceId" = ${workspaceId}) AS "compra-fornecedor",
      EXISTS (SELECT 1 FROM "recipe" WHERE "workspaceId" = ${workspaceId}) AS "ficha-tecnica",
      EXISTS (SELECT 1 FROM "price_list_item" WHERE "workspaceId" = ${workspaceId} AND "active") AS "catalogo",
      EXISTS (SELECT 1 FROM "production_batch" WHERE "workspaceId" = ${workspaceId}) AS "producao",
      EXISTS (SELECT 1 FROM "sale" WHERE "workspaceId" = ${workspaceId}) AS "venda",
      EXISTS (SELECT 1 FROM "sale" WHERE "workspaceId" = ${workspaceId} AND "installmentCount" > 1) AS "venda-parcelada",
      EXISTS (SELECT 1 FROM "customer" WHERE "workspaceId" = ${workspaceId}) AS "cliente"
  `;
  const row = rows[0];
  return Object.fromEntries(MISSION_IDS.map((id) => [id, Boolean(row?.[id])])) as OnboardingProgress;
}

export async function getOnboardingState(input: {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  canWrite: boolean;
}): Promise<OnboardingState> {
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { sector: true, onboardingDismissedAt: true },
  });
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { appTourCompletedAt: true },
  });

  const rawSector = workspace?.sector;
  const sector = isSectorKey(rawSector) ? rawSector : null;
  const dismissed = workspace?.onboardingDismissedAt != null;
  const eligible = canSeeMissions(input.role, input.canWrite);

  let progress: OnboardingProgress | null = null;
  if (eligible && sector && !dismissed) {
    try {
      progress = await getOnboardingProgress(input.workspaceId);
    } catch (error) {
      console.error("onboarding: falha ao calcular o progresso", error);
    }
  }

  return {
    workspaceId: input.workspaceId,
    sector,
    dismissed,
    appTourDone: user?.appTourCompletedAt != null,
    eligible,
    progress,
  };
}

export async function setWorkspaceSector(workspaceId: string, sector: string): Promise<void> {
  if (!isSectorKey(sector)) throw new Error("Escolha o ramo do seu negócio.");
  await db.workspace.update({ where: { id: workspaceId }, data: { sector } });
}

export async function setOnboardingDismissed(workspaceId: string, dismissed: boolean): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { onboardingDismissedAt: dismissed ? new Date() : null },
  });
}

export async function setAppTourCompleted(userId: string, completed: boolean): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { appTourCompletedAt: completed ? new Date() : null },
  });
}

"use server";

import { revalidatePath } from "next/cache";
import type { OnboardingProgress } from "@/lib/onboarding/missions";
import { getWorkspaceContext, requireRole } from "@/server/tenant/context";
import {
  getOnboardingState,
  setAppTourCompleted,
  setOnboardingDismissed,
  setWorkspaceSector,
} from "@/server/tenant/onboarding";
import type { ActionResult } from "./workspaces";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Algo deu errado.";
}

async function perform(task: () => Promise<void>): Promise<ActionResult> {
  try {
    await task();
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function chooseWorkspaceSector(sector: string): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setWorkspaceSector(workspaceId, sector);
  });
}

export async function dismissOnboarding(): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setOnboardingDismissed(workspaceId, true);
  });
}

export async function resumeOnboarding(): Promise<ActionResult> {
  return perform(async () => {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await setOnboardingDismissed(workspaceId, false);
  });
}

export async function finishAppTour(): Promise<ActionResult> {
  return perform(async () => {
    const { userId } = await getWorkspaceContext();
    await setAppTourCompleted(userId, true);
  });
}

export async function restartAppTour(): Promise<ActionResult> {
  return perform(async () => {
    const { userId } = await getWorkspaceContext();
    await setAppTourCompleted(userId, false);
  });
}

export async function refreshOnboardingProgress(): Promise<OnboardingProgress | null> {
  const context = await getWorkspaceContext();
  const state = await getOnboardingState(context);
  return state.progress;
}

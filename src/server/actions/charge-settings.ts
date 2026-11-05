"use server";

import { revalidatePath } from "next/cache";
import { CHARGE_TEMPLATE_MAX, DEFAULT_CHARGE_TEMPLATE } from "@/lib/charge-message";
import { PIX_CITY_MAX, PIX_NAME_MAX, isPixKeyType, normalizePixKey } from "@/lib/pix";
import { requireRole, writeBlocked } from "@/server/tenant/context";
import { saveChargeSettings, type ChargeSettingsInput } from "@/server/tenant/charge-settings";
import type { ActionResult } from "./workspaces";

const UNAUTHORIZED = "Não autorizado";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message === UNAUTHORIZED) return UNAUTHORIZED;
  console.error("[charge-settings] falha ao salvar", error);
  return "Algo deu errado.";
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parse(formData: FormData): { ok: true; data: ChargeSettingsInput } | { ok: false; error: string } {
  const template = String(formData.get("template") ?? "").replace(/\r\n?/g, "\n").trim();
  if (template.length > CHARGE_TEMPLATE_MAX) {
    return { ok: false, error: `A mensagem pode ter até ${CHARGE_TEMPLATE_MAX} caracteres.` };
  }

  const pixRecipientName = text(formData, "pixRecipientName");
  if (pixRecipientName.length > PIX_NAME_MAX) {
    return { ok: false, error: `O nome pode ter até ${PIX_NAME_MAX} caracteres.` };
  }

  const pixCity = text(formData, "pixCity");
  if (pixCity.length > PIX_CITY_MAX) {
    return { ok: false, error: `A cidade pode ter até ${PIX_CITY_MAX} caracteres.` };
  }

  const rawKey = text(formData, "pixKey");
  const rawType = text(formData, "pixKeyType");
  let pixKey: string | null = null;
  let pixKeyType: ChargeSettingsInput["pixKeyType"] = null;

  if (rawKey) {
    if (!isPixKeyType(rawType)) return { ok: false, error: "Escolha o tipo da chave Pix." };
    const normalized = normalizePixKey(rawType, rawKey);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    pixKey = normalized.key;
    pixKeyType = rawType;
  }

  return {
    ok: true,
    data: {
      template: template && template !== DEFAULT_CHARGE_TEMPLATE ? template : null,
      sendImage: formData.get("sendImage") === "on",
      pixKeyType,
      pixKey,
      pixRecipientName: pixRecipientName || null,
      pixCity: pixCity || null,
    },
  };
}

export async function updateChargeSettings(formData: FormData): Promise<ActionResult> {
  try {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    const blocked = await writeBlocked();
    if (blocked) return blocked;
    const parsed = parse(formData);
    if (!parsed.ok) return parsed;
    await saveChargeSettings(workspaceId, parsed.data);
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  revalidatePath("/customers");
  revalidatePath("/admin/charge");
  return { ok: true };
}

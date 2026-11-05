import type { PixKeyType } from "@prisma/client";
import { db } from "@/lib/db";

export type ChargeSettings = {
  workspaceName: string;
  template: string | null;
  sendImage: boolean;
  pixKeyType: PixKeyType | null;
  pixKey: string | null;
  pixRecipientName: string | null;
  pixCity: string | null;
};

export type ChargeSettingsInput = Omit<ChargeSettings, "workspaceName">;

export async function getChargeSettings(workspaceId: string): Promise<ChargeSettings> {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      name: true,
      chargeMessageTemplate: true,
      chargeSendImage: true,
      pixKeyType: true,
      pixKey: true,
      pixRecipientName: true,
      pixCity: true,
    },
  });
  return {
    workspaceName: workspace.name,
    template: workspace.chargeMessageTemplate,
    sendImage: workspace.chargeSendImage,
    pixKeyType: workspace.pixKeyType,
    pixKey: workspace.pixKey,
    pixRecipientName: workspace.pixRecipientName,
    pixCity: workspace.pixCity,
  };
}

export async function saveChargeSettings(workspaceId: string, data: ChargeSettingsInput): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      chargeMessageTemplate: data.template,
      chargeSendImage: data.sendImage,
      pixKeyType: data.pixKeyType,
      pixKey: data.pixKey,
      pixRecipientName: data.pixRecipientName,
      pixCity: data.pixCity,
    },
  });
}

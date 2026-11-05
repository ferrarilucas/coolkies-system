import { PageHeader } from "@/components/shared/page-header";
import { ChargeSettingsForm } from "@/components/customers/charge-settings-form";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getChargeSettings } from "@/server/tenant/charge-settings";

export default async function ChargeSettingsPage() {
  const { workspaceId } = await getWorkspaceContext();
  const settings = await getChargeSettings(workspaceId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobrança"
        description="Mensagem usada no Cobrar no WhatsApp e dados do Pix copia e cola."
      />
      <ChargeSettingsForm settings={settings} />
    </div>
  );
}

import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getCustomers } from "@/server/queries/customers";
import { CustomerList } from "@/components/customers/customer-list";
import { CustomerCreateDialog } from "@/components/customers/customer-create-dialog";

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Gerencie sua base de clientes."
        action={<CustomerCreateDialog />}
      />

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente cadastrado"
          description="Adicione clientes para vincular às suas vendas."
          action={<CustomerCreateDialog />}
        />
      ) : (
        <CustomerList customers={customers} />
      )}
    </div>
  );
}

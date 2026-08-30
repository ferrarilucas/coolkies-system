export type CustomerSituation = "all" | "pending" | "overdue" | "clear";

export type CustomerPendingRow = {
  customerId: string;
  pendingCents: number;
  pendingCount: number;
  oldestForecastDate: Date | null;
};

export type CustomerBalanceFilters = {
  situation: CustomerSituation;
  minDueCents?: number;
};

export type WithBalance<T> = T & {
  pendingCents: number;
  pendingCount: number;
  isOverdue: boolean;
};

export function buildCustomerBalances<T extends { id: string }>(
  customers: T[],
  pendingRows: CustomerPendingRow[],
  filters: CustomerBalanceFilters,
  now: Date = new Date(),
): WithBalance<T>[] {
  const byCustomer = new Map(pendingRows.map((row) => [row.customerId, row]));

  const withBalance = customers.map((customer) => {
    const row = byCustomer.get(customer.id);
    return {
      ...customer,
      pendingCents: row?.pendingCents ?? 0,
      pendingCount: row?.pendingCount ?? 0,
      isOverdue: row ? row.oldestForecastDate !== null && row.oldestForecastDate < now : false,
    };
  });

  const minDueCents = filters.minDueCents ?? 0;

  return withBalance.filter((customer) => {
    if (filters.situation === "clear") return customer.pendingCents === 0;
    if (filters.situation === "pending" && customer.pendingCents === 0) return false;
    if (filters.situation === "overdue" && !customer.isOverdue) return false;
    return customer.pendingCents >= minDueCents;
  });
}

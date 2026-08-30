import { describe, expect, it } from "vitest";
import { injectWorkspaceId } from "./nested-writes";

describe("injectWorkspaceId", () => {
  it("injeta no nível de topo", () => {
    const result = injectWorkspaceId("Product", { name: "Cookie" }, "ws1") as Record<string, unknown>;
    expect(result.workspaceId).toBe("ws1");
  });

  it("injeta em create aninhado", () => {
    const result = injectWorkspaceId(
      "Sale",
      { totalCents: 100, items: { create: [{ quantity: 2, productNameSnapshot: "Cookie" }] } },
      "ws1",
    ) as { workspaceId: string; items: { create: Array<{ workspaceId: string }> } };

    expect(result.workspaceId).toBe("ws1");
    expect(result.items.create[0].workspaceId).toBe("ws1");
  });

  it("injeta em create aninhado que é objeto, não array", () => {
    const result = injectWorkspaceId(
      "Sale",
      { totalCents: 100, items: { create: { quantity: 1, productNameSnapshot: "X" } } },
      "ws1",
    ) as { items: { create: { workspaceId: string } } };

    expect(result.items.create.workspaceId).toBe("ws1");
  });

  it("injeta em connectOrCreate", () => {
    const result = injectWorkspaceId(
      "Sale",
      { customer: { connectOrCreate: { where: { id: "c1" }, create: { name: "Ana" } } } },
      "ws1",
    ) as { customer: { connectOrCreate: { create: { workspaceId: string } } } };

    expect(result.customer.connectOrCreate.create.workspaceId).toBe("ws1");
  });

  it("não toca connect", () => {
    const result = injectWorkspaceId(
      "Sale",
      { customer: { connect: { id: "c1" } } },
      "ws1",
    ) as { customer: { connect: Record<string, unknown> } };

    expect(result.customer.connect.workspaceId).toBeUndefined();
  });

  it("não injeta em relação para modelo não escopado", () => {
    const result = injectWorkspaceId(
      "Sale",
      { user: { connect: { id: "u1" } } },
      "ws1",
    ) as { user: { connect: Record<string, unknown> } };

    expect(result.user.connect.workspaceId).toBeUndefined();
  });

  it("não injeta em create aninhado de modelo não escopado", () => {
    const result = injectWorkspaceId(
      "Sale",
      { user: { create: { id: "u1", name: "Ana", email: "ana@example.com" } } },
      "ws1",
    ) as { user: { create: Record<string, unknown> } };

    expect(result.user.create.workspaceId).toBeUndefined();
  });

  it("injeta nas linhas de um createMany aninhado", () => {
    const result = injectWorkspaceId(
      "Sale",
      {
        totalCents: 100,
        items: {
          createMany: {
            data: [
              { quantity: 1, productNameSnapshot: "A" },
              { quantity: 2, productNameSnapshot: "B" },
            ],
            skipDuplicates: true,
          },
        },
      },
      "ws1",
    ) as {
      items: {
        createMany: { data: Array<{ workspaceId: string }>; skipDuplicates: boolean };
      };
    };

    expect(result.items.createMany.data.map((row) => row.workspaceId)).toEqual(["ws1", "ws1"]);
    expect(result.items.createMany.skipDuplicates).toBe(true);
  });

  it("injeta em profundidade além de um nível", () => {
    const result = injectWorkspaceId(
      "Product",
      { name: "Cookie", flavors: { create: [{ name: "Chocolate", saleItems: { create: { quantity: 1 } } }] } },
      "ws1",
    ) as {
      workspaceId: string;
      flavors: {
        create: Array<{ workspaceId: string; saleItems: { create: { workspaceId: string } } }>;
      };
    };

    expect(result.workspaceId).toBe("ws1");
    expect(result.flavors.create[0].workspaceId).toBe("ws1");
    expect(result.flavors.create[0].saleItems.create.workspaceId).toBe("ws1");
  });

  it("não muta o objeto recebido", () => {
    const input = { totalCents: 100, items: { create: [{ quantity: 2 }] } };

    injectWorkspaceId("Sale", input, "ws1");

    expect(input).toEqual({ totalCents: 100, items: { create: [{ quantity: 2 }] } });
  });

  it("não injeta no topo quando o próprio modelo não é escopado", () => {
    const result = injectWorkspaceId("User", { name: "Ana" }, "ws1") as Record<string, unknown>;
    expect(result.workspaceId).toBeUndefined();
  });
});

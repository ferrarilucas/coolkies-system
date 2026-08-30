import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  injectIntoNestedWrites,
  injectWorkspaceId,
  TENANCY_CONTROL_PLANE_MODELS,
  UNSCOPED_MODELS,
} from "./nested-writes";

describe("UNSCOPED_MODELS", () => {
  it("ter workspaceId equivale a ser escopado, fora do control plane de tenancy", () => {
    for (const model of Prisma.dmmf.datamodel.models) {
      const hasWorkspaceId = model.fields.some((field) => field.name === "workspaceId");
      const shouldBeUnscoped =
        !hasWorkspaceId || TENANCY_CONTROL_PLANE_MODELS.has(model.name);

      expect({ model: model.name, unscoped: UNSCOPED_MODELS.has(model.name) }).toEqual({
        model: model.name,
        unscoped: shouldBeUnscoped,
      });
    }
  });

  it("o control plane de tenancy é uma exceção fechada", () => {
    expect([...TENANCY_CONTROL_PLANE_MODELS].sort()).toEqual(["Invitation", "Member"]);

    for (const model of TENANCY_CONTROL_PLANE_MODELS) {
      expect(UNSCOPED_MODELS.has(model)).toBe(true);
    }
  });

  it("todo model de domínio com workspaceId é escopado", () => {
    const scoped = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === "workspaceId"))
      .filter((model) => !TENANCY_CONTROL_PLANE_MODELS.has(model.name))
      .map((model) => model.name);

    expect(scoped.length).toBeGreaterThan(0);
    for (const model of scoped) {
      expect(UNSCOPED_MODELS.has(model)).toBe(false);
    }
  });
});

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

  it("injeta no create de um upsert aninhado", () => {
    const result = injectWorkspaceId(
      "Sale",
      {
        totalCents: 100,
        items: {
          upsert: {
            where: { id: "i1" },
            create: { quantity: 1, productNameSnapshot: "A" },
            update: { quantity: 2 },
          },
        },
      },
      "ws1",
    ) as {
      items: { upsert: { create: { workspaceId: string }; update: Record<string, unknown> } };
    };

    expect(result.items.upsert.create.workspaceId).toBe("ws1");
    expect(result.items.upsert.update.workspaceId).toBeUndefined();
  });
});

describe("injectIntoNestedWrites", () => {
  it("não escreve workspaceId no nível de topo", () => {
    const result = injectIntoNestedWrites("Sale", { totalCents: 100 }, "ws1") as Record<
      string,
      unknown
    >;

    expect(result.workspaceId).toBeUndefined();
    expect(result.totalCents).toBe(100);
  });

  it("injeta em create aninhado sem tocar o topo", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      { totalCents: 100, items: { create: [{ quantity: 2, productNameSnapshot: "Cookie" }] } },
      "ws1",
    ) as { workspaceId?: string; items: { create: Array<{ workspaceId: string }> } };

    expect(result.workspaceId).toBeUndefined();
    expect(result.items.create[0].workspaceId).toBe("ws1");
  });

  it("injeta nas linhas de um createMany aninhado sem tocar o topo", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      { items: { createMany: { data: [{ quantity: 1 }, { quantity: 2 }] } } },
      "ws1",
    ) as { workspaceId?: string; items: { createMany: { data: Array<{ workspaceId: string }> } } };

    expect(result.workspaceId).toBeUndefined();
    expect(result.items.createMany.data.map((row) => row.workspaceId)).toEqual(["ws1", "ws1"]);
  });

  it("injeta no create de um upsert aninhado e não no topo do update", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      {
        items: {
          upsert: {
            where: { id: "i1" },
            create: { quantity: 1, productNameSnapshot: "A" },
            update: { quantity: 2 },
          },
        },
      },
      "ws1",
    ) as {
      items: { upsert: { create: { workspaceId: string }; update: Record<string, unknown> } };
    };

    expect(result.items.upsert.create.workspaceId).toBe("ws1");
    expect(result.items.upsert.update.workspaceId).toBeUndefined();
  });

  it("percorre o data de um update aninhado sem escrever workspaceId nele", () => {
    const result = injectIntoNestedWrites(
      "Product",
      {
        flavors: {
          update: { where: { id: "f1" }, data: { saleItems: { create: { quantity: 1 } } } },
        },
      },
      "ws1",
    ) as {
      flavors: {
        update: {
          data: { workspaceId?: string; saleItems: { create: { workspaceId: string } } };
        };
      };
    };

    expect(result.flavors.update.data.workspaceId).toBeUndefined();
    expect(result.flavors.update.data.saleItems.create.workspaceId).toBe("ws1");
  });

  it("não toca connect", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      { customer: { connect: { id: "c1" } } },
      "ws1",
    ) as { customer: { connect: Record<string, unknown> } };

    expect(result.customer.connect.workspaceId).toBeUndefined();
  });

  it("não injeta em relação para modelo não escopado", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      { user: { create: { id: "u1", name: "Ana", email: "ana@example.com" } } },
      "ws1",
    ) as { user: { create: Record<string, unknown> } };

    expect(result.user.create.workspaceId).toBeUndefined();
  });

  it("reproduz o data de updateSale", () => {
    const result = injectIntoNestedWrites(
      "Sale",
      {
        totalCents: 1500,
        customerName: "Ana",
        items: {
          create: [
            { productId: "p1", productNameSnapshot: "Cookie", quantity: 3, unitPriceSnapshot: 500 },
          ],
        },
      },
      "ws1",
    ) as {
      workspaceId?: string;
      totalCents: number;
      items: { create: Array<{ workspaceId: string; quantity: number }> };
    };

    expect(result.workspaceId).toBeUndefined();
    expect(result.totalCents).toBe(1500);
    expect(result.items.create[0].workspaceId).toBe("ws1");
    expect(result.items.create[0].quantity).toBe(3);
  });

  it("não muta o objeto recebido", () => {
    const input = { totalCents: 100, items: { create: [{ quantity: 2 }] } };

    injectIntoNestedWrites("Sale", input, "ws1");

    expect(input).toEqual({ totalCents: 100, items: { create: [{ quantity: 2 }] } });
  });
});

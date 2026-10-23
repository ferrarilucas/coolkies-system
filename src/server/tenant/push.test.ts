import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import {
  removePushSubscription,
  savePushSubscription,
  sendDueTodayReminders,
  type PushKeys,
  type PushSendResult,
} from "./push";

const NOW = new Date("2026-10-23T10:00:00Z");
const TODAY_NOON = new Date("2026-10-23T15:00:00Z");
const TODAY_MIDNIGHT = new Date("2026-10-23T03:00:00Z");
const TOMORROW = new Date("2026-10-24T15:00:00Z");
const YESTERDAY = new Date("2026-10-22T15:00:00Z");

async function seedUser(id: string) {
  return testDb.user.create({ data: { id, name: id, email: `${id}@example.com` } });
}

function keys(endpoint: string): PushKeys {
  return { endpoint, p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` };
}

function recordingSender(results: Record<string, PushSendResult> = {}) {
  const sent: { endpoint: string; payload: Record<string, string> }[] = [];
  const send = async (subscription: PushKeys, payload: string) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return results[subscription.endpoint] ?? "sent";
  };
  return { send, sent };
}

describe("inscrições de push", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("salva, reaproveita o mesmo endpoint e remove só do próprio usuário", async () => {
    await seedUser("ana");
    await seedUser("bia");
    await savePushSubscription("ana", keys("https://push/1"));
    await savePushSubscription("ana", { ...keys("https://push/1"), auth: "nova" });

    const rows = await testDb.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].auth).toBe("nova");

    await removePushSubscription("bia", "https://push/1");
    expect(await testDb.pushSubscription.count()).toBe(1);

    await removePushSubscription("ana", "https://push/1");
    expect(await testDb.pushSubscription.count()).toBe(0);
  });
});

describe("sendDueTodayReminders", () => {
  let ws = "";

  beforeEach(async () => {
    await resetDb();
    ws = (await createWorkspace("Doce Vida")).id;
    await seedUser("ana");
    await seedUser("bia");
    await testDb.member.create({ data: { userId: "ana", workspaceId: ws, role: "OWNER" } });
    await testDb.member.create({ data: { userId: "bia", workspaceId: ws, role: "MEMBER" } });
  });

  it("conta só as parcelas em aberto que vencem hoje e avisa todos os membros inscritos", async () => {
    await seedParceledSale({
      workspaceId: ws,
      parcels: [
        { amountCents: 1000, dueDate: TODAY_NOON },
        { amountCents: 1000, dueDate: TODAY_MIDNIGHT },
        { amountCents: 1000, dueDate: TODAY_NOON, paidAt: YESTERDAY },
        { amountCents: 1000, dueDate: TOMORROW },
        { amountCents: 1000, dueDate: YESTERDAY },
      ],
    });
    await savePushSubscription("ana", keys("https://push/ana"));
    await savePushSubscription("bia", keys("https://push/bia"));

    const { send, sent } = recordingSender();
    const summary = await sendDueTodayReminders(send, NOW);

    expect(summary).toEqual({ workspaces: 1, sent: 2, removed: 0, failed: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push/ana", "https://push/bia"]);
    expect(sent[0].payload.body).toBe("2 cobranças vencem hoje. Toque para cobrar.");
    expect(sent[0].payload.title).toBe("Cobranças de hoje · Doce Vida");
  });

  it("não envia nada quando nenhuma parcela vence hoje", async () => {
    await seedParceledSale({ workspaceId: ws, parcels: [{ amountCents: 1000, dueDate: TOMORROW }] });
    await savePushSubscription("ana", keys("https://push/ana"));

    const { send, sent } = recordingSender();
    const summary = await sendDueTodayReminders(send, NOW);

    expect(summary).toEqual({ workspaces: 0, sent: 0, removed: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("não avisa membros de outros workspaces", async () => {
    const outro = (await createWorkspace("Outro")).id;
    await seedUser("caio");
    await testDb.member.create({ data: { userId: "caio", workspaceId: outro, role: "OWNER" } });
    await savePushSubscription("caio", keys("https://push/caio"));
    await seedParceledSale({ workspaceId: ws, parcels: [{ amountCents: 1000, dueDate: TODAY_NOON }] });

    const { send, sent } = recordingSender();
    await sendDueTodayReminders(send, NOW);

    expect(sent).toHaveLength(0);
  });

  it("apaga inscrições expiradas e conta falhas", async () => {
    await seedParceledSale({ workspaceId: ws, parcels: [{ amountCents: 1000, dueDate: TODAY_NOON }] });
    await savePushSubscription("ana", keys("https://push/ana"));
    await savePushSubscription("bia", keys("https://push/bia"));

    const { send } = recordingSender({ "https://push/ana": "gone", "https://push/bia": "failed" });
    const summary = await sendDueTodayReminders(send, NOW);

    expect(summary).toEqual({ workspaces: 1, sent: 0, removed: 1, failed: 1 });
    const left = await testDb.pushSubscription.findMany({ select: { endpoint: true } });
    expect(left).toEqual([{ endpoint: "https://push/bia" }]);
  });
});

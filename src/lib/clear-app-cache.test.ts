import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppCache } from "./clear-app-cache";

describe("clearAppCache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apaga todos os caches e desregistra o service worker", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["pages", "workbox-precache"]),
      delete: deleteMock,
    });

    const unregisterMock = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterMock }]),
      },
    });

    await clearAppCache();

    expect(deleteMock).toHaveBeenCalledWith("pages");
    expect(deleteMock).toHaveBeenCalledWith("workbox-precache");
    expect(unregisterMock).toHaveBeenCalled();
  });

  it("não quebra quando caches/serviceWorker não existem", async () => {
    await expect(clearAppCache()).resolves.toBeUndefined();
  });
});

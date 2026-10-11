import { describe, expect, it, vi } from "vitest";
import {
  publishSubscriptionChange,
  subscribeToSubscriptionChanges,
} from "./subscription-events";

describe("emissor de mudanças de assinatura", () => {
  it("avisa quem se inscreveu no próprio usuário", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-a", listener);

    publishSubscriptionChange("u-a");

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("não avisa quem se inscreveu em outro usuário", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-b", listener);

    publishSubscriptionChange("u-c");

    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("para de avisar depois de cancelar a inscrição", () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-d", listener);
    stop();

    publishSubscriptionChange("u-d");

    expect(listener).not.toHaveBeenCalled();
  });

  it("publicar para o usuário 'error' sem ouvinte não lança", () => {
    expect(() => publishSubscriptionChange("error")).not.toThrow();
  });

  it("a mesma instância atende módulos carregados de novo", async () => {
    const listener = vi.fn();
    const stop = subscribeToSubscriptionChanges("u-e", listener);
    vi.resetModules();
    const reloaded = await import("./subscription-events");

    reloaded.publishSubscriptionChange("u-e");

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

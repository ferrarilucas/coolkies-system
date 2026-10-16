import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "./wait-for";

describe("waitFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolve na hora quando a condição já vale", async () => {
    await expect(waitFor(() => true, { timeoutMs: 1000 })).resolves.toBe(true);
  });

  it("espera a condição passar a valer", async () => {
    let ready = false;
    const promise = waitFor(() => ready, { timeoutMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    ready = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(true);
  });

  it("desiste depois do tempo limite", async () => {
    const promise = waitFor(() => false, { timeoutMs: 500, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toBe(false);
  });

  it("para quando é abortado", async () => {
    const controller = new AbortController();
    const promise = waitFor(() => false, {
      timeoutMs: Number.POSITIVE_INFINITY,
      intervalMs: 100,
      signal: controller.signal,
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(false);
  });
});

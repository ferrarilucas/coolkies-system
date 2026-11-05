import { describe, expect, it } from "vitest";
import {
  CHARGE_IMAGE_MAX_INSTALLMENTS,
  chargeImageKey,
  chargeImageReducer,
  initialChargeImageState,
  isChargeImageReady,
  validateChargeImageResponse,
  type ChargeImageState,
} from "./charge-image-state";

type S = ChargeImageState<string>;
const reduce = chargeImageReducer<string>;

function start(key: string): S {
  return reduce(initialChargeImageState<string>(), { type: "request", key });
}

describe("chargeImageKey", () => {
  it("vazio quando fechado, sem imagem ou sem seleção", () => {
    expect(chargeImageKey({ open: false, sendImage: true, selectedIds: ["a"] })).toBe("");
    expect(chargeImageKey({ open: true, sendImage: false, selectedIds: ["a"] })).toBe("");
    expect(chargeImageKey({ open: true, sendImage: true, selectedIds: [] })).toBe("");
  });

  it("junta os IDs quando há seleção", () => {
    expect(chargeImageKey({ open: true, sendImage: true, selectedIds: ["a", "b"] })).toBe("a,b");
  });

  it("vazio acima do limite de parcelas", () => {
    const ids = Array.from({ length: CHARGE_IMAGE_MAX_INSTALLMENTS + 1 }, (_, i) => `id${i}`);
    expect(CHARGE_IMAGE_MAX_INSTALLMENTS).toBe(200);
    expect(chargeImageKey({ open: true, sendImage: true, selectedIds: ids })).toBe("");
    expect(chargeImageKey({ open: true, sendImage: true, selectedIds: ids.slice(0, 200) })).not.toBe("");
  });
});

describe("chargeImageReducer", () => {
  it("request inicia loading com a chave e um token novo", () => {
    const s = start("k1");
    expect(s.status).toBe("loading");
    expect(s.key).toBe("k1");
    expect(s.file).toBeNull();
  });

  it("aceita a resposta da chave atual", () => {
    const s0 = start("k1");
    const s1 = reduce(s0, { type: "resolve", token: s0.token, file: "img1" });
    expect(s1).toMatchObject({ status: "ready", key: "k1", file: "img1" });
    expect(isChargeImageReady(s1, "k1")).toBe(true);
    expect(isChargeImageReady(s1, "k2")).toBe(false);
  });

  it("trocar a seleção durante a geração ignora a resposta da chave antiga", () => {
    const a = start("k1");
    const b = reduce(a, { type: "request", key: "k2" });
    expect(b.token).not.toBe(a.token);
    const afterOld = reduce(b, { type: "resolve", token: a.token, file: "img1" });
    expect(afterOld).toBe(b);
    expect(afterOld.status).toBe("loading");
    const afterNew = reduce(afterOld, { type: "resolve", token: b.token, file: "img2" });
    expect(afterNew).toMatchObject({ status: "ready", key: "k2", file: "img2" });
  });

  it("erro de chave antiga também é ignorado", () => {
    const a = start("k1");
    const b = reduce(a, { type: "request", key: "k2" });
    expect(reduce(b, { type: "reject", token: a.token, reason: "failed" })).toBe(b);
  });

  it("request com a mesma chave não reinicia a geração", () => {
    const a = start("k1");
    expect(reduce(a, { type: "request", key: "k1" })).toBe(a);
    const ready = reduce(a, { type: "resolve", token: a.token, file: "img" });
    expect(reduce(ready, { type: "request", key: "k1" })).toBe(ready);
  });

  it("falhar → tentar de novo → falhar de novo", () => {
    const a = start("k1");
    const failed = reduce(a, { type: "reject", token: a.token, reason: "failed" });
    expect(failed).toMatchObject({ status: "error", key: "k1", reason: "failed" });
    const retry = reduce(failed, { type: "retry" });
    expect(retry).toMatchObject({ status: "loading", key: "k1", reason: null });
    expect(retry.token).not.toBe(a.token);
    expect(reduce(retry, { type: "reject", token: a.token, reason: "failed" })).toBe(retry);
    const failedAgain = reduce(retry, { type: "reject", token: retry.token, reason: "failed" });
    expect(failedAgain).toMatchObject({ status: "error", key: "k1" });
    const retry2 = reduce(failedAgain, { type: "retry" });
    const ok = reduce(retry2, { type: "resolve", token: retry2.token, file: "img" });
    expect(ok).toMatchObject({ status: "ready", file: "img" });
  });

  it("retry fora de erro não faz nada", () => {
    const a = start("k1");
    expect(reduce(a, { type: "retry" })).toBe(a);
    expect(reduce(initialChargeImageState<string>(), { type: "retry" }).status).toBe("idle");
  });

  it("guarda o motivo stale", () => {
    const a = start("k1");
    expect(reduce(a, { type: "reject", token: a.token, reason: "stale" })).toMatchObject({
      status: "error",
      reason: "stale",
    });
  });

  it("fechar e reabrir no meio do fetch descarta a resposta do fetch anterior", () => {
    const a = start("k1");
    const closed = reduce(a, { type: "reset" });
    expect(closed).toMatchObject({ status: "idle", key: "", file: null });
    const reopened = reduce(closed, { type: "request", key: "k1" });
    expect(reopened.status).toBe("loading");
    expect(reopened.token).not.toBe(a.token);
    expect(reduce(reopened, { type: "resolve", token: a.token, file: "velha" })).toBe(reopened);
    expect(reduce(reopened, { type: "resolve", token: reopened.token, file: "nova" }).file).toBe("nova");
  });

  it("resposta depois de reset é ignorada", () => {
    const a = start("k1");
    const closed = reduce(a, { type: "reset" });
    expect(reduce(closed, { type: "resolve", token: a.token, file: "img" })).toBe(closed);
  });

  it("resolve duplo no mesmo token só aceita o primeiro", () => {
    const a = start("k1");
    const first = reduce(a, { type: "resolve", token: a.token, file: "img1" });
    expect(reduce(first, { type: "resolve", token: a.token, file: "img2" })).toBe(first);
    expect(reduce(first, { type: "reject", token: a.token, reason: "failed" })).toBe(first);
  });

  it("reset em idle não muda o estado", () => {
    const idle = initialChargeImageState<string>();
    expect(reduce(idle, { type: "reset" })).toBe(idle);
  });

  it("request com chave vazia volta para idle", () => {
    const a = start("k1");
    expect(reduce(a, { type: "request", key: "" })).toMatchObject({ status: "idle", key: "" });
  });
});

describe("validateChargeImageResponse", () => {
  const ok = { ok: true, redirected: false, contentType: "image/png", totalCentsHeader: null };

  it("aceita PNG sem header de total", () => {
    expect(validateChargeImageResponse(ok, 1000)).toEqual({ ok: true });
  });

  it("aceita content-type com parâmetros e header igual ao esperado", () => {
    expect(
      validateChargeImageResponse({ ...ok, contentType: "Image/PNG; charset=binary", totalCentsHeader: "1000" }, 1000),
    ).toEqual({ ok: true });
  });

  it("rejeita status não ok, redirect e content-type diferente", () => {
    expect(validateChargeImageResponse({ ...ok, ok: false }, 1000)).toEqual({ ok: false, reason: "failed" });
    expect(validateChargeImageResponse({ ...ok, redirected: true }, 1000)).toEqual({ ok: false, reason: "failed" });
    expect(validateChargeImageResponse({ ...ok, contentType: "text/html" }, 1000)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(validateChargeImageResponse({ ...ok, contentType: null }, 1000)).toEqual({ ok: false, reason: "failed" });
  });

  it("header de total divergente → stale", () => {
    expect(validateChargeImageResponse({ ...ok, totalCentsHeader: "999" }, 1000)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(validateChargeImageResponse({ ...ok, totalCentsHeader: "abc" }, 1000)).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});

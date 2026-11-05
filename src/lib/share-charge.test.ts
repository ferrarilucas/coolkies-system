import { describe, expect, it, vi } from "vitest";
import { shareToWhatsApp, type ShareNavigator } from "./share-charge";

const file = new File([new Uint8Array([1, 2, 3])], "cobranca.png", { type: "image/png" });

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function fakeNav(opts: {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  noShare?: boolean;
}): ShareNavigator {
  return {
    share: opts.noShare ? undefined : (opts.share ?? (async () => {})),
    canShare: opts.noShare ? undefined : (opts.canShare ?? (() => true)),
    clipboard: { writeText: opts.writeText ?? (async () => {}) },
  } as unknown as ShareNavigator;
}

describe("shareToWhatsApp", () => {
  it("copia o texto antes e compartilha arquivo + texto quando canShare aceita", async () => {
    const calls: string[] = [];
    let shared: ShareData | undefined;
    const nav = fakeNav({
      share: async (data) => {
        calls.push("share");
        shared = data;
      },
      writeText: async () => {
        calls.push("copy");
      },
    });
    expect(await shareToWhatsApp({ text: "t", file, nav, open: vi.fn() })).toEqual({ outcome: "shared" });
    expect(calls).toEqual(["copy", "share"]);
    expect(shared).toEqual({ text: "t", files: [file] });
  });

  it("sem arquivo compartilha só o texto", async () => {
    let shared: ShareData | undefined;
    const nav = fakeNav({ share: async (data) => void (shared = data) });
    expect(await shareToWhatsApp({ text: "t", nav, open: vi.fn() })).toEqual({ outcome: "shared" });
    expect(shared).toEqual({ text: "t" });
  });

  it("AbortError → cancelled, sem abrir nada", async () => {
    const open = vi.fn();
    const nav = fakeNav({ share: async () => Promise.reject(domError("AbortError")) });
    expect(await shareToWhatsApp({ text: "t", file, nav, open })).toEqual({ outcome: "cancelled" });
    expect(open).not.toHaveBeenCalled();
  });

  it("NotAllowedError → needs-gesture, sem abrir nada", async () => {
    const open = vi.fn();
    const nav = fakeNav({ share: async () => Promise.reject(domError("NotAllowedError")) });
    expect(await shareToWhatsApp({ text: "t", file, nav, open })).toEqual({ outcome: "needs-gesture" });
    expect(open).not.toHaveBeenCalled();
  });

  it("outro erro do share → failed, sem fallback depois do await", async () => {
    const open = vi.fn();
    const clipboardImage = vi.fn(async () => true);
    const nav = fakeNav({ share: async () => Promise.reject(domError("DataError")) });
    expect(await shareToWhatsApp({ text: "t", file, nav, open, clipboardImage })).toEqual({ outcome: "failed" });
    expect(open).not.toHaveBeenCalled();
    expect(clipboardImage).not.toHaveBeenCalled();
  });

  it("erro sem name (não Error) → failed", async () => {
    const nav = fakeNav({ share: async () => Promise.reject("boom") });
    expect(await shareToWhatsApp({ text: "t", nav, open: vi.fn() })).toEqual({ outcome: "failed" });
  });

  it("erro em objeto simples com name é lido", async () => {
    const nav = fakeNav({ share: async () => Promise.reject({ name: "AbortError" }) });
    expect(await shareToWhatsApp({ text: "t", nav, open: vi.fn() })).toEqual({ outcome: "cancelled" });
  });

  it("sem share e sem arquivo: abre wa.me de forma síncrona e devolve fallback-opened", () => {
    const open = vi.fn();
    const promise = shareToWhatsApp({ text: "Oi", phone: "(11) 98765-4321", nav: fakeNav({ noShare: true }), open });
    expect(open).toHaveBeenCalledWith("https://wa.me/5511987654321?text=Oi");
    return expect(promise).resolves.toEqual({ outcome: "fallback-opened" });
  });

  it("sem share e só texto sem telefone: abre wa.me sem número", async () => {
    const open = vi.fn();
    expect(await shareToWhatsApp({ text: "Oi", nav: fakeNav({ noShare: true }), open })).toEqual({
      outcome: "fallback-opened",
    });
    expect(open).toHaveBeenCalledWith("https://wa.me/?text=Oi");
  });

  it("sem canShare de arquivo: só copia a imagem, não abre nada e devolve image-ready", async () => {
    const open = vi.fn();
    const clipboardImage = vi.fn(async () => true);
    const promise = shareToWhatsApp({
      text: "Oi",
      file,
      phone: "(11) 98765-4321",
      nav: fakeNav({ canShare: () => false }),
      open,
      clipboardImage,
    });
    expect(clipboardImage).toHaveBeenCalledWith(file);
    expect(await promise).toEqual({ outcome: "image-ready", imageCopied: true });
    expect(open).not.toHaveBeenCalled();
  });

  it("cópia da imagem devolvendo false → image-ready com imageCopied false", async () => {
    const result = await shareToWhatsApp({
      text: "Oi",
      file,
      nav: fakeNav({ canShare: () => false }),
      open: vi.fn(),
      clipboardImage: async () => false,
    });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: false });
  });

  it("cópia da imagem rejeitando → image-ready com imageCopied false", async () => {
    const result = await shareToWhatsApp({
      text: "Oi",
      file,
      nav: fakeNav({ canShare: () => false }),
      open: vi.fn(),
      clipboardImage: async () => Promise.reject(new Error("negado")),
    });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: false });
  });

  it("cópia da imagem que lança síncrono → image-ready com imageCopied false", async () => {
    const result = await shareToWhatsApp({
      text: "Oi",
      file,
      nav: fakeNav({ canShare: () => false }),
      open: vi.fn(),
      clipboardImage: () => {
        throw new Error("sync");
      },
    });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: false });
  });

  it("com arquivo e sem clipboardImage → image-ready com imageCopied false", async () => {
    const result = await shareToWhatsApp({ text: "Oi", file, nav: fakeNav({ noShare: true }), open: vi.fn() });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: false });
  });

  it("forceFallback pula o share", async () => {
    const open = vi.fn();
    const share = vi.fn(async () => {});
    expect(await shareToWhatsApp({ text: "t", nav: fakeNav({ share }), open, forceFallback: true })).toEqual({
      outcome: "fallback-opened",
    });
    expect(share).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://wa.me/?text=t");
  });

  it("forceFallback com arquivo copia a imagem e devolve image-ready", async () => {
    const open = vi.fn();
    const share = vi.fn(async () => {});
    const result = await shareToWhatsApp({
      text: "t",
      file,
      nav: fakeNav({ share }),
      open,
      clipboardImage: async () => true,
      forceFallback: true,
    });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: true });
    expect(share).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("skipTextCopy não copia o texto de novo", async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => {});
    expect(await shareToWhatsApp({ text: "t", nav: fakeNav({ writeText, share }), open: vi.fn(), skipTextCopy: true })).toEqual({
      outcome: "shared",
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalled();
  });

  it("NotAllowedError duas vezes e depois sucesso, sem recopiar o texto nas novas tentativas", async () => {
    const writeText = vi.fn(async () => {});
    const share = vi
      .fn<(data?: ShareData) => Promise<void>>()
      .mockRejectedValueOnce(domError("NotAllowedError"))
      .mockRejectedValueOnce(domError("NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const nav = fakeNav({ writeText, share });
    const open = vi.fn();
    expect(await shareToWhatsApp({ text: "t", file, nav, open })).toEqual({ outcome: "needs-gesture" });
    expect(await shareToWhatsApp({ text: "t", file, nav, open, skipTextCopy: true })).toEqual({ outcome: "needs-gesture" });
    expect(await shareToWhatsApp({ text: "t", file, nav, open, skipTextCopy: true })).toEqual({ outcome: "shared" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(3);
    expect(open).not.toHaveBeenCalled();
  });

  it("clipboard de texto falhando não impede o share", async () => {
    const nav = fakeNav({ writeText: async () => Promise.reject(new Error("negado")) });
    expect(await shareToWhatsApp({ text: "t", file, nav, open: vi.fn() })).toEqual({ outcome: "shared" });
  });

  it("clipboard de texto que lança síncrono não impede o share", async () => {
    const nav = fakeNav({
      writeText: () => {
        throw new Error("sync");
      },
    });
    expect(await shareToWhatsApp({ text: "t", nav, open: vi.fn() })).toEqual({ outcome: "shared" });
  });

  it("canShare que lança é tratado como sem suporte a arquivo", async () => {
    const result = await shareToWhatsApp({
      text: "t",
      file,
      nav: fakeNav({
        canShare: () => {
          throw new Error("x");
        },
      }),
      open: vi.fn(),
      clipboardImage: async () => true,
    });
    expect(result).toEqual({ outcome: "image-ready", imageCopied: true });
  });
});

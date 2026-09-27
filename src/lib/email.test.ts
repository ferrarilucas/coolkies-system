import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionEmailHtml,
  escapeHtml,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";

describe("email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("escapa caracteres de HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("o template de ação escapa o título e mantém o link", () => {
    const html = actionEmailHtml({
      heading: "Olá, <script>alert(1)</script>",
      body: "Corpo",
      ctaLabel: "Confirmar",
      ctaUrl: "https://app.example.com/api/auth/verify-email?token=abc&callbackURL=%2Fdashboard",
      footer: "Rodapé",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://app.example.com/api/auth/verify-email?token=abc&amp;callbackURL=%2Fdashboard"');
  });

  it("sem RESEND_API_KEY, a verificação não envia e imprime o link no console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await sendVerificationEmail({ to: "ana@example.com", name: "Ana", url: "http://localhost:3000/v?token=1" });
    expect(res.sent).toBe(false);
    expect(info.mock.calls[0][0]).toContain("http://localhost:3000/v?token=1");
  });

  it("sem RESEND_API_KEY, a redefinição não envia e imprime o link no console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await sendPasswordResetEmail({ to: "ana@example.com", name: "Ana", url: "http://localhost:3000/r/2" });
    expect(res.sent).toBe(false);
    expect(info.mock.calls[0][0]).toContain("http://localhost:3000/r/2");
  });
});

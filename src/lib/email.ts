import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "Cipri <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

export type SendResult = { sent: boolean; reason?: string };

export const EMAIL_NOT_CONFIGURED = "Envio de e-mail não configurado.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ActionEmail = {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
  highlight?: string;
  highlightLabel?: string;
  steps?: string[];
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function logoUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/brand/cipri-wordmark-reverse.png`;
}

function highlightHtml(code: string, label: string): string {
  return `<tr><td style="padding:0 0 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E1;border:2px dashed #FFC93D;border-radius:16px">
      <tr><td align="center" style="padding:20px 16px 22px">
        <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8A6A00;margin:0 0 10px">${escapeHtml(label)}</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:#0F3D34">${escapeHtml(code)}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

function stepsHtml(steps: string[]): string {
  const rows = steps
    .map(
      (step, i) => `<tr>
        <td width="36" valign="top" style="padding:0 0 14px">
          <div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:#0F3D34;color:#FFC93D;font-size:13px;font-weight:700;text-align:center">${i + 1}</div>
        </td>
        <td valign="top" style="padding:3px 0 14px;font-size:15px;line-height:1.5;color:#1F2937">${escapeHtml(step)}</td>
      </tr>`,
    )
    .join("");
  return `<tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>`;
}

export function actionEmailHtml({
  heading,
  body,
  ctaLabel,
  ctaUrl,
  footer,
  highlight,
  highlightLabel = "Seu código",
  steps,
}: ActionEmail): string {
  const highlightBlock = highlight ? highlightHtml(highlight, highlightLabel) : "";
  const stepsBlock = steps && steps.length > 0 ? stepsHtml(steps) : "";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F7F7EF;font-family:${FONT};color:#1F2937">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(body)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7EF">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
          <tr><td align="center" style="background:#0F3D34;border-radius:24px 24px 0 0;padding:36px 24px 32px">
            <img src="${escapeHtml(logoUrl())}" alt="Cipri" width="132" style="display:block;border:0;outline:none;color:#F7F7EF;font-size:28px;font-weight:700">
          </td></tr>
          <tr><td style="height:6px;background:#FFC93D;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td style="background:#ffffff;border-radius:0 0 24px 24px;padding:40px 36px 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:0 0 14px;font-size:26px;line-height:1.25;font-weight:700;color:#0F3D34">${escapeHtml(heading)}</td></tr>
              <tr><td style="padding:0 0 28px;font-size:16px;line-height:1.6;color:#4B5563">${escapeHtml(body)}</td></tr>
              ${stepsBlock}
              <tr><td align="center" style="padding:6px 0 30px">
                <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:16px 36px;background:#FFC93D;color:#0F3D34;border-radius:14px;text-decoration:none;font-size:16px;font-weight:700">${escapeHtml(ctaLabel)}</a>
              </td></tr>
              ${highlightBlock}
              <tr><td style="border-top:1px solid #ECECE3;padding:22px 0 0;font-size:13px;line-height:1.6;color:#6B7280">${escapeHtml(footer)}</td></tr>
            </table>
          </td></tr>
          <tr><td align="center" style="padding:24px 16px 0;font-size:13px;line-height:1.6;color:#6B7280">
            <strong style="color:#0F3D34">Cipri</strong> · Seu negócio no seu ritmo.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function deliver(input: {
  to: string;
  subject: string;
  html: string;
  devFallback: string;
}): Promise<SendResult> {
  if (!resend) {
    console.info(`[email] RESEND_API_KEY ausente. ${input.devFallback}`);
    return { sent: false, reason: EMAIL_NOT_CONFIGURED };
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Falha no envio." };
  }
}

type InviteEmail = {
  to: string;
  code: string;
  workspaceName: string;
  inviterName: string;
  roleLabel: string;
  appUrl: string;
};

export async function sendInviteEmail(invite: InviteEmail): Promise<SendResult> {
  return deliver({
    to: invite.to,
    subject: `Convite para ${invite.workspaceName} no Cipri`,
    html: actionEmailHtml({
      heading: `${invite.inviterName} convidou você para ${invite.workspaceName}`,
      body: `Você vai entrar como ${invite.roleLabel}. É só tocar no botão abaixo: o convite abre direto, sem precisar copiar nada.`,
      steps: [
        "Toque em \"Aceitar convite\".",
        "Entre na sua conta ou crie uma gratuitamente.",
        "Confirme e pronto: o workspace já aparece para você.",
      ],
      ctaLabel: "Aceitar convite",
      ctaUrl: `${invite.appUrl.replace(/\/$/, "")}/convite/${invite.code}`,
      highlight: invite.code,
      highlightLabel: "Prefere digitar? Use este código",
      footer: "O código vale por 7 dias. Se você não esperava este convite, pode ignorar esta mensagem.",
    }),
    devFallback: `Convite para ${invite.to}: código ${invite.code}`,
  });
}

type LinkEmail = { to: string; name: string; url: string };

export async function sendVerificationEmail({ to, name, url }: LinkEmail): Promise<SendResult> {
  return deliver({
    to,
    subject: "Confirme seu e-mail no Cipri",
    html: actionEmailHtml({
      heading: `Olá, ${name}! Falta confirmar seu e-mail`,
      body: "Clique no botão abaixo para confirmar seu e-mail e começar a usar o Cipri.",
      ctaLabel: "Confirmar e-mail",
      ctaUrl: url,
      footer: "O link vale por 24 horas. Se você não criou uma conta no Cipri, pode ignorar esta mensagem.",
    }),
    devFallback: `Verificação para ${to}: ${url}`,
  });
}

export async function sendPasswordResetEmail({ to, name, url }: LinkEmail): Promise<SendResult> {
  return deliver({
    to,
    subject: "Redefina sua senha do Cipri",
    html: actionEmailHtml({
      heading: `Olá, ${name}! Vamos trocar sua senha`,
      body: "Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova.",
      ctaLabel: "Redefinir senha",
      ctaUrl: url,
      footer: "O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a troca, ignore esta mensagem: sua senha continua a mesma.",
    }),
    devFallback: `Redefinição de senha para ${to}: ${url}`,
  });
}

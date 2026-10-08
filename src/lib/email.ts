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
};

export function actionEmailHtml({ heading, body, ctaLabel, ctaUrl, footer, highlight }: ActionEmail): string {
  const highlightBlock = highlight
    ? `<div style="margin:0 0 24px;padding:16px;background:#F7F7EF;border-radius:8px;text-align:center">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:600;letter-spacing:3px">${escapeHtml(highlight)}</span>
      </div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#F7F7EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F2937">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#57534e">${escapeHtml(body)}</p>
      ${highlightBlock}
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 20px;background:#0F3D34;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">${escapeHtml(ctaLabel)}</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c">${escapeHtml(footer)}</p>
    </div>
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
      body: `Você vai entrar como ${invite.roleLabel}. Use o código abaixo na tela "Entrar com código".`,
      highlight: invite.code,
      ctaLabel: "Abrir o Cipri",
      ctaUrl: invite.appUrl,
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

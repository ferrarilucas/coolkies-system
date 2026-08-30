import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "Coolkies <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

export type SendResult = { sent: boolean; reason?: string };

type InviteEmail = {
  to: string;
  code: string;
  workspaceName: string;
  inviterName: string;
  roleLabel: string;
  appUrl: string;
};

function inviteHtml({
  code,
  workspaceName,
  inviterName,
  roleLabel,
  appUrl,
}: Omit<InviteEmail, "to">): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">
        ${inviterName} convidou você para ${workspaceName}
      </h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#57534e">
        Você vai entrar como <strong>${roleLabel}</strong>. Use o código abaixo
        na tela “Entrar com código”.
      </p>
      <div style="margin:0 0 24px;padding:16px;background:#f6f5f3;border-radius:8px;text-align:center">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:600;letter-spacing:3px">
          ${code}
        </span>
      </div>
      <a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#8B5E3C;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500">
        Abrir o Coolkies
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c">
        O código vale por 7 dias. Se você não esperava este convite, pode ignorar
        esta mensagem.
      </p>
    </div>
  </body>
</html>`;
}

export async function sendInviteEmail(invite: InviteEmail): Promise<SendResult> {
  const { to, ...rest } = invite;

  if (!resend) {
    console.info(
      `[email] RESEND_API_KEY ausente. Convite para ${to}: código ${rest.code}`,
    );
    return { sent: false, reason: "Envio de e-mail não configurado." };
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `Convite para ${rest.workspaceName} no Coolkies`,
      html: inviteHtml(rest),
    });

    if (error) return { sent: false, reason: error.message };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Falha no envio." };
  }
}

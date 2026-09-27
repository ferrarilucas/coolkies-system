export const GENERIC_AUTH_ERROR = "Não foi possível continuar. Tente de novo.";

const TOO_MANY_REQUESTS = "Muitas tentativas. Espere um pouco e tente de novo.";
const ALREADY_EXISTS = "Já existe uma conta com este e-mail. Entre ou redefina sua senha.";

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail antes de entrar. Enviamos um novo link para você.",
  USER_ALREADY_EXISTS: ALREADY_EXISTS,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: ALREADY_EXISTS,
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha está longa demais.",
  INVALID_TOKEN: "Este link expirou ou já foi usado. Peça um novo.",
};

export function authErrorMessage(
  error: { code?: string; status?: number } | null | undefined,
): string {
  if (!error) return GENERIC_AUTH_ERROR;
  if (error.status === 429) return TOO_MANY_REQUESTS;
  return (error.code && MESSAGES[error.code]) || GENERIC_AUTH_ERROR;
}

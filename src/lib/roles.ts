export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  MEMBER: "Membro",
};

export const ROLE_DESCRIPTION: Record<string, string> = {
  OWNER: "Acesso total, incluindo assinatura e exclusão do workspace",
  ADMIN: "Também altera preços, receitas e cadastros",
  MEMBER: "Registra vendas, produção e compras",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

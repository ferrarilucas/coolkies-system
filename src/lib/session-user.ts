/** Dados do usuário usados pela navegação (serializável p/ Client Components). */
export type SessionUser = {
  name: string;
  email: string;
  image: string | null;
  role: string;
};

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return user?.role === "ADMIN";
}

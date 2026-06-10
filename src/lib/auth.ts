import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { db } from "./db";
import { findAllowedEmail, normalizeEmail } from "./allowlist";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  // Login social: APENAS Google (sem email/senha próprio).
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false, // não pode ser definido pelo cliente
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 dias
    updateAge: 60 * 60 * 24, // renova a cada 1 dia
  },
  databaseHooks: {
    user: {
      create: {
        // Pré-cadastro: bloqueia criação de conta para e-mails fora da allowlist.
        before: async (user) => {
          const allowed = await findAllowedEmail(user.email);
          if (!allowed) {
            throw new APIError("FORBIDDEN", {
              message: "E-mail não autorizado a acessar o app.",
            });
          }
          return {
            data: {
              ...user,
              email: normalizeEmail(user.email),
              role: allowed.role, // aplica o role definido no pré-cadastro
            },
          };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

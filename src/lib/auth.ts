import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { normalizeEmail } from "./allowlist";

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
        before: async (user) => {
          return { data: { ...user, email: normalizeEmail(user.email) } };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

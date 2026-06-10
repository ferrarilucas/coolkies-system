"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

export const { signIn, signOut, useSession } = authClient;

export async function signInWithGoogle() {
  await signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
    // Se o e-mail não estiver no pré-cadastro, o hook bloqueia e cai aqui.
    errorCallbackURL: "/not-authorized",
  });
}

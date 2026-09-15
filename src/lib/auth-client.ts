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
    errorCallbackURL: "/not-authorized",
  });
}

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
}) {
  return authClient.signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
  });
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}) {
  return authClient.signIn.email({
    email: input.email,
    password: input.password,
  });
}

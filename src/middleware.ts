import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/sign-in", "/not-authorized"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // rotas públicas e assets passam direto
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // checa presença do cookie de sessão (validação completa nas páginas/server)
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // protege tudo, exceto auth API, assets e o próprio sign-in
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png|splash/|sign-in|not-authorized).*)",
  ],
};

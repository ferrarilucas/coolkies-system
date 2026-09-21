import { auth } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/api/auth/.well-known/oauth-protected-resource";
  return auth.handler(new Request(url, { headers: request.headers }));
}

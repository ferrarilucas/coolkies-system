import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { subscribeToSubscriptionChanges } from "@/server/realtime/subscription-events";
import { getSubscriptionState } from "@/server/realtime/subscription-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 25_000;
const MAX_LIFETIME_MS = 10 * 60_000;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const userId = session.user.id;
  const encoder = new TextEncoder();
  let stop: (closeStream: boolean) => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      function send(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close(false);
        }
      }

      async function sendState() {
        const state = await getSubscriptionState(userId);
        send(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      }

      const unsubscribe = subscribeToSubscriptionChanges(userId, () => {
        sendState().catch(() => close(true));
      });
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), KEEP_ALIVE_MS);
      const lifetime = setTimeout(() => close(true), MAX_LIFETIME_MS);

      function close(closeStream: boolean) {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepAlive);
        clearTimeout(lifetime);
        if (closeStream) controller.close();
      }

      stop = close;
      request.signal.addEventListener("abort", () => close(false));
      try {
        await sendState();
      } catch {
        close(true);
      }
    },
    cancel() {
      stop(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

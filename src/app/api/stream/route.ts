import { getBus, type BusMessage } from "@/lib/events/bus";

export const dynamic = "force-dynamic";

/** Server-Sent Events: pushes a tiny notification whenever data changes. */
export async function GET(req: Request) {
  const bus = getBus();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (msg: BusMessage | { kind: "hello" | "ping" }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onMessage = (m: BusMessage) => send(m);
      bus.on("message", onMessage);
      const ping = setInterval(() => send({ kind: "ping" }), 15_000);
      cleanup = () => {
        clearInterval(ping);
        bus.off("message", onMessage);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
      send({ kind: "hello" });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

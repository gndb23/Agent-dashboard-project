import { EventEmitter } from "node:events";

export type BusMessage =
  | { kind: "event"; agentId: string; runId: string; eventType: string; timestamp: number }
  | { kind: "alert"; agentId: string; status: string }
  | { kind: "registry" };

const g = globalThis as unknown as { __agentOpsBus?: EventEmitter };

export function getBus(): EventEmitter {
  if (!g.__agentOpsBus) {
    g.__agentOpsBus = new EventEmitter();
    g.__agentOpsBus.setMaxListeners(200);
  }
  return g.__agentOpsBus;
}

export function publish(msg: BusMessage) {
  getBus().emit("message", msg);
}

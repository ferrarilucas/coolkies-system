import { EventEmitter } from "node:events";

const globalForEvents = globalThis as typeof globalThis & {
  subscriptionEvents?: EventEmitter;
};

function emitter(): EventEmitter {
  if (!globalForEvents.subscriptionEvents) {
    const created = new EventEmitter();
    created.setMaxListeners(0);
    globalForEvents.subscriptionEvents = created;
  }
  return globalForEvents.subscriptionEvents;
}

function channel(userId: string): string {
  return `subscription:${userId}`;
}

export function publishSubscriptionChange(userId: string): void {
  emitter().emit(channel(userId));
}

export function subscribeToSubscriptionChanges(
  userId: string,
  listener: () => void,
): () => void {
  emitter().on(channel(userId), listener);
  return () => {
    emitter().off(channel(userId), listener);
  };
}

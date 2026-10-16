/** Minimal typed event bus used to decouple gameplay systems. */
export type Handler<T = any> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on<T = any>(event: string, handler: Handler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
    return () => this.off(event, handler);
  }

  off<T = any>(event: string, handler: Handler<T>): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }

  emit<T = any>(event: string, payload?: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${event}" failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

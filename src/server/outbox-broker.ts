import { EventEmitter } from "node:events";

class OutboxEventBroker extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(10000);
  }

  notify(interviewId: string): void {
    this.emit(`interview:${interviewId}`);
  }
}

export const outboxEventBroker = new OutboxEventBroker();

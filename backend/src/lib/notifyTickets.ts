import { randomBytes } from "node:crypto";

interface NotifyTicketBinding {
  orgId: string;
  userId: string;
}

interface StoredTicket extends NotifyTicketBinding {
  expiresAt: number;
}

export class NotifyTicketStore {
  private readonly tickets = new Map<string, StoredTicket>();

  mint(binding: NotifyTicketBinding): { ticket: string; expiresInMs: number } {
    const ticket = randomBytes(32).toString("hex");
    const expiresInMs = 30_000;
    this.tickets.set(ticket, { ...binding, expiresAt: Date.now() + expiresInMs });
    return { ticket, expiresInMs };
  }

  redeem(ticket: string): NotifyTicketBinding | null {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    this.tickets.delete(ticket);
    if (entry.expiresAt <= Date.now()) return null;
    return { orgId: entry.orgId, userId: entry.userId };
  }
}

export const notifyTickets = new NotifyTicketStore();

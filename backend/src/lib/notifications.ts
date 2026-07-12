export interface NotifyFrame {
  type: "notify";
  org_id: string;
  recipient_user_id: string;
  seq: number;
}

export class NotificationHub {
  private readonly subscribers = new Map<string, Map<string, (frame: NotifyFrame) => void>>();

  subscribe(orgId: string, userId: string, id: string, send: (frame: NotifyFrame) => void): void {
    const key = `${orgId}:${userId}`;
    const group = this.subscribers.get(key) ?? new Map<string, (frame: NotifyFrame) => void>();
    group.set(id, send);
    this.subscribers.set(key, group);
  }

  unsubscribe(orgId: string, userId: string, id: string): void {
    const key = `${orgId}:${userId}`;
    const group = this.subscribers.get(key);
    if (!group) return;
    group.delete(id);
    if (!group.size) this.subscribers.delete(key);
  }

  broadcast(frame: NotifyFrame): void {
    for (const send of this.subscribers.get(`${frame.org_id}:${frame.recipient_user_id}`)?.values() ?? []) {
      try { send(frame); } catch { /* close handler prunes dead sockets */ }
    }
  }
}

export const notificationHub = new NotificationHub();

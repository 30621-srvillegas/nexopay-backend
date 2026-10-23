export class RealtimeHub {
  constructor() {
    this.byAccount = new Map();
  }

  add(accountId, socket) {
    if (!this.byAccount.has(accountId)) this.byAccount.set(accountId, new Set());
    this.byAccount.get(accountId).add(socket);
  }

  remove(accountId, socket) {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byAccount.delete(accountId);
  }

  sendToSocket(socket, event, data) {
    if (socket.readyState !== 1) return;
    try {
      socket.send(
        JSON.stringify({
          v: 1,
          event,
          data,
          ts: new Date().toISOString(),
        }),
      );
    } catch {
      // El socket se cerró entre la comprobación y el envío.
    }
  }

  send(accountId, event, data) {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    for (const socket of set) this.sendToSocket(socket, event, data);
  }

  allSockets() {
    const all = [];
    for (const set of this.byAccount.values()) all.push(...set);
    return all;
  }
}

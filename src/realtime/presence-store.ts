/**
 * Tracks who's currently online by counting live socket connections per
 * user (a user with two open tabs is still just "online" once).
 *
 * This is in-process, per-server-instance state — fine for the single dev
 * instance this app runs as today, but it will not stay correct once the
 * app is horizontally scaled (a user connected to instance A would look
 * "offline" to instance B). If/when that happens, replace the two Maps
 * below with a shared Redis counter (INCR/DECR per userId), the same
 * pattern already used for the Socket.IO adapter and session store.
 */
class PresenceStore {
  private connectionsByUser = new Map<string, Set<string>>();
  private lastSeenByUser = new Map<string, string>();

  /** Registers a connected socket. Returns true if the user just came online. */
  connect(userId: string, socketId: string): boolean {
    const sockets = this.connectionsByUser.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    this.connectionsByUser.set(userId, sockets);
    return wasOffline;
  }

  /** Removes a disconnected socket. Returns true if the user just went offline. */
  disconnect(userId: string, socketId: string): boolean {
    const sockets = this.connectionsByUser.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size > 0) return false;

    this.connectionsByUser.delete(userId);
    this.lastSeenByUser.set(userId, new Date().toISOString());
    return true;
  }

  isOnline(userId: string): boolean {
    return (this.connectionsByUser.get(userId)?.size ?? 0) > 0;
  }

  getLastSeen(userId: string): string | undefined {
    return this.lastSeenByUser.get(userId);
  }
}

export const presenceStore = new PresenceStore();

/**
 * Reconnectable in-memory cache used by the request layer.
 *
 * Lifecycle: connected -> drop() (network blip) -> reconnect() -> connected.
 * Entries written before a drop must remain servable after a reconnect.
 */
export class ReconnectableCache {
  private store = new Map<string, unknown>();
  private connected = true;

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  drop(): void {
    this.connected = false;
  }

  reconnect(): void {
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  get(key: string): unknown {
    // BUG: guard is inverted — throws while connected instead of while
    // disconnected, so every request fails after the cache reconnects.
    if (this.connected) {
      throw new Error(`cache unavailable while disconnected (key: ${key})`);
    }
    if (!this.store.has(key)) {
      throw new Error(`cache miss: ${key}`);
    }
    return this.store.get(key);
  }
}

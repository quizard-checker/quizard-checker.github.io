import { Injectable } from '@angular/core';

/**
 * Android's hardware back button is app-wide, but some screens need to handle
 * it before the router does (the scanner result screen must not be dismissed).
 * Screens register a small handler while they are active; the root shell asks
 * the newest handler first, then falls back to normal navigation.
 */
@Injectable({ providedIn: 'root' })
export class BackService {
  private handlers: Array<() => boolean> = [];

  register(handler: () => boolean): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.lastIndexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  handle(): boolean {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      try {
        if (this.handlers[i]()) return true;
      } catch {
        // A stale page handler must never stop the app-wide back fallback.
      }
    }
    return false;
  }
}

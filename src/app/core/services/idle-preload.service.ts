import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

// Warm the lazy route chunks + shared engine chunk during browser idle time,
// so the first navigation to a tab/screen feels instant instead of paying a
// chunk download + parse on tap.
@Injectable({ providedIn: 'root' })
export class IdlePreloadService {
  private router = inject(Router);
  private started = false;

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    const warm = () => {
      // teacher pages first (Home is the landing tab), then the rest
      const targets = [
        () => import('../../pages/home/home'),
        () => import('../engine/storage.js'),
        () => import('../../pages/keys/keys'),
        () => import('../../pages/create/create'),
        () => import('../../pages/checking/checking'),
        () => import('../../pages/reports/reports'),
        () => import('../../pages/settings/settings')
      ];
      let i = 0;
      const step = () => {
        if (i >= targets.length) return;
        targets[i++]().catch(() => {});
        if (i < targets.length) schedule();
      };
      const schedule = () => {
        if ('requestIdleCallback' in window) (window as any).requestIdleCallback(step, { timeout: 3000 });
        else setTimeout(step, 220);
      };
      schedule();
    };
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(warm, { timeout: 5000 });
    else setTimeout(warm, 2500);
  }
}

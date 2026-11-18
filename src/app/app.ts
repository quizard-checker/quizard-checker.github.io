import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { IdlePreloadService } from './core/services/idle-preload.service';
import { ConfirmService } from './core/services/confirm.service';
import { UiStateService } from './core/services/ui-state.service';
import { BackService } from './core/services/back.service';
import { GuideService } from './core/services/guide.service';
import { ToastService } from './core/services/toast.service';
import { IcoPipe } from './shared/ico.pipe';
import { GuideSheet } from './shared/guide-sheet';
import { backDestination } from './shared/helpers.js';
import { afterNextRender, effect } from '@angular/core';

// Eager shell: under zoneless CD (Angular 22 makes OnPush the default) an
// OnPush shell strands ion-router-outlet pages — stuck `ion-page-invisible`,
// dead deep-linked pages. Required on every component between the root and
// the outlet (see Ionic zoneless guide).
@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet, IcoPipe, GuideSheet],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.html',
})
export class App {
  // inject() runs here, inside the component's injection context — calling it
  // inside the afterNextRender callback instead throws NG0203.
  private preload = inject(IdlePreloadService);
  private swUpdate = inject(SwUpdate, { optional: true });
  readonly confirm = inject(ConfirmService);
  private ui = inject(UiStateService);
  private router = inject(Router);
  private back = inject(BackService);
  private guide = inject(GuideService);
  private toast = inject(ToastService);
  private tooltipRaf = 0;
  private confirmWasOpen = false;
  private returnFocus: HTMLElement | null = null;
  private lastBackAt = 0;

  // The templates have always carried `data-tooltip`, but nothing rendered it.
  // Mirror it to the native title attribute so icon-only controls at least get
  // a desktop hover hint; the important actions also have visible labels now.
  private startTooltipFallback() {
    const apply = () => {
      document.querySelectorAll<HTMLElement>('[data-tooltip]').forEach(el => {
        const text = el.getAttribute('data-tooltip');
        if (text && el.getAttribute('title') !== text) el.setAttribute('title', text);
      });
    };
    apply();
    const observer = new MutationObserver(() => {
      if (this.tooltipRaf) return;
      this.tooltipRaf = requestAnimationFrame(() => {
        this.tooltipRaf = 0;
        apply();
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tooltip']
    });
  }

  private focusDialog(id: string) {
    this.returnFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      const dialog = document.getElementById(id);
      if (!dialog) return;
      const first = dialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled])');
      (first || dialog).focus();
    }, 0);
  }

  private restoreDialogFocus() {
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }

  // Keep Tab inside the open dialog instead of letting focus fall behind it.
  trapDialogFocus(event: KeyboardEvent, id: string) {
    if (event.key !== 'Tab') return;
    const dialog = document.getElementById(id);
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Android's back button is a navigation button, not an exit button. Close
  // the top dialog/sheet, let the active page handle its own back, then walk
  // back to Home. Only a second press on a root screen exits.
  private async handleBack() {
    if (this.confirm.visible()) {
      this.lastBackAt = 0;
      this.confirm.cancel();
      return;
    }
    if (this.guide.open()) {
      this.lastBackAt = 0;
      this.guide.close();
      return;
    }
    // Ionic keeps previous tabs in the DOM; only the visible overlay counts.
    const overlay = [...document.querySelectorAll<HTMLElement>('.org-overlay')]
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .pop();
    if (overlay) {
      this.lastBackAt = 0;
      overlay.click();
      return;
    }
    if (this.back.handle()) {
      this.lastBackAt = 0;
      return;
    }

    const target = backDestination(this.router.url);
    if (target === 'exit') {
      const now = Date.now();
      if (now - this.lastBackAt < 2000) {
        this.lastBackAt = 0;
        await CapacitorApp.exitApp();
        return;
      }
      this.lastBackAt = now;
      this.toast.toast('Press back again to exit');
      return;
    }
    this.lastBackAt = 0;
    await this.router.navigateByUrl(target);
  }

  constructor() {
    afterNextRender(() => {
      this.preload.start();
      this.startTooltipFallback();
    });
    effect(() => {
      const open = this.confirm.visible();
      if (open === this.confirmWasOpen) return;
      this.confirmWasOpen = open;
      if (open) this.focusDialog('confirm-dialog');
      else this.restoreDialogFocus();
    });
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('backButton', () => { void this.handleBack(); }).catch(() => {});
      // An APK upgrade must never run the previous build out of a service
      // worker cache: the bundled assets are the truth on the device. Older
      // installs may still have a registration — drop it and its caches.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
          .then(rs => rs.forEach(r => r.unregister()))
          .catch(() => {});
        if ('caches' in window) {
          caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
        }
      }
      // Edge-to-edge draws the app under the status bar, so its icons must
      // contrast with the APP theme (light app → dark icons, dark app → light)
      effect(() => {
        const style = this.ui.theme() === 'dark' ? Style.Dark : Style.Light;
        StatusBar.setStyle({ style }).catch(() => {});
      });
    }
    // Apply app updates on the FIRST reload: when the service worker detects a
    // new version it downloads it, we activate immediately and reload once.
    // Without this, users need two manual refreshes (or never see updates).
    if (this.swUpdate?.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter(e => e.type === 'VERSION_READY'))
        .subscribe(() => {
          this.swUpdate!.activateUpdate().then(updated => {
            if (updated && !sessionStorage.getItem('ngsw-just-updated')) {
              sessionStorage.setItem('ngsw-just-updated', '1');
              document.location.reload();
            }
          });
        });
      this.swUpdate.unrecoverable.subscribe(() => {
        sessionStorage.removeItem('ngsw-just-updated');
        if (confirm('The app updated in the background and needs a reload. Reload now?')) {
          document.location.reload();
        }
      });
    }
  }
}

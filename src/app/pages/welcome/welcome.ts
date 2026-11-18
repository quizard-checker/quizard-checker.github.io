import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { assetUrl } from '../../shared/assets.js';
import { listAccounts, loadSettings, setActiveAccount } from '../../core/engine/storage.js';

const SPARKS = Array.from({ length: 10 }, (_, i) =>
  ({ a: `${i * 36}deg`, d: `${(0.45 + i * 0.045).toFixed(2)}s` })
);

const DUST = [
  { l: '16%', t: '24%', d: '0s' },   { l: '82%', t: '18%', d: '.5s' },
  { l: '70%', t: '64%', d: '1s' },   { l: '24%', t: '70%', d: '1.4s' },
  { l: '10%', t: '48%', d: '.8s' },  { l: '88%', t: '46%', d: '1.8s' },
  { l: '40%', t: '14%', d: '1.1s' }, { l: '58%', t: '82%', d: '.3s' }
];

@Component({
  selector: 'app-welcome',
  imports: [],
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
  host: { '(click)': 'advance()' }
})
export class WelcomePage implements OnInit, OnDestroy {
  readonly sparks = SPARKS;
  readonly dust = DUST;
  readonly heroUrl = assetUrl('wizard/wizard-welcome.jpg');
  exiting = false;
  // Where the splash hands over (only used when the splash actually plays):
  // fresh devices go to profile creation, returning users to the profile
  // picker — PIN enforcement lives there.
  private launchTo: '/accounts' | '/tabs/classes' = '/accounts';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private safety: ReturnType<typeof setTimeout> | null = null;

  constructor(private router: Router) {}

  ngOnInit() {
    // A slow IndexedDB read or a failed route load must never strand the
    // splash. After six seconds, fall through to the profile picker.
    this.safety = setTimeout(() => {
      if (this.exiting) return;
      this.launchTo = '/accounts';
      this.advance();
    }, 6000);
    this.decideLaunch().then(({ splash, to }) => {
      if (this.exiting) return;
      this.launchTo = to;
      if (!splash) {
        // straight-into-the-app (skip intro) or straight-to-the-gate (PIN):
        // no splash
        this.exiting = true;
        this.clearSafety();
        this.goToLaunch();
        return;
      }
      this.timer = setTimeout(() => this.advance(), 2050);
    });
  }

  private async decideLaunch(): Promise<{ splash: boolean; to: '/accounts' | '/tabs/classes' }> {
    try {
      const accounts = await listAccounts();
      const fresh = !accounts.length || (accounts.length === 1 && accounts[0].name === 'My account');
      if (fresh) return { splash: true, to: '/accounts' };
      // "Skip intro on launch": straight into the app with the last profile —
      // but a PIN-protected profile still goes through the picker gate.
      if (loadSettings().skipIntro) {
        const lastId = localStorage.getItem('quizard-active-account') || '';
        const last = lastId ? accounts.find(a => a.id === lastId) : null;
        if (last && !last.pinHash) {
          setActiveAccount(last.id);
          return { splash: false, to: '/tabs/classes' };
        }
        return { splash: false, to: '/accounts' };
      }
      // Returning users get the splash, then the profile picker.
      return { splash: true, to: '/accounts' };
    } catch {
      return { splash: true, to: '/accounts' };
    }
  }

  ngOnDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.clearSafety();
  }

  advance() {
    if (this.exiting) return;
    this.exiting = true;
    if (this.timer) clearTimeout(this.timer);
    this.clearSafety();
    // play the "poof" exit before handing over
    setTimeout(() => this.goToLaunch(), 430);
  }

  private clearSafety() {
    if (this.safety) clearTimeout(this.safety);
    this.safety = null;
  }

  private goToLaunch(attempt = 0) {
    this.router.navigateByUrl(this.launchTo).then(ok => {
      if (!ok) this.retryLaunch(attempt);
    }).catch(() => this.retryLaunch(attempt));
  }

  private retryLaunch(attempt: number) {
    if (attempt >= 2) {
      window.location.assign(this.launchTo);
      return;
    }
    setTimeout(() => this.goToLaunch(attempt + 1), 800);
  }
}

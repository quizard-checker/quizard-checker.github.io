import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular';
import {
  listAccounts, createAccount, hashPin, verifyPin, setActiveAccount,
  getAccount, deleteAccount, accountHasData, updateAccount,
  getActiveAccountId, saveSettings, loadSettings
} from '../../core/engine/storage.js';
import type { Account } from '../../core/engine/db-types.js';
import { icon } from '../../shared/icons.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { RemoveAccountSheet } from '../../shared/remove-account-sheet';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';

const COLORS = ['#C4713B', '#1A7F37', '#0A66C2', '#7C5CBF', '#B54708', '#475569'];

type Mode = 'picker' | 'create' | 'lock';

@Component({
  selector: 'app-accounts',
  imports: [IonContent, FormsModule, IcoPipe, RemoveAccountSheet],
  templateUrl: './accounts.html',
})
export class AccountsPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ui = inject(UiStateService);
  private toast = inject(ToastService);

  readonly icons = {
    logo: icon('logo'), lock: icon('lock'), plus: icon('plus'), check: icon('check')
  };
  readonly colors = COLORS;
  mode = signal<Mode>('picker');
  accounts = signal<Account[]>([]);
  removeOpen = signal(false);
  lockAccount = signal<Account | null>(null);
  cameFromPicker = false;

  // create form state
  name = '';
  color = COLORS[0];
  pin = '';
  pinConfirm = '';
  pinHint = 'Leave both empty to skip the PIN';

  // lock state
  entered = '';

  ngOnInit() {
    this.route.queryParamMap.subscribe(async q => {
      const requested = q.get('mode');
      this.mode.set(requested === 'create' || requested === 'lock' ? requested : 'picker');
      this.cameFromPicker = q.get('from') === 'picker';
      if (this.mode() === 'picker') this.accounts.set(await listAccounts());
      if (this.mode() === 'lock') {
        const acc = await getAccount(q.get('id') || '');
        if (!acc) { this.go({ mode: 'picker' }); return; }
        this.lockAccount.set(acc);
      }
    });
  }

  go(params: { mode: Mode; id?: string }) {
    const tree: any[] = ['/accounts'];
    const qp: Record<string, string> = { mode: params.mode };
    if (params.id) qp['id'] = params.id;
    if (params.mode === 'create' && this.cameFromPicker) qp['from'] = 'picker';
    this.router.navigate(tree, { queryParams: qp });
  }

  avatarStyle(color: string) { return { background: color }; }

  async openAccount(acc: Account) {
    if (acc.pinHash) { this.go({ mode: 'lock', id: acc.id }); return; }
    setActiveAccount(acc.id);
    this.ui.account.set(acc);
    this.toast.toast(`Welcome back, ${acc.name}`);
    this.router.navigateByUrl('/tabs/classes');
  }

  async removeAccount(acc: Account) {
    this.removeOpen.set(false);
    if (this.accounts().length <= 1) {
      this.toast.toast('Create another profile before removing this one', true);
      return;
    }
    try {
      await deleteAccount(acc.id);
      if (getActiveAccountId() === acc.id) {
        setActiveAccount(null);
        this.ui.account.set(null);
      }
      this.accounts.set(await listAccounts());
      this.toast.toast(`Removed ${acc.name}`);
    } catch (err: any) {
      this.toast.toast(err?.message || 'Could not remove that account', true);
    }
  }

  validatePin(): boolean {
    this.pin = this.pin.trim();
    this.pinConfirm = this.pinConfirm.trim();
    if (!this.pin && !this.pinConfirm) { this.pinHint = 'Leave both empty to skip the PIN'; return false; }
    if (!/^\d{4}$/.test(this.pin)) { this.pinHint = 'PIN must be exactly 4 digits'; return false; }
    if (this.pin !== this.pinConfirm) { this.pinHint = 'PINs do not match'; return false; }
    this.pinHint = 'PIN ready — you will enter it when opening this profile';
    return true;
  }

  onPinInput() { this.validatePin(); }

  async create() {
    const name = this.name.trim();
    if (!name) { this.toast.toast('Enter a profile name', true); return; }
    const pinOk = this.validatePin();
    const hasPin = this.pin || this.pinConfirm;
    if (hasPin && !pinOk) { this.toast.toast(this.pinHint, true); return; }
    const pinHash = hasPin ? await hashPin(this.pin) : null;
    const acc = await createAccount({ name, color: this.color, pinHash });

    const others = (await listAccounts()).filter(a => a.id !== acc.id);
    for (const other of others) {
      if (!(await accountHasData(other.id))) await deleteAccount(other.id);
    }

    setActiveAccount(acc.id);
    this.ui.account.set(acc);
    const doneMap = { ...(loadSettings().tutorialDoneAccounts || {}) };
    doneMap[acc.id] = false;
    saveSettings({ tutorialAccountId: acc.id, tutorialDone: false, tutorialDoneAccounts: doneMap, tourSeen: [] });
    this.toast.toast(`Welcome, ${acc.name}!`);
    this.router.navigateByUrl('/tabs/classes');
  }

  back() {
    // Backing out of the create form must never enter the app: nobody has
    // picked or created a profile yet, and the auto-created default account
    // would otherwise log the user straight in without them choosing one.
    // The profile picker is always the right destination.
    this.go({ mode: 'picker' });
  }

  // ── lock pad ──
  padKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  pressKey(k: string) {
    if (this.entered.length >= 4) return;
    this.entered += k;
    if (this.entered.length === 4) setTimeout(() => this.tryUnlock(), 120);
  }

  delKey() { this.entered = this.entered.slice(0, -1); }

  cancelLock() { this.go({ mode: 'picker' }); }

  shaking = false;

  private async tryUnlock() {
    const acc = this.lockAccount();
    if (!acc) return;
    const res = await verifyPin(this.entered, acc.pinHash);
    if (res.ok) {
      if (res.upgrade) updateAccount(acc.id, { pinHash: res.upgrade }).catch(() => {});
      setActiveAccount(acc.id);
      this.ui.account.set(acc);
      this.toast.toast(`Welcome back, ${acc.name}`);
      this.router.navigateByUrl('/tabs/classes');
    } else {
      this.shaking = true;
      setTimeout(() => { this.shaking = false; }, 400);
      this.entered = '';
      this.toast.toast('Wrong PIN', true);
    }
  }
}

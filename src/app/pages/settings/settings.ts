import { Component, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular';
import {
  exportAll, importAll, clearAllData, storageUsage, saveSettings, loadSettings,
  listDocs, listAccounts, getAccount, deleteAccount, setActiveAccount,
  getActiveAccountId, accountHasData
} from '../../core/engine/storage.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { RemoveAccountSheet } from '../../shared/remove-account-sheet';
import { assetUrl } from '../../shared/assets.js';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { GuideService } from '../../core/services/guide.service';
import { encryptBackup, decryptBackup } from '../../core/engine/crypto-backup.js';
import { hashPin, verifyPin, updateAccount, deleteDemoData } from '../../core/engine/storage.js';
import { seedDemoData, demoSummary } from '../../core/engine/demo.js';

const BACKUP_NUDGE_MS = 30 * 24 * 60 * 60 * 1000;

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 || v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

@Component({
  selector: 'app-settings',
  imports: [IonContent, FormsModule, IcoPipe, RemoveAccountSheet],
  templateUrl: './settings.html',
})
export class SettingsPage implements OnInit {
  router = inject(Router);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  readonly guide = inject(GuideService);
  private location = inject(Location);
  readonly demoSheets = [
    { file: 'demo/pin-sheet-ivan.png', label: 'Perfect — Ivan (50/50)', url: assetUrl('demo/pin-sheet-ivan.png') },
    { file: 'demo/pin-sheet-joy.png', label: 'Missed two — Joy (48/50)', url: assetUrl('demo/pin-sheet-joy.png') },
    { file: 'demo/pin-sheet-kat.png', label: 'Double-shaded — Kat (49/50)', url: assetUrl('demo/pin-sheet-kat.png') },
    { file: 'demo/pin-sheet-leo.png', label: 'Messy — Leo (44/50)', url: assetUrl('demo/pin-sheet-leo.png') },
  ];
  removePickerOpen = signal(false);
  switchOpen = signal(false);
  switchTarget = signal<any | null>(null);
  switchBusy = signal(false);
  switchMsg = signal('');
  switchSwitching = signal<any | null>(null);
  switchPin = '';

  @ViewChild('importInput') importInput?: ElementRef<HTMLInputElement>;
  @ViewChild('encImportInput') encImportInput?: ElementRef<HTMLInputElement>;

  // reactive settings state: the switches bind through this signal so every
  // toggle visibly flips (plain-object mutation doesn't re-render zoneless)
  private sSig = signal<any>(loadSettings());
  get s(): any { return this.sSig(); }
  private refreshSettings() { this.sSig.set(loadSettings()); }
  lastBackup = this.s.lastBackupAt || null;
  docCount = 0;
  accounts: any[] = [];
  account: any = null;
  usageLine = signal('');

  get showNudge() { return (!this.lastBackup || Date.now() - this.lastBackup > BACKUP_NUDGE_MS) && this.docCount > 0; }
  get version() { return '2.5.4'; }
  get theme() { return this.ui.theme; }

  // ── Rename profile ──
  namePanel = signal(false);
  nameDraft = '';
  nameBusy = signal(false);
  nameMsg = signal('');

  openNameChange() {
    this.nameDraft = this.account?.name || '';
    this.nameMsg.set('');
    this.namePanel.set(true);
  }
  closeNamePanel() {
    this.namePanel.set(false);
    this.nameDraft = '';
    this.nameMsg.set('');
  }

  async submitNameChange() {
    const acc = this.account;
    if (!acc || this.nameBusy()) return;
    const name = this.nameDraft.trim();
    if (!name) { this.nameMsg.set('Enter a profile name'); return; }
    if (name.length > 24) { this.nameMsg.set('Keep the name to 24 characters or fewer'); return; }
    if (name === acc.name) { this.closeNamePanel(); return; }
    this.nameBusy.set(true);
    this.nameMsg.set('');
    try {
      const updated = await updateAccount(acc.id, { name });
      if (!updated) { this.nameMsg.set('Could not update the profile name'); return; }
      this.account = updated;
      this.accounts = this.accounts.map(a => a.id === updated.id ? updated : a);
      // Keep the session copy in sync so headers and the profile picker show
      // the new name immediately, not after the next reload.
      this.ui.account.set(updated);
      this.closeNamePanel();
      this.toast.toast('Profile name updated ✓');
    } catch (err: any) {
      this.nameMsg.set(String(err?.message || 'Could not update the profile name'));
    } finally {
      this.nameBusy.set(false);
    }
  }

  // ── Change profile PIN ──
  pinPanel = signal(false);
  pinOld = '';
  pinNew = '';
  pinNew2 = '';
  pinBusy = signal(false);
  pinMsg = signal('');

  openPinChange() {
    this.pinOld = '';
    this.pinNew = '';
    this.pinNew2 = '';
    this.pinMsg.set('');
    this.pinPanel.set(true);
  }
  closePinPanel() {
    this.pinPanel.set(false);
    this.pinOld = '';
    this.pinNew = '';
    this.pinNew2 = '';
  }

  async submitPinChange() {
    const acc = this.account;
    if (!acc) return;
    if (!/^\d{4}$/.test(this.pinNew)) { this.pinMsg.set('The PIN must be exactly 4 digits'); return; }
    if (this.pinNew !== this.pinNew2) { this.pinMsg.set('The two new PINs do not match'); return; }
    this.pinBusy.set(true);
    this.pinMsg.set('');
    try {
      if (acc.pinHash) {
        const res = await verifyPin(this.pinOld, acc.pinHash);
        if (!res.ok) { this.pinMsg.set('Current PIN is wrong'); return; }
      }
      const pinHash = await hashPin(this.pinNew);
      await updateAccount(acc.id, { pinHash });
      await this.renderAccountSection();
      this.closePinPanel();
      this.toast.toast('Profile PIN updated ✓');
    } catch (err: any) {
      this.pinMsg.set(String(err?.message || 'Could not update the PIN'));
    } finally {
      this.pinBusy.set(false);
    }
  }

  async ngOnInit() {
    this.docCount = (await listDocs()).length;
    await this.renderAccountSection();
    try {
      const usage = await storageUsage();
      const when = this.lastBackup
        ? new Date(this.lastBackup).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : 'never';
      const bytes = usage?.usage;
      const used = typeof bytes === 'number' ? ' · ' + formatBytes(bytes) + ' used on this device' : '';
      this.usageLine.set(`Last backup: ${when}${used}`);
    } catch { /* usage optional */ }
  }

  private async renderAccountSection() {
    // Fresh devices auto-create a default account without ever writing the
    // localStorage id, so fall back to the first existing account.
    this.accounts = await listAccounts();
    const acc = this.ui.account()
      || await getAccount(localStorage.getItem('quizard-active-account') || '')
      || await getAccount(getActiveAccountId() || '')
      || (this.accounts.length ? await getAccount(this.accounts[0].id) : null);
    this.account = acc || null;
  }

  setSkipIntro(on: boolean) { saveSettings({ skipIntro: on }); this.refreshSettings(); this.toast.toast(on ? 'Intro will be skipped' : 'Intro plays on launch'); }


  goBack() {
    // Settings can be opened from any screen's header, so return to where the
    // teacher came from instead of always dumping them on Classes.
    if (history.length > 1) this.location.back();
    else this.router.navigateByUrl('/tabs/classes');
  }

  async openSwitch() {
    this.switchOpen.set(true);
    this.switchTarget.set(null);
    this.switchSwitching.set(null);
    this.switchPin = '';
    this.switchMsg.set('');
    // Refresh the list and toggle a signal so the sheet paints the fresh
    // accounts even under zoneless change detection.
    this.switchBusy.set(true);
    try {
      await this.renderAccountSection();
    } finally {
      this.switchBusy.set(false);
    }
  }

  closeSwitch() {
    this.switchOpen.set(false);
    this.switchTarget.set(null);
    this.switchSwitching.set(null);
    this.switchPin = '';
    this.switchMsg.set('');
  }

  pickAccount(target: any) {
    if (!target) return;
    if (target.id === this.account?.id) { this.closeSwitch(); return; }
    if (target.pinHash) {
      this.switchTarget.set(target);
      this.switchPin = '';
      this.switchMsg.set('');
      return;
    }
    this.switchPin = '';
    void this.switchTo(target);
  }

  setSwitchPin(value: string) {
    this.switchPin = String(value ?? '').replace(/\D/g, '').slice(0, 4);
  }

  cancelSwitchPin() {
    this.switchTarget.set(null);
    this.switchPin = '';
    this.switchMsg.set('');
  }

  async submitSwitchPin() {
    const target = this.switchTarget();
    if (!target || this.switchPin.length !== 4 || this.switchBusy()) return;
    this.switchBusy.set(true);
    this.switchMsg.set('');
    try {
      const res = await verifyPin(this.switchPin, target.pinHash);
      if (!res.ok) { this.switchMsg.set('Wrong PIN'); return; }
      if (res.upgrade) updateAccount(target.id, { pinHash: res.upgrade }).catch(() => {});
      await this.switchTo(target);
    } catch (err: any) {
      this.switchMsg.set(String(err?.message || 'Could not switch account'));
    } finally {
      this.switchBusy.set(false);
    }
  }

  private async switchTo(target: any) {
    this.switchBusy.set(true);
    this.switchSwitching.set(target);
    this.switchTarget.set(null);
    this.switchPin = '';
    this.switchMsg.set('');
    try {
      setActiveAccount(target.id);
      this.ui.account.set(target);
      this.account = target;
      // Let the switch animation play before Home loads under the new profile.
      await new Promise(resolve => setTimeout(resolve, 700));
      this.switchOpen.set(false);
      this.switchSwitching.set(null);
      await this.router.navigateByUrl('/tabs/home');
      this.toast.toast(`Switched to ${target.name}`);
    } catch (err: any) {
      this.switchSwitching.set(null);
      this.toast.toast(String(err?.message || 'Could not switch account'), true);
    } finally {
      this.switchBusy.set(false);
    }
  }

  addAccount() {
    this.closeSwitch();
    this.router.navigate(['/accounts'], { queryParams: { mode: 'create', from: 'picker' } });
  }

  logout() {
    this.closeSwitch();
    setActiveAccount(null);
    this.ui.account.set(null);
    this.router.navigate(['/accounts'], { queryParams: { mode: 'picker' } });
  }

  otherAccounts() {
    return this.accounts.filter(a => a.id !== this.account?.id);
  }

  openRemoveAccount() {
    if (this.otherAccounts().length) this.removePickerOpen.set(true);
  }

  async removeAccount(target: any) {
    this.removePickerOpen.set(false);
    try {
      await deleteAccount(target.id);
      this.toast.toast(`Removed ${target.name}`);
      await this.renderAccountSection();
    } catch (err: any) {
      this.toast.toast(err?.message || 'Could not remove that account', true);
    }
  }

  private downloadJson(data: any, suffix: string) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `quizard-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${suffix}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async exportBackup() {
    try {
      this.downloadJson(await exportAll(), '');
      this.toast.toast('Backup downloaded ✓');
      this.lastBackup = Date.now();
      saveSettings({ lastBackupAt: this.lastBackup }); this.refreshSettings();
      try { this.usageLine.set(`Last backup: ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`); } catch {}
    } catch (err: any) { this.toast.toast('Export failed: ' + err.message, true); }
  }

  onImportPicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        await importAll(JSON.parse(fr.result as string));
        this.toast.toast('Backup restored ✓');
      } catch (err: any) { this.toast.toast('Import failed: ' + (err?.message || 'invalid file'), true); }
    };
    fr.readAsText(file);
  }

  async exportEncrypted() {
    const passphrase = window.prompt('Choose a passphrase for this backup (required):');
    if (!passphrase) return;
    try {
      const data = await exportAll();
      const encrypted = await encryptBackup(data, passphrase);
      this.downloadJson(encrypted, '.encrypted');
      this.toast.toast('Encrypted backup downloaded ✓');
      this.lastBackup = Date.now();
      saveSettings({ lastBackupAt: this.lastBackup }); this.refreshSettings();
    } catch (err: any) { this.toast.toast('Encryption failed: ' + (err?.message || ''), true); }
  }

  onEncImportPicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const passphrase = window.prompt('Passphrase for this backup:');
    if (!passphrase) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const data = await decryptBackup(JSON.parse(fr.result as string), passphrase);
        await importAll(data);
        this.toast.toast('Encrypted backup restored ✓');
      } catch { this.toast.toast('Wrong passphrase or corrupted file', true); }
    };
    fr.readAsText(file);
  }

  async eraseAll() {
    if (!await this.confirm.confirm('Erase everything?', 'All documents, quizzes, history and mistakes will be permanently deleted.', 'Erase')) return;
    await clearAllData();
    this.toast.toast('All data erased');
    this.docCount = 0;
    // the accounts store is gone too — drop the stale profile from the UI
    this.ui.account.set(null);
    this.account = null;
    this.accounts = [];
  }

  // ── Demo data ── a snapshot of a real teacher week (classes, keys, quizzes,
  // graded sheets) that upserts on re-run, so the app is explorable on boot.
  readonly demoBusy = signal(false);
  readonly demoBlurb = demoSummary();

  async loadDemo() {
    if (this.demoBusy()) return;
    this.demoBusy.set(true);
    try {
      await seedDemoData();
      this.toast.toast('Demo data loaded — classes, quizzes and results are in');
    } catch (e: any) {
      this.toast.toast('Could not load demo data' + (e?.message ? ' — ' + e.message : ''), true);
    } finally {
      this.demoBusy.set(false);
    }
  }

  async removeDemo() {
    if (!await this.confirm.confirm('Remove demo data?', 'Only the sample classes, quizzes and results go — your own data stays.', 'Remove')) return;
    const n = await deleteDemoData();
    this.toast.toast(n ? `Removed ${n} demo records` : 'No demo data here');
  }

  clearCache() {
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => location.reload());
    } else location.reload();
  }
}

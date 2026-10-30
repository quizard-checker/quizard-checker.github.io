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
import { testApiKey, getApiKey, setApiKey, hasApiKey, hasRelay } from '../../core/engine/gemini.js';
import { setAiConfig, activeModel } from '../../core/engine/ai-providers.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { assetUrl } from '../../shared/assets.js';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ByokService } from '../../core/services/byok.service';
import { DOCS_URL } from '../../shared/docs-url';
import { encryptBackup, decryptBackup } from '../../core/engine/crypto-backup.js';
import { generateSyncCode, getSyncInfo, turnOffSync, activateSync, pushSync, pullSync, changeSyncPassword } from '../../core/engine/sync.js';
import { normalizeSyncCode } from '../../core/engine/sync.js';
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
  imports: [IonContent, FormsModule, IcoPipe],
  templateUrl: './settings.html',
})
export class SettingsPage implements OnInit {
  router = inject(Router);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  private location = inject(Location);
  readonly byok = inject(ByokService);
  readonly docsUrl = DOCS_URL;
  readonly demoSheets = [
    { file: 'demo/answered-sheet.png', label: 'Perfect — Ivan (100%)', url: assetUrl('demo/answered-sheet.png') },
    { file: 'demo/answered-sheet-joy.png', label: 'Missed two — Joy (75%)', url: assetUrl('demo/answered-sheet-joy.png') },
    { file: 'demo/answered-sheet-kat.png', label: 'Double-shaded — Kat (88%)', url: assetUrl('demo/answered-sheet-kat.png') },
    { file: 'demo/answered-sheet-leo.png', label: 'Messy — Leo (63%)', url: assetUrl('demo/answered-sheet-leo.png') },
  ];
  removePickerOpen = signal(false);

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
  keyStatus = signal('');
  keyInput = '';
  testing = false;

  get showNudge() { return (!this.lastBackup || Date.now() - this.lastBackup > BACKUP_NUDGE_MS) && this.docCount > 0; }
  get version() { return '2.0.6'; }
  get theme() { return this.ui.theme; }

  // ── Cloud sync (sync-code locker) ──
  syncInfo = signal<{ code: string; lastPush: number; on: boolean }>({ code: '', lastPush: 0, on: false });
  syncPanel = signal<'' | 'new' | 'restore'>('');
  newCode = signal(generateSyncCode());
  syncPass = '';
  restoreCode = '';
  restorePass = '';
  syncBusy = signal(false);
  syncMsg = signal('');

  private refreshSyncInfo() {
    this.syncInfo.set(getSyncInfo());
  }

  syncLastPush() {
    const t = this.syncInfo().lastPush;
    return t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'never';
  }

  ngOnInitSyncRestore() {
    // deep link: /tabs/settings?sync=restore (profile picker → "Use your sync
    // code") — send them to the dedicated restore screen.
    try {
      const q = new URLSearchParams(this.router.url.split('?')[1] || '');
      if (q.get('sync') === 'restore') this.router.navigateByUrl('/accounts?mode=restore');
    } catch { /* ignore */ }
  }

  openSyncPanel(mode: 'new' | 'restore') {
    this.syncMsg.set('');
    if (mode === 'new') this.newCode.set(generateSyncCode());
    this.syncPanel.set(mode);
  }
  closeSyncPanel() { this.syncPanel.set(''); this.syncMsg.set(''); this.syncPass = ''; this.restoreCode = ''; this.restorePass = ''; }
  regenCode() { this.newCode.set(generateSyncCode()); }

  async activateSyncNow() {
    this.syncBusy.set(true);
    this.syncMsg.set('');
    try {
      await activateSync(this.newCode(), this.syncPass);
      this.refreshSyncInfo();
      this.closeSyncPanel();
      this.toast.toast('Sync is on — your library is on the cloud locker ✓');
    } catch (err: any) {
      this.syncMsg.set(String(err?.message || 'Sync failed'));
    } finally {
      this.syncBusy.set(false);
    }
  }

  async syncNow() {
    const info = this.syncInfo();
    this.syncBusy.set(true);
    this.syncMsg.set('');
    try {
      await pushSync({ code: info.code, passphrase: getSyncInfo().passphrase });
      this.refreshSyncInfo();
      this.toast.toast('Library pushed to the cloud locker ✓');
    } catch (err: any) {
      this.syncMsg.set(String(err?.message || 'Sync failed'));
    } finally {
      this.syncBusy.set(false);
    }
  }

  async restoreFromSync() {
    // The restore panel supplies code + password; the "Restore from cloud"
    // button in the sync-on state falls back to this device's saved pair.
    const stored = getSyncInfo();
    const code = normalizeSyncCode(this.restoreCode) || stored.code;
    const pass = this.restorePass || stored.passphrase;
    this.syncBusy.set(true);
    this.syncMsg.set('');
    try {
      const out = await pullSync(code, pass);
      this.refreshSyncInfo();
      this.closeSyncPanel();
      this.docCount = (await listDocs()).length;
      this.toast.toast(`Restored — ${out.docs ?? '?'} documents merged ✓`);
    } catch (err: any) {
      const msg = String(err?.message || 'Restore failed');
      this.syncMsg.set(msg);
      // syncMsg isn't rendered while sync is on — make the failure visible
      this.toast.toast(msg, true);
    } finally {
      this.syncBusy.set(false);
    }
  }

  async turnOffSyncAsk() {
    if (!await this.confirm.confirm('Turn off sync on this device?', 'The cloud locker keeps its last snapshot until it expires — this only stops this device from pushing.', 'Turn off')) return;
    turnOffSync();
    this.refreshSyncInfo();
    this.toast.toast('Sync turned off on this device');
  }

  // ── Change sync password (kill switch: old password stops working) ──
  syncPassPanel = signal(false);
  syncOldPass = '';
  syncNewPass = '';
  syncNewPass2 = '';

  openSyncPassPanel() {
    this.syncOldPass = '';
    this.syncNewPass = '';
    this.syncNewPass2 = '';
    this.syncMsg.set('');
    this.syncPassPanel.set(true);
  }
  closeSyncPassPanel() {
    this.syncPassPanel.set(false);
    this.syncOldPass = '';
    this.syncNewPass = '';
    this.syncNewPass2 = '';
  }

  async submitSyncPassword() {
    this.syncBusy.set(true);
    this.syncMsg.set('');
    try {
      await changeSyncPassword(this.syncOldPass, this.syncNewPass);
      this.closeSyncPassPanel();
      this.toast.toast('Password changed — the old one no longer opens the cloud copy ✓');
    } catch (err: any) {
      this.syncMsg.set(String(err?.message || 'Password change failed'));
    } finally {
      this.syncBusy.set(false);
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
    this.renderKeyStatus();
    this.refreshSyncInfo();
    this.ngOnInitSyncRestore();
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

  private renderKeyStatus(msg?: string) {
    this.keyStatus.set(msg || (hasRelay()
      ? `Built-in relay ready${getApiKey() ? ' · personal backup key saved' : ''}.`
      : getApiKey()
        ? 'No relay configured — using your personal key.'
        : 'No relay and no key — quizzes still work with built-in rules.'));
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

  saveKey() {
    const val = this.keyInput.trim();
    if (!val) { this.renderKeyStatus('Paste a key first — tap a provider link above to get one free.'); return; }
    setApiKey(val);
    this.keyInput = '';
    this.byok.notifyAiOk();
    this.renderKeyStatus('Key saved ✓ — AI now uses your key first');
    this.toast.toast('Personal backup key saved ✓');
  }
  removeKey() {
    setApiKey('');
    this.renderKeyStatus('Personal key removed — the built-in relay handles AI.');
    this.toast.toast('Personal key removed');
  }
  async testKey() {
    this.testing = true;
    this.renderKeyStatus('Testing…');
    const res = await testApiKey();
    this.testing = false;
    this.renderKeyStatus(res.ok
      ? `✓ ${res.provider || 'AI'} reachable — model ${res.model}`
      : res.message === 'no_key' || res.message === 'No key'
        ? 'Save your key first — pick a provider above and paste its key'
        : `✗ ${res.message}`);
    if (res.ok) { this.byok.notifyAiOk(); this.toast.toast(`${res.provider || 'AI'} OK ✓`); }
  }
  // the select shares state with the BYOK modal (byok.provider); switching
  // drops any model/base-URL override so the new provider's default applies
  setProvider(id: string) {
    if (id === this.byok.provider()) return;
    this.byok.chooseProvider(id);
    setAiConfig({ provider: id, model: '', baseUrl: '' });
    this.toast.toast(`Key provider: ${this.byok.providerConfig.label}`);
  }
  keyPlaceholder() { return `Paste your ${this.byok.providerConfig.label} API key`; }
  modelLabel() { return activeModel() || 'provider default'; }

  setSkipIntro(on: boolean) { saveSettings({ skipIntro: on }); this.refreshSettings(); this.toast.toast(on ? 'Intro will be skipped' : 'Intro plays on launch'); }


  goBack() {
    // Settings can be opened from any screen's header, so return to where the
    // teacher came from instead of always dumping them on Classes.
    if (history.length > 1) this.location.back();
    else this.router.navigateByUrl('/tabs/classes');
  }

  switchAccount() {
    setActiveAccount(null);
    this.ui.account.set(null);
    this.router.navigate(['/accounts', { mode: 'picker' }]);
  }
  addAccount() { this.router.navigate(['/accounts'], { queryParams: { mode: 'create', from: 'picker' } }); }

  otherAccounts() {
    return this.accounts.filter(a => a.id !== this.account?.id);
  }

  openRemoveAccount() {
    if (this.otherAccounts().length) this.removePickerOpen.set(true);
  }

  async confirmRemoveAccount(target: any) {
    this.removePickerOpen.set(false);
    if (!await this.confirm.confirm('Delete profile?', 'All documents, quizzes, history, and mistakes for this profile will be permanently removed.', 'Delete', target.name)) return;
    await deleteAccount(target.id);
    this.toast.toast(`Removed ${target.name}`);
    await this.renderAccountSection();
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

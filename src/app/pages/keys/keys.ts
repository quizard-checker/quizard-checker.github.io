import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listKeys, saveKey, deleteKey } from '../../core/engine/storage.js';
import { parseKeyText } from '../../core/engine/answerkey.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { fmtDate } from '../../shared/helpers.js';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ByokService } from '../../core/services/byok.service';

// The label a key card prints for each of the parser's five shapes.
const FORMAT_LABELS: Record<string, string> = {
  qa: 'questions + answers',
  answers: 'answers only',
  letters: 'letter key',
  keyed: 'answers with letters',
  mcq: 'example questions',
};

@Component({
  selector: 'app-keys',
  imports: [IonContent, IcoPipe],
  templateUrl: './keys.html',
})
export class KeysPage {
  router = inject(Router);
  ui = inject(UiStateService);
  readonly byok = inject(ByokService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  keys = signal<any[]>([]);
  sheetOpen = signal(false);
  editingId = signal<string | null>(null);
  readonly editingKey = computed(() => this.keys().find(k => k.id === this.editingId()) || null);

  subject = signal('');
  title = signal('');
  paste = signal('');

  readonly preview = computed(() => parseKeyText(this.paste()));
  readonly previewCount = computed(() => this.preview().items.length);
  readonly previewWithQuestions = computed(() => this.preview().items.filter(i => i.question).length);
  readonly dateOf = fmtDate;

  // The parser emits five shapes, so the card names all of them instead of
  // leaving 'keyed' and 'mcq' keys with a meta line and no format.
  readonly formatLabel = (key: any): string =>
    FORMAT_LABELS[key?.format] || 'answer key';

  // The card's hero is the key itself, rendered as a mini answer sheet: one
  // numbered tile per item, the way the printed key row reads. Letter answers
  // stay square; word answers get a wider tile that truncates. Twenty tiles
  // cap the strip — anything longer shows a +N tail instead of growing forever.
  readonly stripCap = 20;
  readonly stripOf = (key: any): { n: number; tag: string; full: string }[] =>
    (key?.items || []).slice(0, this.stripCap).map((it: any, i: number) => {
      const full = this.answerOf(it);
      return { n: i + 1, tag: full.length > 6 ? full.slice(0, 5) + '…' : full, full };
    });

  // The answer an item carries, whichever field the parser chose.
  readonly answerOf = (it: any): string =>
    String(it?.answer || it?.answerLetter || 'ABCD'[it?.answerIndex] || '—');

  // Keys saved before the "Answer: A. <text>" parser fix kept their questions
  // but lost the correct letters — flag them so they can be re-pasted once.
  readonly needsAnswers = (key: any): boolean =>
    (key?.items || []).some((it: any) => (it.options?.length >= 2) && !(it.answerIndex >= 0));

  // ── View sheet: read the whole key without touching the edit form ──
  viewOpen = signal(false);
  viewKey = signal<any>(null);

  openView(key: any) { this.viewKey.set(key); this.viewOpen.set(true); }
  closeView() { this.viewOpen.set(false); }
  editFromView() {
    const k = this.viewKey();
    this.closeView();
    if (k) this.openSheet(k);
  }

  // Rebuild editable text from a saved key so the edit sheet shows what is in
  // it instead of an empty box: one `n. Q → A` line per item, or the letter
  // string when every item is a plain letter.
  readonly keyToText = (key: any): string => {
    const items = key?.items || [];
    if (key?.format === 'letters') {
      const letters = items.map((it: any) => this.answerOf(it)).join('');
      if (/^[A-Da-d]+$/.test(letters)) return letters;
    }
    return items.map((it: any, i: number) => {
      const ans = this.answerOf(it);
      return it.question ? `${i + 1}. ${it.question} → ${ans}` : `${i + 1}. ${ans}`;
    }).join('\n');
  };

  readonly overflowOf = (key: any): number =>
    Math.max(0, (key?.items?.length || 0) - this.stripCap);

  // Straight into the Create tab with this key already picked.
  buildQuiz(key: any) {
    this.router.navigateByUrl(`/tabs/create?key=${encodeURIComponent(key.id)}`);
  }

  async ionViewWillEnter() { await this.load(); }
  ngOnInit() { this.ionViewWillEnter(); }

  async load() {
    this.keys.set(await listKeys());
  }

  openSheet(key: any = null) {
    this.editingId.set(key?.id || null);
    this.subject.set(key?.subject || '');
    this.title.set(key?.title || '');
    // Editing now starts from the key's own text, not a blank box — a title
    // tweak no longer demands re-pasting everything, and Save stays enabled.
    this.paste.set(key ? this.keyToText(key) : '');
    this.sheetOpen.set(true);
  }

  closeSheet() { this.sheetOpen.set(false); }
  setPaste(value: string) { this.paste.set(value); }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    this.paste.set(this.paste() ? this.paste() + '\n' + text : text);
    input.value = '';
    this.toast.toast(`Loaded ${file.name}`);
  }

  async saveSheet() {
    const subject = this.subject().trim();
    if (!subject || !this.previewCount()) return;
    const parsed = this.preview();
    await saveKey({
      id: this.editingId() || undefined,
      subject,
      title: this.title().trim(),
      format: parsed.format as 'qa' | 'answers' | 'letters',
      items: parsed.items,
    });
    this.sheetOpen.set(false);
    await this.load();
    const detail = parsed.format === 'qa' ? `${parsed.items.length} items (${this.previewWithQuestions()} with questions)`
      : parsed.format === 'letters' ? `${parsed.items.length} letter answers`
      : `${parsed.items.length} answers`;
    this.toast.toast(`Key saved — ${detail}`);
  }

  async remove(key: any) {
    if (!await this.confirm.confirm(`Delete the ${key.subject} key?`, 'Scanned results already saved are kept.', 'Delete')) return;
    await deleteKey(key.id);
    await this.load();
    this.toast.toast('Key deleted', false, {
      text: 'Undo',
      handler: async () => {
        await saveKey(key);
        await this.load();
        this.toast.toast('Key restored');
      }
    });
  }
}

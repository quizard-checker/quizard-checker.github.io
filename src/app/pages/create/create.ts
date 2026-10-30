import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { extractText } from '../../core/engine/extract/index.js';
import { parseKeyText } from '../../core/engine/answerkey.js';
import { generateTeacherQuiz, MAX_ITEMS } from '../../core/engine/teacher-quiz.js';
import { listClasses, listKeys, listQuizzes, listSheets, saveQuiz, getQuiz } from '../../core/engine/storage.js';
import { fmtDate, bannerTheme } from '../../shared/helpers.js';
import { DOCS_URL } from '../../shared/docs-url';
import { buildBubbleSheetsPdf } from '../../core/engine/export.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ByokService } from '../../core/services/byok.service';

const MODES = [
  { id: 'key', label: 'Anchor to my key', hint: 'You have the answers — the quiz follows your key exactly', io: 'answer key → quiz' },
  { id: 'ai', label: 'Full AI', hint: 'You have just a lesson — AI writes everything', io: 'lesson → full quiz' },
  { id: 'format', label: 'Match my format', hint: 'You have sample questions — AI writes new ones in the same style', io: 'examples → new questions' },
];

@Component({
  selector: 'app-create',
  imports: [IonContent, IcoPipe, NgTemplateOutlet],
  templateUrl: './create.html',
})
export class CreatePage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  ui = inject(UiStateService);
  readonly byok = inject(ByokService);
  private toast = inject(ToastService);

  // Android WebView has no download manager for blob URLs, so the native build
  // hands the PDF to the system share sheet instead of a browser download.
  readonly native = Capacitor.isNativePlatform();

  readonly modes = MODES;
  readonly maxItems = MAX_ITEMS;
  readonly dateOf = fmtDate;
  // Library cards wear the same hashed gradients as classes/keys, so a
  // subject-colored tile reads consistently across the app.
  readonly bannerTheme = bannerTheme;
  readonly letters = ['A', 'B', 'C', 'D'];
  readonly docsUrl = DOCS_URL;

  stage = signal<'home' | 'setup' | 'review' | 'export'>('home');

  // ── guided wizard rail (Setup → Review → Save) ───────────────────────────
  // Export doubles as "saved quiz detail" when opened from the home list, so
  // the rail only tracks whether it was reached by actually saving.
  wizardExport = signal(false);
  wizSteps = ['Setup', 'Review', 'Save'];
  wizStep = computed(() => (this.stage() === 'setup' ? 0 : this.stage() === 'review' ? 1 : 2));
  goStep(i: number) {
    if (i >= this.wizStep()) return; // only completed steps are clickable
    // editing a SAVED quiz: "back" means its export page, not a blank wizard
    if (i === 0) {
      if (this.editingSource) { this.stage.set('export'); return; }
      this.backToSetup();
    }
    else this.stage.set('review');
  }
  homeQuizzes = signal<any[]>([]);
  // Scanned-paper rows, so a quiz card can show how many papers were graded
  // against it — the "is this quiz live yet" indicator on the home board.
  sheets = signal<any[]>([]);
  gradedOf = (q: any): number => this.sheets().filter(s => s.quizId === q.id).length;
  selectedQuiz = signal<any>(null);
  mode = signal<'ai' | 'key' | 'format'>('key');
  subject = signal('');
  title = signal('');
  count = signal(20);
  fileText = signal('');
  fileName = signal('');
  lessonPaste = signal('');
  keyPaste = signal('');
  pickedKeyId = signal<string | null>(null);
  keyPickOpen = signal(false);
  savedKeys = signal<any[]>([]);
  generating = signal(false);
  error = signal('');

  items = signal<any[]>([]);
  quizId = signal<string | null>(null);

  readonly keyPreview = computed(() => this.keyPaste().trim() ? parseKeyText(this.keyPaste()) : null);
  readonly keyStats = computed(() => {
    const p = this.keyPreview();
    if (!p?.items?.length) return null;
    return {
      count: p.items.length,
      format: p.format as string,
      notes: p.notes.length,
      complete: p.items.filter((i: any) => i.answerIndex >= 0).length,
    };
  });
  readonly lessonText = computed(() => this.fileText() || this.lessonPaste().trim());
  readonly pickedKey = computed(() => this.savedKeys().find(k => k.id === this.pickedKeyId()) || null);
  readonly keySource = computed(() => this.pickedKey() ?? (this.keyPaste().trim() ? this.keyPreview() : null));
  // A key saved before the "Answer: A. <text>" parser fix carries questions
  // and options but no correct letters — building from it would be wrong.
  readonly keyHasMissingAnswers = computed(() => {
    const src: any = this.keySource();
    return this.mode() === 'key' && !!src?.items?.length &&
      src.items.some((it: any) => (it.options?.length >= 2) && !(it.answerIndex >= 0));
  });
  readonly mcqExamples = computed(() => {
    const src: any = this.keySource();
    return src?.format === 'mcq' ? src.items : [];
  });
  readonly canGenerate = computed(() => {
    if (this.generating()) return false;
    if (!this.subject().trim()) return false;
    if (this.mode() !== 'key' && !this.lessonText()) return false;
    if (this.mode() === 'key') return !!this.keySource() && !!this.keySource().items.length;
    if (this.mode() === 'format') return this.mcqExamples().length > 0;
    return true;
  });
  // The disabled Generate button used to be a dead end. Spell out what is
  // still missing so the teacher knows exactly which field to fill.
  readonly generateNeeds = computed(() => {
    const needs: string[] = [];
    if (!this.subject().trim()) needs.push('a subject');
    if (this.mode() === 'key') {
      if (!this.keySource()?.items?.length) needs.push('an answer key or a saved key');
    } else {
      if (!this.lessonText()) needs.push('lesson text or an uploaded file');
      if (this.mode() === 'format' && !this.mcqExamples().length) {
        needs.push('example questions with a * on the correct option');
      }
    }
    return needs;
  });
  readonly generateNeedText = computed(() => {
    const needs = this.generateNeeds();
    if (!needs.length) return '';
    if (needs.length === 1) return needs[0];
    return needs.slice(0, -1).join(', ') + ' and ' + needs[needs.length - 1];
  });
  // letters-only key: every item is an empty scoring grid row (the teacher's
  // own paper carries the questions). Those rows can now be filled in from the
  // review screen; the quiz paper unlocks once EVERY row is complete.
  readonly keyOnly = computed(() =>
    this.items().length > 0 && this.items().every(it => !String(it.question || '').trim()));

  readonly hasQuestions = computed(() =>
    this.items().length > 0 && this.items().every(it =>
      String(it.question || '').trim() && it.options.every((o: string) => String(o || '').trim())));

  // same check for a SAVED quiz (export stage, opened from the quizzes board)
  hasQuestionsIn(q: any): boolean {
    return !!q?.items?.length && q.items.every((it: any) =>
      String(it.question || '').trim() && it.options.every((o: string) => String(o || '').trim()));
  }

  // key mode saves with letters alone (question fields are optional), every
  // other mode needs the full question written
  readonly itemsValid = computed(() => this.items().length && this.items().every(it =>
    it.answerIndex >= 0 && (this.mode() === 'key' || (it.question.trim() && it.options.every((o: string) => o.trim())))));

  classList = signal<any[]>([]);

  // subjects the teacher actually uses on classes — quick-fill chips in setup
  readonly knownSubjects = computed(() =>
    [...new Set(this.classList().map(c => c.subject).filter(Boolean))]);

  // Setup sections renumber by mode: Full AI has no key step at all, so static
  // 1..5 numbers kept dead steps between live ones — the main reason the form
  // read as a confusing wall. Key/example is always section 2 (rendered only in
  // key/format modes); material and details shift around it.
  readonly stepMaterial = computed(() => this.mode() === 'ai' ? 2 : 3);
  // key mode has no lesson step: 1 mode, 2 key, 3 details
  readonly stepDetails = computed(() => this.mode() === 'format' ? 4 : 3);

  async ionViewWillEnter() {
    this.classList.set(await listClasses());
    this.applyKeyParam();
    if (this.stage() === 'home') {
      const [quizzes, sheets] = await Promise.all([listQuizzes(), listSheets()]);
      this.homeQuizzes.set(quizzes);
      this.sheets.set(sheets);
    }
    if (this.stage() === 'setup') {
      this.savedKeys.set(await listKeys());
      // prefill the subject: from the key we arrived with, else from the classes
      if (!this.subject().trim()) {
        const fromKey = this.pickedKey()?.subject;
        const fromClass = this.classList().find(c => c.subject)?.subject;
        const subj = fromKey || fromClass;
        if (subj) this.subject.set(subj);
      }
    }
  }

  // Arriving from the Keys tab's "Build a quiz" button: open the setup form in
  // key mode with that key already picked, so the teacher lands on a filled-in
  // form instead of an empty one. The query param is dropped straight after, so
  // coming back to this tab doesn't drag them into key mode again.
  private applyKeyParam() {
    const id = this.route.snapshot.queryParamMap.get('key');
    if (!id) return;
    this.stage.set('setup');
    this.pickedKeyId.set(id);
    this.mode.set('key');
    this.keyPaste.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  setMode(id: any) {
    // Switching modes switches the paste box's meaning — a picked saved key is
    // an *anchor*, meaningless once you leave key mode.
    if (id !== 'key') this.pickedKeyId.set(null);
    this.mode.set(id);
  }

  pickKey(id: string | null) {
    this.pickedKeyId.set(id);
    this.keyPaste.set('');
    this.keyPickOpen.set(false);
  }
  // Buttons step by 5 and typing accepts anything 1–50; junk (empty, 0,
  // negative) simply keeps the current count instead of snapping to a default.
  setCount(v: any) {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n > 0) this.count.set(Math.min(MAX_ITEMS, n));
  }

  // −/+ stepper: floors at 1 so the button can step down to single digits.
  nudgeCount(d: number) { this.setCount(Math.max(1, this.count() + d)); }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.extracting.set(true);
    try {
      const { text } = await extractText(file);
      this.fileText.set(text);
      this.fileName.set(file.name);
      this.toast.toast(`${file.name} ready — ${Math.round(text.length / 100) / 10}k characters extracted`);
    } catch (e: any) {
      this.toast.toast(e?.message || 'Could not read that file', true);
    }
    this.extracting.set(false);
    input.value = '';
  }
  extracting = signal(false);

  clearFile() { this.fileText.set(''); this.fileName.set(''); }

  async generate() {
    if (!this.canGenerate()) return;
    if (this.mode() === 'key' && this.keyHasMissingAnswers()) {
      this.error.set('This saved key has no correct answers (it was saved before the answer lines were understood) — open it in Keys, paste the key again and save, then build the quiz.');
      return;
    }
    this.generating.set(true);
    this.error.set('');
    try {
      const mode = this.mode();
      let keyItems: any[] = [];
      let examples: any[] = [];
      if (mode === 'key') keyItems = this.keySource()?.items || [];
      if (mode === 'format') {
        examples = this.mcqExamples();
        keyItems = examples; // entries with options are used verbatim too
      }
      const items = await generateTeacherQuiz({
        mode, text: this.lessonText(), keyItems, examples,
        // key mode is locked to the key: one question per entry, exactly —
        // the teacher cannot request more or fewer than they uploaded
        count: mode === 'key' ? (keyItems.length || this.count()) : this.count(),
        subject: this.subject().trim(),
      });
      this.items.set(items.map((it: any, i: number) => ({ ...it, n: i + 1 })));
      this.stage.set('review');
    } catch (e: any) {
      this.error.set(e?.message || 'Generation failed. Check your connection or AI key and try again.');
    }
    this.generating.set(false);
  }

  editQ(i: number, v: string) {
    const next = [...this.items()];
    next[i] = { ...next[i], question: v };
    this.items.set(next);
  }
  setOpt(i: number, oi: number, v: string) {
    const next = [...this.items()];
    const options = [...next[i].options];
    options[oi] = v;
    next[i] = { ...next[i], options };
    this.items.set(next);
  }
  setAnswer(i: number, oi: number) {
    const next = [...this.items()];
    next[i] = { ...next[i], answerIndex: oi };
    this.items.set(next);
  }
  removeItem(i: number) {
    const next = this.items().filter((_, k) => k !== i).map((it, k) => ({ ...it, n: k + 1 }));
    this.items.set(next);
  }
  addItem() {
    this.items.set([...this.items(), { n: this.items().length + 1, question: '', options: ['', '', '', ''], answerIndex: 0 }]);
  }

  async save() {
    if (!this.itemsValid()) return;
    // An id means we're editing a saved quiz (from its detail page) — update
    // that same record instead of stacking a duplicate.
    const editing = !!this.quizId();
    const quiz = await saveQuiz({
      id: this.quizId() || undefined,
      subject: this.subject().trim(),
      title: this.title().trim(),
      source: this.editingSource || this.mode(),
      keyOnly: this.keyOnly(),
      items: this.items(),
    });
    this.editingSource = null;
    this.quizId.set(quiz.id);
    this.selectedQuiz.set(quiz);
    this.wizardExport.set(!editing);
    this.stage.set('export');
    this.toast.toast(editing ? 'Changes saved ✓' : 'Quiz saved ✓ — printable copies are ready');
  }

  // ── preview → download flow ──
  previewOpen = signal(false);
  previewBusy = signal(false);
  previewPages = signal(1);
  previewLabel = signal('');
  previewDoc: any = null;
  previewFilename = '';

  readonly sourceLabel = (q: any): string =>
    ({ ai: 'AI written', key: 'from your key', format: 'from your examples' } as Record<string, string>)[q?.source] || 'saved quiz';

  async openSaved(id: string) {
    const quiz = await getQuiz(id);
    if (!quiz) return;
    this.keyPickOpen.set(false);
    this.selectedQuiz.set(quiz);
    this.sheets.set(await listSheets());
    this.wizardExport.set(false);
    this.stage.set('export');
  }

  // Per-number key strip for the detail page: the LETTER the scanner marks,
  // with the answer text as the hover title.
  readonly keyStripOf = (q: any): { n: number; a: string; full: string }[] =>
    (q?.items || []).map((it: any, i: number) => ({
      n: i + 1,
      a: this.letters[it.answerIndex] || '—',
      full: it.options?.[it.answerIndex] || '',
    }));

  // The source a saved quiz was built with — editSaved() pins it so Save
  // doesn't overwrite the quiz's own provenance with the wizard's default.
  editingSource: 'ai' | 'key' | 'format' | null = null;

  // Edit a saved quiz in place: the review editor opens with the quiz's own
  // items, and Save updates the same record — the quiz owns its key.
  editSaved() {
    const q = this.selectedQuiz();
    if (!q) return;
    this.quizId.set(q.id);
    this.editingSource = q.source || null;
    this.subject.set(q.subject || '');
    this.title.set(q.title || '');
    this.items.set((q.items || []).map((it: any) => ({ ...it })));
    this.stage.set('review');
  }

  scanSaved() {
    const q = this.selectedQuiz();
    if (q) this.router.navigateByUrl(`/tabs/checking?quiz=${q.id}`);
  }

  resultsSaved() {
    const q = this.selectedQuiz();
    if (q) this.router.navigateByUrl(`/tabs/reports?quiz=${q.id}`);
  }

  backHome() {
    this.keyPickOpen.set(false);
    this.stage.set('home');
    this.selectedQuiz.set(null);
    this.quizId.set(null);
    void this.ionViewWillEnter();
  }

  startNewQuiz() {
    this.keyPickOpen.set(false);
    this.stage.set('setup');
    this.items.set([]);
    this.quizId.set(null);
    this.selectedQuiz.set(null);
    this.editingSource = null;
    this.mode.set('key');
    this.subject.set(''); this.title.set(''); this.fileText.set(''); this.fileName.set('');
    this.lessonPaste.set(''); this.keyPaste.set(''); this.pickedKeyId.set(null);
    this.error.set('');
    this.savedKeys.set([]);
    void this.ionViewWillEnter();
  }

  async printSheets() {
    let quiz = this.selectedQuiz();
    if (!quiz) {
      const id = this.quizId();
      quiz = id ? await getQuiz(id) : null;
    }
    if (!quiz) return;
    this.previewBusy.set(true);
    try {
      // Sheets print exactly the chosen class's roster — one page per student,
      // nothing blank and nothing spare. A class is required because the QR on
      // each sheet is what tells the scanner whose paper it is.
      const cls = this.sheetClass();
      if (!cls?.students?.length) {
        this.toast.toast('Pick a class first — sheets print only that class’s students.');
        this.previewBusy.set(false);
        return;
      }
      this.previewDoc = await buildBubbleSheetsPdf(quiz, cls.students, this.paper());
      this.previewFilename = `quizard-bubble-sheets-${slugify(quiz.subject || quiz.title)}-${slugify(cls.name)}`;
      this.previewLabel.set(`Bubble answer sheets — ${cls.name}`);
      // a new document always starts at sheet 1, and the cached pdfjs doc
      // belongs to the old one
      this.previewPdfDoc = null;
      this.previewPage.set(1);
      this.previewOpen.set(true);
      // The dim overlay sits behind the status bar; light system icons stay
      // readable against it (the app theme's own style is restored on close).
      void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      this.previewBusy.set(false); // the canvas mounts in the non-busy branch
      await this.renderPreview();
    } catch (e: any) {
      this.toast.toast(e?.message || 'Could not build the PDF', true);
      this.previewBusy.set(false);
    }
  }

  private async renderPreview() {
    // wait for the modal's canvas to mount (zoneless re-render)
    let canvas: HTMLCanvasElement | null = null;
    for (let i = 0; i < 25 && !canvas; i++) {
      canvas = document.querySelector('canvas.preview-canvas') as HTMLCanvasElement | null;
      if (!canvas) await new Promise(r => setTimeout(r, 80));
    }
    if (!canvas || !this.previewDoc) return;
    try {
      const pdfjs: any = await import('pdfjs-dist');
      // same worker setup as the import pipeline: absolute URL so both the
      // real worker and the fake-worker fallback resolve, and the service
      // worker can serve the precached file offline
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
      const buf = this.previewDoc.output('arraybuffer');
      // the parsed document is kept across page turns: a 40-student roster
      // shouldn't re-parse the whole PDF every time the teacher pages through
      this.previewPdfDoc = this.previewPdfDoc || await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
      const pdf = this.previewPdfDoc;
      this.previewPages.set(pdf.numPages);
      const page = Math.min(Math.max(1, this.previewPage()), pdf.numPages);
      const pdfPage = await pdf.getPage(page);
      // Render at the canvas's true display size × devicePixelRatio: a plain
      // 340px bitmap gets upscaled by CSS on HiDPI screens and looks blurry.
      const wrap = canvas.parentElement;
      const pad = 20; // .preview-canvas-wrap side padding
      const cssW = Math.max(240, Math.min(440, ((wrap?.clientWidth ?? 360) - pad)));
      const dpr = Math.max(1.5, Math.min(window.devicePixelRatio || 1, 3));
      const scale = (cssW * dpr) / pdfPage.getViewport({ scale: 1 }).width;
      const vp = pdfPage.getViewport({ scale });
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      // the bitmap is dpr× the CSS size — pin the CSS size so the browser
      // downsamples instead of stretching
      canvas.style.width = cssW + 'px';
      canvas.style.height = 'auto';
      await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    } catch (e: any) {
      this.toast.toast('Preview failed — you can still download the PDF', true);
    }
  }

  // Roster previews hold one sheet per student, so the pager is how the
  // teacher verifies every name before printing 40 pages.
  previewPage = signal(1);
  private previewPdfDoc: any = null;

  async previewPrev() {
    if (this.previewPage() <= 1 || !this.previewDoc) return;
    this.previewPage.set(this.previewPage() - 1);
    await this.renderPreview();
  }

  async previewNext() {
    if (!this.previewDoc || this.previewPage() >= this.previewPages()) return;
    this.previewPage.set(this.previewPage() + 1);
    await this.renderPreview();
  }

  async downloadPreview() {
    if (!this.previewDoc) return;
    const filename = `${this.previewFilename}.pdf`;
    const n = this.previewPages();
    if (!this.native) {
      this.previewDoc.save(filename);
      this.toast.toast(n > 1 ? `PDF downloaded — all ${n} sheets ✓` : 'PDF downloaded ✓');
      return;
    }
    // In the Android app the WebView cannot download a blob. Write the whole
    // multi-page PDF to the app cache and open the system share sheet, where
    // the teacher can save it to Files or send it to a printer.
    try {
      const dataUri = this.previewDoc.output('datauristring') as string;
      const data = dataUri.slice(dataUri.indexOf(',') + 1);
      const file = await Filesystem.writeFile({
        path: filename,
        data,
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({
        title: 'Bubble answer sheets',
        text: n > 1 ? `${n} sheets — one per student` : filename,
        files: [file.uri],
        dialogTitle: 'Save or print the PDF',
      });
    } catch (e: any) {
      this.toast.toast('Could not create the PDF' + (e?.message ? ' — ' + e.message : ''), true);
    }
  }

  closePreview() {
    this.previewOpen.set(false);
    this.previewDoc = null;
    this.previewPdfDoc = null;
    this.previewPage.set(1);
    const style = this.ui.theme() === 'dark' ? Style.Dark : Style.Light;
    void StatusBar.setStyle({ style }).catch(() => {});
  }

  // Leaving the tab with the overlay open would also leave the status-bar
  // icons in their light-on-dark variant over a light page.
  ionViewWillLeave() {
    if (this.previewOpen()) this.closePreview();
  }

  paper = signal<'letter' | 'a4' | 'long'>('letter');
  setPaper(p: any) { this.paper.set(p); }

  // Sheets print for exactly one class: one page per student on its roster,
  // each with that student's name in the QR and on the header.
  sheetClassId = signal<string | null>(null);
  setSheetClassId(id: any) { this.sheetClassId.set(id || null); }
  readonly sheetClass = computed(() =>
    this.classList().find(c => c.id === this.sheetClassId()) || null);

  backToSetup() {
    this.keyPickOpen.set(false);
    this.stage.set('setup');
    this.items.set([]);
    this.quizId.set(null);
    this.savedKeys.set([]);
    void this.ionViewWillEnter();
  }

  // Back from the Review screen: when it was opened through "Edit key" on a
  // saved quiz, return to that quiz's export page instead of a blank setup.
  backFromReview() {
    if (this.editingSource) { this.stage.set('export'); return; }
    this.backToSetup();
  }
}

function slugify(v: any) {
  return String(v || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'doc'
}

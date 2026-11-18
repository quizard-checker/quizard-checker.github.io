import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { parseKeyText } from '../../core/engine/answerkey.js';
import { validateKey } from '../../core/engine/key-validate.js';
import { xlsxToRows, parseCsv, rowsToKeyText } from '../../core/engine/keysheet.js';
import { generateTeacherQuiz, MAX_ITEMS } from '../../core/engine/teacher-quiz.js';
import { normalizeQuizItems } from '../../core/engine/quiz-items.js';
import { listClasses, listKeys, listQuizzes, listSheets, saveQuiz, getQuiz, duplicateQuiz, saveClass } from '../../core/engine/storage.js';
import { bannerTheme } from '../../shared/helpers.js';
import { buildPinSheetsPdf } from '../../core/engine/export.js';
import { quizTitle, quizClassLabel, resolveQuizClass } from '../../core/engine/quiz-classes.js';
import { generatePins } from '../../core/engine/roster.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { GuideService } from '../../core/services/guide.service';

@Component({
  selector: 'app-create',
  imports: [IonContent, IcoPipe],
  templateUrl: './create.html',
})
export class CreatePage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  readonly guide = inject(GuideService);

  // Android WebView has no download manager for blob URLs, so the native build
  // hands the PDF to the system share sheet instead of a browser download.
  readonly native = Capacitor.isNativePlatform();

  readonly maxItems = MAX_ITEMS;
  // Library cards wear the same hashed gradients as classes/keys, so a
  // subject-colored tile reads consistently across the app.
  readonly bannerTheme = bannerTheme;
  readonly letters = ['A', 'B', 'C', 'D'];

  stage = signal<'setup' | 'review' | 'export'>('setup');

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
  // Scanned-paper rows, so a quiz card can show how many papers were graded
  // against it — the "is this quiz live yet" indicator on the home board.
  sheets = signal<any[]>([]);
  gradedOf = (q: any): number => this.sheets().filter(s => s.quizId === q.id).length;
  selectedQuiz = signal<any>(null);
  subject = signal('');
  title = signal('');
  keyPaste = signal('');
  keyMode = signal<'mcq' | 'letters' | 'answers'>('mcq');
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
  readonly keyCheck = computed(() =>
    validateKey(this.keyPreview(), this.keyMode(), this.keyPaste()));
  readonly keyPlaceholder = computed(() => {
    if (this.keyMode() === 'letters') return 'Paste the answer letters only — for example 1.B 2.C 3.A.';
    if (this.keyMode() === 'answers') {
      return 'Paste numbered answers, one per line:\n1. Photosynthesis\n2. Water and air\n\nOr: 1. What do plants use for food? → Photosynthesis';
    }
    return '1. What do plants use for food?\nA. Sunlight\nB. Water and air\nC. Soil\nD. Rocks\nAnswer: B';
  });
  readonly pickedKey = computed(() => this.savedKeys().find(k => k.id === this.pickedKeyId()) || null);
  readonly keySource = computed(() => this.pickedKey() ?? (this.keyPaste().trim() ? this.keyPreview() : null));
  // A key saved before the "Answer: A. <text>" parser fix carries questions
  // and options but no correct letters — building from it would be wrong.
  readonly keyHasMissingAnswers = computed(() => {
    const src: any = this.keySource();
    return !!src?.items?.length &&
      src.items.some((it: any) => (it.options?.length >= 2) && !(it.answerIndex >= 0));
  });
  readonly canGenerate = computed(() => {
    if (this.generating()) return false;
    if (!this.quizClassId()) return false;
    if (!this.pickedKeyId() && this.keyPaste().trim() && !this.keyCheck().ok) return false;
    return !!this.keySource() && !!this.keySource().items.length;
  });
  // The disabled Generate button used to be a dead end. Spell out what is
  // still missing so the teacher knows exactly which field to fill.
  readonly generateNeeds = computed(() => {
    const needs: string[] = [];
    if (!this.quizClassId()) needs.push('a class');
    if (!this.keySource()?.items?.length) needs.push('an answer key or a saved key');
    else if (!this.pickedKeyId() && this.keyPaste().trim() && !this.keyCheck().ok) needs.push('a valid answer key');
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
    it.answerIndex >= 0));

  classList = signal<any[]>([]);

  // A quiz belongs to one class now. `quizClassNameSnap` keeps the stored name
  // visible if that class was deleted; the live class wins when it still exists.
  quizClassId = signal<string | null>(null);
  quizClassNameSnap = signal('');
  classPickOpen = signal(false);
  readonly quizClass = computed(() => {
    const id = this.quizClassId();
    if (!id) return null;
    return resolveQuizClass({ classId: id, className: this.quizClassNameSnap() }, this.classList());
  });
  // New quizzes and printing always target a live (non-archived) class; archived
  // classes stay visible only where history is shown.
  readonly assignableClasses = computed(() => this.classList().filter(c => !c.archived));
  // The quiz's own class with its full roster (quizClass() is a lightweight
  // label object — printing needs the students).
  readonly quizFullClass = computed(() => {
    const id = this.quizClassId();
    return id ? this.classList().find(c => c.id === id) || null : null;
  });
  readonly quizTitle = quizTitle;
  readonly quizClassLabel = (q: any) => quizClassLabel(q, this.classList());
  readonly quizClassOf = (q: any) => resolveQuizClass(q, this.classList());

  pickClass(c: any) {
    if (!c) return;
    // The class already owns its subject, so the quiz inherits it instead of
    // asking the teacher to pick the same thing twice.
    const subject = String(c.subject || '').trim();
    this.subject.set(subject);
    if (!this.title().trim()) this.title.set(`${subject || c.name || 'Quiz'} quiz`);
    this.quizClassId.set(c.id);
    this.quizClassNameSnap.set(c.name || '');
    this.classPickOpen.set(false);
  }

  // Setup section numbering is static now: the key step is 1, details 2.
  // 1..5 numbers kept dead steps between live ones — the main reason the form
  // read as a confusing wall. Key/example is always section 2 (rendered only in
  // key/format modes); material and details shift around it.

  // Same-route query changes (/quiz?quiz=A → /quiz?quiz=B, e.g. the copy
  // toast's Open action) reuse this component, so ionViewWillEnter never runs
  // and the page would keep showing the first quiz. Follow ?quiz= here.
  private pageEntered = false;
  ngOnInit() {
    this.route.queryParamMap.subscribe(qp => {
      if (!this.pageEntered) return; // first arrival is handled on enter
      const id = qp.get('quiz');
      if (id && id !== this.selectedQuiz()?.id) void this.openSaved(id);
    });
  }

  async ionViewWillEnter() {
    this.pageEntered = true;
    this.classList.set(await listClasses());
    this.applyKeyParam();
    // Coming back from Scan papers should refresh the progress card (and the
    // quiz itself, in case its class was changed elsewhere).
    if (this.stage() === 'export' && !this.route.snapshot.queryParamMap.get('quiz')) {
      this.sheets.set(await listSheets());
      const id = this.selectedQuiz()?.id || this.quizId();
      if (id) {
        const fresh = await getQuiz(id);
        if (fresh) this.selectedQuiz.set(fresh);
      }
      return;
    }
    // Query entry points from Home: ?quiz=<id> opens a quiz; ?new=1&class=<id>
    // starts the wizard pre-assigned to that class.
    const qp = this.route.snapshot.queryParamMap;
    const quizId = qp.get('quiz');
    const classParam = qp.get('class');
    if (quizId) {
      await this.openSaved(quizId);
      return;
    }
    // Fresh wizard; stepping back from Review keeps the class and subject.
    this.stage.set('setup');
    if (!this.keyPickOpen()) {
      this.items.set([]);
    }
    this.editingSource = null;
    this.savedKeys.set(await listKeys());
    if (classParam) {
      const preset = this.classList().find(c => c.id === classParam);
      if (preset) this.pickClass(preset);
      if (this.assignableClasses().length === 1) this.pickClass(this.assignableClasses()[0]);
    } else if (!this.quizClassId() && this.assignableClasses().length === 1) {
      this.pickClass(this.assignableClasses()[0]);
    }
    if (!this.subject().trim() && this.quizClass()?.subject) this.subject.set(this.quizClass()?.subject || '');
    if (!this.title().trim() && this.subject().trim()) this.title.set(`${this.subject().trim()} quiz`);
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
    this.keyPaste.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  pickKey(id: string | null) {
    const key = id ? this.savedKeys().find(k => k.id === id) : null;
    this.pickedKeyId.set(id);
    this.keyPaste.set('');
    if (key && !this.title().trim()) {
      const title = String(key.subject || key.title || '').trim();
      if (title) this.title.set(title);
    }
    this.keyPickOpen.set(false);
  }
  // Excel/CSV answer-key import. The sheet layout teachers hand over is one
  // question per row across 6 columns: question, choices A–D, then the answer.
  // The rows are laid out as key text the normal parser understands, so every
  // downstream step (anchor or match-my-format) works unchanged.
  async onKeyFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!/\.(xlsx|csv|txt)$/i.test(file.name)) {
      this.toast.toast('Use an .xlsx file or a CSV — .xls needs a re-save as .xlsx in Excel', true);
    } else {
      try {
        const rows = /\.xlsx$/i.test(file.name)
          ? await xlsxToRows(await file.arrayBuffer())
          : parseCsv(await file.text());
        const out = rowsToKeyText(rows);
        if (!out.count) {
          this.toast.toast('No question rows found — each row needs: question, choices A–D, answer', true);
        } else {
          const next = this.keyPaste().trim()
            ? this.keyPaste().trimEnd() + '\n\n' + out.text
            : out.text;
          const check = validateKey(parseKeyText(next), 'mcq', next);
          if (!check.ok) {
            this.toast.toast(`${file.name} was not imported — ${check.message}`, true);
          } else {
            this.keyMode.set('mcq');
            this.keyPaste.set(next);
            this.toast.toast(`${out.count} question${out.count === 1 ? '' : 's'} imported from ${file.name}${out.skipped ? ` · ${out.skipped} skipped` : ''}`);
          }
        }
      } catch (e: any) {
        this.toast.toast(e?.message || 'Could not read that file', true);
      }
    }
    input.value = '';
  }

  async generate() {
    if (!this.canGenerate()) return;
    this.generating.set(true);
    this.error.set('');
    try {
      // Fully offline: the quiz mirrors the key entry-for-entry. Entries that
      // need question text or options land as placeholders the teacher
      // completes by hand in the review editor.
      const keyItems = this.keySource()?.items || [];
      const items = normalizeQuizItems(await generateTeacherQuiz({
        mode: 'key', keyItems,
        count: keyItems.length || MAX_ITEMS,
        subject: String(this.quizClass()?.subject || this.subject() || '').trim(),
      }));
      this.items.set(items.map((it: any, i: number) => ({ ...it, n: i + 1 })));
      this.stage.set('review');
    } catch (e: any) {
      this.error.set(e?.message || 'Could not build the quiz from that key.');
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
    // The printed sheet is fixed at 50 items; do not let the editor grow past it.
    if (this.items().length >= MAX_ITEMS) return;
    this.items.set([...this.items(), { n: this.items().length + 1, question: '', options: ['', '', '', ''], answerIndex: 0 }]);
  }

  async save() {
    if (!this.itemsValid()) return;
    const qc = this.quizClass();
    if (!qc) {
      this.toast.toast('Pick a class for this quiz first', true);
      return;
    }
    // An id means we're editing a saved quiz (from its detail page) — update
    // that same record instead of stacking a duplicate.
    const editing = !!this.quizId();
    const subject = String(qc.subject || '').trim();
    const title = this.title().trim() || `${subject || qc.name || 'Quiz'} quiz`;
    const quiz = await saveQuiz({
      id: this.quizId() || undefined,
      subject,
      title,
      classId: qc.id,
      className: qc.name,
      source: this.editingSource || 'key',
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
    this.quizClassId.set(quiz.classId || null);
    this.quizClassNameSnap.set(quiz.className || '');
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
    this.quizClassId.set(q.classId || null);
    this.quizClassNameSnap.set(q.className || '');
    this.subject.set(q.subject || '');
    this.title.set(q.title || '');
    this.items.set((q.items || []).map((it: any) => ({ ...it })));
    this.stage.set('review');
  }

  // ── copy to another section ──────────────────────────────────────────────
  // The same quiz is often taught to several sections. A copy gets a fresh
  // record (new id) in the target class, so its scans and sheets never mix
  // with the original's — see duplicateQuiz() in storage.js.
  copyPickOpen = signal(false);
  copyBusy = signal(false);
  readonly copyTargets = computed(() =>
    this.assignableClasses().filter(c => c.id !== this.selectedQuiz()?.classId));

  openCopy() {
    if (!this.copyTargets().length) {
      this.toast.toast('Add another section first — a copy needs somewhere to go.', true);
      return;
    }
    this.copyPickOpen.set(true);
  }

  async copyTo(cls: any) {
    const quiz = this.selectedQuiz();
    if (!quiz || !cls || this.copyBusy()) return;
    this.copyBusy.set(true);
    try {
      const copy = await duplicateQuiz(quiz, cls);
      if (!copy) { this.toast.toast('Could not copy this quiz', true); return; }
      this.copyPickOpen.set(false);
      // Stay on the original so several copies can be made back-to-back; the
      // toast carries an Open shortcut to the new section's copy.
      this.toast.toast(`Copied to “${cls.name}” ✓`, false, {
        text: 'Open',
        handler: () => { this.router.navigateByUrl(`/quiz?quiz=${copy.id}`); },
      });
    } finally {
      this.copyBusy.set(false);
    }
  }

  backToClass() {
    this.keyPickOpen.set(false);
    this.classPickOpen.set(false);
    this.copyPickOpen.set(false);
    // Quizzes are opened from a class roster; return there instead of dumping
    // the teacher on Home. Fall back only when the class no longer exists.
    const cls = this.quizClassId()
      ? this.classList().find(c => c.id === this.quizClassId())
      : null;
    void this.router.navigateByUrl(cls ? `/tabs/classes/${cls.id}` : '/tabs/home');
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
      // PIN sheets print for the quiz's own class — the one it was created
      // in. The QR carries only the quiz; each student is matched by the
      // 5-digit PIN they shade, so every roster student needs one before
      // printing.
      const cls = this.quizFullClass();
      if (!cls?.students?.length) {
        this.toast.toast('This quiz has no class with students to print for.');
        this.previewBusy.set(false);
        return;
      }
      const { students, assigned } = generatePins(cls.students || []);
      if (assigned) {
        await saveClass({ ...cls, students });
        this.classList.set(await listClasses());
        this.toast.toast(`${assigned} PIN${assigned === 1 ? '' : 's'} assigned automatically — print the PIN list from the class page.`);
      }
      this.previewDoc = await buildPinSheetsPdf(quiz, students, 'long', cls.name);
      this.previewFilename = `quizard-pin-sheets-${slugify(quiz.subject || quiz.title)}-${slugify(cls.name)}`;
      this.previewLabel.set(`PIN answer sheets (2-up, cut in half) — ${cls.name}`);
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
        title: 'Answer sheets',
        text: n > 1 ? `${n} pages — 2 sheets per page` : filename,
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

  pinPagesOf(c: any): number { return Math.max(1, Math.ceil((c?.students?.length || 0) / 2)); }
  // Everything prints on Long bond (8.5x13): PIN half-sheets 2-up, cut in
  // half. One paper stock, so there is nothing to choose.


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

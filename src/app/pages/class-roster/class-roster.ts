import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { getClass, listSheets, listQuizzes, saveClass } from '../../core/engine/storage.js';
import { buildGradebook, isStudentSheet } from '../../core/engine/gradebook.js';
import { diffRoster, parseRoster, generatePins, isValidPin } from '../../core/engine/roster.js';
import { readClassFile } from '../../core/engine/class-file.js';
import { exportPinListPdf } from '../../core/engine/export.js';
import { bannerTheme, bannerAvatar, fmtDateLong } from '../../shared/helpers.js';
import { quizTitle } from '../../core/engine/quiz-classes.js';
import { ToastService } from '../../core/services/toast.service';
import { IcoPipe } from '../../shared/ico.pipe';

// One scanned sheet, resolved to the roster student it belongs to.
interface StudentRecord {
  id: string;
  quizId: string;
  quiz: string;
  percent: number;
  correct: number;
  total: number;
  date: number;
  answers?: number[];
}

// Class page: a themed banner (same gradient the class wears on the Classes
// page) over three tabs — Classwork quizzes, the student roster, and the
// gradebook (students down, quizzes across, latest score per cell). Tapping a
// student opens their full answer review; Edit roster opens an inline sheet
// right here — no hand-off to another tab.
@Component({
  selector: 'app-class-roster',
  imports: [IonContent, IcoPipe],
  templateUrl: './class-roster.html',
})
export class ClassRosterPage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);

  cls = signal<any>(null);
  bannerTheme = bannerTheme;
  bannerAvatar = bannerAvatar;
  // Creation date on the Classwork/Scores cards — not the scan date, so a
  // quiz made in September still reads September even if papers come later.
  readonly dateOf = fmtDateLong;
  missing = signal(false);
  rosterOpen = signal(false);
  // Classroom-style tabs inside the class: Classwork, the roster, the
  // gradebook. `?tab=` (e.g. from the Home card chips) can open one directly.
  tab = signal<'quiz' | 'students' | 'scores'>('quiz');
  setTab(t: 'quiz' | 'students' | 'scores') {
    // Leaving Scores drops the drill-down so the tab always reopens on the
    // quiz list, matching the Quiz tab's rhythm.
    if (t !== 'scores') this.scoreQuizId.set(null);
    this.tab.set(t);
  }
  // Replace rewrites the whole list (box prefilled); Add appends just the new
  // names a teacher pastes or uploads — real classes arrive in batches.
  rosterMode = signal<'replace' | 'add'>('replace');
  paste = signal('');
  private sheets = signal<any[]>([]);
  private quizzes = signal<any[]>([]);

  readonly previewCount = computed(() => parseRoster(this.paste()).students.length);
  readonly previewSkipped = computed(() => parseRoster(this.paste()).skipped);

  readonly students = computed(() =>
    (this.cls()?.students || []).slice().sort((a: any, b: any) => (a.no || 0) - (b.no || 0)));

  readonly checkedCount = computed(() => this.sheets().length);

  // Banner sub-line: subject · grade — section · N students · N checked,
  // skipping whatever the class doesn't have.
  readonly metaOf = (c: any): string => {
    const parts: string[] = [];
    if (c?.subject) parts.push(c.subject);
    const gs = [c?.grade, c?.section].filter(Boolean).join(' — ');
    if (gs) parts.push(gs);
    const n = c?.students?.length || 0;
    parts.push(`${n} student${n === 1 ? '' : 's'}`);
    if (this.checkedCount()) parts.push(`${this.checkedCount()} checked`);
    return parts.join(' · ');
  };

  // Students down, quizzes across, the latest score in each cell. A class with
  // no scans yet yields no columns, which is what the template keys the plain
  // student list off.
  readonly book = computed(() => buildGradebook({
    students: this.students(),
    sheets: this.sheets(),
    quizzes: this.quizzes(),
  }));

  // Classwork: quizzes assigned to this class, plus any with scanned papers
  // here — card-ready for the top of the page.
  readonly classwork = computed(() => {
    const c = this.cls();
    if (!c) return [];
    const ids = new Set<string>();
    const out: any[] = [];
    for (const q of this.quizzes()) {
      if (q.classId !== c.id || ids.has(q.id)) continue
      ids.add(q.id); out.push(q)
    }
    for (const col of this.book().columns) {
      if (ids.has(col.quizId)) continue
      const q = this.quizzes().find((x: any) => x.id === col.quizId)
      if (q) { ids.add(q.id); out.push(q) }
    }
    return out.map((q: any) => ({
      q,
      title: quizTitle(q),
      subject: q.subject || '',
      items: q.items?.length || 0,
      graded: this.sheets().filter((s: any) => s.quizId === q.id).length,
      // Per-quiz average: every scanned paper for this quiz in this class.
      avg: this.avgOfQuiz(q.id),
    }));
  });

  newQuiz() {
    this.router.navigateByUrl('/quiz?new=1&class=' + (this.cls()?.id || ''));
  }

  scanPapers() {
    this.router.navigateByUrl('/tabs/checking');
  }

  // ── Scores tab: quiz first, then that quiz's full student list ───────────
  // Same rhythm as Classwork: a card per quiz, tap one to see every student's
  // score for it. A quiz deleted after its papers were checked keeps a card
  // (its gradebook column still exists), so scanned results never vanish.
  scoreQuizId = signal<string | null>(null);

  readonly scoreCards = computed(() => {
    const seen = new Set<string>();
    const cards: any[] = [];
    for (const cw of this.classwork()) {
      seen.add(cw.q.id);
      cards.push({
        id: cw.q.id, title: cw.title, subject: cw.subject,
        scanned: this.scannedOfQuiz(cw.q.id), avg: cw.avg,
        points: this.avgPointsOfQuiz(cw.q.id),
        date: cw.q.createdAt,
      });
    }
    for (const col of this.book().columns) {
      if (seen.has(col.quizId)) continue;
      cards.push({
        id: col.quizId, title: col.full || col.label, subject: '',
        scanned: this.scannedOfQuiz(col.quizId), avg: this.avgOfQuiz(col.quizId),
        points: this.avgPointsOfQuiz(col.quizId),
        // the quiz record is gone; its first scan is the closest date evidence
        date: this.firstScanOf(col.quizId),
      });
    }
    return cards;
  });

  readonly scoreCard = computed(() => {
    const id = this.scoreQuizId();
    return id ? this.scoreCards().find(c => c.id === id) || null : null;
  });

  readonly scoreRows = computed(() =>
    this.book().rows.map((row: any) => ({
      ...row,
      cell: row.cells.find((c: any) => c.quizId === this.scoreQuizId()) || null,
    })));

  // Unique roster students with a scanned paper for this quiz (sheets are
  // already scoped to this class by ionViewWillEnter).
  scannedOfQuiz(id: string): number {
    const seen = new Set<string>();
    for (const s of this.sheets()) {
      if (s.quizId !== id) continue;
      seen.add(s.studentNo != null ? 'n' + s.studentNo : 'name:' + s.studentName);
    }
    return seen.size;
  }

  avgOfQuiz(id: string): number | null {
    const rows = this.sheets().filter((s: any) => s.quizId === id);
    if (!rows.length) return null;
    return Math.round(rows.reduce((a: number, s: any) => a + (Number(s.percent) || 0), 0) / rows.length);
  }

  // The class's actual score on the quiz: mean correct out of the item total,
  // shown next to the percent on the quiz's scores screen.
  avgPointsOfQuiz(id: string): { correct: number, total: number } | null {
    const rows = this.sheets().filter((s: any) => s.quizId === id);
    if (!rows.length) return null;
    const total = rows.reduce((a: number, s: any) => a + (Number(s.total) || 0), 0) / rows.length;
    const correct = rows.reduce((a: number, s: any) => a + (Number(s.correct) || 0), 0) / rows.length;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return { correct: round1(correct), total: round1(total) };
  }

  firstScanOf(id: string): number {
    const rows = this.sheets().filter((s: any) => s.quizId === id);
    return rows.length ? Math.min(...rows.map((s: any) => Number(s.createdAt) || 0)) : 0;
  }

  openScores(id: string) { this.scoreQuizId.set(id); }
  closeScores() { this.scoreQuizId.set(null); }
  goScan() { this.router.navigate(['/tabs/checking']); }

  // ── Student PINs (for the generic PIN answer sheets) ──────────────────────
  // Every student gets a 5-digit PIN; they write + shade it on their half
  // sheet and the scanner routes the paper back to them.
  pinEditOpen = signal(false);
  pinEditStudent = signal<any>(null);
  pinDraft = signal('');
  pinError = signal('');
  readonly isValidPin = isValidPin;

  openPinEdit(st: any) {
    this.pinEditStudent.set(st);
    this.pinDraft.set(st?.pin || '');
    this.pinError.set('');
    this.pinEditOpen.set(true);
  }
  closePinEdit() { this.pinEditOpen.set(false); }

  async savePin() {
    const cls = this.cls();
    const st = this.pinEditStudent();
    const pin = this.pinDraft().trim();
    if (!cls || !st) return;
    if (!isValidPin(pin)) { this.pinError.set('The PIN must be exactly 5 digits.'); return; }
    const clash = (cls.students || []).find((s: any) => s.id !== st.id && s.pin === pin);
    if (clash) { this.pinError.set(`That PIN already belongs to ${clash.name}.`); return; }
    const students = (cls.students || []).map((s: any) => (s.id === st.id ? { ...s, pin } : s));
    const record = await saveClass({ ...cls, students });
    this.cls.set(record);
    this.pinEditOpen.set(false);
    this.toast.toast(`PIN ${pin} saved for ${st.name}`);
  }

  async generatePinsNow() {
    const cls = this.cls();
    if (!cls) return;
    const { students, assigned } = generatePins(cls.students || []);
    if (!assigned) { this.toast.toast('Every student already has a PIN.'); return; }
    const record = await saveClass({ ...cls, students });
    this.cls.set(record);
    this.toast.toast(`${assigned} PIN${assigned === 1 ? '' : 's'} assigned`);
  }

  async printPinList() {
    const cls = this.cls();
    if (!cls) return;
    try {
      await exportPinListPdf(cls);
      this.toast.toast('PIN list exported — hand each student their PIN');
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/cancel/i.test(msg)) return;
      this.toast.toast('Could not export the PIN list' + (msg ? ' — ' + msg : ''), true);
    }
  }

  openQuiz(id: string) {
    this.router.navigateByUrl('/quiz?quiz=' + id);
  }

  // Row avatars: initials + a stable colour per student, so the roster reads
  // like a people list at a glance (same student always wears the same tint).
  private static readonly AVA_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#14b8a6', '#a855f7', '#ef4444', '#3b82f6', '#ec4899'];
  initialsOf(st: any): string {
    return String(st?.name || '').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0] || '').join('').toUpperCase();
  }
  avatarColorOf(st: any): string {
    const key = String(st?.id || st?.name || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return ClassRosterPage.AVA_COLORS[h % ClassRosterPage.AVA_COLORS.length];
  }

  // The latest attempt per quiz, newest quiz first, for the expanded rows. Only
  // the latest is shown: rescanning a paper is a correction, not a second
  // sitting, so listing every stored row would just repeat the same quiz.
  // Matching is by roster number (stable across renames), falling back to the
  // name for any record saved without one.
  readonly recordsByStudent = computed(() => {
    const map = new Map<string, StudentRecord[]>();
    for (const st of this.students()) {
      const seen = new Set<string>();
      const rows: StudentRecord[] = [];
      const mine = this.sheets()
        .filter(s => isStudentSheet(s, st))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      for (const s of mine) {
        if (seen.has(s.quizId)) continue;
        seen.add(s.quizId);
        rows.push({
          id: s.id,
          quizId: s.quizId,
          quiz: this.quizLabel(s.quizId),
          percent: s.percent, correct: s.correct, total: s.total, date: s.createdAt,
          answers: s.answers,
        });
      }
      map.set(st.id, rows);
    }
    return map;
  });

  async ionViewWillEnter() {
    this.scoreQuizId.set(null);
    const t = this.route.snapshot.queryParamMap.get('tab');
    if (t === 'students' || t === 'scores') this.tab.set(t);
    const id = this.route.snapshot.paramMap.get('id');
    const cls = id ? await getClass(id) : null;
    this.cls.set(cls);
    this.missing.set(!cls);
    if (!cls) { this.sheets.set([]); return; }
    const [sheets, quizzes] = await Promise.all([listSheets({ classId: cls.id }), listQuizzes()]);
    this.sheets.set(sheets);
    this.quizzes.set(quizzes);
  }

  // Full quiz name for the expanded attempt rows. A quiz deleted after its
  // sheets were checked keeps its column, so fall back to the column label.
  private quizLabel(quizId: string) {
    const col = this.book().columns.find(c => c.quizId === quizId);
    return col?.full || col?.label || 'Quiz';
  }

  records(st: any): StudentRecord[] {
    return this.recordsByStudent().get(st.id) || [];
  }

  // The Answers button opens the student's full review page: per quiz, every
  // question with the student's pick, the keyed answer and the full choices.
  // Passing this quiz's id preselects it there (the page opens on that quiz).
  openAnswers(st: any, quizId: string | null = null) {
    const cls = this.cls();
    if (!cls) return;
    this.router.navigate(['/tabs/classes', cls.id, 'students', st.id], {
      queryParams: quizId ? { quiz: quizId } : {},
    });
  }

  // Edit roster stays on this page: the sheet just edits the student list —
  // name, grade and section stay as they are. saveClass keeps each student's
  // sheet number pinned to them (matched by name) even after the edit, and a
  // student removed from the list keeps their stored scan results in Reports.
  openRoster() {
    const cls = this.cls();
    if (!cls) return;
    this.setMode('replace');
    this.rosterOpen.set(true);
  }

  setMode(mode: 'replace' | 'add') {
    this.rosterMode.set(mode);
    // Replace starts from the current list so an edit is a tweak; Add starts
    // from an empty box because only the new names go in it.
    this.paste.set(mode === 'replace'
      ? (this.cls()?.students || []).map((s: any) => s.name).join('\n')
      : '');
  }

  closeRoster() { this.rosterOpen.set(false); }
  setPaste(value: string) { this.paste.set(value); }

  // In Add mode the parse splits into genuinely new names and ones already on
  // the roster (or repeated within the same paste) — the dupes are kept, never
  // re-added, so a careless double paste can't create twin students.
  readonly addPreview = computed(() => this.rosterMode() === 'add'
    ? diffRoster(parseRoster(this.paste()).students, (this.cls()?.students || []).map((s: any) => s.name))
    : { fresh: [], dupes: 0 });

  // Roster files: .xlsx, .csv, or .txt. Rows are appended as text, so an
  // upload can drop into either Replace list or Add names.
  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await readClassFile(file);
      this.paste.set(this.paste() ? this.paste() + '\n' + result.studentsText : result.studentsText);
      this.toast.toast(`Loaded ${result.studentCount} student${result.studentCount === 1 ? '' : 's'} from ${file.name}`);
    } catch (err) {
      this.toast.toast(err instanceof Error ? err.message : 'Could not read that file', true);
    } finally {
      input.value = '';
    }
  }

  async saveRoster() {
    const cls = this.cls();
    if (!cls) return;
    const parsed = parseRoster(this.paste());
    if (this.rosterMode() === 'add') {
      // Append only the names the roster doesn't have yet — existing students
      // are untouched, so their sheet numbers and scan history stay put.
      const { fresh, dupes } = this.addPreview();
      if (!fresh.length) {
        this.toast.toast(parsed.students.length ? 'Everyone listed is already on the roster' : 'Paste or upload at least one student name', true);
        return;
      }
      // Spread the whole class so school year, archived state and any other
      // fields survive a roster edit — saveClass replaces the record wholesale.
      // New students get a PIN (generatePins fills only the missing ones), so
      // generic PIN sheets route to them without a manual registration pass.
      const merged = generatePins([
        ...(cls.students || []),
        ...fresh.map((s: any) => ({
          name: s.name,
          grade: s.grade || cls.grade || '',
          section: s.section || cls.section || '',
        })),
      ]).students;
      const record = await saveClass({
        ...cls,
        students: merged,
      });
      this.cls.set(record);
      this.rosterOpen.set(false);
      this.toast.toast(`${fresh.length} student${fresh.length === 1 ? '' : 's'} added to “${cls.name}”${dupes ? ` · ${dupes} already on the roster` : ''}`);
      return;
    }
    if (!parsed.students.length) {
      this.toast.toast('Paste or upload at least one student name', true);
      return;
    }
    const record = await saveClass({
      ...cls,
      // a replaced roster still ends up fully pinned — generatePins keeps any
      // PIN the surviving students already had and fills only the missing ones
      students: generatePins(parsed.students.map((s: any): any => ({
        name: s.name,
        grade: s.grade || cls.grade || '',
        section: s.section || cls.section || '',
      }))).students,
    });
    this.cls.set(record);
    this.rosterOpen.set(false);
    this.toast.toast(`${parsed.students.length} student${parsed.students.length === 1 ? '' : 's'} saved to “${cls.name}”`);
  }
}

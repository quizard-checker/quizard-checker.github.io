import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { getClass, listSheets, listQuizzes, saveClass } from '../../core/engine/storage.js';
import { buildGradebook, isStudentSheet } from '../../core/engine/gradebook.js';
import { diffRoster, parseRoster } from '../../core/engine/roster.js';
import { bannerTheme, bannerAvatar } from '../../shared/helpers.js';
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

// Class roster page: back header, a themed banner card (same gradient the
// class wears on the Classes page) with the gradebook underneath — students
// down, quizzes across, the latest score in each cell. Tapping a student
// expands the latest attempt per quiz with its date, where a result can also
// be removed. Edit roster opens an inline sheet right here — no hand-off to
// the Classes tab.
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
  missing = signal(false);
  rosterOpen = signal(false);
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

  readonly quizCount = computed(() => this.book().columns.length);
  // A student counts as completed once any quiz cell carries a score.
  readonly completedOf = computed(() =>
    this.book().rows.filter(r => r.cells.some((c: any) => c.scored)).length);
  readonly ringPct = computed(() => {
    const total = this.students().length || 1;
    return Math.round((this.completedOf() / total) * 100);
  });

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
  openAnswers(st: any) {
    const cls = this.cls();
    if (!cls) return;
    this.router.navigate(['/tabs/classes', cls.id, 'students', st.id]);
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

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    this.paste.set(this.paste() ? this.paste() + '\n' + text : text);
    input.value = '';
    this.toast.toast(`Loaded ${file.name}`);
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
      const record = await saveClass({
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        section: cls.section,
        subject: cls.subject,
        students: [
          ...(cls.students || []),
          ...fresh.map((s: any) => ({
            name: s.name,
            grade: s.grade || cls.grade || '',
            section: s.section || cls.section || '',
          })),
        ],
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
      id: cls.id,
      name: cls.name,
      grade: cls.grade,
      section: cls.section,
      subject: cls.subject,
      students: parsed.students.map((s: any) => ({
        name: s.name,
        grade: s.grade || cls.grade || '',
        section: s.section || cls.section || '',
      })),
    });
    this.cls.set(record);
    this.rosterOpen.set(false);
    this.toast.toast(`${parsed.students.length} student${parsed.students.length === 1 ? '' : 's'} saved to “${cls.name}”`);
  }
}

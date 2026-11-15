import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listClasses, listQuizzes, listSheets, saveClass, deleteClass, getActiveAccountId, getAccount, getQuiz } from '../../core/engine/storage.js';
import { parseRoster, generatePins } from '../../core/engine/roster.js';
import { quizTitle } from '../../core/engine/quiz-classes.js';
import { filterClasses, sortClasses, classFilterOptions } from '../../core/engine/class-filters.js';
import { bannerTheme, bannerAvatar } from '../../shared/helpers.js';
import { icon } from '../../shared/icons.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { GuideService } from '../../core/services/guide.service';

@Component({
  selector: 'app-home',
  imports: [IonContent, IcoPipe],
  templateUrl: './home.html',
})
export class HomePage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);
  readonly guide = inject(GuideService);

  account = this.ui.account;
  classes = signal<any[]>([]);
  quizzes = signal<any[]>([]);
  sheets = signal<any[]>([]);
  sheetOpen = signal(false);
  editingId = signal<string | null>(null);

  name = signal('');
  grade = signal('');
  section = signal('');
  subject = signal('');
  schoolYear = signal('');
  paste = signal('');

  readonly previewCount = computed(() => parseRoster(this.paste()).students.length);
  readonly classSubjects = computed(() =>
    [...new Set(this.classes().map(x => x.subject).filter(Boolean))]);
  readonly editingRoster = computed(() => {
    const cls = this.classes().find(c => c.id === this.editingId());
    return (cls?.students || []).slice().sort((a: any, b: any) => (a.no || 0) - (b.no || 0));
  });
  readonly previewSkipped = computed(() => parseRoster(this.paste()).skipped);
  // The current school year's classes lead; archived ones keep their history
  // in a separate section instead of cluttering the main grid.
  readonly activeClasses = computed(() => this.classes().filter(c => !c.archived));
  readonly archivedClasses = computed(() => this.classes().filter(c => c.archived));
  readonly totalStudents = computed(() =>
    this.activeClasses().reduce((s, c) => s + (c.students?.length || 0), 0));

  // ── list tools: search, sort, school-year/grade chips ────────────────────
  // Session-only (no stored prefs): arriving at Home always shows everything.
  query = signal('');
  sortBy = signal<'recent' | 'name' | 'year' | 'grade'>('recent');
  yearPick = signal('');
  gradePick = signal('');
  readonly sortOptions = [
    { id: 'recent', label: 'Recent' },
    { id: 'name', label: 'Name' },
    { id: 'year', label: 'Year' },
    { id: 'grade', label: 'Grade' },
  ] as const;

  readonly filterOptions = computed(() => classFilterOptions(this.activeClasses()));
  readonly yearOptions = computed(() => this.filterOptions().years);
  readonly gradeOptions = computed(() => this.filterOptions().grades);
  readonly hasFilter = computed(() =>
    !!(this.query().trim() || this.yearPick() || this.gradePick()));

  // The grid and the archived strip both follow the same search/filter/sort,
  // so a year filter never leaves a mismatched archived card behind.
  private readonly filterArgs = computed(() => ({
    query: this.query(), year: this.yearPick(), grade: this.gradePick(),
  }));
  readonly visibleClasses = computed(() =>
    sortClasses(filterClasses(this.activeClasses(), this.filterArgs()), this.sortBy()));
  readonly visibleArchived = computed(() =>
    sortClasses(filterClasses(this.archivedClasses(), this.filterArgs()), this.sortBy()));

  setSort(id: string) { this.sortBy.set(id as any); }
  clearFilters() { this.query.set(''); this.yearPick.set(''); this.gradePick.set(''); }

  // One clean meta line per tile: "Biology · 7 — A". Built in TS so the
  // template never has to manage separators around missing fields.
  readonly metaOf = (cls: any): string => {
    const parts: string[] = [];
    if (cls?.subject) parts.push(cls.subject);
    const gs = [cls?.grade, cls?.section].filter(Boolean).join(' — ');
    if (gs) parts.push(gs);
    return parts.join(' · ');
  };

  // The roster at a glance: first names on the tile, the rest counted.
  readonly studentsOf = (cls: any): { short: string; full: string }[] =>
    (cls?.students || []).slice(0, 5).map((s: any) => {
      const full = String(s.name || '');
      const short = full.split(' ')[0] || full;
      return { short, full };
    });

  readonly studentsOverflowOf = (cls: any): number => Math.max(0, (cls?.students?.length || 0) - 5);

  readonly quizzesOf = (cls: any): number =>
    this.quizzes().filter(q => q.classId === cls.id).length;
  // Unique roster students with a scanned paper in this class.
  readonly scannedOf = (cls: any): number => {
    const seen = new Set<string>();
    for (const s of this.sheets()) {
      if (s.classId !== cls.id) continue;
      seen.add(s.studentNo != null ? 'n' + s.studentNo : 'name:' + s.studentName);
    }
    return seen.size;
  };
  readonly quizTitle = quizTitle;

  // Quiz creation lives inside each class (roster page → Classwork).

  // One shared implementation (helpers.js) so a class wears the same gradient
  // on the Classes cards and the roster banner.
  readonly themeOf = (cls: any): string => bannerTheme(cls);
  readonly avatarOf = (cls: any): string => bannerAvatar(cls);

  async ionViewWillEnter() {
    if (!this.ui.account()) {
      const id = getActiveAccountId() || localStorage.getItem('quizard-active-account');
      if (id) this.ui.account.set(await getAccount(id) || null);
    }
    await this.load();
    const [quizzes, sheets] = await Promise.all([listQuizzes(), listSheets()]);
    this.quizzes.set(quizzes);
    this.sheets.set(sheets);
    // Hand-off from the roster page: /tabs/classes?edit=<id> opens the sheet
    const editId = this.route.snapshot.queryParamMap.get('edit');
    if (editId) {
      const cls = this.classes().find(c => c.id === editId);
      if (cls) this.openSheet(cls);
    }
  }

  ngOnInit() { this.ionViewWillEnter(); }

  async load() {
    this.classes.set(await listClasses());
  }

  openSheet(cls: any = null) {
    this.editingId.set(cls?.id || null);
    this.name.set(cls?.name || '');
    this.grade.set(cls?.grade || '');
    this.section.set(cls?.section || '');
    this.subject.set(cls?.subject || '');
    this.schoolYear.set(cls?.schoolYear || '');
    this.paste.set('');
    this.sheetOpen.set(true);
  }

  closeSheet() { this.sheetOpen.set(false); }

  viewRoster(cls: any) {
    this.router.navigateByUrl('/tabs/classes/' + cls.id);
  }

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
    const name = this.name().trim();
    const schoolYear = this.schoolYear().trim();
    if (!name) return;
    if (!schoolYear) {
      this.toast.toast('School year is required — e.g. 2026-2027', true);
      return;
    }
    const prev = this.classes().find(c => c.id === this.editingId());
    // editing an existing class without re-pasting keeps its roster — only a
    // fresh paste replaces the students
    const parsed = this.paste().trim() ? parseRoster(this.paste()) : null;
    let students: any[];
    if (parsed?.students.length) {
      students = parsed.students.map((s: any) => ({
        name: s.name,
        grade: s.grade || this.grade().trim(),
        section: s.section || this.section().trim(),
      }));
    } else if (prev?.students?.length) {
      students = prev.students;
    } else {
      this.toast.toast('Paste or upload at least one student name', true);
      return;
    }
    // every student carries a PIN — generic PIN sheets route by it, so a
    // roster without codes would silently fall back to manual picking
    students = generatePins(students).students;
    await saveClass({
      id: this.editingId() || undefined,
      name,
      grade: this.grade().trim(),
      section: this.section().trim(),
      subject: this.subject().trim(),
      schoolYear,
      archived: prev?.archived || false,
      students,
    });
    this.sheetOpen.set(false);
    await this.load();
    this.toast.toast(`${students.length} student${students.length === 1 ? '' : 's'} saved to “${name}”`);
  }

  async remove(cls: any) {
    if (!await this.confirm.confirm(`Delete “${cls.name}”?`, 'The roster will be removed. Saved scan results are kept.', 'Delete')) return;
    await deleteClass(cls.id);
    await this.load();
    this.toast.toast('Class deleted', false, {
      text: 'Undo',
      handler: async () => {
        await saveClass(cls);
        await this.load();
        this.toast.toast('Class restored');
      }
    });
  }

  async archive(cls: any) {
    if (!await this.confirm.confirm(`Archive “${cls.name}”?`, 'It moves out of the way with all its results. You can restore it any time.', 'Archive')) return;
    await saveClass({ ...cls, archived: true });
    await this.load();
    this.toast.toast(`${cls.name} archived`, false, {
      text: 'Undo',
      handler: async () => {
        await saveClass({ ...cls, archived: false });
        await this.load();
        this.toast.toast('Class restored');
      }
    });
  }

  async restore(cls: any) {
    await saveClass({ ...cls, archived: false });
    await this.load();
    this.toast.toast(`${cls.name} restored`);
  }
}

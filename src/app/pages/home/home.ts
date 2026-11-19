import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listClasses, listQuizzes, saveClass, deleteClass, getActiveAccountId, getAccount, getQuiz } from '../../core/engine/storage.js';
import { parseRoster, generatePins } from '../../core/engine/roster.js';
import { readClassFile } from '../../core/engine/class-file.js';
import { quizTitle } from '../../core/engine/quiz-classes.js';
import { filterClasses, sortClasses, classFilterOptions } from '../../core/engine/class-filters.js';
import { findDuplicateClass } from '../../core/engine/class-identity.js';
import { bannerTheme, currentSchoolYearStart, normalizeGrade, parseSchoolYear, schoolYearLabel, schoolYearOptions } from '../../shared/helpers.js';
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
  sheetOpen = signal(false);
  editingId = signal<string | null>(null);

  grade = signal('');
  section = signal('');
  subject = signal('');
  schoolYear = signal('');
  yearAnchor = signal(currentSchoolYearStart());
  yearPickerOpen = signal(false);
  paste = signal('');
  copySourceId = signal('');

  readonly copySources = computed(() =>
    this.classes().filter(c => c.id !== this.editingId() && (c.students?.length || 0) > 0));
  readonly copySource = computed(() =>
    this.copySources().find(c => c.id === this.copySourceId()) || null);
  readonly previewCount = computed(() => parseRoster(this.paste()).students.length);
  readonly classSubjects = computed(() =>
    [...new Set(this.classes().map(x => x.subject).filter(Boolean))]);
  readonly editingRoster = computed(() => {
    const cls = this.classes().find(c => c.id === this.editingId());
    return (cls?.students || []).slice().sort((a: any, b: any) => (a.no || 0) - (b.no || 0));
  });
  readonly previewSkipped = computed(() => parseRoster(this.paste()).skipped);
  // The class title is built from the fields instead of asking for a duplicate
  // name: "English 8-B", "Science 7-A", and so on.
  readonly hasTitle = computed(() =>
    !!(this.subject().trim() && this.grade().trim() && this.section().trim()));
  readonly className = computed(() => {
    const subject = this.subject().trim();
    const gradeSection = [this.grade().trim(), this.section().trim()].filter(Boolean).join('-');
    return [subject, gradeSection].filter(Boolean).join(' ') || 'Class';
  });
  readonly duplicateClass = computed(() => findDuplicateClass({
    subject: this.subject(),
    grade: this.grade(),
    section: this.section(),
    schoolYear: parseSchoolYear(this.schoolYear()),
  }, this.classes(), this.editingId()));
  readonly schoolYears = computed(() =>
    schoolYearOptions(this.yearAnchor(), this.schoolYear()));
  // Archived classes keep their history in the archive page, reached from the
  // Home header, instead of cluttering the main grid.
  readonly activeClasses = computed(() => this.classes().filter(c => !c.archived));
  readonly archivedClasses = computed(() => this.classes().filter(c => c.archived));
  readonly totalStudents = computed(() =>
    this.activeClasses().reduce((s, c) => s + (c.students?.length || 0), 0));

  // ── list tools: search, class/year dropdowns, grade chips ────────────────
  // Session-only (no stored prefs): arriving at Home always shows everything.
  query = signal('');
  namePick = signal('');
  yearPick = signal('');
  gradePick = signal('');

  readonly filterOptions = computed(() => classFilterOptions(this.activeClasses()));
  readonly yearOptions = computed(() => this.filterOptions().years);
  readonly gradeOptions = computed(() => this.filterOptions().grades);
  readonly hasFilter = computed(() =>
    !!(this.query().trim() || this.namePick() || this.yearPick() || this.gradePick()));

  private readonly filterArgs = computed(() => ({
    query: this.query(), year: this.yearPick(), grade: this.gradePick(),
  }));
  readonly visibleClasses = computed(() => {
    const picked = this.namePick();
    const named = picked
      ? this.activeClasses().filter(c => String(c.id) === picked)
      : this.activeClasses();
    return sortClasses(filterClasses(named, this.filterArgs()), 'recent');
  });

  clearFilters() {
    this.query.set('');
    this.namePick.set('');
    this.yearPick.set('');
    this.gradePick.set('');
  }

  readonly quizzesOf = (cls: any): number =>
    this.quizzes().filter(q => q.classId === cls.id).length;
  readonly quizTitle = quizTitle;

  // Quiz creation lives inside each class (roster page → Classwork).

  // One shared implementation (helpers.js) so a class wears the same gradient
  // on the Classes cards and the roster banner.
  readonly themeOf = (cls: any): string => bannerTheme(cls);

  async ionViewWillEnter() {
    if (!this.ui.account()) {
      const id = getActiveAccountId() || localStorage.getItem('quizard-active-account');
      if (id) this.ui.account.set(await getAccount(id) || null);
    }
    await this.load();
    this.quizzes.set(await listQuizzes());
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
    this.grade.set(normalizeGrade(cls?.grade || ''));
    this.section.set(cls?.section || '');
    this.subject.set(cls?.subject || '');
    const anchor = currentSchoolYearStart();
    this.yearAnchor.set(anchor);
    this.schoolYear.set(parseSchoolYear(cls?.schoolYear) || schoolYearLabel(anchor));
    this.yearPickerOpen.set(false);
    this.paste.set('');
    this.copySourceId.set('');
    this.sheetOpen.set(true);
  }

  closeSheet() { this.sheetOpen.set(false); }

  viewRoster(cls: any) {
    this.router.navigateByUrl('/tabs/classes/' + cls.id);
  }

  setPaste(value: string) { this.paste.set(value); }

  setGrade(value: string) {
    this.grade.set(normalizeGrade(value));
  }

  setSchoolYear(value: string) {
    this.schoolYear.set(parseSchoolYear(value));
    this.yearPickerOpen.set(false);
  }

  stepYear(delta: number) {
    const current = parseSchoolYear(this.schoolYear()) || schoolYearLabel(this.yearAnchor());
    this.schoolYear.set(schoolYearLabel(Number(current.slice(0, 4)) + delta));
  }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await readClassFile(file);
      this.paste.set(this.paste() ? this.paste() + '\n' + result.studentsText : result.studentsText);
      const count = result.studentCount;
      this.toast.toast(`Loaded ${count} student${count === 1 ? '' : 's'} from ${file.name}`);
    } catch (err) {
      this.toast.toast(err instanceof Error ? err.message : 'Could not read that file', true);
    } finally {
      input.value = '';
    }
  }

  copyRosterFromSource() {
    const src = this.copySource();
    if (!src) return;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const student of src.students || []) {
      const name = String(student?.name || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    if (!names.length) {
      this.toast.toast('That class has no student names to copy', true);
      return;
    }
    this.paste.set(names.join('\n'));
    if (src.grade) this.grade.set(normalizeGrade(src.grade));
    if (src.section) this.section.set(src.section);
    const year = parseSchoolYear(src.schoolYear);
    if (year) {
      this.schoolYear.set(year);
      this.yearAnchor.set(Number(year.slice(0, 4)));
    }
    this.copySourceId.set('');
    this.toast.toast(
      `Copied ${names.length} student${names.length === 1 ? '' : 's'} from ${src.name}`);
  }

  async saveSheet() {
    const schoolYear = parseSchoolYear(this.schoolYear());
    if (!this.hasTitle()) {
      this.toast.toast('Subject, grade, and section are required', true);
      return;
    }
    const name = this.className();
    if (!schoolYear) {
      this.toast.toast('Choose a school year - e.g. 2026-2027', true);
      return;
    }
    const duplicate = this.duplicateClass();
    if (duplicate) {
      this.toast.toast(`${duplicate.name} already exists for ${duplicate.schoolYear}`, true);
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

}

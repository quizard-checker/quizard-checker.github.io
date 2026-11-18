import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listClasses, saveClass, deleteClass, getActiveAccountId, getAccount } from '../../core/engine/storage.js';
import { parseRoster } from '../../core/engine/roster.js';
import { readClassFile } from '../../core/engine/class-file.js';
import { bannerTheme, bannerAvatar, currentSchoolYearStart, normalizeGrade, parseSchoolYear, schoolYearLabel, schoolYearOptions } from '../../shared/helpers.js';
import { icon } from '../../shared/icons.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';

@Component({
  selector: 'app-classes',
  imports: [IonContent, IcoPipe],
  templateUrl: './classes.html',
})
export class ClassesPage {
  router = inject(Router);
  private route = inject(ActivatedRoute);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  account = this.ui.account;
  classes = signal<any[]>([]);
  sheetOpen = signal(false);
  editingId = signal<string | null>(null);

  grade = signal('');
  section = signal('');
  subject = signal('');
  schoolYear = signal('');
  yearAnchor = signal(currentSchoolYearStart());
  yearPickerOpen = signal(false);
  paste = signal('');

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
  readonly schoolYears = computed(() =>
    schoolYearOptions(this.yearAnchor(), this.schoolYear()));
  // The current school year's classes lead; archived ones keep their history
  // in a separate section instead of cluttering the main grid.
  readonly activeClasses = computed(() => this.classes().filter(c => !c.archived));
  readonly archivedClasses = computed(() => this.classes().filter(c => c.archived));
  readonly totalStudents = computed(() =>
    this.activeClasses().reduce((s, c) => s + (c.students?.length || 0), 0));

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

  async saveSheet() {
    const schoolYear = parseSchoolYear(this.schoolYear());
    if (!this.hasTitle()) {
      this.toast.toast('Subject, grade, and section are required', true);
      return;
    }
    const name = this.className();
    if (!schoolYear) {
      this.toast.toast('Choose a school year — e.g. 2026-2027', true);
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

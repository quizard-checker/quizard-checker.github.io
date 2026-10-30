import { Component, computed, inject, signal, NgZone, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { listClasses, listQuizzes, saveSheet, listSheets, deleteSheet, getQuiz } from '../../core/engine/storage.js';
import { readSheet, scoreSheet, decodeQr, FLAG } from '../../core/engine/omr.js';
import { parseSheetQr, resolveSheetStudent } from '../../core/engine/sheet-spec.js';
import { resolveDemoSheet } from '../../core/engine/demo-sheet.js';
import { liveScanStep, LIVE_SCAN } from '../../core/engine/live-scan.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
import { ByokService } from '../../core/services/byok.service';
import { bannerTheme } from '../../shared/helpers.js';

/**
 * A roster student resolved for one sheet. `grade` / `section` fall back to the
 * class-level values when the student row leaves them blank, so every result
 * carries a section even for a class with one section for all.
 */
interface MatchedStudent {
  id: string;
  no?: number;
  name: string;
  grade: string;
  section: string;
  classId: string;
  className: string;
}

@Component({
  selector: 'app-checking',
  imports: [IonContent, IcoPipe],
  templateUrl: './checking.html',
})
export class CheckingPage {
  router = inject(Router);
  ui = inject(UiStateService);
  readonly byok = inject(ByokService);
  private toast = inject(ToastService);
  private zone = inject(NgZone);

  stage = signal<'setup' | 'scan' | 'result'>('setup');
  classes = signal<any[]>([]);
  quizzes = signal<any[]>([]);
  sheets = signal<any[]>([]);
  classId = signal<string | null>(null);
  quizOverrideId = signal<string | null>(null);
  quizPickOpen = signal(false);
  session = signal<any[]>([]);

  // Templates can't see bare imports, so the shared banner theme is exposed as
  // a field — a class wears the same gradient here as on Classes and roster.
  readonly bannerTheme = bannerTheme;

  processing = signal(false);
  scanError = signal('');
  qrHit = signal<string | null>(null);
  detectedQuiz = signal<any>(null);
  answers = signal<number[]>([]);
  flags = signal<string[]>([]);
  photo = signal<string>('');
  studentName = signal('');
  autoStudent = signal<MatchedStudent | null>(null);
  // how the sheet got its student: the sheet's own QR, or the result-screen
  // picker when the QR named nobody
  studentSource = signal<'qr' | 'manual' | null>(null);
  // a QR named a student this device's roster doesn't have — the teacher still
  // picks manually, but knows the sheet's claim
  qrUnknownName = signal<string | null>(null);
  pickedStudentId = signal<string | null>(null);
  studentPickOpen = signal(false);

  // The score that pops up over the scanner the moment a sheet is read and
  // recorded, so the teacher sees the result without tapping through a screen.
  // Shaped by recordResult(); null means no popup.
  scorePop = signal<{ id: string; name: string; section: string; percent: number; correct: number; total: number } | null>(null);

  cameraActive = signal(false);
  // The live viewfinder scans by itself: it waits for a sheet QR to sit still
  // for a couple of frames, then captures and scores without a shutter tap.
  // Auto-scan can be switched off to go back to manual captures.
  autoScan = signal(true);
  livePhase = signal<'off' | 'looking' | 'locking' | 'waiting'>('off');
  readonly liveText = computed(() => {
    if (!this.autoScan()) return 'Auto-scan off — tap Capture now';
    if (this.scanError()) return 'Scan needs attention';
    switch (this.livePhase()) {
      case 'locking': return 'Sheet found — hold still…';
      case 'waiting': return 'Move to the next sheet';
      case 'looking': return 'Looking for a sheet…';
      default: return 'Starting camera…';
    }
  });
  private stream: MediaStream | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private liveBusy = false;
  private liveCandidate: string | null = null;
  private liveHits = 0;
  private liveAbsent = 0;
  private scannedQr: string | null = null;
  private cooldownUntil = 0;
  private detector: any = null;
  private detectorFails = 0;
  private detectorMisses = 0;

  readonly flag = FLAG;
  readonly pickedClass = computed(() => this.classes().find(c => c.id === this.classId()) || null);
  readonly scored = computed(() => {
    const quiz = this.detectedQuiz();
    if (!quiz) return null;
    return scoreSheet(this.answers(), quiz.items);
  });
  readonly letters = ['A', 'B', 'C', 'D'];

  // Every student across every class, in the shape a result needs. Building the
  // option list from the same entries the auto-match uses means the manual
  // fallback attaches the same identity data as a numbered scan.
  readonly roster = computed<MatchedStudent[]>(() =>
    this.classes().flatMap(cls => (cls.students || []).map((st: any) => this.rosterEntry(cls, st))));

  // The class being checked scopes both pickers — a session is per class, so a
  // 200-student school never scrolls one giant list.
  readonly classRoster = computed(() =>
    this.roster().filter(r => r.classId === this.classId()));

  private rosterEntry(cls: any, st: any): MatchedStudent {
    return {
      id: st.id,
      no: st.no,
      name: st.name,
      grade: st.grade || cls.grade || '',
      section: st.section || cls.section || '',
      classId: cls.id,
      className: cls.name,
    };
  }


  subjectMismatch = signal(false);

  selectStudent(id: string) {
    const st = this.roster().find(r => r.id === id) || null;
    this.attachStudent(st, 'manual');
    this.qrUnknownName.set(null);
  }

  // One place that binds a roster student to the sheet being checked, so the
  // QR path and the manual picker carry identical identity data.
  private attachStudent(st: MatchedStudent | null, source: 'qr' | 'manual' | null) {
    this.pickedStudentId.set(st?.id ?? null);
    this.autoStudent.set(st);
    this.studentName.set(st?.name ?? '');
    this.studentSource.set(source);
    // the subject guard applies to manual picks too — a sheet from another
    // subject's pile would otherwise land on the wrong class silently
    const quiz = this.detectedQuiz();
    const cls = st ? this.classes().find(c => c.id === st.classId) : null;
    this.subjectMismatch.set(!!cls?.subject && !!quiz?.subject &&
      cls.subject.toLowerCase() !== quiz.subject.toLowerCase());
  }

  // A roster-printed sheet's QR carries the student id and name: id first
  // (stable across roster edits), then the name as the fallback for a roster
  // that was re-created on this device. The rule lives in sheet-spec.js so it
  // is covered by the same tests as the parser.
  private matchRosterStudent(parsed: { studentId: string | null; studentName: string | null } | null) {
    return resolveSheetStudent(this.roster(), parsed, this.classId());
  }

  async ionViewWillEnter() {
    const [classes, quizzes, sheets] = await Promise.all([listClasses(), listQuizzes(), listSheets()]);
    this.classes.set(classes);
    this.quizzes.set(quizzes);
    this.sheets.set(sheets);
    // Landing from a quiz's detail page (?quiz=): that quiz is the session's
    // target before any scanning starts.
    const qm = /[?&]quiz=([A-Za-z0-9-]+)/.exec(this.router.url || '');
    if (qm) this.quizOverrideId.set(qm[1]);
  }

  // Leaving the tab mid-scan must release the camera and stop the live loop;
  // Ionic caches the page, so nothing else would switch it off.
  ionViewWillLeave() {
    this.closeCamera();
  }

  // Browsers freeze or suspend camera tracks when the tab/app is hidden; a
  // frozen viewfinder that still claims to scan is worse than asking the
  // teacher to reopen the camera.
  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (document.hidden) this.closeCamera();
  }

  // Per-class scan totals, so a class card shows whether a pile was started —
  // the same count the roster hero and Results use.
  readonly checkedCount = (cls: any): number =>
    this.sheets().filter(s => s.classId === cls.id).length;

  // ── quiz picker (setup) ──
  // A session's quiz comes off each sheet's QR in almost every scan, so the
  // full quiz library never sits on the setup screen — the pill opens a sheet
  // filtered to the picked class's subject first.
  readonly classSubjectQuizzes = computed(() => {
    const sub = (this.pickedClass()?.subject || '').trim().toLowerCase();
    if (!sub) return [];
    return this.quizzes().filter(q => (q.subject || '').trim().toLowerCase() === sub);
  });
  readonly otherQuizzes = computed(() => {
    const own = new Set(this.classSubjectQuizzes().map(q => q.id));
    return this.quizzes().filter(q => !own.has(q.id));
  });
  readonly othersLabel = computed(() =>
    (this.pickedClass()?.subject || '').trim() ? 'Other subjects' : 'All quizzes');

  quizLabel(id: string): string {
    const q = this.quizzes().find(x => x.id === id);
    if (!q) return 'Quiz';
    return `${q.subject || 'Quiz'}${q.title ? ' — ' + q.title : ''} · ${q.items?.length || 0} items`;
  }

  setQuiz(id: string | null) {
    this.quizOverrideId.set(id);
    this.quizPickOpen.set(false);
  }

  // ── setup ──
  async startSession() {
    if (!this.classId()) return;
    await this.refreshSession();
    this.scanError.set('');
    this.stage.set('scan');
  }

  async refreshSession() {
    this.session.set(await listSheets({ classId: this.classId() || undefined }));
  }

  // ── camera ──
  async openCamera() {
    if (this.cameraActive()) return;
    this.scanError.set('');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      this.cameraActive.set(true);
      this.makeDetector();
      this.attachVideo();
    } catch {
      this.toast.toast('Camera unavailable — use “Check from photo” instead', true);
    }
  }

  // BarcodeDetector is hardware-backed on Android and reads a video frame far
  // faster than jsQR; where it is missing (iOS Safari, older WebViews) the live
  // loop falls back to jsQR on a downscaled frame.
  private makeDetector() {
    try {
      const BD = (window as any).BarcodeDetector;
      this.detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    } catch {
      this.detector = null;
    }
    this.detectorFails = 0;
    this.detectorMisses = 0;
  }

  private videoEl(): HTMLVideoElement | null {
    return document.querySelector('video.camera-view') as HTMLVideoElement | null;
  }

  private attachVideo(attempt = 0) {
    const video = this.videoEl();
    if (!video) {
      if (attempt < 12) setTimeout(() => this.attachVideo(attempt + 1), 50);
      return;
    }
    if (this.stream && video.srcObject !== this.stream) video.srcObject = this.stream;
    void video.play().catch(() => {});
    this.startLiveLoop();
  }

  private startLiveLoop() {
    this.stopLiveLoop();
    if (!this.autoScan()) {
      this.livePhase.set('off');
      return;
    }
    this.liveCandidate = null;
    this.liveHits = 0;
    this.liveAbsent = 0;
    this.livePhase.set('looking');
    this.liveTimer = setInterval(() => { void this.tickLive(); }, LIVE_SCAN.tickMs);
  }

  private stopLiveLoop() {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    this.liveBusy = false;
  }

  toggleAutoScan() {
    const on = !this.autoScan();
    this.autoScan.set(on);
    if (on && this.cameraActive()) this.startLiveLoop();
    else {
      this.stopLiveLoop();
      this.livePhase.set('off');
    }
  }

  // One live tick: read the QR from the preview, let liveScanStep decide, and
  // only grab a full-resolution frame when it says the sheet has been held
  // still. The stream stays open after a scan so the next sheet can be read
  // without reopening the camera.
  private async tickLive() {
    if (this.liveBusy || !this.cameraActive() || !this.autoScan()) return;
    if (this.processing() || this.scorePop() || this.stage() !== 'scan') return;
    const video = this.videoEl();
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    this.liveBusy = true;
    try {
      const now = performance.now();
      let text: string | null = null;
      if (this.detector) {
        text = await this.detectWithDetector(video);
        if (text) {
          this.detectorMisses = 0;
        } else if (++this.detectorMisses % 3 === 0) {
          // Some WebViews expose BarcodeDetector but return nothing (no
          // barcode module installed). Probe with jsQR every third empty tick
          // so the live scanner cannot end up blind.
          text = this.decodeLiveFrame(video);
        }
      } else {
        text = this.decodeLiveFrame(video);
      }
      const step = liveScanStep({
        text,
        candidate: this.liveCandidate,
        hits: this.liveHits,
        absent: this.liveAbsent,
        scannedQr: this.scannedQr,
        cooldownUntil: this.cooldownUntil,
        now,
      });
      this.liveCandidate = step.candidate;
      this.liveHits = step.hits;
      this.liveAbsent = step.absent;
      // Seeing nothing for a moment re-arms the paper that was just scanned,
      // so a deliberate rescan works by lifting the phone away and back.
      if (step.absent >= LIVE_SCAN.rearmTicks) this.scannedQr = null;
      this.livePhase.set(step.status);
      if (!step.scan) return;
      this.cooldownUntil = now + LIVE_SCAN.cooldownMs;
      this.liveCandidate = null;
      this.liveHits = 0;
      if ('vibrate' in navigator) navigator.vibrate?.(35);
      void this.processImage(this.grabFrame(video), true);
    } finally {
      this.liveBusy = false;
    }
  }

  private async detectWithDetector(video: HTMLVideoElement): Promise<string | null> {
    try {
      const codes = await this.detector.detect(video);
      this.detectorFails = 0;
      return codes?.[0]?.rawValue || null;
    } catch {
      // an API that exists but always throws (e.g. no barcode module) must not
      // leave the scanner blind — drop it and use jsQR from the next tick
      if (++this.detectorFails >= 3) this.detector = null;
      return null;
    }
  }

  private decodeLiveFrame(video: HTMLVideoElement): string | null {
    const width = Math.min(900, video.videoWidth);
    const height = Math.round(video.videoHeight * (width / video.videoWidth));
    let canvas = this.liveCanvas;
    if (!canvas) canvas = this.liveCanvas = document.createElement('canvas');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    return decodeQr(frame.data, width, height, { inversionAttempts: 'dontInvert' });
  }

  private grabFrame(video: HTMLVideoElement, maxWidth = 1600): ImageData {
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  closeCamera() {
    this.stopLiveLoop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.cameraActive.set(false);
    this.livePhase.set('off');
    this.liveCandidate = null;
    this.liveHits = 0;
    this.liveAbsent = 0;
    this.scannedQr = null;
  }

  captureFromCamera() {
    const video = this.videoEl();
    if (!video || !video.videoWidth) return;
    this.cooldownUntil = performance.now() + LIVE_SCAN.cooldownMs;
    void this.processImage(this.grabFrame(video), true);
  }

  async onPhoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / bitmap.width);
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    input.value = '';
    // A photo replaces the viewfinder for this sheet — releasing the camera
    // keeps the live loop from scanning something else while it is read.
    this.closeCamera();
    void this.processImage(data);
  }

  // A thrown storage or vision error used to reject silently and leave the
  // "Analyzing…" overlay (or the camera) with no explanation.
  private async processImage(data: ImageData, fromLive = false) {
    try {
      await this.processImageInner(data, fromLive);
    } catch (e: any) {
      this.processing.set(false);
      this.scanError.set('Could not read that sheet' + (e?.message ? ' — ' + e.message : '') + '. Try again, or use Check from photo.');
    }
  }

  private async processImageInner(data: ImageData, fromLive = false) {
    this.processing.set(true);
    // A live retry keeps the previous message on screen until it succeeds or
    // fails again, so the viewfinder does not flicker while the teacher
    // reframes the sheet.
    if (!fromLive) this.scanError.set('');
    // let the spinner paint before the synchronous CV work blocks the frame
    await new Promise(r => setTimeout(r, 60));

    // the QR identifies the quiz — and, on roster-printed sheets, the student
    // — before any geometry work: one CV pass total
    const qrText = decodeQr(data.data, data.width, data.height);
    const parsed = parseSheetQr(qrText);
    let quiz: any = null;
    let demoMatch: { cls: any; student: any } | null = null;
    if (parsed?.demo) {
      // The bundled demo sheet points at stable demo keys, not this profile's
      // storage ids. Resolve it against the demo records loaded here.
      const match = resolveDemoSheet(parsed, this.classes(), await listQuizzes());
      if (!match) {
        this.processing.set(false);
        this.scanError.set('This is the built-in demo sheet. Open Settings → Demo data → Load demo data, then scan it again.');
        // the sheet is still in frame: do not fire on it again until the
        // teacher has fixed the data and deliberately moves away and back
        if (fromLive) this.scannedQr = qrText;
        return;
      }
      quiz = match.quiz;
      demoMatch = { cls: match.cls, student: match.student };
    } else {
      const quizId = parsed?.quizId || this.quizOverrideId();
      quiz = quizId ? await getQuiz(quizId) : null;
    }
    if (!quiz) {
      this.processing.set(false);
      // two different failures wore one message before: a photo with no
      // readable QR at all, and a QR naming a quiz this device doesn't have
      // (sheets printed on another phone / browser, or a deleted quiz)
      this.scanError.set(parsed
        ? `This sheet’s quiz isn’t on this device${parsed.studentName ? ` (the QR names ${parsed.studentName})` : ''} — it was printed somewhere else or deleted here. Pick the quiz manually on the setup screen and scan again.`
        : 'No QR code found on that photo — fill the frame with the sheet, keep it flat and well-lit, then try again. Or pick the quiz manually on the setup screen to scan without one.');
      if (fromLive && parsed) this.scannedQr = qrText;
      return;
    }

    const result = readSheet({ data: data.data, width: data.width, height: data.height }, quiz.items.length);
    if (!result.ok) {
      this.processing.set(false);
      this.scanError.set('Could not align the sheet — fit all four corner squares and the black frame inside the frame. It will retry automatically.');
      // a framing miss is worth another automatic try once the phone is moved
      if (fromLive) this.scannedQr = null;
      return;
    }
    const answers = result.answers, flags = result.flags;
    this.zone.run(() => {
      this.scanError.set('');
      this.qrHit.set(result.qr);
      this.detectedQuiz.set(quiz);
      this.answers.set(answers);
      this.flags.set(flags);
      this.photo.set(dataToJpeg(data));
      // Sheets are printed one per roster student, so the QR almost always
      // names whose paper this is — it attaches with nothing to confirm. Only
      // a sheet whose QR names nobody (or names a student this device doesn't
      // have) waits for the teacher, and that pick happens on the result screen.
      const qrStudent = demoMatch
        ? this.rosterEntry(demoMatch.cls, demoMatch.student)
        : this.matchRosterStudent(parsed);
      if (qrStudent) {
        // Remember the paper that was just read so the live loop moves on to
        // the next sheet instead of firing on this one again.
        if (fromLive) this.scannedQr = qrText;
        this.qrUnknownName.set(null);
        this.attachStudent(qrStudent, 'qr');
        // Nothing left to confirm, so record it now and pop the score up over
        // the scanner — the teacher never taps through a result screen.
        this.stage.set('scan');
        void this.recordResult()
          .then(row => {
            if (row) this.scorePop.set(row);
            else this.scanError.set('The sheet was read, but it could not be saved. Move the phone away and scan it again.');
          })
          .catch((e: any) => {
            this.scanError.set('The sheet was read, but saving failed' + (e?.message ? ' — ' + e.message : '') + '. Try again, or use Check from photo.');
          });
      } else {
        this.attachStudent(null, null);
        this.qrUnknownName.set(parsed?.studentName || null);
        // Nobody in the QR: the result screen's picker decides whose paper it
        // is. That screen has no viewfinder, so release the camera.
        this.closeCamera();
        this.stage.set('result');
      }
      this.processing.set(false);
    });
  }

  // ── result editor ──
  cycleAnswer(i: number) {
    const next = [...this.answers()];
    next[i] = next[i] >= 3 ? -1 : next[i] + 1;
    const flags = [...this.flags()];
    flags[i] = next[i] >= 0 ? FLAG.OK : FLAG.BLANK;
    this.answers.set(next);
    this.flags.set(flags);
  }

  setAnswer(i: number, b: number) {
    const next = [...this.answers()];
    next[i] = b;
    const flags = [...this.flags()];
    flags[i] = FLAG.OK;
    this.answers.set(next);
    this.flags.set(flags);
  }

  // Writes the sheet being checked to storage and hands back the row it made.
  // Shared by the automatic scan path (which pops the score up straight away)
  // and the result screen's Save button. Identity comes from the roster entry,
  // never from the handwriting.
  //
  // Rescanning a paper is a correction, not a second sitting, so it replaces
  // the score that student already has for this quiz rather than stacking
  // another row — otherwise one sheet counts twice in the class average.
  private async recordResult() {
    const quiz = this.detectedQuiz();
    const auto = this.autoStudent();
    const cls = auto ? this.classes().find(c => c.id === auto.classId) || this.pickedClass() : this.pickedClass();
    const s = this.scored();
    const name = this.studentName().trim();
    if (!quiz || !cls || !s || !name) return null;
    const no = auto?.no ?? null;
    const prior = (await listSheets({ classId: cls.id, quizId: quiz.id }))
      .find(x => no != null ? x.studentNo === no : (!x.studentNo && x.studentName === name));
    const saved = await saveSheet({
      id: prior?.id,
      classId: cls.id, className: cls.name, quizId: quiz.id,
      studentNo: auto?.no ?? null,
      studentName: name,
      grade: auto?.grade ?? '',
      section: auto?.section ?? '',
      answers: this.answers(), flags: this.flags(),
      correct: s.correct, total: s.total, percent: s.percent,
      photo: this.photo() || undefined,
    });
    await this.refreshSession();
    return { id: saved.id, name, section: saved.section || '', percent: s.percent, correct: s.correct, total: s.total };
  }

  async saveResult() {
    this.scanError.set('');
    try {
      const row = await this.recordResult();
      if (!row) {
        this.scanError.set('Could not save this result — check that the student and quiz are still on this device.');
        return;
      }
      this.stage.set('scan');
      this.scorePop.set(row);
    } catch (e: any) {
      this.scanError.set('Could not save this result' + (e?.message ? ' — ' + e.message : '') + '. Try again.');
    }
  }

  // A misread must not be permanent: drop the row that was just written and
  // reopen the result screen, where the answer chips and the student can be
  // corrected before saving again.
  async fixScore() {
    const pop = this.scorePop();
    this.scorePop.set(null);
    if (!pop) return;
    this.closeCamera();
    await deleteSheet(pop.id);
    await this.refreshSession();
    this.stage.set('result');
  }

  async undoLast() {
    const last = this.session()[0];
    if (!last) return;
    await deleteSheet(last.id);
    // The paper may still be in front of the camera: re-arm it so Undo can be
    // followed by a rescan without moving away first.
    this.scannedQr = null;
    await this.refreshSession();
    this.toast.toast('Last result removed');
  }

  endSession() {
    this.closeCamera();
    this.stage.set('setup');
    this.detectedQuiz.set(null);
    this.answers.set([]);
    this.flags.set([]);
    this.photo.set('');
    this.autoStudent.set(null);
    this.studentSource.set(null);
    this.qrUnknownName.set(null);
    this.scorePop.set(null);
  }

  flagColor(f: string) {
    return f === FLAG.MULTI ? 'bad' : f === FLAG.FAINT ? 'warn' : f === FLAG.BLANK ? 'dim' : 'good';
  }
}

function dataToJpeg(data: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = data.width; canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.6);
}

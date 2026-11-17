import { Component, computed, inject, signal, NgZone, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { App } from '@capacitor/app';
import { IonContent } from '@ionic/angular';
import { listClasses, listQuizzes, saveSheet, listSheets, deleteSheet, getQuiz, saveClass } from '../../core/engine/storage.js';
import { readSheet, readPinSheet, readPinSheetV3, scoreSheet, decodeQr, decodeQrAnywhere, decodeQrFromSheet, detectSheet, FLAG } from '../../core/engine/omr.js';
import { resolveStudentByPin, claimPin } from '../../core/engine/roster.js';
import { parseSheetQr, resolveSheetStudent } from '../../core/engine/sheet-spec.js';
import { wideScanEnterPlan, wideScanExitPlan } from '../../core/engine/wide-scan.js';
import { resolveDemoSheet } from '../../core/engine/demo-sheet.js';
import { quizTitle } from '../../core/engine/quiz-classes.js';
import { liveScanStep, LIVE_SCAN } from '../../core/engine/live-scan.js';
import { IcoPipe } from '../../shared/ico.pipe';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../../core/services/toast.service';
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

type SheetPoint = { x: number; y: number };
type SheetLock = NonNullable<ReturnType<typeof detectSheet>> & { quadVideo: SheetPoint[] };

@Component({
  selector: 'app-checking',
  imports: [IonContent, IcoPipe],
  templateUrl: './checking.html',
})
export class CheckingPage {
  router = inject(Router);
  ui = inject(UiStateService);
  private toast = inject(ToastService);
  private zone = inject(NgZone);

  stage = signal<'setup' | 'scan' | 'result'>('setup');
  classes = signal<any[]>([]);
  // Archived classes keep their history but are not scanning targets.
  readonly activeClasses = computed(() => this.classes().filter(c => !c.archived));
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
  scorePop = signal<{ id: string; name: string; section: string; quiz: string; percent: number; correct: number; total: number } | null>(null);

  cameraActive = signal(false);
  // The live viewfinder scans by itself: it waits for a sheet QR to sit still
  // for a couple of frames, then captures and scores without a shutter tap.
  // Auto-scan can be switched off to go back to manual captures.
  autoScan = signal(true);
  livePhase = signal<'off' | 'looking' | 'locking' | 'waiting'>('off');
  // crop-based digital zoom (1 = full frame, 2 = center half) and the
  // camera torch — the two controls that fix "hard to scan" at distance
  camZoom = signal(1);
  torchOn = signal(false);
  torchSupported = signal(false);
  // wide scan: the viewfinder turns landscape so wide sheets (PIN half-sheets
  // on long bond, or a sheet shown on a laptop screen) fit all four corner
  // squares in frame. Fullscreen + orientation lock where the platform
  // allows it; a rotate hint where it does not.
  wideOn = signal(false);
  wideHint = signal(false);
  searchHint = signal(false);
  // Live marker-lock feedback. Kept separate from the red scan error so a
  // previous failed capture does not keep saying "Scan needs attention" while
  // the four corner squares are actually lined up.
  sheetHint = signal('');
  // Detected quad in full-video pixels for the live overlay. amber = a marker
  // is at the edge; green = all four are stable enough to capture.
  sheetQuad = signal<{ points: SheetPoint[]; edge: boolean; stable: boolean } | null>(null);
  videoW = signal(0);
  videoH = signal(0);
  // the 5-digit PIN read off the sheet being checked — a manual pick registers
  // it to the picked student so later papers route automatically
  scannedPin = signal<string | null>(null);
  private track: MediaStreamTrack | null = null;
  readonly liveText = computed(() => {
    if (!this.autoScan()) return 'Auto-scan off — tap Capture now';
    if (this.sheetHint()) return this.sheetHint();
    if (this.scanError()) return 'Scan needs attention';
    switch (this.livePhase()) {
      case 'locking': return 'Sheet found — hold still…';
      case 'waiting': return 'Already scanned — next sheet, or tap Capture now';
      case 'looking': return this.searchHint()
        ? 'Fit the whole page inside — move back if a corner is cut off'
        : 'Looking for a sheet…';
      default: return 'Starting camera…';
    }
  });
  quadPolygon(q: { points: SheetPoint[] }): string {
    return q.points.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
  }
  quadRadius(): number {
    return Math.max(10, Math.round(this.videoW() * 0.012));
  }
  private stream: MediaStream | null = null;
  private backListener: { remove: () => Promise<void> } | null = null;
  private cameraStarting = false;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private liveBusy = false;
  private tickCount = 0;
  private liveCandidate: string | null = null;
  private liveHits = 0;
  private liveAbsent = 0;
  // Marker-lock auto-capture: two consecutive frames with a verified printed
  // frame are enough. `sheetArmed` stops re-firing while the same sheet stays
  // in view; it re-arms after the same absence window as a QR rescan.
  private sheetHits = 0;
  private sheetArmed = true;
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

  async selectStudent(id: string) {
    const st = this.roster().find(r => r.id === id) || null;
    this.attachStudent(st, 'manual');
    this.qrUnknownName.set(null);
    // A PIN sheet the scanner couldn't auto-match: registering the shaded PIN
    // to the hand-picked student means every later paper from that student
    // routes by itself — the first checked paper teaches the roster.
    const pin = this.scannedPin();
    if (st && pin) {
      const cls = this.classes().find(c => c.id === st.classId);
      if (cls) {
        const res = claimPin(cls.students || [], st.id, pin);
        if (res.ok && res.changed) {
          await saveClass({ ...cls, students: res.students });
          this.classes.set(await listClasses());
          this.toast.toast(`PIN ${pin.split('').join(' ')} registered to ${st.name} — their papers route automatically now.`);
        }
      }
    }
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
    void this.installBackHandler();
  }

  // Leaving the tab mid-scan must release the camera and stop the live loop;
  // Ionic caches the page, so nothing else would switch it off.
  ionViewWillLeave() {
    this.closeCamera();
    void this.removeBackHandler();
  }

  // Android's hardware back must never close the app on a pending result.
  // The native default (when the WebView has no history) is to finish the
  // activity, which used to throw away the scanned sheet. Stay on the result
  // screen until the teacher saves or deliberately backs out with the header
  // arrow; on the scanner, back ends the session safely.
  private async installBackHandler() {
    if (this.backListener) return;
    try {
      this.backListener = await App.addListener('backButton', () => {
        if (this.stage() === 'result') {
          this.toast.toast('Save this sheet or use the back arrow to return to scanning.');
          return;
        }
        if (this.stage() === 'scan') {
          this.closeCamera();
          this.endSession();
          return;
        }
        this.toast.toast('Tap Home to leave the scanner.');
      });
    } catch {
      this.backListener = null;
    }
  }

  private async removeBackHandler() {
    const handle = this.backListener;
    this.backListener = null;
    try { await handle?.remove(); } catch { /* plugin already gone */ }
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
    if (this.cameraActive() || this.cameraStarting) return;
    this.cameraStarting = true;
    this.scanError.set('');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      this.cameraActive.set(true);
      this.makeDetector();
      this.attachVideo();
      const track = this.stream.getVideoTracks()[0] || null;
      this.track = track;
      try {
        const caps = track?.getCapabilities?.() as any;
        this.torchSupported.set(!!caps && caps.torch === true);
      } catch {
        this.torchSupported.set(false);
      }
    } catch {
      this.toast.toast('Camera unavailable — use “Check from photo” instead', true);
    } finally {
      this.cameraStarting = false;
    }
  }

  // 2× crop zoom: the decode and capture read the center half of the frame at
  // native pixels, so a sheet that filled 40% of the view now fills 80% of
  // what the scanner sees — double the QR size and marker detail, no hardware
  // zoom required. Toggled from the viewfinder.
  toggleZoom() {
    this.camZoom.set(this.camZoom() === 1 ? 2 : 1);
  }

  async toggleTorch() {
    const track = this.track;
    if (!track) return;
    const next = !this.torchOn();
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      this.torchOn.set(next);
    } catch {
      this.toast.toast('Flashlight is not available on this camera', true);
    }
  }

  // Wide scan: the sensor's long axis runs across the sheet, so wide papers
  // keep all four corner squares in frame. The CSS widens the stage whenever
  // the phone is actually landscape, so a normal rotate needs no button.
  // This tool is for devices where auto-rotate is off: inside the APK the
  // native plugin rotates the screen for real (the WebView's web-level lock
  // silently fails, and system auto-rotate is often switched off), Android
  // Chrome locks landscape for real too (fullscreen first: orientation locks
  // are only granted there), and iOS just widens the layout once the phone
  // physically rotates.
  async toggleWide() {
    if (this.wideOn()) {
      this.exitWide();
      return;
    }
    const plan = wideScanEnterPlan(screen, { native: Capacitor.isNativePlatform() });
    this.wideOn.set(true);
    this.wideHint.set(plan.hint);
    if (plan.native) {
      try {
        await ScreenOrientation.lock({ orientation: 'landscape' });
      } catch {
        // plugin refusal — the wide layout still applies once the device
        // actually is landscape
      }
      return;
    }
    try {
      if (plan.fullscreen) await this.stageEl()?.requestFullscreen?.();
    } catch {
      // fullscreen refusal (kiosk, older WebView) — the wide layout still
      // applies the moment the device actually is landscape
    }
    try {
      if (plan.lockTo) await screen.orientation.lock(plan.lockTo);
    } catch {
      // locking is best-effort: physical rotation triggers the same layout
    }
  }

  private exitWide() {
    const plan = wideScanExitPlan(screen, { native: Capacitor.isNativePlatform() });
    if (plan.native) {
      // unlock, don't force portrait: the screen follows the system setting
      // again (some tablets default to landscape)
      void ScreenOrientation.unlock().catch(() => {});
      this.wideOn.set(false);
      this.wideHint.set(false);
      return;
    }
    // lock back before leaving fullscreen — Android only honors locks while
    // fullscreen, so order matters here
    if (plan.lockTo === 'portrait') void screen.orientation.lock(plan.lockTo).catch(() => {});
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.wideOn.set(false);
    this.wideHint.set(false);
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

  private stageEl(): HTMLElement | null {
    return document.querySelector('div.camera-stage');
  }

  private attachVideo(attempt = 0) {
    const video = this.videoEl();
    if (!video) {
      if (attempt < 12) setTimeout(() => this.attachVideo(attempt + 1), 50);
      return;
    }
    if (this.stream && video.srcObject !== this.stream) video.srcObject = this.stream;
    const syncSize = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      if (this.videoW() !== video.videoWidth) this.videoW.set(video.videoWidth);
      if (this.videoH() !== video.videoHeight) this.videoH.set(video.videoHeight);
    };
    video.addEventListener('loadedmetadata', syncSize, { once: true });
    syncSize();
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
    this.sheetHits = 0;
    this.sheetArmed = true;
    this.sheetHint.set('');
    this.sheetQuad.set(null);
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
      // A small QR (the PIN half-sheet's code is ~10% of the sheet width)
      // drops under jsQR's ~2px-per-module floor once a far-framed sheet is
      // squeezed into the cheap 900px preview decode. When nothing has been
      // seen for a moment — or while a candidate is mid-confirmation — step
      // up to a full-resolution search decode. The candidate case matters:
      // one search hit resets `absent`, so falling straight back to the 900px
      // preview would miss the next ticks and the confirmation counter could
      // never reach 2 — the width must not oscillate under a confirming sheet.
      const search = this.liveAbsent >= LIVE_SCAN.searchAfterTicks || this.liveHits > 0;
      // search ticks alternate 1600 ↔ 2400: the deep pass decodes tiny QRs
      // where the 1600 upscale fails (the binarizer needs bigger modules),
      // at twice the cost — acceptable only while pointed at nothing
      const searchWidth = search
        ? (this.tickCount % 2 === 0 ? LIVE_SCAN.searchDeepWidth : LIVE_SCAN.searchWidth)
        : LIVE_SCAN.previewWidth;
      this.tickCount++;
      let text: string | null = null;
      if (this.detector) {
        text = await this.detectWithDetector(video);
        if (text) {
          this.detectorMisses = 0;
        } else if (++this.detectorMisses % 3 === 0 || search) {
          // Some WebViews expose BarcodeDetector but return nothing (no
          // barcode module installed). Probe with jsQR every third empty tick
          // so the live scanner cannot end up blind.
          text = this.decodeLiveFrame(video, searchWidth);
        }
      } else {
        text = this.decodeLiveFrame(video, searchWidth);
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
      // the absence counter drives the search decode (small QRs need the
      // full-res pass), the re-arm below, and the "move closer" hint
      this.searchHint.set(step.status === 'looking' && this.liveAbsent >= 12);
      // Seeing nothing for a moment re-arms the paper that was just scanned,
      // so a deliberate rescan works by lifting the phone away and back.
      if (step.absent >= LIVE_SCAN.rearmTicks) {
        this.scannedQr = null;
        this.sheetArmed = true;
      }
      this.livePhase.set(step.status);
      if (step.scan) {
        this.cooldownUntil = now + LIVE_SCAN.cooldownMs;
        this.liveCandidate = null;
        this.liveHits = 0;
        this.sheetHits = 0;
        this.sheetArmed = false;
        this.sheetHint.set('');
        this.sheetQuad.set(null);
        if ('vibrate' in navigator) navigator.vibrate?.(35);
        // Keep the live QR that triggered the capture. `grabFrame` is a
        // different image (and may be smaller or blurrier than the search
        // decode), so re-reading it can fail even though the sheet was just
        // identified.
        void this.processImage(this.grabFrame(video), true, step.scan);
        return;
      }

      // The QR is not required to trigger a capture. A sheet whose four
      // corner squares and printed frame are visible can fire on its own;
      // the high-resolution capture then reads the QR from a rectified crop.
      // This is what makes a landscape sheet on a laptop screen work even
      // when its QR is below the preview decoder's resolution floor.
      const lock = this.detectLiveSheet(video);
      if (!lock) {
        this.sheetHits = 0;
        this.sheetHint.set('');
        this.sheetQuad.set(null);
        return;
      }
      // The sheet is present, so the QR-absence counter must not climb and
      // re-arm a second capture while it is still sitting in view.
      this.liveAbsent = 0;
      this.searchHint.set(false);
      this.scanError.set('');
      if (lock.edge) {
        this.sheetHits = 0;
        this.livePhase.set('looking');
        this.sheetHint.set('Move back - the sheet is cropped at the edge');
        this.sheetQuad.set({ points: lock.quadVideo, edge: true, stable: false });
        return;
      }
      this.livePhase.set('locking');
      this.sheetHint.set('Sheet found — hold still…');
      this.sheetHits++;
      this.sheetQuad.set({ points: lock.quadVideo, edge: false, stable: this.sheetHits >= 2 });
      if (!this.sheetArmed || this.sheetHits < 2) return;
      this.sheetArmed = false;
      this.sheetHits = 0;
      this.sheetHint.set('');
      this.sheetQuad.set(null);
      this.cooldownUntil = now + LIVE_SCAN.cooldownMs;
      const qrHint = this.liveCandidate;
      this.liveCandidate = null;
      this.liveHits = 0;
      if ('vibrate' in navigator) navigator.vibrate?.(35);
      void this.processImage(this.grabFrame(video), true, qrHint);
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

  // The zoom crop rectangle: center half of the frame at zoom 2, full frame at 1.
  private zoomRect(video: HTMLVideoElement) {
    const zoom = this.camZoom();
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = Math.round(vw / zoom), ch = Math.round(vh / zoom);
    return { sx: Math.round((vw - cw) / 2), sy: Math.round((vh - ch) / 2), cw, ch };
  }

  private decodeLiveFrame(video: HTMLVideoElement, maxWidth = LIVE_SCAN.previewWidth): string | null {
    const { sx, sy, cw, ch } = this.zoomRect(video);
    if (!cw || !ch) return null;
    // preview decodes never upscale (native pixels, downscaled to fit);
    // search decodes always run at the full search width — upscaling a small
    // stream gives jsQR the module resolution a far-framed QR loses at 720p
    const width = Math.round(maxWidth > cw ? maxWidth : Math.min(maxWidth, cw));
    const height = Math.round(ch * (width / cw));
    let canvas = this.liveCanvas;
    if (!canvas) canvas = this.liveCanvas = document.createElement('canvas');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    return decodeQr(frame.data, width, height, { inversionAttempts: 'dontInvert' });
  }

  // Cheap marker/frame lock for the auto-capture trigger. QR decoding alone
  // cannot fire when the code is too small for the preview; four corner
  // squares are much easier to see. Uses the same zoom crop as the preview.
  private detectLiveSheet(video: HTMLVideoElement): SheetLock | null {
    if (video.videoWidth && this.videoW() !== video.videoWidth) this.videoW.set(video.videoWidth);
    if (video.videoHeight && this.videoH() !== video.videoHeight) this.videoH.set(video.videoHeight);
    const { sx, sy, cw, ch } = this.zoomRect(video);
    if (!cw || !ch) return null;
    const width = Math.min(LIVE_SCAN.previewWidth, cw);
    const height = Math.round(ch * (width / cw));
    let canvas = this.liveCanvas;
    if (!canvas) canvas = this.liveCanvas = document.createElement('canvas');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    // Four printed corner squares are enough to arm the live capture. The old
    // black frame was removed from the sheet design, so requiring it here made
    // borderless prints impossible to auto-scan.
    const detected = detectSheet({ data: frame.data, width, height }, 0);
    if (!detected) return null;
    const quadVideo = detected.quad.map((p: SheetPoint) => ({
      x: sx + p.x * (cw / width),
      y: sy + p.y * (ch / height),
    }));
    return { ...detected, quadVideo };
  }

  private grabFrame(video: HTMLVideoElement, maxWidth = 2048): ImageData {
    const { sx, sy, cw, ch } = this.zoomRect(video);
    // Capture the (possibly zoomed) region at native resolution for OMR.
    // The old 1200px cap downscaled a 1920px stream to 1200 — shrinking a
    // sheet's corner squares and QR below what the reader can resolve. Only
    // upscale small regions (toward 1600px) and cap truly huge frames.
    const scale = Math.min(3, Math.max(1, 1600 / cw), maxWidth / cw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(ch * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  closeCamera() {
    this.stopLiveLoop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.track = null;
    this.cameraActive.set(false);
    // Release the preview canvas and platform barcode detector too; the page
    // can sit in the background for a long time between scans.
    this.liveCanvas = null;
    this.detector = null;
    this.detectorFails = 0;
    this.detectorMisses = 0;
    this.livePhase.set('off');
    this.liveCandidate = null;
    this.liveHits = 0;
    this.liveAbsent = 0;
    this.sheetHits = 0;
    this.sheetArmed = true;
    this.sheetHint.set('');
    this.sheetQuad.set(null);
    this.videoW.set(0);
    this.videoH.set(0);
    this.tickCount = 0;
    this.scannedQr = null;
    this.camZoom.set(1);
    this.torchOn.set(false);
    this.searchHint.set(false);
    if (this.wideOn()) this.exitWide();
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
  private async processImage(data: ImageData, fromLive = false, qrHint: string | null = null) {
    try {
      await this.processImageInner(data, fromLive, qrHint);
    } catch (e: any) {
      this.processing.set(false);
      this.scanError.set('Could not read that sheet' + (e?.message ? ' — ' + e.message : '') + '. Try again, or use Check from photo.');
    }
  }

  private logScanDiag(diag: any) {
    try { console.info('QUIZARD_SCAN_DIAG', JSON.stringify(diag)); } catch { /* diagnostics must never block a scan */ }
  }

  private async processImageInner(data: ImageData, fromLive = false, qrHint: string | null = null) {
    this.processing.set(true);
    // A live retry keeps the previous message on screen until it succeeds or
    // fails again, so the viewfinder does not flicker while the teacher
    // reframes the sheet.
    if (!fromLive) this.scanError.set('');
    // let the spinner paint before the synchronous CV work blocks the frame
    await new Promise(r => setTimeout(r, 60));
    this.scannedPin.set(null);

    // The QR identifies the quiz — and, on roster-printed sheets, the student —
    // before any geometry work. Prefer the text the live scanner already read;
    // the saved frame may be cropped, downscaled or motion-blurred compared
    // with the frame that produced the live hit. If neither has it, find the
    // corner squares and decode a rectified crop of the known QR rectangle.
    let qrSource: 'live' | 'full' | 'tile' | 'crop' | 'none' = qrHint ? 'live' : 'none';
    let qrText = qrHint;
    let qrLocation: any = null;
    // Keep the QR corners from the captured frame. They are a second
    // alignment source when the printed corner squares are clipped or a
    // paper-edge/shadow quad was mistaken for the markers.
    const located = decodeQrAnywhere({ data: data.data, width: data.width, height: data.height });
    if (located) {
      qrLocation = located.location;
      if (!qrText || located.text !== qrText) {
        qrText = located.text;
        qrSource = located.source === 'tile' ? 'tile' : 'full';
      }
    } else if (!qrText) {
      qrText = decodeQrFromSheet({ data: data.data, width: data.width, height: data.height });
      if (qrText) qrSource = 'crop';
    }
    const parsed = parseSheetQr(qrText);
    let quiz: any = null;
    let demoMatch: { cls: any; student: any } | null = null;
    if (parsed?.demo) {
      // The bundled demo sheet points at stable demo keys, not this profile's
      // storage ids. Resolve it against the demo records loaded here.
      const match = resolveDemoSheet(parsed, this.classes(), await listQuizzes());
      if (!match) {
        this.processing.set(false);
        this.logScanDiag({ reason: 'demo', qr: qrText, qrSource, width: data.width, height: data.height });
        this.scanError.set('This is the built-in demo sheet. Open Settings → Demo data → Load demo data, then scan it again.');
        // the sheet is still in frame: do not fire on it again until the
        // teacher has fixed the data and deliberately moves away and back
        if (fromLive) this.scannedQr = qrText;
        return;
      }
      quiz = match.quiz;
      // QZD2 demo PIN sheets resolve to the class + quiz only: the shaded
      // 5-digit PIN names the student through the normal PIN path below.
      demoMatch = match.student ? { cls: match.cls, student: match.student } : null;
    } else {
      const quizId = parsed?.quizId || this.quizOverrideId();
      quiz = quizId ? await getQuiz(quizId) : null;
    }
    if (!quiz) {
      this.processing.set(false);
      this.logScanDiag({ reason: 'quiz', qr: qrText, qrSource, width: data.width, height: data.height });
      // two different failures wore one message before: a photo with no
      // readable QR at all, and a QR naming a quiz this device doesn't have
      // (sheets printed on another phone / browser, or a deleted quiz)
      // the quiz name rides in the QR (newer sheets), so the teacher at least
      // knows which paper this is even when the quiz isn't on this device
      this.scanError.set(parsed
        ? `This sheet’s quiz isn’t on this device${parsed.quizName ? ` — the QR says “${parsed.quizName}”` : parsed.studentName ? ` (the QR names ${parsed.studentName})` : ''} — it was printed somewhere else or deleted here. Pick the quiz manually on the setup screen and scan again.`
        : 'Captured the sheet, but could not read its QR code — move back so the whole QR block is inside and not glared out, then try again. Or use Check from photo, or pick the quiz manually on the setup screen.');
      if (fromLive && parsed) this.scannedQr = qrText;
      return;
    }

    // PIN half-sheets (QZ3) use the fixed 50-item geometry; roster sheets use
    // the per-quiz geometry. With a manual quiz override and no readable QR,
    // try the PIN geometry as a fallback — the override flow is how PIN sheets
    // get scanned when the code won't decode.
    const pinSheet = parsed?.pinSheet === true;
    const pinV3 = parsed?.pinSheetVersion === 3
      || (typeof qrText === 'string' && qrText.startsWith('QZ3v3:'));
    const readPin = pinV3 ? readPinSheetV3 : readPinSheet;
    let result: any = pinSheet
      ? readPin({ data: data.data, width: data.width, height: data.height }, qrText, qrSource, qrLocation)
      : readSheet({ data: data.data, width: data.width, height: data.height }, quiz.items.length, qrText, qrSource, qrLocation);
    if (!result.ok && !pinSheet && this.quizOverrideId()) {
      result = readPin({ data: data.data, width: data.width, height: data.height }, qrText, qrSource, qrLocation);
    }
    if (!result.ok) {
      this.processing.set(false);
      this.logScanDiag(result.diag || {
        reason: result.reason, qr: qrText, qrSource, width: data.width, height: data.height,
      });
      // the engine reports which step failed — name it, so the teacher can
      // act instead of re-framing blind (glare, moiré and a small sheet kill
      // the corner squares; a shadow, a fold or a glare streak breaks the
      // printed frame line)
      this.scanError.set(result.reason === 'frame'
        ? 'Found the corner squares, but the black frame line is broken — move back so the whole page is inside, avoid glare and shadows, and keep it flat. It will retry automatically.'
        : 'Could not align the sheet — move back until the whole page and all four black corner squares are inside the frame. The sheet can be small; keep it flat and evenly lit. Or use Check from photo. It will retry automatically.');
      // a framing miss is worth another automatic try once the phone is moved
      if (fromLive) this.scannedQr = null;
      return;
    }
    const answers = result.answers, flags = result.flags;
    // A PIN half-sheet whose PIN is unreadable and whose bubble grid is almost
    // entirely blank is not a result — it is a failed alignment. Showing a
    // random 1/50 score is worse than asking for a rescan. A genuinely blank
    // sheet still works because its PIN identifies the student.
    const answered = answers.filter((a: number) => a >= 0).length;
    const minRead = Math.max(5, Math.ceil((quiz.items?.length || 50) * 0.1));
    if (pinSheet && !result.pin && answered < minRead) {
      this.processing.set(false);
      this.logScanDiag({ ...(result.diag || {}), reason: 'low-confidence', answered });
      this.scanError.set('Could not read the shaded PIN or enough answers — nothing was saved. Move back so the whole page is inside, avoid glare, and try again. If this is an older print with clipped corner squares, use the clean sheet.');
      if (fromLive) this.scannedQr = null;
      return;
    }
    this.logScanDiag(result.diag || {
      reason: 'ok', qr: qrText, qrSource, width: data.width, height: data.height,
    });
    this.zone.run(() => {
      this.scanError.set('');
      this.qrHit.set(result.qr || qrText);
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
      // Generic PIN sheets name nobody in the QR: the shaded 5-digit PIN is
      // the student's identity, matched inside the quiz's own class. The read
      // PIN is kept so a manual pick can register it (first paper teaches the
      // roster who that PIN belongs to).
      this.scannedPin.set(result.pin || null);
      let pinStudent: any = null;
      let pinHint = '';
      if (!qrStudent && result.pin !== undefined) {
        if (result.pin) {
          pinStudent = this.matchPinStudent(quiz, result.pin);
          if (!pinStudent) {
            pinHint = `The shaded PIN ${result.pin.split('').join(' ')} didn't match one student in ${quiz.className || 'this class'} — pick whose paper this is below; it will be registered to them.`;
          }
        } else {
          pinHint = `The PIN wasn't readable (${result.pinDigits.map((d: number) => (d >= 0 ? String(d) : '·')).join(' ')}) — pick whose paper this is below.`;
        }
      }
      const student = qrStudent || pinStudent;
      if (student) {
        // Remember the paper that was just read so the live loop moves on to
        // the next sheet instead of firing on this one again.
        if (fromLive) this.scannedQr = qrText;
        this.qrUnknownName.set(null);
        this.scanError.set('');
        this.attachStudent(student, 'qr');
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
        this.scanError.set(pinHint);
        // Nobody in the QR or PIN: the result screen's picker decides whose
        // paper it is. That screen has no viewfinder, so release the camera.
        this.closeCamera();
        this.stage.set('result');
      }
      this.processing.set(false);
    });
  }

  // PIN half-sheets: match the shaded 5-digit PIN against the quiz's own
  // roster. Duplicates and unknowns return null — the teacher attaches
  // manually rather than score the wrong student's paper.
  private matchPinStudent(quiz: any, pin: string | null) {
    if (!pin) return null;
    const cls = this.classes().find(c => c.id === quiz.classId) || this.pickedClass();
    return resolveStudentByPin(cls?.students || [], pin);
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
    // The popup names the quiz: with several quizzes per class, "recorded ✓"
    // alone never says where the scan just landed.
    return { id: saved.id, name, section: saved.section || '', quiz: quizTitle(quiz), percent: s.percent, correct: s.correct, total: s.total };
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

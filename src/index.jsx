import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./index.module.css";

const PHASES = { IDLE: "idle", PREP: "prep", WORK: "work", REST: "rest" };
const PREP_DURATION = 5;
const REST_DURATION = 15;
const WORK_OPTIONS = [15, 30, 45, 60];
const REST_OPTIONS = [5, 10, 15, 20];

function useAudio() {
  const ctxRef = useRef(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const beep = useCallback((freq, duration) => {
    const ctx = getCtx();
    const fundamental = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const fundamentalGain = ctx.createGain();
    const overtoneGain = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();

    // Acts as a limiter: raises perceived loudness so beeps cut through music.
    compressor.threshold.value = -18;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0;
    compressor.release.value = 0.1;

    fundamental.type = "sine";
    fundamental.frequency.value = freq;
    fundamental.connect(fundamentalGain);
    fundamentalGain.connect(compressor);

    overtone.type = "sine";
    overtone.frequency.value = freq * 2;
    overtone.connect(overtoneGain);
    overtoneGain.connect(compressor);

    compressor.connect(ctx.destination);

    // Bell-like envelope: fast attack, exponential decay.
    const now = ctx.currentTime;
    const tail = Math.max(duration, 0.25);
    const attack = 0.005;
    fundamentalGain.gain.setValueAtTime(0, now);
    fundamentalGain.gain.linearRampToValueAtTime(0.9, now + attack);
    fundamentalGain.gain.exponentialRampToValueAtTime(0.001, now + tail);
    overtoneGain.gain.setValueAtTime(0, now);
    overtoneGain.gain.linearRampToValueAtTime(0.2, now + attack);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + tail);

    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + tail);
    overtone.stop(now + tail);
  }, [getCtx]);

  const warningBeep = useCallback(() => beep(440, 0.1), [beep]);
  const transitionBeep = useCallback(() => beep(880, 0.3), [beep]);

  return { warningBeep, transitionBeep };
}

function useWakeLock(active) {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let lock = null;
    let cancelled = false;

    const request = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) {
          l.release();
          return;
        }
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
      } catch {
        // permission denied or unsupported state — ignore
      }
    };

    request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !lock) request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (lock) {
        lock.release();
        lock = null;
      }
    };
  }, [active]);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function phaseDuration(phase, workDuration, restDuration) {
  if (phase === PHASES.PREP) return PREP_DURATION;
  if (phase === PHASES.WORK) return workDuration;
  if (phase === PHASES.REST) return restDuration;
  return 0;
}

function phaseStyleKey(phase) {
  if (phase === PHASES.PREP) return "Prep";
  if (phase === PHASES.WORK) return "Work";
  if (phase === PHASES.REST) return "Rest";
  return "Idle";
}

const RING_RADIUS = 120;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function App() {
  const [phase, setPhase] = useState(PHASES.IDLE);
  const [workDuration, setWorkDuration] = useState(30);
  const [restDuration, setRestDuration] = useState(REST_DURATION);
  const [timeLeft, setTimeLeft] = useState(0);
  const [round, setRound] = useState(1);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const phaseRef = useRef(phase);
  const workDurationRef = useRef(workDuration);
  phaseRef.current = phase;
  workDurationRef.current = workDuration;
  const { warningBeep, transitionBeep } = useAudio();

  const isActive = phase !== PHASES.IDLE;
  useWakeLock(running);

  const advancePhase = useCallback(() => {
    transitionBeep();
    if (phase === PHASES.PREP) {
      setPhase(PHASES.WORK);
      setTimeLeft(workDuration);
    } else if (phase === PHASES.WORK) {
      setPhase(PHASES.REST);
      setTimeLeft(restDuration);
    } else if (phase === PHASES.REST) {
      setRound((r) => r + 1);
      setPhase(PHASES.WORK);
      setTimeLeft(workDuration);
    }
  }, [phase, workDuration, restDuration, transitionBeep]);

  useEffect(() => {
    if (!running) {
      clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1;
        if (phaseRef.current === PHASES.WORK && next === Math.floor(workDurationRef.current / 2)) {
          warningBeep();
        }
        if (next > 0 && next <= 3) warningBeep();
        if (next <= 0) {
          advancePhase();
          return prev; // advancePhase sets the new timeLeft
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [running, advancePhase, warningBeep]);

  const handleStart = () => {
    setPhase(PHASES.PREP);
    setTimeLeft(PREP_DURATION);
    setRound(1);
    setRunning(true);
  };

  const handlePause = () => setRunning(false);
  const handleResume = () => setRunning(true);

  const cycleRestDuration = () => {
    if (isActive) return;
    const idx = REST_OPTIONS.indexOf(restDuration);
    setRestDuration(REST_OPTIONS[(idx + 1) % REST_OPTIONS.length]);
  };

  const handleReset = () => {
    setRunning(false);
    setPhase(PHASES.IDLE);
    setTimeLeft(0);
    setRound(1);
  };

  const totalDuration = phaseDuration(phase, workDuration, restDuration);
  const progress = totalDuration > 0 ? timeLeft / totalDuration : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const styleKey = phaseStyleKey(phase);

  const phaseLabels = {
    [PHASES.IDLE]: "READY",
    [PHASES.PREP]: "GET READY",
    [PHASES.WORK]: "WORK",
    [PHASES.REST]: "REST",
  };

  return (
    <div className={styles.app}>
      <div className={`${styles.phaseLabel} ${styles["phaseLabel" + styleKey]}`}>
        {phaseLabels[phase]}
      </div>

      <div className={styles.ringWrap}>
        <svg className={styles.ringSvg} viewBox="0 0 260 260">
          <circle className={styles.ringBg} cx="130" cy="130" r={RING_RADIUS} />
          <circle
            className={`${styles.ringFg} ${styles["ring" + styleKey]}`}
            cx="130"
            cy="130"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className={styles.countdown}>
          <div className={styles.countdownTime}>
            {isActive ? formatTime(timeLeft) : formatTime(workDuration)}
          </div>
          <div className={styles.roundLabel}>Round {round}</div>
        </div>
      </div>

      <div className={styles.selector}>
        {WORK_OPTIONS.map((opt) => (
          <button
            key={opt}
            className={`${styles.selectorBtn} ${opt === workDuration ? styles.selectorBtnActive : ""}`}
            disabled={isActive}
            onClick={() => setWorkDuration(opt)}
          >
            {opt}s
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        {!isActive && (
          <button className={styles.btnStart} onClick={handleStart}>
            Start
          </button>
        )}
        {isActive && running && (
          <button className={styles.btnPause} onClick={handlePause}>
            Pause
          </button>
        )}
        {isActive && !running && (
          <>
            <button className={styles.btnResume} onClick={handleResume}>
              Resume
            </button>
            <button className={styles.btnReset} onClick={handleReset}>
              Reset
            </button>
          </>
        )}
        {isActive && running && (
          <button className={styles.btnReset} onClick={handleReset}>
            Reset
          </button>
        )}
      </div>

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Work</div>
          <div className={`${styles.summaryCardValue} ${styles.summaryCardWork}`}>
            {formatTime(workDuration)}
          </div>
        </div>
        <div
          className={`${styles.summaryCard} ${!isActive ? styles.summaryCardTappable : ""}`}
          onClick={cycleRestDuration}
        >
          <div className={styles.summaryCardLabel}>Rest {!isActive && "▾"}</div>
          <div className={`${styles.summaryCardValue} ${styles.summaryCardRest}`}>
            {formatTime(restDuration)}
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);

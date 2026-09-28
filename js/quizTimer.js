import { prefersReducedMotion } from "./motion.js";

const DEFAULT_COLORS = {
  green: "var(--mint)",
  yellow: "var(--amber)",
  red: "var(--danger)"
};

const DEFAULT_THRESHOLDS = {
  warning: 0.5,
  critical: 0.1
};

const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function resolveColorToRGB(color, owner = document.documentElement) {
  if (typeof color !== "string") return "rgb(94,234,212)";
  const temp = document.createElement("div");
  temp.style.color = color;
  owner.appendChild(temp);
  const computed = getComputedStyle(temp).color;
  owner.removeChild(temp);
  const match = computed.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (match) return computed;
  return color;
}

function interpolateRGB(fromRGB, toRGB, t) {
  const parse = (s) => {
    const m = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : [0, 0, 0];
  };
  const a = parse(fromRGB);
  const b = parse(toRGB);
  const result = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${result[0]}, ${result[1]}, ${result[2]})`;
}

function getPhaseFromPercentage(pct, warningThreshold, criticalThreshold) {
  if (pct <= criticalThreshold) return "critical";
  if (pct <= warningThreshold) return "warning";
  return "calm";
}

function getLabelForPhase(phase, timeLeft) {
  switch (phase) {
    case "critical":
      return "Hurry!";
    case "warning":
      return "Time winding down";
    case "calm":
      return "Time remaining";
    case "idle":
      return "Timer ready";
    case "inactive":
      return "Timer paused";
    default:
      return "Time remaining";
  }
}

export class QuizTimer {
  constructor(container, options = {}) {
    this.container = container;
    this.duration = options.duration ?? 30;
    this.warningThreshold = options.warningThreshold ?? DEFAULT_THRESHOLDS.warning;
    this.criticalThreshold = options.criticalThreshold ?? DEFAULT_THRESHOLDS.critical;
    this.colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };

    this.timeLeft = 0;
    this.total = this.duration;
    this.deadline = null;
    this.interval = null;
    this.phase = "idle";
    this.running = false;

    this._onTick = options.onTick ?? null;
    this._onPhaseChange = options.onPhaseChange ?? null;
    this._onWarning = options.onWarning ?? null;
    this._onCritical = options.onCritical ?? null;
    this._onTimeout = options.onTimeout ?? null;

    this._resolvedColors = null;
    this._currentColor = null;
    this._animateId = null;

    this._resolveColors();
    this._render();
  }

  _resolveColors() {
    const owner = this.container.ownerDocument.documentElement;
    this._resolvedColors = {
      green: resolveColorToRGB(this.colors.green, owner),
      yellow: resolveColorToRGB(this.colors.yellow, owner),
      red: resolveColorToRGB(this.colors.red, owner)
    };
  }

  _render() {
    if (!this.container) return;

    this.container.innerHTML = "";

    this.container.setAttribute("class", "quiz-timer-widget");
    this.container.setAttribute("data-state", "idle");
    this.container.setAttribute("data-phase", "idle");
    this.container.setAttribute("aria-live", "polite");
    this.container.setAttribute("aria-atomic", "true");
    this.container.setAttribute("role", "group");
    this.container.setAttribute("aria-label", "Quiz timer");

    this.container.style.setProperty("--timer-color-green", this.colors.green);
    this.container.style.setProperty("--timer-color-yellow", this.colors.yellow);
    this.container.style.setProperty("--timer-color-red", this.colors.red);

    this.container.innerHTML = `
      <div class="quiz-timer-ring-wrap">
        <svg class="quiz-timer-ring" viewBox="0 0 44 44" role="img" aria-label="Time remaining ring" focusable="false">
          <circle class="quiz-timer-ring-bg" cx="22" cy="22" r="${RING_RADIUS}"/>
          <circle class="quiz-timer-ring-fill" id="quizTimerRing" cx="22" cy="22" r="${RING_RADIUS}"/>
        </svg>
        <span class="quiz-timer" id="quizTimer" aria-hidden="true"></span>
        <span class="quiz-timer-dot" aria-hidden="true"></span>
      </div>
      <span class="quiz-timer-label" id="quizTimerLabel" data-state="idle"></span>
    `;

    this.ringFill = this.container.querySelector(".quiz-timer-ring-fill");
    this.timeEl = this.container.querySelector(".quiz-timer");
    this.labelEl = this.container.querySelector(".quiz-timer-label");
    this.dotEl = this.container.querySelector(".quiz-timer-dot");

    this.ringFill.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    this.ringFill.style.strokeDashoffset = "0";
    this._setRingProgress(0);
    this._setColor(this._resolvedColors.green);
    this._setLabelState("idle", "00:00");
  }

  _setLabelState(phase, timeStr) {
    if (this.labelEl) {
      this.labelEl.textContent = getLabelForPhase(phase, timeStr);
      this.labelEl.setAttribute("data-state", phase);
    }
  }

  _computeColor(percentage) {
    const { green, yellow, red } = this._resolvedColors;

    if (percentage >= this.warningThreshold) {
      const t = (percentage - this.warningThreshold) / (1 - this.warningThreshold);
      return interpolateRGB(green, yellow, 1 - t);
    }
    if (percentage >= this.criticalThreshold) {
      const t = (percentage - this.criticalThreshold) / (this.warningThreshold - this.criticalThreshold);
      return interpolateRGB(yellow, red, 1 - t);
    }
    return red;
  }

  _setColor(rgbColor) {
    if (!this.ringFill || !this.timeEl || !this.dotEl) return;

    if (this._currentColor === rgbColor && this._animateId === null) return;

    if (this._currentColor && this._currentColor !== rgbColor) {
      this._animateColor(this._currentColor, rgbColor);
    } else {
      this._currentColor = rgbColor;
      this.container.style.setProperty("--timer-color-current", rgbColor);
      this.ringFill.style.stroke = rgbColor;
      this.timeEl.style.color = rgbColor;
      this.dotEl.style.background = rgbColor;
    }
  }

  _animateColor(from, to) {
    if (this._animateId !== null) {
      cancelAnimationFrame(this._animateId);
    }

    const startTs = performance.now();
    const duration = prefersReducedMotion() ? 0 : 320;

    const step = (ts) => {
      const elapsed = ts - startTs;
      const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
      const color = interpolateRGB(from, to, t);
      this.container.style.setProperty("--timer-color-current", color);
      this.ringFill.style.stroke = color;
      this.timeEl.style.color = color;
      this.dotEl.style.background = color;

      if (t < 1) {
        this._animateId = requestAnimationFrame(step);
      } else {
        this._currentColor = to;
        this._animateId = null;
      }
    };

    this._animateId = requestAnimationFrame(step);
  }

  _setRingProgress(percentage) {
    if (this.ringFill) {
      const offset = RING_CIRCUMFERENCE * (1 - percentage);
      this.ringFill.style.strokeDashoffset = String(offset);
    }
  }

  _updateDisplay(isTick = false) {
    const mins = Math.floor(this.timeLeft / 60);
    const secs = this.timeLeft % 60;
    const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (this.timeEl) {
      this.timeEl.textContent = timeStr;
      this.timeEl.setAttribute("aria-hidden", "true");
    }

    const percentage = this.total > 0 ? this.timeLeft / this.total : 0;
    const newPhase = getPhaseFromPercentage(percentage, this.warningThreshold, this.criticalThreshold);
    this._setPhase(newPhase, timeStr);

    this._setRingProgress(percentage);

    const color = this._computeColor(percentage);
    this._setColor(color);

    this._setLabelState(newPhase, timeStr);

    if (this.container) {
      this.container.setAttribute("aria-label", `Time remaining: ${this.timeLeft} second${this.timeLeft === 1 ? "" : "s"}. Phase: ${getLabelForPhase(newPhase, timeStr)}`);
    }

    if (isTick && this.timeEl && !prefersReducedMotion()) {
      this.timeEl.classList.add("timer-tick");
      setTimeout(() => this.timeEl.classList.remove("timer-tick"), 120);
    }
  }

  _setPhase(newPhase, timeStr) {
    if (newPhase === this.phase) return;

    const oldPhase = this.phase;
    this.phase = newPhase;

    if (this.container) {
      this.container.setAttribute("data-phase", newPhase);
      this.container.setAttribute("data-state", newPhase === "idle" ? "idle" : newPhase === "inactive" ? "inactive" : "active");
    }

    if (newPhase === "warning" && this._onWarning) this._onWarning();
    if (newPhase === "critical" && this._onCritical) this._onCritical();
    if (this._onPhaseChange) this._onPhaseChange(newPhase, oldPhase);
  }

  start(duration = this.duration) {
    this.stop();

    this.duration = duration;
    this.total = duration;

    if (duration <= 0) {
      this.timeLeft = 0;
      this.deadline = null;
      this._setPhase("idle", "00:00");
      this._setLabelState("idle", "00:00");
      this._setRingProgress(0);
      this._setColor(this._resolvedColors.green);
      if (this.timeEl) this.timeEl.textContent = "—:—";
      return;
    }

    this.timeLeft = duration;
    this.deadline = Date.now() + duration * 1000;
    this.running = true;
    this._updateDisplay();
    this.interval = setInterval(() => this._tick(), 250);
  }

  _tick() {
    if (!this.deadline) return;

    const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));

    if (remaining !== this.timeLeft) {
      this.timeLeft = remaining;
      this._updateDisplay(true);
      if (this._onTick) this._onTick(this.timeLeft);
    }

    if (this.timeLeft <= 0) {
      this._handleTimeout();
    }
  }

  _handleTimeout() {
    this.running = false;
    this.deadline = null;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this._setPhase("critical", "00:00");
    if (this.container) {
      this.container.setAttribute("data-state", "timeout");
    }
    if (this.labelEl) {
      this.labelEl.textContent = "Time's up";
      this.labelEl.setAttribute("data-state", "critical");
    }
    if (this.timeEl) this.timeEl.textContent = "00:00";
    this._setRingProgress(0);
    this._setColor(this._resolvedColors.red);

    if (this._onTimeout) this._onTimeout();
  }

  pause() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
  }

  resume() {
    if (this.deadline && !this.interval) {
      this._tick();
      this.interval = setInterval(() => this._tick(), 250);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this._animateId !== null) {
      cancelAnimationFrame(this._animateId);
      this._animateId = null;
    }
    this.running = false;
    this.deadline = null;
    this.timeLeft = 0;
    this._setPhase("idle", "00:00");
    this._setLabelState("inactive", "00:00");
    this._setRingProgress(0);
    this._setColor(this._resolvedColors.green);
    if (this.timeEl) this.timeEl.textContent = "—:—";
    if (this.container) {
      this.container.setAttribute("data-state", "inactive");
      this.container.setAttribute("aria-label", "Timer paused");
    }
  }

  reset() {
    this.stop();
  }

  setDuration(duration) {
    this.duration = duration;
    this.total = duration;
  }

  setThresholds(warningThreshold, criticalThreshold) {
    if (warningThreshold !== undefined) this.warningThreshold = warningThreshold;
    if (criticalThreshold !== undefined) this.criticalThreshold = criticalThreshold;
  }

  setColors(colors) {
    this.colors = { ...this.colors, ...colors };
    this._resolveColors();
    if (this.container) {
      this.container.style.setProperty("--timer-color-green", this.colors.green);
      this.container.style.setProperty("--timer-color-yellow", this.colors.yellow);
      this.container.style.setProperty("--timer-color-red", this.colors.red);
    }
    if (this.running && this.deadline) {
      this._updateDisplay();
    }
  }

  getRemainingSeconds() {
    return this.timeLeft;
  }

  getPhase() {
    return this.phase;
  }

  isRunning() {
    return this.running;
  }
}

export default QuizTimer;

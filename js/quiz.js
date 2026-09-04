// Requires utils.js loaded first (SUBJECT_NAMES, pad, getSubjectFromURL)
import { auth, db } from "../firebase/firebase.js";

import { recordActivity } from "../js/activity.js";
import { recordQuizResult } from "../js/userProfile.js";

import {
    getQuestionBank,
    getAvailableQuestionCount,
    pad,
    getSubjectFromURL,
    getQuestionTimerSeconds,
    getUserSettings
} from "../utils/utils.js";

import {
    doc,
    getDoc,
    updateDoc,
    increment
} from "firebase/firestore";

import {
    saveWrongAnswers
} from "../services/wrongAnswerService.js";

const SUBJECT_NAMES = {

    pnleSets: "Comprehensive PNLE SETS",
    fundamentals: "Foundation of Nursing",
    maternal: "Maternal & Child Nursing",
    community: "Community Health Nursing",
    medSurg: "Medical-Surgical Nursing",
    psychiatric: "Psychiatric Nursing",
    allTopics: "All Topics"

};

function getLegacySubjectMap() {
    return {
        fundamentals: "foundation-nursing-process-assessment",
        maternal: "maternal-maternalHealth",
        pediatric: "maternal-pediatric",
        psychiatric: "psychiatric-1",
        medSurg: "medSurg-1",
        community: "community-1",
        pharma: "pharma-1",
        leadership: "leadership-1"
    };
}

function resolveSubjectKey(rawKey) {
    const legacy = getLegacySubjectMap();
    return legacy[rawKey] || rawKey;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

let bank = {};            // full JSON bank, fetched once
let questions = [];       // active quiz's questions
let currentQuestion = 0;
let score = 0;
let answers = [];         // stores selected index per question, resets per quiz
let currentSubject = getSubjectFromURL("fundamentals");
let currentQuizId = "";
let currentQuizMeta = null;

// Canonical storage key for a quiz's mistakes. Prefer the catalog subjectKey,
// then quizId, so mistakes are always saved (and later retrieved) under one
// stable key regardless of whether the quiz was launched by quizId or subject.
function getCanonicalSubjectKey() {
    if (currentQuizMeta) {
        return currentQuizMeta.subjectKey || currentQuizMeta.quizId;
    }
    return currentSubject || currentQuizId || "unknown";
}

const TIMER_RING_CIRC = 2 * Math.PI * 19;
const ORIGINAL_PAGE_TITLE = document.title;

let timeLeft = 0;
let timerInterval = null;
let timerDeadline = null;
let urgencyPulseInterval = null;
let urgencyPulseActive = false;

// Returns the active per-question duration from saved settings.
// Re-read each call so changes in Settings take effect on the next question.
function getQuestionDuration() {
  return getQuestionTimerSeconds();
}

// "No timer" mode (setting = 0) means skip the timer entirely.
function isTimerDisabled() {
  return getQuestionDuration() === 0;
}

// ======================================
// RESUME QUIZ PERSISTENCE
// ======================================

function getQuizStorageKey() {
  return currentQuizId ? `quiz_progress_${currentQuizId}` : `quiz_progress_${currentSubject}`;
}

function saveQuizProgress() {
  if (!questions.length) return;
  
  const answeredCount = answers.filter(a => a !== null).length;
  if (answeredCount === 0) return; // Don't save if nothing answered yet
  
  const snapshot = {
    quizId: currentQuizId,
    subject: currentSubject,
    title: subjectTitle.textContent,
    questions: questions,
    answers: answers,
    currentQuestion: currentQuestion,
    score: score,
    savedAt: Date.now()
  };
  
  try {
    localStorage.setItem(getQuizStorageKey(), JSON.stringify(snapshot));
  } catch (err) {
    console.error("Failed to save quiz progress:", err);
  }
}

function loadQuizProgress() {
  const key = getQuizStorageKey();
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    
    const snapshot = JSON.parse(saved);
    
    // Validate snapshot matches current quiz
    if (currentQuizId && snapshot.quizId !== currentQuizId) return null;
    if (!currentQuizId && snapshot.subject !== currentSubject) return null;
    
    // Check if not complete
    const answeredCount = snapshot.answers.filter(a => a !== null).length;
    const totalCount = snapshot.questions.length;
    if (answeredCount === 0 || answeredCount === totalCount) return null;
    
    return snapshot;
  } catch (err) {
    console.error("Failed to load quiz progress:", err);
    return null;
  }
}

function clearQuizProgress() {
  const key = getQuizStorageKey();
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.error("Failed to clear quiz progress:", err);
  }
}

// ELEMENTS
const countEl       = document.getElementById("quizCount");
const progressFill  = document.getElementById("quizProgressFill");
const questionEl    = document.getElementById("quizQuestion");
const choicesEl     = document.getElementById("quizChoices");
const warningEl     = document.getElementById("quizWarning");
// submitBtn may be absent (immediate-feedback quiz). Guard every reference.
const submitBtn     = document.getElementById("quizSubmit");
const prevBtn       = document.getElementById("quizPrev");
const nextBtn       = document.getElementById("quizNext");
const shellEl       = document.getElementById("quizShell");
const subjectTitle  = document.getElementById("subjectTitle");
const timerEl       = document.getElementById("quizTimer");
const timerWidgetEl = document.getElementById("quizTimerWidget");
const timerRingEl   = document.getElementById("quizTimerRing");
const timerLabelEl  = document.getElementById("quizTimerLabel");
const questionCard  = shellEl.querySelector(".question-card");
const cornerFlashes = document.querySelectorAll(".corner-flash");
const feedbackEl    = document.getElementById("quizFeedback");
const feedbackIconEl = document.getElementById("quizFeedbackIcon");
const feedbackTextEl = document.getElementById("quizFeedbackText");
const explanationEl = document.getElementById("quizExplanation");
const explanationTextEl = document.getElementById("quizExplanationText");

// ======================================
// URGENCY AUDIO (Web Audio API)
// ======================================

let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  audioUnlocked = audioCtx.state === "running";
  return audioCtx;
}

function unlockAudio() {
  ensureAudio();
}

function playTone(freq, duration, volume, type = "sine") {
  const ctx = ensureAudio();
  if (!audioUnlocked) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playTimerTick(secondsLeft) {
  if (secondsLeft <= 5) {
    playTone(920, 0.12, 0.35, "square");
    setTimeout(() => playTone(1100, 0.08, 0.25, "square"), 60);
  } else if (secondsLeft <= 10) {
    playTone(740, 0.08, 0.22, "triangle");
  } else if (secondsLeft <= 20) {
    playTone(600, 0.06, 0.15, "triangle");
  } else {
    playTone(440, 0.05, 0.1, "sine");
  }
}

function playTimeoutAlarm() {
  if (!audioUnlocked) return;
  [0, 100, 200, 300, 400].forEach((delay) => {
    setTimeout(() => playTone(880, 0.15, 0.3, "square"), delay);
  });
}

function playHeartbeat(intensity) {
  playTone(180 + intensity * 40, 0.12, 0.08 + intensity * 0.06, "sine");
}

function playCorrectAnswerSound() {
  if (!audioUnlocked) return;
  // Bright ascending chime, reusing the existing playTone infrastructure.
  playTone(660, 0.12, 0.22, "sine");
  setTimeout(() => playTone(880, 0.14, 0.22, "sine"), 80);
}

function playIncorrectAnswerSound() {
  if (!audioUnlocked) return;
  // Short low buzz, reusing the existing playTone infrastructure.
  playTone(220, 0.14, 0.22, "square");
  setTimeout(() => playTone(180, 0.18, 0.18, "square"), 90);
}

function startUrgencyPulse() {
   if (urgencyPulseActive) return;
   urgencyPulseActive = true;
   let pulseTick = 0;
   urgencyPulseInterval = setInterval(() => {
     if (!timerDeadline || document.hidden) return;
     pulseTick++;
     if (timeLeft <= 5) {
       playHeartbeat(1);
     }
   }, 500);
 }

function stopUrgencyPulse() {
  if (urgencyPulseInterval) {
    clearInterval(urgencyPulseInterval);
    urgencyPulseInterval = null;
  }
  urgencyPulseActive = false;
}

// ======================================
// TIMER (deadline-based — survives tab switches)
// ======================================

function getRemainingSeconds() {
  if (!timerDeadline) return 0;
  return Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
}

function getTimerPhase(seconds) {
  if (seconds <= 5) return "critical";
  if (seconds <= 10) return "urgent";
  if (seconds <= 20) return "warning";
  return "calm";
}

function updateTimerDisplay(isTick = false) {
   const mins = Math.floor(timeLeft / 60);
   const secs = timeLeft % 60;
   timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
   timerWidgetEl.setAttribute("aria-label",
     `Time remaining: ${timeLeft} second${timeLeft === 1 ? "" : "s"}`);
   timerWidgetEl.dataset.phase = getTimerPhase(timeLeft);

   const phase = getTimerPhase(timeLeft);
   const phases = ["calm", "warning", "urgent", "critical"];
   phases.forEach((p) => {
     timerWidgetEl.classList.toggle(`timer-${p}`, phase === p && p !== "calm");
   });

   if (timerRingEl) {
     const duration = getQuestionDuration();
     const progress = duration > 0 ? timeLeft / duration : 0;
     timerRingEl.style.strokeDashoffset = String(TIMER_RING_CIRC * (1 - progress));
   }

   if (phase === "critical") {
     timerLabelEl.textContent = "Hurry";
     timerLabelEl.setAttribute("data-state", "critical");
     if (!questionCard.classList.contains("shake")) {
       questionCard.classList.add("shake");
       questionCard.addEventListener("animationend", () => {
         questionCard.classList.remove("shake");
       }, { once: true });
     }
   } else if (phase === "urgent") {
     timerLabelEl.textContent = "Running out";
     timerLabelEl.setAttribute("data-state", "urgent");
   } else if (phase === "warning") {
     timerLabelEl.textContent = "Time left";
     timerLabelEl.setAttribute("data-state", "warning");
   } else {
     timerLabelEl.textContent = "Time left";
     timerLabelEl.setAttribute("data-state", "calm");
   }

   if (isTick) {
     timerWidgetEl.classList.add("timer-tick");
     setTimeout(() => timerWidgetEl.classList.remove("timer-tick"), 150);
   }

   if (document.hidden && timerDeadline) {
     const icon = timeLeft <= 5 ? "🚨" : timeLeft <= 10 ? "⚠️" : "⏱";
     document.title = `${icon} ${timerEl.textContent} — ANSWER NOW | NursePrep`;
   } else {
     document.title = ORIGINAL_PAGE_TITLE;
   }

if (timeLeft <= 5 && timerDeadline) {
     startUrgencyPulse();
   } else {
     stopUrgencyPulse();
   }
 }

function tickTimer() {
  if (!timerDeadline) return;

  const remaining = getRemainingSeconds();
  if (remaining !== timeLeft) {
    timeLeft = remaining;
    updateTimerDisplay(true);
    playTimerTick(timeLeft);
  }

  if (timeLeft <= 0) {
    stopTimer();
    playTimeoutAlarm();
    handleTimeout();
  }
}

function startTimer() {
  // Defensive: always clear any existing timer state first so we never
  // run two intervals side-by-side.
  stopTimer();

  const duration = getQuestionDuration();
  console.log("[Quiz Timer] starting question:", currentQuestion + 1,
              "duration:", duration + "s",
              "timerDisabled:", duration === 0);

  if (duration <= 0) {
    // No timer mode: leave deadline null so tickTimer short-circuits.
    timeLeft = 0;
    timerDeadline = null;
    if (timerEl) timerEl.textContent = "—:—";
    if (timerLabelEl) timerLabelEl.textContent = "No timer";
    if (timerRingEl) timerRingEl.style.strokeDashoffset = String(TIMER_RING_CIRC);
    timerWidgetEl?.classList.remove("timer-warning", "timer-urgent", "timer-critical", "timer-tick");
    return;
  }

  timeLeft = duration;
  timerDeadline = Date.now() + duration * 1000;
  console.log("[Quiz Timer] configured duration:", duration + "s",
              "deadline in:", duration * 1000 + "ms");
  updateTimerDisplay();
  // Use 250ms tick rate — fires fast enough that the displayed seconds
  // value is always correct within a quarter-second, and avoids drift.
  timerInterval = setInterval(tickTimer, 250);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  stopUrgencyPulse();
  timerDeadline = null;
  document.title = ORIGINAL_PAGE_TITLE;
  timerWidgetEl.classList.remove("timer-warning", "timer-urgent", "timer-critical", "timer-tick");
  if (timerRingEl) {
    timerRingEl.style.strokeDashoffset = "0";
  }
  if (timerLabelEl) {
    timerLabelEl.textContent = "Time left";
    timerLabelEl.setAttribute("data-state", "calm");
  }
  timerWidgetEl.setAttribute("data-state", "inactive");
  timerWidgetEl.setAttribute("aria-label", "Timer paused");
}

document.addEventListener("visibilitychange", () => {
   if (!timerDeadline) return;
   tickTimer();
   if (timeLeft <= 5) startUrgencyPulse();
 });

document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });
choicesEl.addEventListener("change", unlockAudio);

function autoSubmitAnswer() {
  // Timed-out: lock question with no selection so the user can still advance.
  if (answers[currentQuestion] !== null) return;

  stopTimer();
  stopUrgencyPulse();
  timerWidgetEl.setAttribute("data-state", "timeout");
  if (timerLabelEl) {
    timerLabelEl.textContent = "Time's up";
    timerLabelEl.setAttribute("data-state", "critical");
  }

  answers[currentQuestion] = -1; // sentinel: no selection (timed out)
  lockChoicesForFeedback();

  feedbackEl.classList.remove("is-correct", "is-incorrect");
  feedbackEl.classList.add("show", "is-incorrect");
  feedbackIconEl.textContent = "!";
  feedbackTextEl.textContent = "Time's up — Incorrect. No points awarded.";

  const correctIndex = questions[currentQuestion].answer;
  markCorrectChoice(correctIndex);

  const explanation = questions[currentQuestion].explanation;
  if (explanation) {
    explanationTextEl.textContent = explanation;
    explanationEl.classList.add("show");
  }

  playTimeoutAlarm();
  playIncorrectAnswerSound();

  nextBtn.disabled = false;
  if (submitBtn) submitBtn.disabled = true;

  saveQuizProgress();
}

function markCorrectChoice(correctIndex) {
  const labels = choicesEl.querySelectorAll(".choice");
  const target = labels[correctIndex];
  if (!target) return;
  target.classList.add("is-correct");
  target.setAttribute("aria-label", `Option ${LETTERS[correctIndex]}: ${questions[currentQuestion].choices[correctIndex]} (Correct answer)`);
  if (!target.querySelector(".choice-tag")) {
    const tag = document.createElement("span");
    tag.className = "choice-tag";
    tag.textContent = "Correct answer";
    target.appendChild(tag);
  }
}

function lockChoicesForFeedback() {
  choicesEl.classList.add("is-locked");
  choicesEl.querySelectorAll("input[name='quiz-choice']").forEach((inp) => {
    inp.disabled = true;
    inp.setAttribute("aria-disabled", "true");
  });
}

function handleTimeout() {
  autoSubmitAnswer();
}

// ======================================
// HELPERS
// ======================================

function getQuizIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("quizId") || "";
}

async function loadCatalog() {
    try {
        const res = await fetch("./data/quiz-catalog.json");
        return await res.json();
    } catch (err) {
        console.error("Failed to load quiz catalog:", err);
        return { categories: [] };
    }
}

function findQuizInCatalog(catalog, quizId) {
    for (const cat of catalog.categories || []) {
        const quiz = (cat.quizzes || []).find(q => q.quizId === quizId);
        if (quiz) return quiz;
    }
    return null;
}

// ======================================
// RENDER
// ======================================

function renderChoices(q, selectedIndex, locked = false) {
  choicesEl.innerHTML = "";
  q.choices.forEach((text, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    const inputId = `quiz-choice-${index}`;
    label.innerHTML = `
      <input type="radio" id="${inputId}" name="quiz-choice" value="${index}" ${index === selectedIndex ? "checked" : ""} ${locked ? "disabled" : ""}>
      <span class="letter" aria-hidden="true">${LETTERS[index]}</span>
      <span class="label-text">${text}</span>
    `;
    label.setAttribute("role", "radio");
    label.setAttribute("aria-checked", String(index === selectedIndex));
    label.setAttribute("aria-label", `Option ${LETTERS[index]}: ${text}`);
    choicesEl.appendChild(label);
  });
  if (locked) {
    choicesEl.classList.add("is-locked");
  } else {
    choicesEl.classList.remove("is-locked");
  }
}

function loadQuestion(index) {
  const q = questions[index];

  questionEl.textContent = q.question;
  renderChoices(q, answers[index], answers[index] !== null);

  countEl.textContent = `${pad(index + 1)} / ${pad(questions.length)}`;
  progressFill.style.width = `${((index + 1) / questions.length) * 100}%`;

  warningEl.classList.remove("show");
  feedbackEl.classList.remove("show", "is-correct", "is-incorrect");
  feedbackIconEl.textContent = "";
  feedbackTextEl.textContent = "";
  explanationEl.classList.remove("show");
  explanationTextEl.textContent = "";

  prevBtn.disabled = index === 0;

  const alreadyAnswered = answers[index] !== null;

  if (alreadyAnswered) {
    // Restore feedback view (used after resume / prev navigation).
    revealAnswerFeedback(index);
  }

  if (submitBtn) {
    submitBtn.style.display = "none";
    submitBtn.disabled = true;
  }

  startTimer();
}

// Restores the post-answer feedback state for an already-answered question
// (used by Previous / resume). Does NOT change scoring.
function revealAnswerFeedback(index) {
  const q = questions[index];
  const selectedIndex = answers[index];
  const correctIndex = q.answer;
  const timedOut = selectedIndex === -1;

  lockChoicesForFeedback();

  feedbackEl.classList.remove("is-correct", "is-incorrect");
  feedbackEl.classList.add("show");

  if (timedOut) {
    feedbackEl.classList.add("is-incorrect");
    feedbackIconEl.textContent = "!";
    feedbackTextEl.textContent = "Time's up — Incorrect. No points awarded.";
  } else {
    const isCorrect = selectedIndex === correctIndex;
    if (isCorrect) {
      feedbackEl.classList.add("is-correct");
      feedbackIconEl.textContent = "\u2713";
      feedbackTextEl.textContent = "Correct!";
    } else {
      feedbackEl.classList.add("is-incorrect");
      feedbackIconEl.textContent = "\u2717";
      feedbackTextEl.textContent = "Incorrect. The correct answer is highlighted below.";
    }

    const selectedLabel = choicesEl.querySelectorAll(".choice")[selectedIndex];
    if (selectedLabel && !isCorrect) {
      selectedLabel.classList.add("is-incorrect");
      const tag = document.createElement("span");
      tag.className = "choice-tag";
      tag.textContent = "Your answer";
      selectedLabel.appendChild(tag);
      selectedLabel.setAttribute("aria-label", `Option ${LETTERS[selectedIndex]}: ${q.choices[selectedIndex]} (Your answer, incorrect)`);
    }
  }

  markCorrectChoice(correctIndex);

  if (q.explanation) {
    explanationTextEl.textContent = q.explanation;
    explanationEl.classList.add("show");
  }

  nextBtn.disabled = false;
}


function showEmptyState() {
  stopTimer();
  shellEl.innerHTML = `<p class="quiz-warning show">No questions found for this quiz yet. Check back soon!</p>`;
}

// ======================================
// RESUME PROMPT
// ======================================

function restoreQuizState(snapshot) {
  questions = snapshot.questions;
  answers = snapshot.answers;
  currentQuestion = snapshot.currentQuestion;
  score = snapshot.score;
  subjectTitle.textContent = snapshot.title;
  loadQuestion(currentQuestion);
}

function showResumePrompt(snapshot, onContinue, onRestart) {
  stopTimer();

  const answeredCount = snapshot.answers.filter(a => a !== null).length;
  const totalCount = snapshot.questions.length;

  const pct = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;

  const promptEl = document.createElement("div");
  promptEl.className = "quiz-resume-overlay";
  promptEl.innerHTML = `
    <div class="quiz-resume-card" role="dialog" aria-modal="true" aria-labelledby="quizResumeHeading">
      <div class="quiz-resume-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7"></path>
          <path d="M3 4v4h4"></path>
          <path d="M12 8v4l3 2"></path>
        </svg>
      </div>
      <h1 id="quizResumeHeading">Resume Previous Quiz?</h1>
      <p class="quiz-resume-sub">You left this quiz unfinished. Pick up right where you stopped.</p>
      <div class="quiz-resume-panel">
        <p class="quiz-resume-title">${snapshot.title}</p>
        <div class="quiz-resume-progress-row">
          <span class="quiz-resume-progress">${answeredCount} / ${totalCount} answered</span>
          <span class="quiz-resume-pct">${pct}%</span>
        </div>
        <div class="quiz-resume-bar"><span style="width:${pct}%"></span></div>
      </div>
      <div class="quiz-resume-footer">
        <button class="btn btn-secondary" id="quizRestartBtn">Restart</button>
        <button class="btn btn-primary" id="quizContinueBtn">Continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(promptEl);

  const continueBtn = document.getElementById("quizContinueBtn");
  const restartBtn = document.getElementById("quizRestartBtn");

  continueBtn.addEventListener("click", () => {
    promptEl.remove();
    onContinue();
  });

  restartBtn.addEventListener("click", () => {
    promptEl.remove();
    clearQuizProgress();
    onRestart();
  });
}

async function loadQuizBank() {
  bank = await getQuestionBank();
}

async function loadSubject(subjectKey) {
  const resolvedKey = resolveSubjectKey(subjectKey);
  currentSubject = resolvedKey;
  currentQuizId = "";

  const catalog = await loadCatalog();
  const quizMeta = catalog.categories.flatMap(c => c.quizzes || []).find(q => q.quizId === resolvedKey || q.subjectKey === resolvedKey);
  currentQuizMeta = quizMeta || null;
  subjectTitle.textContent = quizMeta ? quizMeta.title : (SUBJECT_NAMES[subjectKey] || resolvedKey);

  currentQuestion = 0;
  score = 0;
  questions = bank[resolvedKey] || [];
  answers = new Array(questions.length).fill(null);

  const url = new URL(window.location);
  url.searchParams.set("subject", resolvedKey);
  url.searchParams.delete("quizId");
  window.history.replaceState(null, "", url);

  if (!questions.length) {
    showEmptyState();
    return;
  }

  const saved = loadQuizProgress();
  if (saved) {
    showResumePrompt(
      saved,
      () => restoreQuizState(saved),
      () => loadQuestion(currentQuestion)
    );
  } else {
    loadQuestion(currentQuestion);
  }
}

async function loadQuizById(quizId) {
    currentQuizId = quizId;
    currentSubject = "";
    currentQuestion = 0;
    score = 0;
    questions = [];
    answers = [];

    const catalog = await loadCatalog();
    const quizMeta = findQuizInCatalog(catalog, quizId);
    currentQuizMeta = quizMeta || null;
    const allData = await getQuestionBank();
    const availableCount = quizMeta ? getAvailableQuestionCount(quizMeta, allData) : 0;
    const displayCount = quizMeta ? Math.min(quizMeta.itemCount || availableCount, availableCount) : availableCount;

    if (quizMeta) {
        subjectTitle.textContent = quizMeta.title;
    } else {
        subjectTitle.textContent = "Quiz";
    }

    const url = new URL(window.location);
    url.searchParams.set("quizId", quizId);
    url.searchParams.delete("subject");
    window.history.replaceState(null, "", url);

    try {
        let matchedQuestions = [];
        const questionBankKey = quizMeta ? quizMeta.quizId : quizId;

        if (Array.isArray(allData[questionBankKey])) {
            matchedQuestions = allData[questionBankKey].map((q, idx) => ({
                ...q,
                _subjectKey: questionBankKey,
                _originalIndex: idx
            }));
        }

        if (matchedQuestions.length > 0) {
            const shuffled = matchedQuestions.sort(() => Math.random() - 0.5);
            const count = Math.min(quizMeta ? quizMeta.itemCount || displayCount : displayCount, matchedQuestions.length);
            questions = shuffled.slice(0, count);
        }
    } catch (err) {
        console.error("Failed to load questions:", err);
    }

    answers = new Array(questions.length).fill(null);

    if (!questions.length) {
        showEmptyState();
        return;
    }

    const saved = loadQuizProgress();
    if (saved) {
        showResumePrompt(
            saved,
            () => restoreQuizState(saved),
            () => loadQuestion(currentQuestion)
        );
    } else {
        loadQuestion(currentQuestion);
    }
}

// ======================================
// CHECK ANSWER / NAV
// ======================================
function checkAnswer(answerIndex) {
  if (answers[currentQuestion] !== null) return; // already answered — ignore
  if (!questions.length) return;

  stopTimer();

  const q = questions[currentQuestion];
  const correctIndex = q.answer;
  const isCorrect = answerIndex === correctIndex;
  const alreadyAnswered = answers[currentQuestion] !== null;

  answers[currentQuestion] = answerIndex;
  if (!alreadyAnswered && isCorrect) {
    score++;
  }

  // Visual: lock all choices and style selection + correct answer.
  lockChoicesForFeedback();
  const selectedLabel = choicesEl.querySelectorAll(".choice")[answerIndex];
  if (selectedLabel) {
    if (isCorrect) {
      selectedLabel.classList.add("is-correct");
      selectedLabel.setAttribute("aria-label", `Option ${LETTERS[answerIndex]}: ${q.choices[answerIndex]} (Your answer, correct)`);
    } else {
      selectedLabel.classList.add("is-incorrect");
      const tag = document.createElement("span");
      tag.className = "choice-tag";
      tag.textContent = "Your answer";
      selectedLabel.appendChild(tag);
      selectedLabel.setAttribute("aria-label", `Option ${LETTERS[answerIndex]}: ${q.choices[answerIndex]} (Your answer, incorrect)`);
    }
  }
  if (!isCorrect) {
    markCorrectChoice(correctIndex);
  }

  // Feedback banner with text (not color-only).
  feedbackEl.classList.remove("is-correct", "is-incorrect");
  feedbackEl.classList.add("show");
  if (isCorrect) {
    feedbackEl.classList.add("is-correct");
    feedbackIconEl.textContent = "\u2713";
    feedbackTextEl.textContent = "Correct!";
    playCorrectAnswerSound();
  } else {
    feedbackEl.classList.add("is-incorrect");
    feedbackIconEl.textContent = "\u2717";
    feedbackTextEl.textContent = "Incorrect. The correct answer is highlighted below.";
    playIncorrectAnswerSound();
  }

  // Explanation, if available.
  if (q.explanation) {
    explanationTextEl.textContent = q.explanation;
    explanationEl.classList.add("show");
  }

  // Incorrect feedback: keep the existing subtle shake + corner flashes,
  // but no shake on correct answers.
  if (!isCorrect && questionCard) {
    questionCard.classList.remove("shake");
    void questionCard.offsetWidth;
    questionCard.classList.add("shake");
    questionCard.addEventListener("animationend", () => {
      questionCard.classList.remove("shake");
    }, { once: true });
  }
  if (!isCorrect && cornerFlashes.length) {
    cornerFlashes.forEach((el) => {
      el.classList.remove("active");
      void el.offsetWidth;
      el.classList.add("active");
      el.addEventListener("animationend", () => {
        el.classList.remove("active");
      }, { once: true });
    });
  }

  nextBtn.disabled = false;
  if (submitBtn) submitBtn.disabled = true;

  saveQuizProgress();
}

function goPrev() {
  if (currentQuestion === 0) return;
  currentQuestion--;
  loadQuestion(currentQuestion);
  saveQuizProgress();
}

function goNext() {

    if (currentQuestion < questions.length - 1) {

        currentQuestion++;
        loadQuestion(currentQuestion);
        saveQuizProgress();

    } else {

        showResult();

    }

}

async function showResult() {

    stopTimer();
    clearQuizProgress();

    const total = questions.length;

    const pct = Math.round((score / total) * 100);

    const message =
        pct >= 80
            ? "Excellent work — that's PNLE-ready thinking."
            : pct >= 50
            ? "Good progress. Review the ones you missed and try again."
            : "Keep going — every attempt builds your recall.";

    const mistakes = [];
    answers.forEach((selected, idx) => {
        if (selected !== null && selected !== questions[idx].answer) {
            mistakes.push({
                idx: idx,
                question: questions[idx].question,
                choices: questions[idx].choices,
                answer: questions[idx].answer,
                userAnswer: selected,
                explanation: questions[idx].explanation || ""
            });
        }
    });

    console.log("[quiz] mistakes found:", mistakes.length, "subject:", currentSubject, "quizId:", currentQuizId);

    const user = auth.currentUser;

    if (user) {

        try {

            const saveStatus = document.createElement("div");
            saveStatus.className = "quiz-save-status";
            saveStatus.textContent = "Saving progress…";
            shellEl.appendChild(saveStatus);

            const subjectKey = getCanonicalSubjectKey();

            if (mistakes.length > 0) {
                try {
                    console.log("[quiz] saving", mistakes.length, "mistakes for", subjectKey);
                    await saveWrongAnswers(subjectKey, mistakes);
                    console.log("[quiz] saveWrongAnswers succeeded");
                } catch (err) {
                    console.error("[quiz] Failed to save wrong answers:", err);
                }
            }

            const answeredThisQuiz = answers.filter(answer => answer !== null).length;

            await recordQuizResult(user.uid, {
                subject: subjectKey,
                total: total,
                correct: score
            });

            await recordActivity(user.uid, {

                type: "quiz",

                subject: subjectKey,

                subjectKey: subjectKey,

                label: `${subjectKey} Quiz`,

                detail: `${score}/${total} correct`,

                score: pct,

                path: `quiz.html?quizId=${currentQuizId || subjectKey}`,

                questionsCount: answeredThisQuiz

            });

            if (saveStatus) {
                saveStatus.textContent = "Progress saved ✓";
                saveStatus.style.color = "var(--mint)";
            }

        }

        catch (err) {

            console.error("Firestore Error:", err);

            if (saveStatus) {
                saveStatus.textContent = "Could not save progress. Please check your connection.";
                saveStatus.style.color = "var(--pink-300)";
            }

        }

    }

    shellEl.innerHTML = `
        <div class="question-card quiz-result">

            <span class="eyebrow">
                Quiz Complete
            </span>

            <h1>
                Nice work, Future RN
            </h1>

            <div class="score-display">
              <div class="score-ring">
                <svg viewBox="0 0 120 120" class="score-svg">
                  <circle cx="60" cy="60" r="54" fill="none" stroke="var(--bg-soft)" stroke-width="8"/>
                  <circle cx="60" cy="60" r="54" fill="none" stroke="var(--pink-400)" stroke-width="8" stroke-linecap="round"
                    stroke-dasharray="${2 * Math.PI * 54}"
                    stroke-dashoffset="${2 * Math.PI * 54 * (1 - pct / 100)}"
                    transform="rotate(-90 60 60)" class="score-circle"/>
                </svg>
                <div class="score-inner">
                  <span class="score-pct">${pct}%</span>
                </div>
              </div>
              <div class="score-detail">
                <span class="score-fraction">${score} / ${total}</span>
                <span class="score-label">correct</span>
              </div>
            </div>

            <p class="sub">
                ${message}
            </p>

            <div class="quiz-footer">

                <button
                    class="btn btn-secondary"
                    onclick="location.reload()">

                    Try Again

                </button>

                ${mistakes.length > 0 ? `
                <a
                    href="review.html?subject=${encodeURIComponent(getCanonicalSubjectKey())}"
                    class="btn btn-primary review-mistakes-btn">

                    Review ${mistakes.length} Mistake${mistakes.length > 1 ? "s" : ""}

                </a>` : `
                <a
                    href="dashboard.html"
                    class="btn btn-primary">

                    Back to Dashboard

                </a>`}

            </div>

        </div>
    `;

}

// ======================================
// LOAD JSON (fetched once, cached in `bank`)
// ======================================
async function loadQuiz() {
  await loadQuizBank();

  const quizId = getQuizIdFromURL();
  const subject = getSubjectFromURL();

  if (quizId) {
      await loadQuizById(quizId);
  } else if (subject) {
      await loadSubject(subject);
  } else {
      await loadSubject("foundation-nursing-process-assessment");
  }
}

// ======================================
// EVENTS
// ======================================
// Immediate feedback: as soon as the user picks a choice, evaluate it.
choicesEl.addEventListener("change", (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.name !== "quiz-choice") return;
  if (answers[currentQuestion] !== null) {
    // Locked — revert UI selection back to the recorded answer.
    const recorded = answers[currentQuestion];
    choicesEl.querySelectorAll("input[name='quiz-choice']").forEach((inp, idx) => {
      inp.checked = idx === recorded;
    });
    return;
  }
  checkAnswer(Number(input.value));
});
prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);

// ======================================
// START
// ======================================
loadQuiz();
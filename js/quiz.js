// Requires utils.js loaded first (SUBJECT_NAMES, pad, getSubjectFromURL)
import { auth, db } from "../firebase/firebase.js";

import { recordActivity } from "../js/activity.js";
import { recordQuizResult } from "../js/userProfile.js";

import {
    getQuestionBank,
    getAvailableQuestionCount,
    pad,
    getSubjectFromURL
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

const MIN_QUESTION_SECONDS = 30;
let timeLeft = MIN_QUESTION_SECONDS;
let timerInterval = null;
let timerDeadline = null;
let urgencyPulseInterval = null;
let urgencyPulseActive = false;
const TIMER_RING_CIRC = 2 * Math.PI * 19;
const ORIGINAL_PAGE_TITLE = document.title;

// ELEMENTS
const countEl       = document.getElementById("quizCount");
const progressFill  = document.getElementById("quizProgressFill");
const questionEl    = document.getElementById("quizQuestion");
const choicesEl     = document.getElementById("quizChoices");
const warningEl     = document.getElementById("quizWarning");
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

   const phase = getTimerPhase(timeLeft);
   const phases = ["calm", "warning", "urgent", "critical"];
   phases.forEach((p) => {
     timerWidgetEl.classList.toggle(`timer-${p}`, phase === p && p !== "calm");
   });

   if (timerRingEl) {
     const progress = timeLeft / MIN_QUESTION_SECONDS;
     timerRingEl.style.strokeDashoffset = String(TIMER_RING_CIRC * (1 - progress));
   }

   if (phase === "critical") {
     timerLabelEl.textContent = "HURRY";
     if (!questionCard.classList.contains("shake")) {
       questionCard.classList.add("shake");
       questionCard.addEventListener("animationend", () => {
         questionCard.classList.remove("shake");
       }, { once: true });
     }
   } else if (phase === "urgent") {
     timerLabelEl.textContent = "Running out";
   } else if (phase === "warning") {
     timerLabelEl.textContent = "Time left";
   } else {
     timerLabelEl.textContent = "Time left";
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
  stopTimer();
  timeLeft = MIN_QUESTION_SECONDS;
  timerDeadline = Date.now() + timeLeft * 1000;
  updateTimerDisplay();
  timerInterval = setInterval(tickTimer, 200);
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
  }
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
  const selected = choicesEl.querySelector("input[name='quiz-choice']:checked");
  if (!selected) return;

  const answerIndex = Number(selected.value);
  const alreadyAnswered = answers[currentQuestion] !== null;
  answers[currentQuestion] = answerIndex;
  if (!alreadyAnswered && answerIndex === questions[currentQuestion].answer) {
    score++;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Answer Submitted";
  nextBtn.disabled = false;
}

function handleTimeout() {
  autoSubmitAnswer();
  setTimeout(() => goNext(), 600);
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

function renderChoices(q, selectedIndex) {
  choicesEl.innerHTML = "";
  q.choices.forEach((text, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    label.innerHTML = `
      <input type="radio" name="quiz-choice" value="${index}" ${index === selectedIndex ? "checked" : ""}>
      <span class="letter">${LETTERS[index]}</span>
      <span class="label-text">${text}</span>
    `;
    choicesEl.appendChild(label);
  });
}

function loadQuestion(index) {
  const q = questions[index];

  questionEl.textContent = q.question;
  renderChoices(q, answers[index]);

  countEl.textContent = `${pad(index + 1)} / ${pad(questions.length)}`;
  progressFill.style.width = `${((index + 1) / questions.length) * 100}%`;

  warningEl.classList.remove("show");

  prevBtn.disabled = index === 0;
  submitBtn.disabled = answers[index] !== null;
  nextBtn.disabled = answers[index] === null;

  submitBtn.textContent =
      answers[index] !== null
          ? "Answer Submitted"
          : "Submit Answer";

  startTimer();
}


function showEmptyState() {
  stopTimer();
  shellEl.innerHTML = `<p class="quiz-warning show">No questions found for this quiz yet. Check back soon!</p>`;
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

  loadQuestion(currentQuestion);
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

    loadQuestion(currentQuestion);
}

// ======================================
// CHECK ANSWER / NAV
// ======================================
function checkAnswer() {
  const selected = choicesEl.querySelector("input[name='quiz-choice']:checked");

  if (!selected) {
    warningEl.classList.add("show");
    return;
  }

  const answerIndex = Number(selected.value);
  const alreadyAnswered = answers[currentQuestion] !== null;
  const isCorrect = answerIndex === questions[currentQuestion].answer;

  answers[currentQuestion] = answerIndex;
  if (!alreadyAnswered && isCorrect) {
    score++;
  }

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
  submitBtn.disabled = true;

}

function goPrev() {
  if (currentQuestion === 0) return;
  currentQuestion--;
  loadQuestion(currentQuestion);
}

function goNext() {

    if (currentQuestion < questions.length - 1) {

        currentQuestion++;
        loadQuestion(currentQuestion);

    } else {

        showResult();

    }

}

async function showResult() {

    stopTimer();

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

            if (mistakes.length > 0) {
                try {
                    const subjectKey = currentSubject || currentQuizId || "unknown";
                    console.log("[quiz] saving", mistakes.length, "mistakes for", subjectKey);
                    await saveWrongAnswers(subjectKey, mistakes);
                    console.log("[quiz] saveWrongAnswers succeeded");
                } catch (err) {
                    console.error("[quiz] Failed to save wrong answers:", err);
                }
            }

            const answeredThisQuiz = answers.filter(answer => answer !== null).length;

            const subjectKey = currentSubject || currentQuizId || "unknown";

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
                    href="review.html?subject=${encodeURIComponent(currentSubject || currentQuizId)}"
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
submitBtn.addEventListener("click", checkAnswer);
prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);

// ======================================
// START
// ======================================
loadQuiz();
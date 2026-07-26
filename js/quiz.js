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

    fundamentals: "Fundamentals of Nursing",
    medSurg: "Medical-Surgical Nursing",
    maternal: "Maternal Nursing",
    pediatric: "Pediatric Nursing",
    psychiatric: "Psychiatric Nursing",
    community: "Community Health Nursing",
    pharma: "Pharmacology",
    leadership: "Leadership & Management"

};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

let bank = {};            // full JSON bank, fetched once
let questions = [];       // active quiz's questions
let currentQuestion = 0;
let score = 0;
let answers = [];         // stores selected index per question, resets per quiz
let currentSubject = getSubjectFromURL("fundamentals");
let currentQuizId = "";

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
}


function showEmptyState() {
  shellEl.innerHTML = `<p class="quiz-warning show">No questions found for this quiz yet. Check back soon!</p>`;
}

async function loadQuizBank() {
  bank = await getQuestionBank();
}

async function loadSubject(subjectKey) {
  currentSubject = subjectKey;
  currentQuizId = "";
  subjectTitle.textContent =
    SUBJECT_NAMES[subjectKey];
  currentQuestion = 0;
  score = 0;
  questions = bank[subjectKey] || [];
  answers = new Array(questions.length).fill(null);

  const url = new URL(window.location);
  url.searchParams.set("subject", subjectKey);
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
        subjectTitle.textContent = `${quizMeta.title} (${displayCount} items)`;
    } else {
        subjectTitle.textContent = "Quiz";
    }

    const url = new URL(window.location);
    url.searchParams.set("quizId", quizId);
    url.searchParams.delete("subject");
    window.history.replaceState(null, "", url);

    try {
        let matchedQuestions = [];
        if (quizMeta && quizMeta.subjectKey && Array.isArray(allData[quizMeta.subjectKey])) {
            const qs = allData[quizMeta.subjectKey];
            matchedQuestions = qs.map((q, idx) => ({
                ...q,
                _subjectKey: quizMeta.subjectKey,
                _originalIndex: idx
            }));
        } else if (allData) {
            for (const [subjectKey, qs] of Object.entries(allData)) {
                if (!Array.isArray(qs)) continue;
                const mapped = qs.map((q, idx) => ({
                    ...q,
                    _subjectKey: subjectKey,
                    _originalIndex: idx
                }));
                matchedQuestions = matchedQuestions.concat(mapped);
            }
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

  answers[currentQuestion] = answerIndex;
  if (!alreadyAnswered && answerIndex === questions[currentQuestion].answer) {
    score++;
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
      await loadSubject("fundamentals");
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
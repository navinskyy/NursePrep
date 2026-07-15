// Requires utils.js loaded first (SUBJECT_NAMES, pad, getSubjectFromURL)
import { auth, db } from "../firebase/firebase.js";

import { recordActivity } from "../js/activity.js";

import {
    pad,
    getSubjectFromURL
} from "../utils/utils.js";

import {
    doc,
    getDoc,
    updateDoc,
    increment
} from "firebase/firestore";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

let bank = {};            // full JSON bank, fetched once
let questions = [];       // active subject's questions
let currentQuestion = 0;
let score = 0;
let answers = [];         // stores selected index per question, resets per subject
let currentSubject = getSubjectFromURL("fundamentals");

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
const subjectSelect = document.getElementById("subjectSelect");

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
  shellEl.innerHTML = `<p class="quiz-warning show">No questions found for this subject yet. Check back soon!</p>`;
}

function loadSubject(subjectKey) {
  currentSubject = subjectKey;
  currentQuestion = 0;
  score = 0;
  questions = bank[subjectKey] || [];
  answers = new Array(questions.length).fill(null);

  // reflect in URL without reloading the page
  const url = new URL(window.location);
  url.searchParams.set("subject", subjectKey);
  window.history.replaceState(null, "", url);

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

    console.log("questions.length =", questions.length);
    console.log("answers =", answers);
    console.log("answered =", answers.filter(a => a !== null).length);
    console.log("score =", score);

    const total = questions.length;

    const pct = Math.round((score / total) * 100);

    const message =
        pct >= 80
            ? "Excellent work — that's PNLE-ready thinking."
            : pct >= 50
            ? "Good progress. Review the ones you missed and try again."
            : "Keep going — every attempt builds your recall.";

    // SAVE TO FIREBASE

    const user = auth.currentUser;

    if (user) {

        try {

            const userRef = doc(db, "users", user.uid);

            const snap = await getDoc(userRef);

            if (snap.exists()) {

                const data = snap.data();

const quizzesTaken =
    (data.quizzesTaken || 0) + 1;

// Actual number of questions answered
const answeredThisQuiz =
    answers.filter(answer => answer !== null).length;

const questionsAnswered =
    (data.questionsAnswered || 0) + answeredThisQuiz;

const correctAnswers =
    (data.correctAnswers || 0) + score;

const accuracy =
    questionsAnswered === 0
        ? 0
        : Math.round(
            (correctAnswers / questionsAnswered) * 100
        );

// =========================
// SUBJECT PROGRESS
// =========================

const subjectProgress = data.subjectProgress || {};

const currentStats =
    subjectProgress[currentSubject] || {
        answered: 0,
        correct: 0,
        total: 0,
        accuracy: 0
    };

currentStats.answered += answeredThisQuiz;
currentStats.correct += score;
currentStats.total += total;

currentStats.accuracy = Math.min(
    100,
    Math.round((currentStats.correct / currentStats.total) * 100)
);

subjectProgress[currentSubject] = currentStats;

// =========================
// SAVE
// =========================

console.log("Saving...");
console.log({
  total,
  answeredThisQuiz,
  questionsAnswered
});

await updateDoc(userRef, {

    quizzesTaken,
    questionsAnswered,
    correctAnswers,
    accuracy,

   [`subjectProgress.${currentSubject}`]: currentStats

});

await recordActivity(user.uid, {

    type: "quiz",

    subject: currentSubject,

    subjectKey: currentSubject,

    label: `${currentSubject} Quiz`,

    detail: `${score}/${total} correct`,

    score: pct,

    path: `quiz.html?subject=${currentSubject}`,

    questionsCount: answeredThisQuiz

});



         }

        }

        catch (err) {

            console.error("Firestore Error:", err);

        }

    }

    shellEl.innerHTML = `
        <div class="question-card quiz-result">

            <span class="eyebrow">
                Quiz Complete
            </span>

            <h1>
                Nice work, Future RN 🎉
            </h1>

            <div class="score">
                ${score} / ${total}
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

                <a
                    href="dashboard.html"
                    class="btn btn-primary">

                    Back to Dashboard

                </a>

            </div>

        </div>
    `;

}

// ======================================
// LOAD JSON (fetched once, cached in `bank`)
// ======================================
async function loadQuiz() {
  try {
    const res = await fetch("./data/quiz.json");
    bank = await res.json();

    subjectSelect.value = currentSubject;
    loadSubject(currentSubject);    
  } catch (err) {
    console.error("Failed to load quiz data:", err);
    showEmptyState();
  }
}

// ======================================
// EVENTS
// ======================================
submitBtn.addEventListener("click", checkAnswer);
prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);
subjectSelect.addEventListener("change", (e) => loadSubject(e.target.value));

// ======================================
// START
// ======================================
loadQuiz();
import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

import { getQuestionBank, getAvailableQuestionCount, plural } from "../utils/utils.js";
import { subjectIcon } from "./icons.js";
import { animateIfAllowed, prefersReducedMotion, stagger } from "./motion.js";

const container = document.getElementById("subjectsGrid");
const sidebarStreak = document.getElementById("sidebarStreak");
const reviewBadge = document.getElementById("reviewBadge");

let catalog = { categories: [] };
let userProgress = {};
let questionBank = null;

async function loadCatalog() {
  try {
    const res = await fetch("./data/quiz-catalog.json");
    catalog = await res.json();
  } catch (err) {
    console.error("Failed to load quiz catalog:", err);
    catalog = { categories: [] };
  }
}

async function loadUserProgress() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const quizzesRef = collection(db, "userProgress", user.uid, "quizzes");
    const snap = await getDocs(quizzesRef);
    userProgress = {};
    snap.forEach((docSnap) => {
      userProgress[docSnap.id] = docSnap.data();
    });
  } catch (err) {
    console.error("Failed to load user progress:", err);
    userProgress = {};
  }
}

function getCategoryStats(category) {
  const quizzes = category.quizzes || [];
  let totalItems = 0;
  let completedCount = 0;
  let bestScores = [];
  let totalAttempts = 0;
  let lastAttemptDate = null;

  quizzes.forEach(q => {
    totalItems += questionBank
      ? Math.min(q.itemCount || Infinity, getAvailableQuestionCount(q, questionBank))
      : (q.itemCount || 0);
    const progress = userProgress[q.quizId];
    if (progress) {
      if (progress.completed) {
        completedCount++;
      }
      if (typeof progress.bestScore === "number") {
        bestScores.push(progress.bestScore);
      }
      if (typeof progress.attempts === "number") {
        totalAttempts += progress.attempts;
      }
      if (progress.lastAttempt) {
        const attemptDate = progress.lastAttempt.toDate
          ? progress.lastAttempt.toDate()
          : new Date(progress.lastAttempt);
        if (!lastAttemptDate || attemptDate > lastAttemptDate) {
          lastAttemptDate = attemptDate;
        }
      }
    }
  });

  const overallProgress = bestScores.length > 0
    ? Math.round(bestScores.reduce((a, b) => a + b, 0) / bestScores.length)
    : 0;

  const bestScore = bestScores.length > 0
    ? Math.max(...bestScores)
    : 0;

  return {
    quizCount: quizzes.length,
    totalItems,
    completedCount,
    overallProgress,
    bestScore,
    totalAttempts,
    lastAttemptDate
  };
}

function formatDate(date) {
  if (!date) return "Never";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderCategories() {
  if (!container) return;

  container.innerHTML = "";

  const sorted = [...catalog.categories].sort((a, b) => (a.order || 0) - (b.order || 0));

  sorted.forEach((category, index) => {
    const stats = getCategoryStats(category);
    const card = document.createElement("div");
    card.className = "subject-card";
    card.style.setProperty("--delay", `${index * 0.07}s`);

    const progressLabel = stats.completedCount > 0
      ? `${stats.overallProgress}%`
      : "Not started";

    const progressClass = stats.completedCount === 0 ? "not-started" : "";

    const lastAttemptText = stats.totalAttempts > 0
      ? formatDate(stats.lastAttemptDate)
      : "No attempts yet";

    card.innerHTML = `
      <div class="subject-top">
        <div class="subject-icon">
          ${subjectIcon(category.id)}
        </div>
        <div class="subject-progress ${progressClass}">
          ${progressLabel}
        </div>
      </div>

      <h3>${category.name}</h3>
      <p>${plural(stats.quizCount, "quiz", "quizzes")} · ${plural(stats.totalItems, "item")}</p>

      ${stats.totalAttempts > 0 ? `
      <dl class="subject-stats">
        <div class="subject-stat">
          <dt>Best score</dt>
          <dd>${stats.bestScore > 0 ? stats.bestScore + "%" : "—"}</dd>
        </div>
        <div class="subject-stat">
          <dt>Attempts</dt>
          <dd>${stats.totalAttempts}</dd>
        </div>
        <div class="subject-stat">
          <dt>Last attempt</dt>
          <dd>${lastAttemptText}</dd>
        </div>
      </dl>` : ""}

      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill" style="--progress: ${stats.overallProgress}%"></div>
      </div>

      <a href="quiz-list.html?category=${encodeURIComponent(category.id)}" class="subject-link">
        View quizzes<span class="sr-only"> in ${category.name}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    `;

    container.appendChild(card);
  });
}

function animateCategoryCards() {
  if (!container || prefersReducedMotion()) return;

  const cards = Array.from(container.children);
  if (!cards.length) return;

  void animateIfAllowed(cards, {
    opacity: [0, 1],
    translateY: [8, 0],
    delay: stagger(45),
    duration: 240,
    ease: "outCubic"
  }).catch(() => undefined);

  cards.forEach((card) => {
    const fill = card.querySelector(".progress-fill");
    if (!fill) return;
    const progress = Number.parseFloat(getComputedStyle(fill).getPropertyValue("--progress")) || 0;
    void animateIfAllowed(fill, {
      scaleX: [0, progress / 100],
      duration: 360,
      ease: "outCubic"
    }).catch(() => undefined);
  });
}

async function init() {
  questionBank = await getQuestionBank();
  await loadCatalog();
  await loadUserProgress();
  renderCategories();
  animateCategoryCards();
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (sidebarStreak) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        sidebarStreak.textContent = plural(snap.data().streak || 0, "day");
      }
    } catch (err) {
      console.error("Failed to load streak:", err);
    }
  }

  if (reviewBadge) {
    try {
      const total = await getTotalWrongAnswerCount();
      reviewBadge.textContent = total;
      reviewBadge.style.display = total > 0 ? "inline-flex" : "none";
    } catch (err) {
      console.error("Failed to load review badge count:", err);
    }
  }

  await init();
});

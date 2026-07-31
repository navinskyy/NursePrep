import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

import { getQuestionBank, getAvailableQuestionCount } from "../utils/utils.js";

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

function getStars(score) {
  if (score <= 0) {
    return '<span class="star-empty">★</span>'.repeat(5);
  }
  const rounded = Math.ceil(score / 20);
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += i <= rounded ? '<span class="star-filled">★</span>' : '<span class="star-empty">★</span>';
  }
  return html;
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

    const starsHtml = stats.bestScore > 0
      ? getStars(stats.bestScore)
      : '<span class="star-empty">★</span>'.repeat(5);

    card.innerHTML = `
      <div class="subject-top">
        <div class="subject-icon">
          <span style="font-size: 20px;">${category.icon || "📋"}</span>
        </div>
        <div class="subject-progress ${progressClass}">
          ${progressLabel}
        </div>
      </div>

      <h3>${category.name}</h3>
      <p>${stats.quizCount} quizzes · ${stats.totalItems} items</p>

      <div class="subject-stats">
        <div class="subject-stat">
          <span class="subject-stat-value">${stats.bestScore > 0 ? stats.bestScore + "%" : "—"}</span>
          <span class="subject-stat-label">Best Score</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat-value">${stats.totalAttempts}</span>
          <span class="subject-stat-label">Attempts</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat-value">${lastAttemptText}</span>
          <span class="subject-stat-label">Last Attempt</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat-value stars">${starsHtml}</span>
          <span class="subject-stat-label">Rating</span>
        </div>
      </div>

      <div class="progress-track">
        <div class="progress-fill" style="--progress: ${stats.overallProgress}%"></div>
      </div>

      <div class="subject-actions">
        <a href="quiz-list.html?category=${encodeURIComponent(category.id)}" class="btn btn-primary">
          View Quizzes
        </a>
      </div>
    `;

    container.appendChild(card);
  });
}

async function init() {
  questionBank = await getQuestionBank();
  await loadCatalog();
  await loadUserProgress();
  renderCategories();
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
        sidebarStreak.textContent = `${snap.data().streak || 0} days`;
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

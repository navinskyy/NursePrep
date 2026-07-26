import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";
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
    const ref = doc(db, "userProgress", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      userProgress = snap.data() || {};
    }
  } catch (err) {
    console.error("Failed to load user progress:", err);
  }
}

function getCategoryStats(category) {
  const quizzes = category.quizzes || [];
  let totalItems = 0;
  let completedCount = 0;
  let bestScores = [];

  quizzes.forEach(q => {
    totalItems += questionBank
      ? Math.min(q.itemCount || Infinity, getAvailableQuestionCount(q, questionBank))
      : (q.itemCount || 0);
    const progress = userProgress[q.quizId];
    if (progress && progress.completed) {
      completedCount++;
    }
    if (progress && typeof progress.bestScore === "number") {
      bestScores.push(progress.bestScore);
    }
  });

  const overallProgress = totalItems > 0 && bestScores.length > 0
    ? Math.round(bestScores.reduce((a, b) => a + b, 0) / bestScores.length)
    : 0;

  return {
    quizCount: quizzes.length,
    totalItems,
    completedCount,
    overallProgress
  };
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

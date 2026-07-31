import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";

import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

import { getQuestionBank, getAvailableQuestionCount } from "../utils/utils.js";

const categoryId = new URLSearchParams(window.location.search).get("category") || "allTopics";
const quizGrid = document.getElementById("quizGrid");
const categoryTitle = document.getElementById("categoryTitle");
const categoryDescription = document.getElementById("categoryDescription");
const quizSearch = document.getElementById("quizSearch");
const sidebarStreak = document.getElementById("sidebarStreak");
const reviewBadge = document.getElementById("reviewBadge");

let catalog = {};
let quizzes = [];
let userProgress = {};
let questionBank = null;
let searchQuery = "";

function getDifficultyClass(difficulty) {
  const d = (difficulty || "").toLowerCase();
  if (d === "easy") return "difficulty-easy";
  if (d === "medium") return "difficulty-medium";
  if (d === "hard") return "difficulty-hard";
  return "";
}

function getStatus(quiz) {
  const progress = userProgress[quiz.quizId];
  if (!progress || !progress.attempts) {
    return "new";
  }
  if (progress.completed && progress.bestScore < 100) {
    return "retake";
  }
  if (progress.completed) {
    return "completed";
  }
  return "in-progress";
}

function getStatusLabel(status) {
  switch (status) {
    case "new": return "New";
    case "not-attempted": return "Not Attempted";
    case "completed": return "Completed";
    case "retake": return "Retake";
    default: return "In Progress";
  }
}

function getStatusClass(status) {
  switch (status) {
    case "new": return "status-new";
    case "not-attempted": return "status-not-attempted";
    case "completed": return "status-completed";
    case "retake": return "status-retake";
    default: return "status-not-attempted";
  }
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

function getCTA(quiz, status) {
  if (status === "new" || status === "not-attempted") {
    return `<a href="quiz.html?quizId=${quiz.quizId}" class="btn btn-primary">Start Quiz</a>`;
  }
  if (status === "retake" || status === "completed") {
    return `<a href="quiz.html?quizId=${quiz.quizId}" class="btn btn-primary">Retake</a>`;
  }
  return `<a href="quiz.html?quizId=${quiz.quizId}" class="btn btn-primary">Continue</a>`;
}

function formatDate(timestamp) {
  if (!timestamp) return "Never";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderQuizzes() {
  if (!quizGrid) return;

  const filtered = quizzes.filter(q => {
    if (!searchQuery) return true;
    const q2 = searchQuery.toLowerCase();
    return (
      q.title.toLowerCase().includes(q2) ||
      (q.description || "").toLowerCase().includes(q2) ||
      (q.difficulty || "").toLowerCase().includes(q2)
    );
  });

  if (filtered.length === 0) {
    quizGrid.innerHTML = `
      <div class="quiz-card-empty" style="grid-column: 1 / -1;">
        <h3>No quizzes found</h3>
        <p>Try adjusting your search or check back later for new content.</p>
      </div>
    `;
    return;
  }

  quizGrid.innerHTML = filtered.map((quiz, index) => {
    const progress = userProgress[quiz.quizId] || {};
    const status = getStatus(quiz);
    const bestScore = progress.bestScore || 0;
    const attempts = progress.attempts || 0;
    const lastAttempt = formatDate(progress.lastAttempt);

    const actualCount = questionBank
      ? Math.min(quiz.itemCount || Infinity, getAvailableQuestionCount(quiz, questionBank))
      : (quiz.itemCount || 0);
    const displayTitle = quiz.title;

    return `
      <div class="quiz-card" style="--delay: ${index * 0.05}s">
        <div class="status-badge ${getStatusClass(status)}">
          ${getStatusLabel(status)}
        </div>

        <div class="quiz-card-header">
          <h3 class="quiz-card-title">${displayTitle}</h3>
        </div>

        <p class="quiz-card-description">${quiz.description || ""}</p>

        <div class="quiz-card-meta">
          <span class="meta-badge">${actualCount} items</span>
          <span class="meta-badge ${getDifficultyClass(quiz.difficulty)}">${quiz.difficulty || "Medium"}</span>
        </div>

        <div class="quiz-card-stats">
          <div class="stat-item">
            <span class="stat-value">${bestScore}%</span>
            <span class="stat-label">Best Score</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${attempts}</span>
            <span class="stat-label">Attempts</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${lastAttempt}</span>
            <span class="stat-label">Last Attempt</span>
          </div>
          <div class="stat-item">
            <span class="stars">${getStars(bestScore)}</span>
            <span class="stat-label">Rating</span>
          </div>
        </div>

        <div class="quiz-card-actions">
          ${getCTA(quiz, status)}
        </div>
      </div>
    `;
  }).join("");
}

async function loadCatalog() {
  try {
    const res = await fetch("./data/quiz-catalog.json");
    catalog = await res.json();
  } catch (err) {
    console.error("Failed to load quiz catalog:", err);
    catalog = { categories: [] };
  }
}

function resolveCategoryName(id) {
  const cat = catalog.categories.find(c => c.id === id);
  return cat ? cat.name : "Quizzes";
}

function resolveCategoryDescription(id) {
  const cat = catalog.categories.find(c => c.id === id);
  return cat ? cat.description : "Select a quiz to begin.";
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

function initSearch() {
  if (!quizSearch) return;
  quizSearch.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderQuizzes();
  });
}

async function init() {
  questionBank = await getQuestionBank();

  await loadCatalog();

  if (categoryTitle) {
    categoryTitle.textContent = resolveCategoryName(categoryId);
  }
  if (categoryDescription) {
    categoryDescription.textContent = resolveCategoryDescription(categoryId);
  }

  const category = catalog.categories.find(c => c.id === categoryId);
  quizzes = category ? category.quizzes : [];

  await loadUserProgress();
  initSearch();
  renderQuizzes();
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

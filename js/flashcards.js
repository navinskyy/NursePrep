import {
    auth,
    db
} from "../firebase/firebase.js";

import {
    onAuthStateChanged
} from "firebase/auth";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc
} from "firebase/firestore";

// Inlined here (not relying on utils.js's classic-script globals inside this module)
const SUBJECT_NAMES = {
  fundamentals: "Fundamentals of Nursing",
  medSurg:      "Medical-Surgical Nursing",
  maternal:     "Maternal Nursing",
  pediatric:    "Pediatric Nursing",
  psychiatric:  "Psychiatric Nursing",
  community:    "Community Health Nursing",
  pharma:       "Pharmacology",
  leadership:   "Leadership & Management",
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function getSubjectFromURL(defaultKey = "fundamentals") {
  const params = new URLSearchParams(window.location.search);
  return params.get("subject") || defaultKey;
}

// ======================================
// STATE
// ======================================
let bank = {};             // full JSON bank, fetched once
let cards = [];             // active deck's cards (array of card objects)
let queue = [];             // array of { idx, requeued } — study order into `cards`
let queuePos = 0;
let currentSubject = getSubjectFromURL("fundamentals");
let viewingSaved = false;
let cardShownAt = 0;

let bookmarks = new Set();
let mastered = new Set();
let favSubjects = new Set();
let shuffleOn = false;
let streakData = { count: 0, lastDate: null };

let uid = null;
let progressRef = null;

let stats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0, timings: [] };

// ======================================
// ELEMENTS
// ======================================
const flashShell     = document.getElementById("flashShell");
const flashCard       = document.getElementById("flashCard");
const flashFrontText  = document.querySelector("#flashFront .flash-text");
const flashBackText   = document.querySelector("#flashBack .flash-text");
const explanationText = document.getElementById("explanationText");
const difficultyBadge = document.getElementById("difficultyBadgeFront");
const flashCounter    = document.getElementById("flashCounter");
const masteryCountEl  = document.getElementById("masteryCount");
const ringFill        = document.getElementById("ringFill");
const ringPct         = document.getElementById("ringPct");
const subjectSelect   = document.getElementById("subjectSelect");
const favSubjectBtn   = document.getElementById("favSubjectBtn");
const shuffleToggle   = document.getElementById("shuffleToggle");
const savedToggleBtn  = document.getElementById("savedToggleBtn");
const savedCountEl    = document.getElementById("savedCount");
const prevBtn         = document.getElementById("prevCard");
const nextBtn         = document.getElementById("nextCard");
const flipBtn         = document.getElementById("flipCard");
const learnedBtn      = document.getElementById("learnedBtn");
const confidencePanel = document.getElementById("confidencePanel");
const bookmarkBtnFront = document.getElementById("bookmarkBtnFront");
const bookmarkBtnBack  = document.getElementById("bookmarkBtnBack");
const audioBtnFront    = document.getElementById("audioBtnFront");
const audioBtnBack     = document.getElementById("audioBtnBack");
const sidebarStreak    = document.getElementById("sidebarStreak");

const RING_CIRCUMFERENCE = 113.1;

// ======================================
// FIRESTORE PERSISTENCE
// ======================================
async function loadProgressFromFirestore() {
  const snap = await getDoc(progressRef);

  if (snap.exists()) {
    const data = snap.data();
    bookmarks = new Set(data.bookmarks || []);
    mastered = new Set(data.mastered || []);
    favSubjects = new Set(data.favSubjects || []);
    shuffleOn = !!data.shuffle;
    streakData = data.streak || { count: 0, lastDate: null };
  } else {
    // first time this user reaches flashcards — create the doc
    await setDoc(progressRef, {
      bookmarks: [],
      mastered: [],
      favSubjects: [],
      shuffle: false,
      streak: { count: 0, lastDate: null },
    });
  }

  shuffleToggle.checked = shuffleOn;
  if (sidebarStreak && streakData.count > 0) {
    sidebarStreak.textContent = `${streakData.count} day${streakData.count === 1 ? "" : "s"}`;
  }
}

async function persistProgress(partial) {
  if (!progressRef) return;
  try {
    await setDoc(progressRef, partial, { merge: true });
  } catch (err) {
    console.error("Failed to save progress to Firestore:", err);
  }
}

// ======================================
// DECK BUILDING
// ======================================
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue() {
  const indices = cards.map((_, i) => i);
  const ordered = shuffleOn ? shuffleArray(indices) : indices;
  queue = ordered.map((idx) => ({ idx, requeued: false }));
  queuePos = 0;
  stats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0, timings: [] };
}

function updateSavedCount() {
  savedCountEl.textContent = bookmarks.size;
}

function updateSubjectOptions() {
  [...subjectSelect.options].forEach((opt) => {
    const isFav = favSubjects.has(opt.value);
    const baseName = SUBJECT_NAMES[opt.value] || opt.textContent.replace(/^★ /, "");
    opt.textContent = isFav ? `★ ${baseName}` : baseName;
  });
  favSubjectBtn.classList.toggle("active", favSubjects.has(currentSubject));
}

// ======================================
// RENDER
// ======================================
function renderCard() {
  const item = queue[queuePos];
  const card = cards[item.idx];

  flashFrontText.textContent = card.front;
  flashBackText.textContent = card.back;
  explanationText.textContent = card.explanation || "";

  difficultyBadge.textContent = card.difficulty || "";
  difficultyBadge.className = `difficulty-badge ${card.difficulty || ""}`;

  const isBookmarked = bookmarks.has(card.id);
  bookmarkBtnFront.classList.toggle("active", isBookmarked);
  bookmarkBtnBack.classList.toggle("active", isBookmarked);

  const isLearned = mastered.has(card.id);
  learnedBtn.classList.toggle("active", isLearned);
  learnedBtn.textContent = isLearned ? "✓ Learned" : "✓ Mark as Learned";

  flashCounter.textContent = `${pad(queuePos + 1)} / ${pad(queue.length)}`;

  const masteredInDeck = cards.filter((c) => mastered.has(c.id)).length;
  masteryCountEl.textContent = `${masteredInDeck} / ${cards.length} mastered`;

  const pct = Math.round(((queuePos + 1) / queue.length) * 100);
  ringPct.textContent = `${pct}%`;
  ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * pct) / 100;

  flashCard.classList.remove("flip");
  flipBtn.textContent = "Reveal Answer";
  confidencePanel.classList.remove("show");

  prevBtn.disabled = queuePos === 0;
  nextBtn.textContent = queuePos === queue.length - 1 ? "Finish" : "Next";

  cardShownAt = Date.now();
}

function showEmptyState(message) {
  flashShell.innerHTML = `<p class="flash-empty">${message}</p>`;
}

// ======================================
// LOADING SUBJECT / SAVED VIEW
// ======================================
function loadSubject(subjectKey) {
  viewingSaved = false;
  currentSubject = subjectKey;
  subjectSelect.value = subjectKey;
  subjectSelect.disabled = false;
  savedToggleBtn.textContent = `☆ Saved (${bookmarks.size})`;

  const url = new URL(window.location);
  url.searchParams.set("subject", subjectKey);
  window.history.replaceState(null, "", url);

  cards = bank[subjectKey] || [];
  updateSubjectOptions();

  if (!cards.length) {
    showEmptyState("No flashcards found for this subject yet. Check back soon!");
    return;
  }

  buildQueue();
  renderCard();
}

function loadSavedView() {
  const allCards = Object.values(bank).flat();
  const savedCards = allCards.filter((c) => bookmarks.has(c.id));

  if (!savedCards.length) {
    alert("No bookmarked cards yet. Tap the ⭐ on a card to save it for review.");
    return;
  }

  viewingSaved = true;
  cards = savedCards;
  subjectSelect.disabled = true;
  savedToggleBtn.textContent = `★ Viewing Saved (${bookmarks.size})`;

  buildQueue();
  renderCard();
}

function toggleSavedView() {
  if (viewingSaved) loadSubject(currentSubject);
  else loadSavedView();
}

// ======================================
// LOAD JSON (fetched once)
// ======================================
async function loadFlashcards() {
  try {
    const res = await fetch("./data/flashcards.json");
    bank = await res.json();
    updateSavedCount();
    loadSubject(currentSubject);
  } catch (err) {
    console.error("Failed to load flashcards:", err);
    showEmptyState("Couldn't load flashcards. Please refresh the page.");
  }
}

// ======================================
// FLIP / AUDIO / BOOKMARK / LEARNED
// ======================================
function toggleFlip() {
  const isFlipped = flashCard.classList.toggle("flip");
  flipBtn.textContent = isFlipped ? "Show Question" : "Reveal Answer";
  confidencePanel.classList.toggle("show", isFlipped);
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

function currentCard() {
  return cards[queue[queuePos].idx];
}

function toggleBookmark() {
  const card = currentCard();
  if (bookmarks.has(card.id)) bookmarks.delete(card.id);
  else bookmarks.add(card.id);

  persistProgress({ bookmarks: [...bookmarks] });
  updateSavedCount();

  bookmarkBtnFront.classList.toggle("active", bookmarks.has(card.id));
  bookmarkBtnBack.classList.toggle("active", bookmarks.has(card.id));
  savedToggleBtn.textContent = viewingSaved
    ? `★ Viewing Saved (${bookmarks.size})`
    : `☆ Saved (${bookmarks.size})`;
}

function toggleLearned() {
  const card = currentCard();
  if (mastered.has(card.id)) mastered.delete(card.id);
  else mastered.add(card.id);

  persistProgress({ mastered: [...mastered] });
  renderCard();
}

function toggleFavSubject() {
  if (favSubjects.has(currentSubject)) favSubjects.delete(currentSubject);
  else favSubjects.add(currentSubject);

  persistProgress({ favSubjects: [...favSubjects] });
  updateSubjectOptions();
}

// ======================================
// NAVIGATION
// ======================================
function goPrev() {
  if (queuePos === 0) return;
  queuePos--;
  renderCard();
}

async function goNext() {
  if (queuePos < queue.length - 1) {
    queuePos++;
    renderCard();
  } else {
    await showCompletion();
  }
}

// ======================================
// CONFIDENCE RATING
// ======================================
async function handleConfidence(rating) {

    const elapsed = (Date.now() - cardShownAt) / 1000;

    stats.reviewed++;
    stats[rating]++;
    stats.timings.push(elapsed);

    const card = currentCard();

    if (rating === "good" || rating === "easy") {

        mastered.add(card.id);

        await persistProgress({
            mastered: [...mastered]
        });

    }

    if (rating === "again") {

        const item = queue[queuePos];

        if (!item.requeued) {

            queue.push({
                idx: item.idx,
                requeued: true
            });

        }

    }

    await goNext();

}

confidencePanel.querySelectorAll(".confidence-btn").forEach((btn) => {
  btn.addEventListener("click", () => handleConfidence(btn.dataset.rating));
});

// ======================================
// STREAK
// ======================================
function updateStreak() {
  const today = new Date().toISOString().slice(0, 10);

  if (streakData.lastDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streakData.count = streakData.lastDate === yesterday ? streakData.count + 1 : 1;
    streakData.lastDate = today;
    persistProgress({ streak: streakData });
  }

  if (sidebarStreak) {
    sidebarStreak.textContent = `${streakData.count} day${streakData.count === 1 ? "" : "s"}`;
  }
  return streakData.count;
}

// ======================================
// CONFETTI
// ======================================
function launchConfetti() {
  const colors = ["#EC6FA0", "#5EEAD4", "#F5B95B", "#F3A9C9"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove());
  }
}

// ======================================
// COMPLETION SCREEN
// ======================================
async function showCompletion() {
  const total = stats.reviewed || cards.length;
  const correct = stats.good + stats.easy;
  const needReview = stats.again + stats.hard;
  const avgTime = stats.timings.length
    ? (stats.timings.reduce((a, b) => a + b, 0) / stats.timings.length).toFixed(1)
    : "0.0";

  const streakCount = updateStreak();

  flashShell.innerHTML = `
    <div class="flash-complete">
      <div class="streak-banner">🔥 +1 Day Streak — Great job, future RN! Current streak: ${streakCount} day${streakCount === 1 ? "" : "s"}.</div>
      <span class="eyebrow">Deck Complete</span>
      <h1>Nice work! 🎉</h1>
      <div class="stats-grid">
        <div class="stat"><span class="num">${total}</span><span class="label">Reviewed</span></div>
        <div class="stat"><span class="num">${correct}</span><span class="label">Correct</span></div>
        <div class="stat"><span class="num">${needReview}</span><span class="label">Need Review</span></div>
        <div class="stat"><span class="num">${avgTime}s</span><span class="label">Avg Time</span></div>
      </div>
      <div class="quiz-footer">
        <button class="btn btn-secondary" onclick="location.reload()">Study Again</button>
        <a href="dashboard.html" class="btn btn-primary">Back to Dashboard</a>
      </div>
    </div>
  `;

  // ===============================
// Save Flashcard Subject Progress
// ===============================

const masteredCount = cards.filter(card => mastered.has(card.id)).length;

const progressPercent =
    cards.length === 0
        ? 0
        : Math.round((masteredCount / cards.length) * 100);

await persistProgress({
    subjectProgress: {
        [currentSubject]: {
            progress: progressPercent,
            mastered: masteredCount,
            total: cards.length
        }
    }
});

  launchConfetti();
}

// ======================================
// EVENTS
// ======================================
flipBtn.addEventListener("click", toggleFlip);
flashCard.addEventListener("click", toggleFlip);
prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);
learnedBtn.addEventListener("click", toggleLearned);
favSubjectBtn.addEventListener("click", toggleFavSubject);
savedToggleBtn.addEventListener("click", toggleSavedView);
bookmarkBtnFront.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmark(); });
bookmarkBtnBack.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmark(); });
audioBtnFront.addEventListener("click", (e) => { e.stopPropagation(); speak(currentCard().front); });
audioBtnBack.addEventListener("click", (e) => { e.stopPropagation(); speak(currentCard().back); });

subjectSelect.addEventListener("change", (e) => loadSubject(e.target.value));

shuffleToggle.addEventListener("change", (e) => {
  shuffleOn = e.target.checked;
  persistProgress({ shuffle: shuffleOn });
  buildQueue();
  renderCard();
});

document.addEventListener("keydown", (e) => {
  if (document.activeElement.tagName === "SELECT") return;

  if (e.key === "ArrowLeft") { e.preventDefault(); if (!prevBtn.disabled) goPrev(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
  else if (e.key === " " || e.key.toLowerCase() === "f") { e.preventDefault(); toggleFlip(); }
});

// ======================================
// START — wait for auth before touching Firestore
// ======================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  uid = user.uid;
  progressRef = doc(db, "users", uid, "progress", "flashcards");

  await loadProgressFromFirestore();
  await loadFlashcards();
});
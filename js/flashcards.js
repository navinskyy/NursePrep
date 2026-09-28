import {
    auth,
    db
} from "../firebase/firebase.js";

import {
    onAuthStateChanged,
} from "firebase/auth";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc
} from "firebase/firestore";

import {
    updateMasteredCards,
    recordFlashcardSession
} from "./userProfile.js";

import { animateIfAllowed, prefersReducedMotion, stagger } from "./motion.js";

// Inlined here (not relying on utils.js's classic-script globals inside this module)
const SUBJECT_NAMES = {
  pnleSets:      "Comprehensive PNLE SETS",
  fundamentals: "Foundation of Nursing",
  maternal:     "Maternal & Child Nursing",
  community:    "Community Health Nursing",
  medSurg:      "Medical-Surgical Nursing",
  psychiatric:  "Psychiatric Nursing",
  allTopics:    "All Topics",
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
let flipInProgress = false;
let subjectSwitchInProgress = false;
let ratingInProgress = false;

let bookmarks = new Set();
let mastered = new Set();
let favSubjects = new Set();
let shuffleOn = false;
let streakData = { count: 0, lastDate: null };
let cardSchedule = {};

let uid = null;
let progressRef = null;

let stats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0, timings: [] };

// ======================================
// SPACED REPETITION SCHEDULE
// ======================================
// Per-card schedule stored in Firestore. Each card tracks:
//  - interval: minutes until next review
//  - easeFactor: multiplier for future intervals (SM-2 inspired)
//  - reps: number of successful reviews
//  - dueAt: timestamp (ms) when card is due for review
// ======================================
const DEFAULT_INTERVALS = { again: 1, hard: 6, good: 10, easy: 16 };

function getCardSchedule(cardId) {
    if (!cardSchedule[cardId]) {
        cardSchedule[cardId] = {
            interval: 0,
            easeFactor: 2.5,
            reps: 0,
            dueAt: Date.now(),
            lastRating: null
        };
    }
    return cardSchedule[cardId];
}

function calculateNextReview(schedule, rating) {
    let interval, easeFactor;

    if (rating === "again") {
        interval = 1;
        easeFactor = Math.max(1.3, schedule.easeFactor - 0.4);
    } else if (rating === "hard") {
        interval = Math.max(1, Math.round(schedule.interval * 1.2));
        easeFactor = Math.max(1.3, schedule.easeFactor - 0.15);
    } else if (rating === "good") {
        interval = schedule.reps === 0
            ? DEFAULT_INTERVALS.good
            : Math.round(schedule.interval * schedule.easeFactor);
        easeFactor = schedule.easeFactor;
    } else if (rating === "easy") {
        interval = schedule.reps === 0
            ? DEFAULT_INTERVALS.easy
            : Math.round(schedule.interval * schedule.easeFactor * 1.3);
        easeFactor = Math.min(3.0, schedule.easeFactor + 0.15);
    }

    return {
        interval,
        easeFactor,
        reps: rating === "again" ? 0 : schedule.reps + 1,
        dueAt: Date.now() + interval * 60 * 1000,
        lastRating: rating
    };
}

// ======================================
// ELEMENTS
// ======================================
const flashShell     = document.getElementById("flashShell");
const flashCard       = document.getElementById("flashCard");
const flashCardInner  = document.querySelector(".flash-inner");
const flashFront      = document.getElementById("flashFront");
const flashBack       = document.getElementById("flashBack");
const flashFrontText  = document.querySelector("#flashFront .flash-text");
const flashBackText   = document.querySelector("#flashBack .flash-text");
const explanationText = document.getElementById("explanationText");
const difficultyBadge = document.getElementById("difficultyBadgeFront");
const flashCounter    = document.getElementById("flashCounter");
const masteryCountEl  = document.getElementById("masteryCount");
const ringFill        = document.getElementById("ringFill");
const ringPct         = document.getElementById("ringPct");
const progressRing    = document.querySelector(".progress-ring-wrap");
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
const liveRegion       = document.getElementById("flashLiveRegion");

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
    cardSchedule = data.cardSchedule || {};
  } else {
    // first time this user reaches flashcards — create the doc
    cardSchedule = {};
    await setDoc(progressRef, {
      bookmarks: [],
      mastered: [],
      favSubjects: [],
      shuffle: false,
      streak: { count: 0, lastDate: null },
      cardSchedule: {},
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
  const now = Date.now();

  const due = [];
  const notDue = [];
  indices.forEach(i => {
    const card = cards[i];
    const sched = getCardSchedule(card.id);
    if (sched.dueAt <= now) {
      due.push({ idx: i, overdue: now - sched.dueAt });
    } else {
      notDue.push({ idx: i });
    }
  });

  due.sort((a, b) => b.overdue - a.overdue);

  const ordered = [...due.map(d => d.idx), ...notDue.map(n => n.idx)];
  const shuffled = shuffleOn ? shuffleArray(ordered) : ordered;

  queue = shuffled.map((idx) => ({ idx, requeued: false }));
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
  const isFavorite = favSubjects.has(currentSubject);
  favSubjectBtn.classList.toggle("active", isFavorite);
  favSubjectBtn.setAttribute("aria-pressed", String(isFavorite));
}

// ======================================
// ANIMATION HELPERS
// ======================================
function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}

function setCardAccessibility(isFlipped) {
  const position = queue.length ? queuePos + 1 : 0;
  const side = isFlipped ? "answer" : "question";

  flashCard.setAttribute("aria-label", `Flashcard ${position} of ${queue.length}, ${side} side`);
  flashFront.setAttribute("aria-hidden", String(isFlipped));
  flashBack.setAttribute("aria-hidden", String(!isFlipped));
  flashFront.querySelectorAll("button").forEach((button) => {
    button.disabled = isFlipped;
  });
  flashBack.querySelectorAll("button").forEach((button) => {
    button.disabled = !isFlipped;
  });
  flipBtn.setAttribute("aria-expanded", String(isFlipped));
  flipBtn.setAttribute("aria-pressed", String(isFlipped));
}

function updateCardAccessibility() {
  setCardAccessibility(flashCard.classList.contains("flip"));
}

function animateFlip(isFlipping) {
  if (!flashCardInner || prefersReducedMotion()) {
    flashCard?.classList.toggle("flip", isFlipping);
    return Promise.resolve();
  }

  flashCard.classList.remove("flip");

  return animateIfAllowed(flashCardInner, {
    rotateY: isFlipping ? 180 : 0,
    scale: [
      { value: 1, duration: 0 },
      { value: 0.98, duration: 240 },
      { value: 1, duration: 240 }
    ],
    duration: 480,
    ease: "spring(1, 80, 10, 0)"
  }).then(() => {
    flashCard.classList.toggle("flip", isFlipping);
  });
}

function animateConfetti() {
  if (prefersReducedMotion()) return Promise.resolve();

  const colors = ["#EC6FA0", "#5EEAD4", "#F5B95B", "#F3A9C9"];
  const pieces = Array.from({ length: 40 }, () => {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = `
      left: ${Math.random() * 100}vw;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    return el;
  });

  return animateIfAllowed(pieces, {
    translateY: ["-10vh", "110vh"],
    rotate: (el) => `${Math.random() * 720}deg`,
    scale: [1, 0.3],
    opacity: [1, 0],
    duration: (el) => 2000 + Math.random() * 1500,
    delay: stagger(45),
    ease: "outCubic"
  }).finally(() => pieces.forEach((el) => el.remove()));
}

function animateProgressRing(pct) {
  const offset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * pct) / 100;

  if (prefersReducedMotion()) {
    ringPct.textContent = `${pct}%`;
    ringFill.style.strokeDashoffset = offset;
    return Promise.resolve();
  }

  const current = parseInt(ringPct.textContent, 10) || 0;

  return Promise.all([
    animateIfAllowed(ringFill, {
      "stroke-dashoffset": offset,
      duration: 300,
      ease: "outCubic"
    }),
    animateIfAllowed({ value: current }, {
      value: pct,
      duration: 300,
      ease: "outCubic",
      onUpdate: (animation) => {
        ringPct.textContent = `${Math.round(animation.targets[0].value)}%`;
      }
    })
  ]);
}

function animateConfidenceEntrance() {
  confidencePanel.classList.add("show");
  if (prefersReducedMotion()) return Promise.resolve();

  return animateIfAllowed(".confidence-btn", {
    translateY: [12, 0],
    opacity: [0, 1],
    scale: [0.96, 1],
    delay: stagger(35),
    duration: 220,
    ease: "outCubic"
  });
}

function getFlashSections() {
  return Array.from(document.querySelectorAll(
    ".flash-toolbar, .flash-progress-row, .flash-card, .flash-actions, .flash-learned-row, .confidence-panel"
  )).filter((el) => el.isConnected);
}

function animateSubjectSwitch(enterCallback) {
  if (prefersReducedMotion()) {
    enterCallback();
    return Promise.resolve();
  }

  return animateIfAllowed(flashShell, {
    opacity: [1, 0],
    translateY: [0, -8],
    duration: 160,
    ease: "inCubic"
  }).then(() => {
    enterCallback();
    const sections = getFlashSections();

    return Promise.all([
      animateIfAllowed(flashShell, {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 240,
        ease: "outCubic"
      }),
      sections.length
        ? animateIfAllowed(sections, {
            opacity: [0, 1],
            translateY: [10, 0],
            delay: stagger(25),
            duration: 220,
            ease: "outCubic"
          })
        : Promise.resolve()
    ]);
  });
}

function animateCardEntrance() {
  if (prefersReducedMotion()) return Promise.resolve();

  return animateIfAllowed([flashCard, ".flash-actions", ".flash-learned-row"].filter(Boolean), {
    opacity: [0.72, 1],
    translateY: [6, 0],
    duration: 180,
    ease: "outCubic"
  });
}

// ======================================
// RENDER
// ======================================
function renderCard({ animate = false } = {}) {
  const item = queue[queuePos];
  if (!item) return;

  const card = cards[item.idx];

  flashFrontText.textContent = card.front;
  flashBackText.textContent = card.back;
  explanationText.textContent = card.explanation || "";

  difficultyBadge.textContent = card.difficulty || "";
  difficultyBadge.className = `difficulty-badge ${card.difficulty || ""}`;

  const isBookmarked = bookmarks.has(card.id);
  bookmarkBtnFront.classList.toggle("active", isBookmarked);
  bookmarkBtnBack.classList.toggle("active", isBookmarked);
  bookmarkBtnFront.setAttribute("aria-pressed", String(isBookmarked));
  bookmarkBtnBack.setAttribute("aria-pressed", String(isBookmarked));

  const isLearned = mastered.has(card.id);
  learnedBtn.classList.toggle("active", isLearned);
  learnedBtn.textContent = isLearned ? "✓ Learned" : "✓ Mark as Learned";
  learnedBtn.setAttribute("aria-pressed", String(isLearned));

  flashCounter.textContent = `${pad(queuePos + 1)} / ${pad(queue.length)}`;

  const masteredInDeck = cards.filter((c) => mastered.has(c.id)).length;
  masteryCountEl.textContent = `${masteredInDeck} / ${cards.length} mastered`;

  const pct = queue.length ? Math.round(((queuePos + 1) / queue.length) * 100) : 0;
  progressRing?.setAttribute("aria-label", `Study progress: ${pct}%`);
  void animateProgressRing(pct).catch(() => undefined);

  flashCard.classList.remove("flip");
  flashCardInner.style.transform = "";
  flipBtn.disabled = false;
  flipBtn.textContent = "Reveal Answer";
  confidencePanel.classList.remove("show", "is-busy");
  ratingInProgress = false;

  prevBtn.disabled = queuePos === 0;
  nextBtn.disabled = false;
  nextBtn.textContent = queuePos === queue.length - 1 ? "Finish" : "Next";
  updateCardAccessibility();

  cardShownAt = Date.now();
  announce(`Card ${queuePos + 1} of ${queue.length}`);

  if (animate) {
    void animateCardEntrance().catch(() => undefined);
  }
}

function showEmptyState(message) {
  flashFrontText.textContent = message;
  flashBackText.textContent = message;
  explanationText.textContent = "";
  difficultyBadge.textContent = "";
  difficultyBadge.className = "difficulty-badge";
  flashCard.classList.remove("flip");
  flashCardInner.style.transform = "";
  confidencePanel.classList.remove("show", "is-busy");
  updateCardAccessibility();
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  flipBtn.disabled = true;
  learnedBtn.disabled = true;
  flashFront.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  flashBack.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  announce(message);
}

// ======================================
// LOADING SUBJECT / SAVED VIEW
// ======================================
async function loadSubject(subjectKey) {
  if (subjectSwitchInProgress) return;

  subjectSwitchInProgress = true;
  subjectSelect.disabled = true;
  favSubjectBtn.disabled = true;
  savedToggleBtn.disabled = true;

  const doLoad = () => {
    viewingSaved = false;
    currentSubject = subjectKey;
    subjectSelect.value = subjectKey;
    subjectSelect.disabled = false;
    favSubjectBtn.disabled = false;
    savedToggleBtn.disabled = false;
    savedToggleBtn.textContent = `☆ Saved (${bookmarks.size})`;
    savedToggleBtn.setAttribute("aria-pressed", "false");

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
    announce(`${SUBJECT_NAMES[subjectKey] || subjectKey} loaded`);
  };

  try {
    await animateSubjectSwitch(doLoad);
  } finally {
    subjectSwitchInProgress = false;
    subjectSelect.disabled = viewingSaved;
    favSubjectBtn.disabled = false;
    savedToggleBtn.disabled = false;
  }
}

async function loadSavedView() {
  if (subjectSwitchInProgress) return;

  subjectSwitchInProgress = true;
  subjectSelect.disabled = true;
  favSubjectBtn.disabled = true;
  savedToggleBtn.disabled = true;

  const doLoad = () => {
    const allCards = Object.values(bank).flat();
    const savedCards = allCards.filter((c) => bookmarks.has(c.id));

    if (!savedCards.length) {
      announce("No bookmarked cards yet. Tap the bookmark button on a card to save it for review.");
      return;
    }

    viewingSaved = true;
    cards = savedCards;
    subjectSelect.disabled = true;
    savedToggleBtn.textContent = `★ Viewing Saved (${bookmarks.size})`;
    savedToggleBtn.setAttribute("aria-pressed", "true");

    buildQueue();
    renderCard();
    announce("Saved flashcards loaded");
  };

  try {
    await animateSubjectSwitch(doLoad);
  } finally {
    subjectSwitchInProgress = false;
    subjectSelect.disabled = viewingSaved;
    favSubjectBtn.disabled = false;
    savedToggleBtn.disabled = false;
  }
}

async function toggleSavedView() {
  if (subjectSwitchInProgress) return;
  if (viewingSaved) await loadSubject(currentSubject);
  else await loadSavedView();
}

// ======================================
// LOAD JSON (fetched once)
// ======================================
async function loadFlashcards() {
  try {
    const res = await fetch("./data/flashcards.json");
    bank = await res.json();
    updateSavedCount();
    await loadSubject(currentSubject);
  } catch (err) {
    console.error("Failed to load flashcards:", err);
    showEmptyState("Couldn't load flashcards. Please refresh the page.");
  }
}

// ======================================
// FLIP / AUDIO / BOOKMARK / LEARNED
// ======================================
async function toggleFlip(event) {
  if (flipInProgress || flipBtn.disabled) return;

  flipInProgress = true;
  const isFlipped = !flashCard.classList.contains("flip");
  setCardAccessibility(isFlipped);
  flipBtn.textContent = isFlipped ? "Show Question" : "Reveal Answer";

  const keyboardTrigger = event?.type === "keydown" ||
    event?.detail === 0 ||
    document.activeElement === flashCard;

  try {
    await animateFlip(isFlipped);
  } catch {
  } finally {
    flipInProgress = false;
  }

  if (isFlipped) {
    try {
      await animateConfidenceEntrance();
    } catch {
    }
    if (keyboardTrigger) {
      confidencePanel.querySelector(".confidence-btn")?.focus({ preventScroll: true });
    }
    announce("Answer revealed");
  } else {
    confidencePanel.classList.remove("show");
    announce("Question shown");
  }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

function currentCard() {
  const item = queue[queuePos];
  return item ? cards[item.idx] : null;
}

function toggleBookmark() {
  const card = currentCard();
  if (!card || flipInProgress || subjectSwitchInProgress) return;
  const isBookmarked = bookmarks.has(card.id);
  if (isBookmarked) bookmarks.delete(card.id);
  else bookmarks.add(card.id);

  persistProgress({ bookmarks: [...bookmarks] });
  updateSavedCount();

  bookmarkBtnFront.classList.toggle("active", !isBookmarked);
  bookmarkBtnBack.classList.toggle("active", !isBookmarked);
  bookmarkBtnFront.setAttribute("aria-pressed", String(!isBookmarked));
  bookmarkBtnBack.setAttribute("aria-pressed", String(!isBookmarked));
  savedToggleBtn.textContent = viewingSaved
    ? `★ Viewing Saved (${bookmarks.size})`
    : `☆ Saved (${bookmarks.size})`;
  announce(isBookmarked ? "Card removed from saved cards" : "Card saved for review");
}

function toggleLearned() {
  const card = currentCard();
  if (!card || flipInProgress || subjectSwitchInProgress) return;
  const isLearned = mastered.has(card.id);
  if (isLearned) mastered.delete(card.id);
  else mastered.add(card.id);

  persistProgress({ mastered: [...mastered] });
  renderCard({ animate: true });
  announce(isLearned ? "Card marked as not learned" : "Card marked as learned");
}

function toggleFavSubject() {
  const isFavorite = favSubjects.has(currentSubject);
  if (isFavorite) favSubjects.delete(currentSubject);
  else favSubjects.add(currentSubject);

  persistProgress({ favSubjects: [...favSubjects] });
  updateSubjectOptions();
  announce(isFavorite ? "Subject removed from favorites" : "Subject added to favorites");
}

// ======================================
// NAVIGATION
// ======================================
function goPrev() {
  if (subjectSwitchInProgress || flipInProgress || queuePos === 0) return;
  queuePos--;
  renderCard({ animate: true });
}

async function goNext() {
  if (subjectSwitchInProgress || flipInProgress || nextBtn.disabled) return;
  if (queuePos < queue.length - 1) {
    queuePos++;
    renderCard();
  } else {
    await showCompletion();
  }
}

async function handleConfidence(rating, event) {
  if (ratingInProgress || !confidencePanel.classList.contains("show")) return;

  ratingInProgress = true;
  confidencePanel.classList.add("is-busy");
  const keyboardTrigger = event?.detail === 0;

  try {
    const elapsed = (Date.now() - cardShownAt) / 1000;

    stats.reviewed++;
    stats[rating]++;
    stats.timings.push(elapsed);

    const card = currentCard();
    if (!card) return;
    const schedule = getCardSchedule(card.id);
    const nextSchedule = calculateNextReview(schedule, rating);
    cardSchedule[card.id] = nextSchedule;

    if (rating === "good" || rating === "easy") {
      mastered.add(card.id);
    }

    if (rating === "again") {
      const item = queue[queuePos];
      if (item && !item.requeued) {
        queue.push({ idx: item.idx, requeued: true });
      }
    }

    await persistProgress({
      mastered: [...mastered],
      cardSchedule: { ...cardSchedule }
    });

    await goNext();
    announce(`${rating[0].toUpperCase()}${rating.slice(1)} rating saved`);

    if (keyboardTrigger && document.contains(flipBtn)) {
      flipBtn.focus({ preventScroll: true });
    }
  } finally {
    ratingInProgress = false;
    confidencePanel.classList.remove("is-busy");
  }
}

confidencePanel.querySelectorAll(".confidence-btn").forEach((btn) => {
  btn.addEventListener("click", (event) => handleConfidence(btn.dataset.rating, event));
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
async function launchConfetti() {
  await animateConfetti();
}

// ======================================
// COMPLETION SCREEN
// ======================================
async function showCompletion() {
  flipInProgress = false;
  ratingInProgress = false;
  subjectSwitchInProgress = false;
  const total = stats.reviewed || cards.length;
  const correct = stats.good + stats.easy;
  const needReview = stats.again + stats.hard;
  const avgTime = stats.timings.length
    ? (stats.timings.reduce((a, b) => a + b, 0) / stats.timings.length).toFixed(1)
    : "0.0";

  const streakCount = updateStreak();

  flashShell.innerHTML = `
    <div class="flash-complete" role="status" tabindex="-1" aria-labelledby="completionHeading">
      <div class="streak-banner">🔥 +1 Day Streak — Great job, future RN! Current streak: ${streakCount} day${streakCount === 1 ? "" : "s"}.</div>
      <span class="eyebrow">Deck Complete</span>
      <h1 id="completionHeading">Nice work! 🎉</h1>
      <div class="stats-grid">
        <div class="stat"><span class="num">${total}</span><span class="label">Reviewed</span></div>
        <div class="stat"><span class="num">${correct}</span><span class="label">Correct</span></div>
        <div class="stat"><span class="num">${needReview}</span><span class="label">Need Review</span></div>
        <div class="stat"><span class="num">${avgTime}s</span><span class="label">Avg Time</span></div>
      </div>
      <div class="quiz-footer">
        <button class="btn btn-secondary" id="studyAgainBtn">Study Again</button>
        <a href="dashboard.html" class="btn btn-primary">Back to Dashboard</a>
      </div>
    </div>
  `;

  const completion = flashShell.querySelector(".flash-complete");
  completion?.focus({ preventScroll: true });
  document.getElementById("studyAgainBtn")?.addEventListener("click", () => window.location.reload());

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

  if (uid) {
      try {
          await updateMasteredCards(uid, masteredCount);
      } catch (err) {
          console.error("Failed to update mastered cards:", err);
      }
  }

  if (uid) {
      try {
          await recordFlashcardSession(uid, stats.reviewed, masteredCount);
      } catch (err) {
          console.error("Failed to record flashcard session:", err);
      }
  }

  await launchConfetti();
  announce(`Deck complete. Reviewed ${total} cards.`);
}

// ======================================
// EVENTS
// ======================================
flipBtn.addEventListener("click", toggleFlip);
flashCard.addEventListener("click", toggleFlip);
flashCard.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter" || event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFlip(event);
  }
});
prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);
learnedBtn.addEventListener("click", toggleLearned);
favSubjectBtn.addEventListener("click", toggleFavSubject);
savedToggleBtn.addEventListener("click", () => {
  void toggleSavedView();
});
bookmarkBtnFront.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmark(); });
bookmarkBtnBack.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmark(); });
audioBtnFront.addEventListener("click", (e) => {
  e.stopPropagation();
  const card = currentCard();
  if (card) speak(card.front);
});
audioBtnBack.addEventListener("click", (e) => {
  e.stopPropagation();
  const card = currentCard();
  if (card) speak(card.back);
});

subjectSelect.addEventListener("change", (e) => {
  if (!subjectSwitchInProgress) void loadSubject(e.target.value);
});

shuffleToggle.addEventListener("change", (e) => {
  shuffleOn = e.target.checked;
  persistProgress({ shuffle: shuffleOn });
  buildQueue();
  renderCard({ animate: true });
});

document.addEventListener("keydown", (e) => {
  const activeElement = document.activeElement;
  if (!flashCard.isConnected || activeElement === flashCard) return;
  if (activeElement && ["BUTTON", "SELECT", "INPUT", "TEXTAREA", "A"].includes(activeElement.tagName)) return;

  if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
  else if (e.key === " " || e.key.toLowerCase() === "f") { e.preventDefault(); toggleFlip(e); }
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
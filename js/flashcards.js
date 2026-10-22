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
import { DECK_CATEGORIES, getDeck, getDeckProgress, listCards, saveDeckProgress } from "./customDecks.js";
import { ALL_SUBJECTS_KEY, allSubjectsDeck, loadOfficialBank } from "./flashcardBank.js";
import { subjectIcon } from "./icons.js";

// Filled from quiz-catalog.json once the bank loads.
let SUBJECT_NAMES = {};

function pad(n) {
  return String(n).padStart(2, "0");
}

function getSubjectFromURL() {
  return new URLSearchParams(window.location.search).get("subject");
}

// ======================================
// STATE
// ======================================
let bank = {};             // subject key -> cards, derived from the quiz bank
let subjectList = [];       // [{ key, name, cards }] in catalog order, plus "All subjects"
let cards = [];             // active deck's cards (array of card objects)
let deckCards = [];         // the full active deck, kept for "Study again" after a missed-only round
let missedIds = new Set();  // cards rated Again/Hard this round
let queue = [];             // array of { idx, requeued } — study order into `cards`
let queuePos = 0;
let currentSubject = getSubjectFromURL();
// Custom deck mode (flashcards.html?deck=<id>): cards come from the user's own deck and
// mastery / schedule are stored per deck, never in the official progress document.
const customDeckId = new URLSearchParams(window.location.search).get("deck");
let customDeck = null;
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
const deckOverview    = document.getElementById("deckOverview");
const overviewBody    = document.getElementById("overviewBody");
const completeWrap    = document.getElementById("flashCompleteWrap");
const backToSubjects  = document.getElementById("backToSubjects");
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

const DECK_SCOPED_KEYS = ["mastered", "cardSchedule"];

async function persistProgress(partial) {
  if (!progressRef) return;
  let shared = partial;
  if (customDeckId) {
    const deckPart = {};
    shared = {};
    Object.entries(partial).forEach(([key, value]) => {
      if (DECK_SCOPED_KEYS.includes(key)) deckPart[key] = value;
      else if (key !== "subjectProgress") shared[key] = value;
    });
    if (Object.keys(deckPart).length) {
      try {
        await saveDeckProgress(uid, customDeckId, deckPart);
      } catch (err) {
        console.error("Failed to save deck progress:", err);
      }
    }
    if (!Object.keys(shared).length) return;
  }
  try {
    await setDoc(progressRef, shared, { merge: true });
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
    // Read without creating an entry: unseen cards are due now, and only
    // cards the user has rated are stored in the progress document.
    const dueAt = cardSchedule[cards[i].id]?.dueAt ?? 0;
    if (dueAt <= now) {
      due.push({ idx: i, overdue: now - dueAt });
    } else {
      notDue.push({ idx: i });
    }
  });

  due.sort((a, b) => b.overdue - a.overdue);

  const ordered = [...due.map(d => d.idx), ...notDue.map(n => n.idx)];
  const shuffled = shuffleOn ? shuffleArray(ordered) : ordered;

  queue = shuffled.map((idx) => ({ idx, requeued: false }));
  queuePos = 0;
  missedIds = new Set();
  stats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0, timings: [] };
}

function updateSavedCount() {
  savedCountEl.textContent = bookmarks.size;
}

function updateSubjectOptions() {
  [...subjectSelect.options].forEach((opt) => {
    const isFav = favSubjects.has(opt.value);
    const baseName = `${SUBJECT_NAMES[opt.value] || opt.value} (${(bank[opt.value] || []).length})`;
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

// direction: 1 = next card slides in from the right, -1 = previous from the left,
// 0 = gentle settle in place (e.g. after Mark as learned).
function animateCardEntrance(direction = 0) {
  if (prefersReducedMotion()) return Promise.resolve();

  if (direction) {
    return animateIfAllowed(flashCard, {
      opacity: [0.4, 1],
      translateX: [direction * 28, 0],
      duration: 220,
      ease: "outCubic"
    });
  }
  return animateIfAllowed([flashCard, ".flash-actions", ".flash-learned-row"].filter(Boolean), {
    opacity: [0.72, 1],
    translateY: [6, 0],
    duration: 180,
    ease: "outCubic"
  });
}

// Long scenario questions and multi-line answers get a smaller, left-aligned style.
function setLengthClass(el, text, longAt) {
  const long = text.length > longAt || text.includes("\n");
  el.classList.toggle("is-long", long);
}

// ======================================
// RENDER
// ======================================
function renderCard({ animate = false, direction = 0 } = {}) {
  const item = queue[queuePos];
  if (!item) return;

  const card = cards[item.idx];

  flashFrontText.textContent = card.front;
  flashBackText.textContent = card.back;
  setLengthClass(flashFront, card.front, 150);
  setLengthClass(flashBack, `${card.back}${card.explanation || ""}`, 260);
  flashFront.scrollTop = 0;
  flashBack.scrollTop = 0;
  explanationText.textContent = card.explanation || "";
  explanationText.parentElement.hidden = !card.explanation;

  difficultyBadge.textContent = card.difficulty || "";
  difficultyBadge.className = `difficulty-badge ${card.difficulty || ""}`;

  const isBookmarked = bookmarks.has(card.id);
  bookmarkBtnFront.classList.toggle("active", isBookmarked);
  bookmarkBtnBack.classList.toggle("active", isBookmarked);
  bookmarkBtnFront.setAttribute("aria-pressed", String(isBookmarked));
  bookmarkBtnBack.setAttribute("aria-pressed", String(isBookmarked));

  const isLearned = mastered.has(card.id);
  learnedBtn.classList.toggle("active", isLearned);
  learnedBtn.textContent = isLearned ? "Learned" : "Mark as learned";
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

  if (animate || direction) {
    void animateCardEntrance(direction).catch(() => undefined);
  }
}

function showEmptyState(message) {
  flashFrontText.textContent = message;
  flashBackText.textContent = message;
  explanationText.textContent = "";
  explanationText.parentElement.hidden = true;
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
// ----- views: subject overview vs. study -----
function setView(view) {
  deckOverview.hidden = view !== "overview";
  flashShell.hidden = view !== "study";
  completeWrap.hidden = view !== "complete";
  if (view !== "complete") completeWrap.innerHTML = "";
  document.title = view === "overview"
    ? "Flashcards | NursePrep"
    : `${viewingSaved ? "Saved cards" : SUBJECT_NAMES[currentSubject] || "Flashcards"} | Flashcards | NursePrep`;
}

function setURL(params, { push = false } = {}) {
  const url = new URL(window.location);
  url.search = new URLSearchParams(params).toString();
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function subjectMasteredCount(list) {
  let n = 0;
  for (const c of list) if (mastered.has(c.id)) n++;
  return n;
}

function renderOverview({ animate = true } = {}) {
  overviewBody.setAttribute("aria-busy", "false");
  document.getElementById("overviewSavedCount").textContent = bookmarks.size;

  const grid = document.createElement("ul");
  grid.className = "subject-deck-grid";
  grid.setAttribute("role", "list");

  subjectList.forEach((subject) => {
    const total = subject.cards.length;
    const done = subjectMasteredCount(subject.cards);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const li = document.createElement("li");
    const tile = document.createElement(total ? "a" : "div");
    tile.className = `subject-deck${subject.key === ALL_SUBJECTS_KEY ? " is-all" : ""}${total ? "" : " is-empty"}`;
    if (total) {
      tile.href = `flashcards.html?subject=${encodeURIComponent(subject.key)}`;
      tile.dataset.subject = subject.key;
    }

    const head = document.createElement("div");
    head.className = "subject-deck-head";
    const iconEl = document.createElement("span");
    iconEl.className = "subject-deck-icon";
    iconEl.innerHTML = subjectIcon(subject.key === ALL_SUBJECTS_KEY ? "pnleSets" : subject.key, 20);
    const name = document.createElement("h2");
    name.className = "subject-deck-name";
    name.textContent = subject.name;
    head.append(iconEl, name);
    if (favSubjects.has(subject.key)) {
      const fav = document.createElement("span");
      fav.className = "subject-deck-fav";
      fav.textContent = "★";
      fav.setAttribute("aria-label", "Favorite");
      head.append(fav);
    }

    const meta = document.createElement("p");
    meta.className = "subject-deck-meta";
    if (total) {
      meta.innerHTML = `<strong></strong> cards<span aria-hidden="true"> · </span><span class="subject-deck-done"></span>`;
      meta.querySelector("strong").textContent = total.toLocaleString();
      meta.querySelector(".subject-deck-done").textContent = `${done.toLocaleString()} mastered`;
    } else {
      meta.textContent = "No cards in the question bank yet";
    }

    const bar = document.createElement("div");
    bar.className = "subject-deck-progress";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${subject.name}: ${pct}% mastered`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(pct));
    const fill = document.createElement("span");
    fill.style.setProperty("--p", String(pct / 100));
    bar.append(fill);

    tile.append(head, meta, bar);
    li.append(tile);
    grid.append(li);
  });

  overviewBody.replaceChildren(grid);

  if (animate && !prefersReducedMotion()) {
    const tiles = grid.querySelectorAll(".subject-deck");
    void animateIfAllowed(tiles, {
      opacity: [0, 1],
      translateY: [10, 0],
      delay: stagger(30),
      duration: 260,
      ease: "outCubic"
    }).catch(() => undefined);
    void animateIfAllowed(grid.querySelectorAll(".subject-deck-progress span"), {
      scaleX: [0, (el) => Number(el.style.getPropertyValue("--p")) || 0],
      delay: stagger(30, { start: 120 }),
      duration: 420,
      ease: "outCubic"
    }).catch(() => undefined);
  }
}

function renderOverviewError() {
  overviewBody.setAttribute("aria-busy", "false");
  overviewBody.innerHTML = `
    <div class="overview-state" role="alert">
      <h2>Couldn't load flashcards</h2>
      <p>The question bank didn't load. Check your connection and try again.</p>
      <button class="btn btn-primary" type="button" id="overviewRetry">Try again</button>
    </div>`;
  document.getElementById("overviewRetry").addEventListener("click", () => {
    overviewBody.setAttribute("aria-busy", "true");
    void loadFlashcards();
  });
}

function showOverview({ push = false } = {}) {
  viewingSaved = false;
  setURL({}, { push });
  setView("overview");
  renderOverview({ animate: true });
  if (push) document.getElementById("overviewHeading").focus({ preventScroll: true });
}

async function openSubject(subjectKey, { push = false } = {}) {
  setURL({ subject: subjectKey }, { push });
  flashShell.hidden = false;
  deckOverview.hidden = true;
  completeWrap.hidden = true;
  await loadSubject(subjectKey);
}

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
    savedToggleBtn.textContent = `Saved (${bookmarks.size})`;
    savedToggleBtn.setAttribute("aria-pressed", "false");

    setURL({ subject: subjectKey });
    setView("study");

    cards = bank[subjectKey] || [];
    deckCards = cards;
    updateSubjectOptions();

    if (!cards.length) {
      showEmptyState("This subject has no flashcards yet. Choose another subject.");
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
    const allCards = bank[ALL_SUBJECTS_KEY] || [];
    const savedCards = allCards.filter((c) => bookmarks.has(c.id));

    if (!savedCards.length) {
      announce("No bookmarked cards yet. Tap the bookmark button on a card to save it for review.");
      if (!cards.length) showEmptyState("No saved cards yet. Bookmark a card while studying to collect it here.");
      return;
    }

    viewingSaved = true;
    setURL({ view: "saved" });
    setView("study");
    cards = savedCards;
    deckCards = cards;
    subjectSelect.disabled = true;
    savedToggleBtn.textContent = `Viewing saved (${bookmarks.size})`;
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
// CUSTOM DECK (user-created)
// ======================================
function enterCustomDeckMode(deck) {
  document.body.classList.add("is-custom-deck");
  const label = document.getElementById("customDeckLabel");
  if (label) {
    label.hidden = false;
    document.getElementById("customDeckTitle").textContent = deck ? deck.title : "My deck";
    document.getElementById("customDeckCategory").textContent = deck ? (DECK_CATEGORIES[deck.category] || "My deck") : "My deck";
  }
  if (deck) document.title = `${deck.title} | Flashcards | NursePrep`;
}

async function loadCustomDeck() {
  setView("study");
  enterCustomDeckMode(null);
  try {
    const [deck, cardDocs, progress] = await Promise.all([
      getDeck(uid, customDeckId),
      listCards(uid, customDeckId),
      getDeckProgress(uid, customDeckId),
    ]);
    customDeck = deck;
    enterCustomDeckMode(deck);
    mastered = new Set(progress.mastered || []);
    cardSchedule = progress.cardSchedule || {};
    cards = cardDocs.map((c) => ({ id: c.id, front: c.front, back: c.back, difficulty: "", explanation: "" }));
    deckCards = cards;

    if (!cards.length) {
      showEmptyState("This deck has no cards yet. Add cards in My Decks, then come back to study.");
      return;
    }
    await animateSubjectSwitch(() => {
      buildQueue();
      renderCard();
    });
    announce(`${deck.title} loaded`);
  } catch (err) {
    console.error("Failed to load custom deck:", err);
    showEmptyState(err?.code === "not-found"
      ? "This deck doesn't exist anymore. Go back to My Decks to choose another."
      : err?.code === "permission-denied"
        ? "You don't have access to this deck."
        : "Couldn't load this deck. Check your connection and refresh the page.");
  }
}

// ======================================
// LOAD JSON (fetched once)
// ======================================
function populateSubjectSelect() {
  subjectSelect.replaceChildren(...subjectList.map((s) => {
    const opt = document.createElement("option");
    opt.value = s.key;
    return opt;
  }));
}

// Decides what to show from the URL: overview, a subject, or saved cards.
async function route() {
  const params = new URLSearchParams(window.location.search);
  const subject = params.get("subject");
  if (params.get("view") === "saved") {
    flashShell.hidden = false;
    deckOverview.hidden = true;
    if (!currentSubject || !bank[currentSubject]) currentSubject = subjectList[0]?.key;
    subjectSelect.value = currentSubject;
    await loadSavedView();
  } else if (subject && bank[subject]) {
    await openSubject(subject);
  } else {
    showOverview();
  }
}

async function loadFlashcards() {
  try {
    const { subjects, skipped } = await loadOfficialBank();
    const all = allSubjectsDeck(subjects);
    subjectList = [...subjects, all];
    bank = Object.fromEntries(subjectList.map((s) => [s.key, s.cards]));
    SUBJECT_NAMES = Object.fromEntries(subjectList.map((s) => [s.key, s.name]));
    if (skipped.length) {
      console.info(`Flashcards: ${skipped.length} source questions were not turned into cards (ambiguous without choices, or duplicates).`);
    }
    populateSubjectSelect();
    updateSavedCount();
    await route();
  } catch (err) {
    console.error("Failed to load flashcards:", err);
    setView("overview");
    renderOverviewError();
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
    ? `Viewing saved (${bookmarks.size})`
    : `Saved (${bookmarks.size})`;
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
  renderCard({ direction: -1 });
}

async function goNext() {
  if (subjectSwitchInProgress || flipInProgress || nextBtn.disabled) return;
  if (queuePos < queue.length - 1) {
    queuePos++;
    renderCard({ direction: 1 });
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
    } else {
      missedIds.add(card.id);
    }

    if (rating === "again") {
      const item = queue[queuePos];
      if (item && !item.requeued) {
        queue.push({ idx: item.idx, requeued: true });
      }
    }

    // Brief confirmation on the chosen button; the save runs in the
    // background so the next card never waits on the network.
    const chosen = confidencePanel.querySelector(`[data-rating="${rating}"]`);
    if (chosen) {
      void animateIfAllowed(chosen, { scale: [1, 1.06, 1], duration: 180, ease: "outQuad" }).catch(() => undefined);
    }
    void persistProgress({
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

  const missedCards = deckCards.filter((c) => missedIds.has(c.id));
  const deckName = customDeckId
    ? customDeck?.title || "Your deck"
    : viewingSaved ? "Saved cards" : SUBJECT_NAMES[currentSubject] || "Deck";

  completeWrap.innerHTML = `
    <div class="flash-complete" role="status" tabindex="-1" aria-labelledby="completionHeading">
      <div class="streak-banner">+1 day streak — Great job, future RN! Current streak: ${streakCount} day${streakCount === 1 ? "" : "s"}.</div>
      <h1 id="completionHeading">Nice work!</h1>
      <p class="complete-deck"></p>
      <div class="stats-grid">
        <div class="stat"><span class="num">${total}</span><span class="label">Reviewed</span></div>
        <div class="stat"><span class="num">${correct}</span><span class="label">Correct</span></div>
        <div class="stat"><span class="num">${needReview}</span><span class="label">Need Review</span></div>
        <div class="stat"><span class="num">${avgTime}s</span><span class="label">Avg Time</span></div>
      </div>
      <div class="quiz-footer">
        ${missedCards.length ? `<button class="btn btn-primary" id="reviewMissedBtn" type="button">Review missed (${missedCards.length})</button>` : ""}
        <button class="btn btn-secondary" id="studyAgainBtn" type="button">Study again</button>
        ${customDeckId
          ? '<a href="my-decks.html" class="btn btn-secondary">Back to My Decks</a>'
          : '<a href="flashcards.html" class="btn btn-secondary" id="allSubjectsBtn">All subjects</a>'}
      </div>
    </div>
  `;
  completeWrap.querySelector(".complete-deck").textContent = `${deckName} · deck complete`;
  setView("complete");

  const completion = completeWrap.querySelector(".flash-complete");
  completion?.focus({ preventScroll: true });
  if (!prefersReducedMotion()) {
    void animateIfAllowed(completeWrap.querySelectorAll(".stat"), {
      opacity: [0, 1],
      translateY: [8, 0],
      delay: stagger(50, { start: 80 }),
      duration: 240,
      ease: "outCubic"
    }).catch(() => undefined);
  }

  const restart = (list) => {
    cards = list;
    setView("study");
    buildQueue();
    renderCard({ animate: true });
    flipBtn.focus({ preventScroll: true });
  };
  document.getElementById("studyAgainBtn")?.addEventListener("click", () => restart(deckCards));
  document.getElementById("reviewMissedBtn")?.addEventListener("click", () => {
    restart(missedCards);
    announce(`Reviewing ${missedCards.length} missed cards`);
  });
  document.getElementById("allSubjectsBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    showOverview({ push: true });
  });

  // ===============================
// Save Flashcard Subject Progress
// ===============================

  // Measured against the whole deck, even after a "Review missed" round.
  const masteredCount = deckCards.filter(card => mastered.has(card.id)).length;

  if (customDeckId) {
      // Custom decks keep their own progress; they don't count toward official mastery stats.
      try {
          await saveDeckProgress(uid, customDeckId, {
              mastered: deckCards.filter((c) => mastered.has(c.id)).map((c) => c.id),
              lastStudiedAt: new Date(),
              lastSession: { reviewed: stats.reviewed, correct, needReview, total: deckCards.length },
          });
      } catch (err) {
          console.error("Failed to save deck progress:", err);
      }
      await launchConfetti();
      announce(`Deck complete. Reviewed ${total} cards.`);
      return;
  }

  const progressPercent =
      deckCards.length === 0
          ? 0
          : Math.round((masteredCount / deckCards.length) * 100);

  // A saved-cards round mixes subjects, so it doesn't update a subject's progress.
  if (!viewingSaved) {
      await persistProgress({
          subjectProgress: {
              [currentSubject]: {
                  progress: progressPercent,
                  mastered: masteredCount,
                  total: deckCards.length
              }
          }
      });
  }

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

backToSubjects.addEventListener("click", (e) => {
  e.preventDefault();
  showOverview({ push: true });
});

overviewBody.addEventListener("click", (e) => {
  const tile = e.target.closest("a.subject-deck[data-subject]");
  if (!tile || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  void openSubject(tile.dataset.subject, { push: true });
});

document.getElementById("overviewSavedLink").addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  window.history.pushState(null, "", "flashcards.html?view=saved");
  void route();
});

// Browser back/forward between the overview and a subject.
window.addEventListener("popstate", () => {
  if (!customDeckId && subjectList.length) void route();
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
  if (flashShell.hidden || activeElement === flashCard) return;
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
  if (customDeckId) await loadCustomDeck();
  else await loadFlashcards();
});
// Requires utils.js loaded first (SUBJECT_NAMES, pad, getSubjectFromURL)

let bank = {};       // full JSON bank, fetched once
let cards = [];      // active subject's cards
let current = 0;
let currentSubject = getSubjectFromURL("fundamentals");

// ELEMENTS
const flashCard       = document.getElementById("flashCard");
const flashFrontText  = document.querySelector("#flashFront .flash-text");
const flashBackText   = document.querySelector("#flashBack .flash-text");
const flashCounter    = document.getElementById("flashCounter");
const flashProgress   = document.getElementById("flashProgressFill");
const subjectSelect   = document.getElementById("subjectSelect");
const prevBtn         = document.getElementById("prevCard");
const nextBtn         = document.getElementById("nextCard");
const flipBtn         = document.getElementById("flipCard");

// ======================================
// RENDER
// ======================================
function renderCard() {
  const card = cards[current];

  flashFrontText.textContent = card.front;
  flashBackText.textContent = card.back;

  flashCounter.textContent = `${pad(current + 1)} / ${pad(cards.length)}`;
  flashProgress.style.width = `${((current + 1) / cards.length) * 100}%`;

  flashCard.classList.remove("flip");
  flipBtn.textContent = "Reveal Answer";

  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === cards.length - 1;
}

function showEmptyState() {
  document.querySelector(".flash-shell").innerHTML = `
    <p class="flash-empty">No flashcards found for this subject yet. Check back soon!</p>
  `;
}

function loadSubject(subjectKey) {
  currentSubject = subjectKey;
  current = 0;
  cards = bank[subjectKey] || [];

  // reflect in URL without reloading the page
  const url = new URL(window.location);
  url.searchParams.set("subject", subjectKey);
  window.history.replaceState(null, "", url);

  if (!cards.length) {
    showEmptyState();
    return;
  }

  renderCard();
}

// ======================================
// LOAD JSON (fetched once, cached in `bank`)
// ======================================
async function loadFlashcards() {
  try {
    const res = await fetch("./data/flashcards.json");
    bank = await res.json();

    subjectSelect.value = currentSubject;
    loadSubject(currentSubject);
  } catch (err) {
    console.error("Failed to load flashcards:", err);
    showEmptyState();
  }
}

// ======================================
// EVENTS
// ======================================
function toggleFlip() {
  const isFlipped = flashCard.classList.toggle("flip");
  flipBtn.textContent = isFlipped ? "Show Question" : "Reveal Answer";
}

flipBtn.addEventListener("click", toggleFlip);
flashCard.addEventListener("click", toggleFlip);

nextBtn.addEventListener("click", () => {
  if (current < cards.length - 1) {
    current++;
    renderCard();
  }
});

prevBtn.addEventListener("click", () => {
  if (current > 0) {
    current--;
    renderCard();
  }
});

subjectSelect.addEventListener("change", (e) => {
  loadSubject(e.target.value);
});

// ======================================
// START
// ======================================
loadFlashcards();
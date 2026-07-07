// ======================================
// SHARED SUBJECT DISPLAY NAMES
// Used by quiz.js and flashcards.js — keep subject keys in sync with subjects.js
// ======================================
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

// ======================================
// SMALL HELPERS
// ======================================
function pad(n) {
  return String(n).padStart(2, "0");
}

function getSubjectFromURL(defaultKey = "fundamentals") {
  const params = new URLSearchParams(window.location.search);
  return params.get("subject") || defaultKey;
}
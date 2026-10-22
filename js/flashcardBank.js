/* ============================================================
   NursePrep — official flashcard bank
   ------------------------------------------------------------
   Official flashcards are derived at load time from the quiz
   bank (public/data/quiz.json) so the quiz stays the single
   source of truth: editing a question, answer key or explanation
   there is reflected here on the next load. The short hand-written
   concept cards in flashcards.json are kept alongside them.

   Subjects come from quiz-catalog.json categories. Two catalog ids
   map onto the subject keys that flashcard progress was already
   stored under, so nobody's saved progress is orphaned.

   This module is pure (no DOM, no Firestore) so the conversion
   can be validated outside the browser.
   ============================================================ */

// Catalog category id -> flashcard subject key (identity unless listed).
const CATEGORY_SUBJECT_KEYS = { foundation: "fundamentals", maternalChild: "maternal" };

// flashcards.json groups that live inside a broader catalog subject.
const LEGACY_GROUP_KEYS = { pediatric: "maternal" };

export const ALL_SUBJECTS_KEY = "all";

// ----- text helpers -----
function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// cyrb53: small, fast 53-bit string hash. Ids stay stable when quiz sets are
// reordered and change only when the question or its answer changes.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Questions that ask for the odd one out can't be answered without the
// choices in front of you, so they don't become cards.
const NEGATIVE_STEM = [
  /\bexcept\b/i,
  /\bNOT\b/,
  /\b(?:is|are|statements?|one)\s+(?:is\s+)?(?:incorrect|false|untrue|inaccurate)\b/i,
  /\bneeds? (?:further|more|additional) (?:teaching|instruction|education)\b/i,
];
// Checked against the question sentence only, so scenario text such as
// "…water, which is not sterile." doesn't count.
const NEGATIVE_QUESTION = [
  // "…is not true / not a sign of / not appropriate" picks the odd one out;
  // "…should not be given" still names one specific, recallable answer.
  /^(?:\S+\s+){0,6}which\b.*\bnot\s+(?:\S+\s+)?(?:true|correct|accurate|appropriate|therapeutic|a|an|one|part|included|considered|typical|recommended|likely|indicated|helpful|effective)\b/i,
  /^(?:\S+\s+){0,6}which\b.*\bleast\b(?! restrictive)/i,
];

function questionSentence(stem) {
  const parts = stem.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=\S)/);
  return parts[parts.length - 1];
}

function isNegativeSelection(stem) {
  if (NEGATIVE_STEM.some((re) => re.test(stem))) return true;
  return NEGATIVE_QUESTION.some((re) => re.test(questionSentence(stem)));
}

const OPTION_REFERENCE = /\b(?:options?|choices?|letters?)\s+[A-D1-4]\b|^[A-Da-d]\.?$/;
const ALL_OF_ABOVE = /^all of the (?:above|choices|options)\.?$/i;
const NONE_OF_ABOVE = /^none of the (?:above|choices|options)\.?$/i;
const NUMBER_COMBO = /^\d+(?:\s*(?:,|&|\band\b)\s*(?:and\s+)?\d+)+\.?$/i;
const CHOICE_PREFIX = /^[A-Da-d][.)]\s+/;

// "Which of the following is …" reads oddly without choices; ask directly.
function rewriteStem(stem) {
  return stem.replace(
    /\b([Ww])hich of the following (is|are|would|should|will|can|could|may|might|does|do|best|most|statements?)\b/g,
    (_, w, next) => {
      if (/^statements?$/i.test(next)) return `${w}hich statement`;
      return `${w === "W" ? "What" : "what"} ${next}`;
    },
  );
}

// Splits "…question?\nItem one\nItem two" into the lead line and list items.
function stemList(stem) {
  const lines = stem.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered = lines
    .map((l) => l.match(/^(\d+)[.)]\s+(.+)$/))
    .filter(Boolean);
  if (numbered.length >= 2) {
    return { items: new Map(numbered.map((m) => [Number(m[1]), m[2]])), renumberedStem: null };
  }
  // The list follows the line that asks the question; without punctuation,
  // that's the first line.
  const asked = lines.findIndex((l) => /[?:.]$/.test(l));
  const leadIdx = asked === -1 ? 0 : asked;
  const rest = lines.slice(leadIdx + 1);
  if (rest.length < 2) return { items: new Map(), renumberedStem: null };
  const items = new Map(rest.map((l, i) => [i + 1, l]));
  const renumberedStem = [...lines.slice(0, leadIdx + 1), ...rest.map((l, i) => `${i + 1}. ${l}`)].join("\n");
  return { items, renumberedStem };
}

// Explanations often end with "Why the other options are incorrect" and a
// per-option list; that part doesn't make sense without the choices.
function trimExplanation(raw, answerText) {
  if (typeof raw !== "string") return "";
  const text = raw.replace(/\*\*/g, "").replace(/\r/g, "").trim();
  const lines = text.split("\n");
  const cut = lines.findIndex((l, i) =>
    i > 0 && (
      /^\s*why (?:the )?other/i.test(l) ||
      /^\s*(?:other|incorrect) (?:options|choices)/i.test(l) ||
      /^\s*[-*•]?\s*\(?[A-D][.)]\s/.test(l)
    ));
  let kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  kept = kept.replace(/^\(?[A-D]\)\s+|^[A-D]\.\s+(?=[A-Z])/, "").trim();
  if (kept.length < 15) kept = text;
  if (normalize(kept) === normalize(answerText)) return "";
  return kept.replace(/\n{3,}/g, "\n\n");
}

/**
 * Converts one quiz question into a flashcard.
 * Returns { card } or { skip: reason }.
 */
export function questionToCard(q, { subject, quizId, index, difficulty = "" }) {
  if (!q || typeof q.question !== "string" || !q.question.trim()) return { skip: "Missing question text" };
  if (!Array.isArray(q.choices) || q.choices.length < 2) return { skip: "Missing answer choices" };
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
    return { skip: "Answer index is out of range" };
  }
  const choices = q.choices.map((c) => (typeof c === "string" ? c.trim().replace(CHOICE_PREFIX, "") : ""));
  let answer = choices[q.answer];
  if (!answer) return { skip: "Correct choice is empty" };

  let stem = q.question.trim();
  if (isNegativeSelection(stem)) {
    return { skip: "Asks for the wrong or exception choice (EXCEPT / NOT / least / needs further teaching), which can't be answered without the choices" };
  }

  if (NONE_OF_ABOVE.test(answer)) return { skip: "Answer is \"None of the above\"" };
  if (ALL_OF_ABOVE.test(answer)) {
    const others = choices.filter((c, i) => i !== q.answer && c && !ALL_OF_ABOVE.test(c));
    if (others.length < 2) return { skip: "\"All of the above\" with too few other choices" };
    answer = others.join("\n");
  } else if (NUMBER_COMBO.test(answer)) {
    const nums = answer.match(/\d+/g).map(Number);
    const { items, renumberedStem } = stemList(stem);
    if (!nums.every((n) => items.has(n))) {
      return { skip: "Combination answer doesn't match a numbered list in the question" };
    }
    if (renumberedStem) stem = renumberedStem;
    answer = nums.map((n) => `${n}. ${items.get(n)}`).join("\n");
  } else if (OPTION_REFERENCE.test(answer)) {
    return { skip: "Answer refers to other choices by letter" };
  }

  const front = rewriteStem(stem);
  return {
    card: {
      id: `q-${hash(`${normalize(q.question)}|${normalize(answer)}`)}`,
      front,
      back: answer,
      explanation: trimExplanation(q.explanation, answer),
      difficulty: ["Easy", "Medium", "Hard"].includes(difficulty) ? difficulty : "",
      subject,
      source: { quizId, index },
      stemKey: normalize(q.question),
    },
  };
}

function subjectKeyFor(categoryId) {
  return CATEGORY_SUBJECT_KEYS[categoryId] || categoryId;
}

/**
 * Builds the official bank.
 * @param {object} quiz       quiz.json: { quizId: [question, …] }
 * @param {object} catalog    quiz-catalog.json: { categories: [...] }
 * @param {object} handwritten flashcards.json: { group: [card, …] }
 * @returns {{ subjects: Array, skipped: Array, unassigned: Array }}
 */
export function buildOfficialBank(quiz = {}, catalog = {}, handwritten = {}) {
  const categories = [...(catalog.categories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const subjects = categories.map((c) => ({
    key: subjectKeyFor(c.id),
    categoryId: c.id,
    name: c.name,
    description: c.description || "",
    cards: [],
  }));
  const byKey = new Map(subjects.map((s) => [s.key, s]));

  // quizId -> { subject, difficulty } from the catalog; uncatalogued sets fall
  // back to the category that owns the same id prefix (e.g. "medSurg-1").
  const quizInfo = new Map();
  const prefixOwner = new Map();
  categories.forEach((c) => (c.quizzes || []).forEach((z) => {
    quizInfo.set(z.quizId, { subject: subjectKeyFor(c.id), difficulty: z.difficulty });
    const prefix = z.quizId.split("-")[0];
    const owner = prefixOwner.get(prefix);
    prefixOwner.set(prefix, owner === undefined || owner === c.id ? c.id : null);
  }));

  const skipped = [];
  const unassigned = [];

  // Hand-written concept cards first: they're short, foundational prompts.
  Object.entries(handwritten || {}).forEach(([group, list]) => {
    const key = byKey.has(group) ? group : LEGACY_GROUP_KEYS[group];
    const subject = byKey.get(key);
    if (!subject || !Array.isArray(list)) { unassigned.push({ source: `flashcards.json:${group}` }); return; }
    list.forEach((c) => {
      if (c && c.id && c.front && c.back) {
        subject.cards.push({ ...c, explanation: c.explanation || "", subject: key, source: { handwritten: group } });
      }
    });
  });

  Object.entries(quiz).forEach(([quizId, questions]) => {
    let info = quizInfo.get(quizId);
    if (!info) {
      const owner = prefixOwner.get(quizId.split("-")[0]);
      if (owner) info = { subject: subjectKeyFor(owner), difficulty: "" };
    }
    if (!info || !byKey.has(info.subject) || !Array.isArray(questions)) {
      unassigned.push({ source: quizId, count: Array.isArray(questions) ? questions.length : 0 });
      return;
    }
    questions.forEach((q, index) => {
      const result = questionToCard(q, { subject: info.subject, quizId, index, difficulty: info.difficulty });
      if (result.skip) skipped.push({ quizId, index, reason: result.skip });
      else byKey.get(info.subject).cards.push(result.card);
    });
  });

  // De-duplicate within each subject. The same question with the same answer
  // collapses to one card; the same question with conflicting answer keys is
  // ambiguous, so every copy of it is dropped and reported.
  subjects.forEach((subject) => {
    const answersByStem = new Map();
    subject.cards.forEach((c) => {
      if (!c.stemKey) return;
      const set = answersByStem.get(c.stemKey) || new Set();
      set.add(c.id);
      answersByStem.set(c.stemKey, set);
    });
    const seen = new Set();
    subject.cards = subject.cards.filter((c) => {
      if (c.stemKey && answersByStem.get(c.stemKey).size > 1) {
        skipped.push({ quizId: c.source.quizId, index: c.source.index, reason: "Same question has different answer keys in the bank" });
        return false;
      }
      if (seen.has(c.id)) {
        skipped.push({ quizId: c.source.quizId, index: c.source.index, reason: "Duplicate of another card in this subject", duplicate: true });
        return false;
      }
      seen.add(c.id);
      return true;
    });
    subject.cards.forEach((c) => delete c.stemKey);
  });

  return { subjects, skipped, unassigned };
}

/** One deck containing every subject's cards, each card once. */
export function allSubjectsDeck(subjects) {
  const seen = new Set();
  const cards = [];
  subjects.forEach((s) => s.cards.forEach((c) => {
    if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); }
  }));
  return { key: ALL_SUBJECTS_KEY, name: "All subjects", description: "Every NursePrep card in one deck.", cards };
}

let bankPromise = null;

/** Fetches the source files once per page and builds the bank. */
export function loadOfficialBank() {
  if (!bankPromise) {
    const getJSON = (url) => fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.json();
    });
    bankPromise = Promise.all([
      getJSON("./data/quiz.json"),
      getJSON("./data/quiz-catalog.json"),
      getJSON("./data/flashcards.json").catch(() => ({})),
    ]).then(([quiz, catalog, handwritten]) => buildOfficialBank(quiz, catalog, handwritten));
    bankPromise.catch(() => { bankPromise = null; });
  }
  return bankPromise;
}

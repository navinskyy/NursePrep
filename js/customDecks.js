/* ============================================================
   NursePrep — Custom flashcard decks (data layer)
   ------------------------------------------------------------
   users/{uid}/customDecks/{deckId}            deck metadata
   users/{uid}/customDecks/{deckId}/cards/{id} front / back
   users/{uid}/deckProgress/{deckId}           per-deck study progress
   Ownership and field shape are enforced in firestore.rules;
   the same limits are validated here before every write.
   ============================================================ */
import { db } from "../firebase/firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

export const DECK_CATEGORIES = {
  fundamentals: "Fundamentals of Nursing",
  maternal: "Maternal & Child Nursing",
  community: "Community Health Nursing",
  medSurg: "Medical-Surgical Nursing",
  psychiatric: "Psychiatric Nursing",
  pharma: "Pharmacology",
  personal: "Personal Review Notes",
};

export const LIMITS = { title: 80, description: 300, front: 500, back: 2000, cardsPerDeck: 500 };

const decksCol = (uid) => collection(db, "users", uid, "customDecks");
const deckDoc = (uid, deckId) => doc(db, "users", uid, "customDecks", deckId);
const cardsCol = (uid, deckId) => collection(db, "users", uid, "customDecks", deckId, "cards");
const progressDoc = (uid, deckId) => doc(db, "users", uid, "deckProgress", deckId);

// ---------- validation (mirrors firestore.rules) ----------
export function validateDeck({ title = "", description = "", category = "" }) {
  const errors = {};
  const t = title.trim();
  if (!t) errors.title = "Give your deck a title.";
  else if (t.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (description.trim().length > LIMITS.description) errors.description = `Keep the description under ${LIMITS.description} characters.`;
  if (!DECK_CATEGORIES[category]) errors.category = "Choose a subject for this deck.";
  return errors;
}

export function validateCard({ front = "", back = "" }) {
  const errors = {};
  if (!front.trim()) errors.front = "The front can't be empty.";
  else if (front.trim().length > LIMITS.front) errors.front = `Keep the front under ${LIMITS.front} characters.`;
  if (!back.trim()) errors.back = "The back can't be empty.";
  else if (back.trim().length > LIMITS.back) errors.back = `Keep the back under ${LIMITS.back} characters.`;
  return errors;
}

const hasErrors = (e) => Object.keys(e).length > 0;

// ---------- error messages ----------
export function describeError(err) {
  const code = err?.code || "";
  if (code === "permission-denied") return "You don't have permission to change this deck. Try signing in again.";
  if (code === "unavailable" || !navigator.onLine) return "You appear to be offline. Your changes are still here; try again when you're connected.";
  if (code === "not-found") return "This deck no longer exists.";
  if (code === "invalid-input") return err.message;
  return "Something went wrong while saving. Your changes are still here; please try again.";
}

function invalid(message) {
  const e = new Error(message);
  e.code = "invalid-input";
  return e;
}

// ---------- decks ----------
export async function listDecks(uid) {
  const snap = await getDocs(query(decksCol(uid), orderBy("updatedAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDeck(uid, deckId) {
  const snap = await getDoc(deckDoc(uid, deckId));
  if (!snap.exists()) {
    const e = new Error("Deck not found");
    e.code = "not-found";
    throw e;
  }
  return { id: snap.id, ...snap.data() };
}

export async function createDeck(uid, input) {
  const errors = validateDeck(input);
  if (hasErrors(errors)) throw invalid(Object.values(errors)[0]);
  const ref = doc(decksCol(uid));
  const batch = writeBatch(db);
  batch.set(ref, {
    title: input.title.trim(),
    description: (input.description || "").trim(),
    category: input.category,
    visibility: "private",
    cardCount: 0,
    ownerUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

export async function updateDeck(uid, deckId, input) {
  const errors = validateDeck(input);
  if (hasErrors(errors)) throw invalid(Object.values(errors)[0]);
  const batch = writeBatch(db);
  batch.update(deckDoc(uid, deckId), {
    title: input.title.trim(),
    description: (input.description || "").trim(),
    category: input.category,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/** Deletes the deck, all its cards and its study progress. */
export async function deleteDeck(uid, deckId) {
  const cardSnap = await getDocs(cardsCol(uid, deckId));
  const refs = cardSnap.docs.map((d) => d.ref);
  // Firestore batches hold up to 500 writes; leave room for the deck + progress docs.
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(progressDoc(uid, deckId));
  batch.delete(deckDoc(uid, deckId));
  await batch.commit();
}

// ---------- cards ----------
export async function listCards(uid, deckId) {
  const snap = await getDocs(query(cardsCol(uid, deckId), orderBy("order", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Adds one or more cards in a single batch and bumps the deck's card count. */
export async function addCards(uid, deckId, cards, { startOrder = Date.now(), currentCount = 0 } = {}) {
  if (!cards.length) return [];
  if (currentCount + cards.length > LIMITS.cardsPerDeck) {
    throw invalid(`A deck can hold up to ${LIMITS.cardsPerDeck} cards.`);
  }
  for (const c of cards) {
    const errors = validateCard(c);
    if (hasErrors(errors)) throw invalid(Object.values(errors)[0]);
  }
  const created = [];
  for (let i = 0; i < cards.length; i += 450) {
    const chunk = cards.slice(i, i + 450);
    const batch = writeBatch(db);
    chunk.forEach((c, j) => {
      const ref = doc(cardsCol(uid, deckId));
      const data = {
        front: c.front.trim(),
        back: c.back.trim(),
        order: startOrder + i + j,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(ref, data);
      created.push({ id: ref.id, ...data });
    });
    batch.update(deckDoc(uid, deckId), { cardCount: increment(chunk.length), updatedAt: serverTimestamp() });
    await batch.commit();
  }
  return created;
}

export async function updateCard(uid, deckId, cardId, { front, back }) {
  const errors = validateCard({ front, back });
  if (hasErrors(errors)) throw invalid(Object.values(errors)[0]);
  const batch = writeBatch(db);
  batch.update(doc(cardsCol(uid, deckId), cardId), {
    front: front.trim(),
    back: back.trim(),
    updatedAt: serverTimestamp(),
  });
  batch.update(deckDoc(uid, deckId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function deleteCard(uid, deckId, cardId) {
  const batch = writeBatch(db);
  batch.delete(doc(cardsCol(uid, deckId), cardId));
  batch.update(deckDoc(uid, deckId), { cardCount: increment(-1), updatedAt: serverTimestamp() });
  await batch.commit();
}

// ---------- study progress (kept apart from official-deck progress) ----------
export async function getDeckProgress(uid, deckId) {
  const snap = await getDoc(progressDoc(uid, deckId));
  return snap.exists() ? snap.data() : { mastered: [], cardSchedule: {} };
}

export async function saveDeckProgress(uid, deckId, partial) {
  const batch = writeBatch(db);
  batch.set(progressDoc(uid, deckId), { ...partial, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function listDeckProgress(uid) {
  const snap = await getDocs(collection(db, "users", uid, "deckProgress"));
  const map = {};
  snap.docs.forEach((d) => { map[d.id] = d.data(); });
  return map;
}

// ---------- bulk import ----------
/**
 * Parses blocks of
 *   Front: question
 *   Back: answer
 * separated by blank lines. A field may span several lines.
 * Returns { cards: [{front, back, line}], problems: [{line, text, message}] }.
 * Nothing is dropped: any block that can't be read is returned as a problem.
 */
export function parseBulk(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let current = null;
  lines.forEach((raw, i) => {
    if (!raw.trim()) {
      if (current) { blocks.push(current); current = null; }
      return;
    }
    if (!current) current = { line: i + 1, lines: [] };
    current.lines.push(raw);
  });
  if (current) blocks.push(current);

  const cards = [];
  const problems = [];
  blocks.forEach((block) => {
    let front = null;
    let back = null;
    let field = null;
    let stray = false;
    block.lines.forEach((raw) => {
      const m = raw.match(/^\s*(front|back|q|a|question|answer)\s*:\s*(.*)$/i);
      if (m) {
        field = /^(front|q|question)$/i.test(m[1]) ? "front" : "back";
        const value = m[2];
        if (field === "front") front = front === null ? value : `${front}\n${value}`;
        else back = back === null ? value : `${back}\n${value}`;
      } else if (field === "front") front += `\n${raw}`;
      else if (field === "back") back += `\n${raw}`;
      else stray = true;
    });
    const text = block.lines.join("\n");
    if (stray || front === null || back === null) {
      problems.push({
        line: block.line,
        text,
        message: front === null && back === null
          ? "Start the card with \"Front:\" and add a \"Back:\" line."
          : front === null ? "This card is missing a \"Front:\" line." : back === null ? "This card is missing a \"Back:\" line." : "Text before \"Front:\" couldn't be read.",
      });
      return;
    }
    const errors = validateCard({ front, back });
    if (hasErrors(errors)) {
      problems.push({ line: block.line, text, message: Object.values(errors)[0] });
      return;
    }
    cards.push({ front: front.trim(), back: back.trim(), line: block.line });
  });
  return { cards, problems };
}

import { db } from "../firebase/firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// Canonical shape for every users/{uid} document.
// Every signup path (email, Google via login, Google via register) and
// dashboard.js's self-heal fallback all go through this one function —
// so the document shape can never drift between paths again.
const DEFAULT_PROFILE = {
  quizzesTaken: 0,
  questionsAnswered: 0,
  correctAnswers: 0,
  accuracy: 0,
  streak: 0,
  longestStreak: 0,
  masteredCards: 0,
  studyTime: 0,
  subjectProgress: {},
  lastActiveDate: null,
};

/**
 * Ensures a users/{uid} document exists with the canonical shape.
 * If it already exists, returns the existing data untouched (never
 * overwrites real progress). If missing, creates it with defaults.
 */
export async function ensureUserProfile(uid, { fullname, email }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return snap.data();
  }

  const profile = {
    fullname: fullname || "Future RN",
    email: email || "",
    ...DEFAULT_PROFILE,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, profile);
  return profile;
}

/**
 * Bumps the daily streak counter — call this once whenever the user
 * does something study-related (visiting the dashboard, finishing a
 * quiz, reviewing flashcards). Safe to call multiple times per day:
 * it only increments once per calendar day thanks to `lastActiveDate`.
 *
 * Streak logic:
 *  - Same day as last recorded activity -> no change (already counted)
 *  - Exactly one day after last activity -> streak + 1
 *  - Any bigger gap (or first-ever activity) -> streak resets to 1
 */
export async function bumpDailyStreak(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();
  const today = new Date().toISOString().slice(0, 10);

  if (data.lastActiveDate === today) {
    // Already counted today — nothing to do.
    return data;
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = data.lastActiveDate === yesterday ? (data.streak || 0) + 1 : 1;
  const newLongest = Math.max(newStreak, data.longestStreak || 0);

  const updates = {
    streak: newStreak,
    longestStreak: newLongest,
    lastActiveDate: today,
  };

  await setDoc(ref, updates, { merge: true });

  return { ...data, ...updates };
}
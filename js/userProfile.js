import { db } from "../firebase/firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// Canonical shape for every users/{uid} document.
// Every signup path (email, Google via login, Google via register) and
// dashboard.js's self-heal fallback all go through this one function —
// so the document shape can never drift between paths again.

const ACHIEVEMENTS = [
  {
    id: "first_quiz",
    name: "First Quiz",
    description: "Complete your first quiz",
    icon: "📝",
    check: (data) => (data.quizzesTaken || 0) >= 1
  },
  {
    id: "streak_7",
    name: "7 Day Streak",
    description: "Maintain a 7-day study streak",
    icon: "🔥",
    check: (data) => (data.streak || 0) >= 7
  },
  {
    id: "questions_100",
    name: "100 Questions",
    description: "Answer 100 questions total",
    icon: "💯",
    check: (data) => (data.questionsAnswered || 0) >= 100
  },
  {
    id: "accuracy_90",
    name: "90% Accuracy",
    description: "Reach 90% overall accuracy",
    icon: "🎯",
    check: (data) => (data.accuracy || 0) >= 90
  },
  {
    id: "perfect_score",
    name: "Perfect Score",
    description: "Get 100% on any quiz",
    icon: "🏆",
    check: (data) => (data.perfectScores || 0) >= 1
  },
  {
    id: "flashcard_master",
    name: "Flashcard Master",
    description: "Master 50 flashcards",
    icon: "🧠",
    check: (data) => (data.masteredCards || 0) >= 50
  },
  {
    id: "all_subjects",
    name: "PNLE Ready",
    description: "Complete quizzes in all 8 subjects",
    icon: "⭐",
    check: (data) => {
      const subjects = Object.keys(data.subjectProgress || {});
      return subjects.length >= 8;
    }
  },
  {
    id: "streak_30",
    name: "30 Day Champion",
    description: "Maintain a 30-day study streak",
    icon: "👑",
    check: (data) => (data.streak || 0) >= 30
  }
];

const DEFAULT_PROFILE = {
  fullname: "Future RN",
  email: "",
  photoURL: "",
  school: "",
  course: "",
  yearLevel: "",
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
  achievements: [],
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
    ...DEFAULT_PROFILE,
    fullname: fullname || "Future RN",
    email: email || "",
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

/**
 * Updates editable profile fields (name, school, course, year level,
 * photoURL). Only touches the fields passed in — never overwrites
 * stats/progress fields.
 */
export async function updateUserProfile(uid, fields) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, fields, { merge: true });
  return fields;
}

/**
 * Records a completed quiz attempt: bumps aggregate stats, updates
 * per-subject accuracy (subjectProgress[subject].accuracy — the exact
 * field dashboard.js reads to render each subject's progress bar),
 * and bumps the daily streak. Called once when a quiz finishes.
 */
export async function recordQuizResult(uid, { subject, total, correct }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data();

  const quizzesTaken = (data.quizzesTaken || 0) + 1;
  const questionsAnswered = (data.questionsAnswered || 0) + total;
  const correctAnswers = (data.correctAnswers || 0) + correct;
  const accuracy = questionsAnswered
    ? Math.round((correctAnswers / questionsAnswered) * 100)
    : 0;

  const perfectScores = (data.perfectScores || 0) + (total > 0 && correct === total ? 1 : 0);

  const subjectProgress = { ...(data.subjectProgress || {}) };
  const prev = subjectProgress[subject] || { correct: 0, total: 0 };
  const subjCorrect = prev.correct + correct;
  const subjTotal = prev.total + total;
  subjectProgress[subject] = {
    correct: subjCorrect,
    total: subjTotal,
    accuracy: subjTotal ? Math.round((subjCorrect / subjTotal) * 100) : 0,
  };

  const updates = {
    quizzesTaken,
    questionsAnswered,
    correctAnswers,
    accuracy,
    perfectScores: perfectScores > (data.perfectScores || 0) ? perfectScores : data.perfectScores,
    subjectProgress
  };
  await setDoc(ref, updates, { merge: true });

  const updated = { ...data, ...updates };
  await checkAchievements(uid, updated);

  return updated;
}

/**
 * Checks all achievement conditions and unlocks any new ones.
 * Called automatically after quiz results and streak updates.
 */
export async function checkAchievements(uid, data) {
  const ref = doc(db, "users", uid);
  const currentAchievements = new Set(data.achievements || []);
  let newUnlocks = [];

  for (const ach of ACHIEVEMENTS) {
    if (!currentAchievements.has(ach.id) && ach.check(data)) {
      currentAchievements.add(ach.id);
      newUnlocks.push(ach);
    }
  }

  if (newUnlocks.length > 0) {
    await setDoc(ref, {
      achievements: Array.from(currentAchievements)
    }, { merge: true });
  }

  return newUnlocks;
}

/**
 * Returns all achievement definitions with their unlock status
 * for a given user's data.
 */
export function getAchievementStatus(data) {
  const unlocked = new Set(data.achievements || []);
  return ACHIEVEMENTS.map(ach => ({
    ...ach,
    unlocked: unlocked.has(ach.id)
  }));
}

/**
 * Tracks a perfect score event (100% on a quiz).
 */
export async function recordPerfectScore(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data();
  const perfectScores = (data.perfectScores || 0) + 1;
  await setDoc(ref, { perfectScores }, { merge: true });

  await checkAchievements(uid, { ...data, perfectScores });
}

/**
 * Updates the masteredCards count. Call after flashcard sessions.
 */
export async function updateMasteredCards(uid, count) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, { masteredCards: count }, { merge: true });

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await checkAchievements(uid, snap.data());
  }
}
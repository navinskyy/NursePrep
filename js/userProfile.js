import { db } from "../firebase/firebase.js";
import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";

// ============================================
// ACHIEVEMENTS
// ============================================

const ACHIEVEMENTS = [
  {
    id: "first_quiz",
    name: "First Quiz",
    description: "Complete your first quiz",
    icon: "📝",
    check: (data) => (data.quizzesTaken || 0) >= 1,
    progress: (data) => (data.quizzesTaken || 0) / 1
  },
  {
    id: "streak_7",
    name: "7 Day Streak",
    description: "Maintain a 7-day study streak",
    icon: "🔥",
    check: (data) => (data.streak || 0) >= 7,
    progress: (data) => (data.streak || 0) / 7
  },
  {
    id: "questions_100",
    name: "100 Questions",
    description: "Answer 100 questions total",
    icon: "💯",
    check: (data) => (data.questionsAnswered || 0) >= 100,
    progress: (data) => (data.questionsAnswered || 0) / 100
  },
  {
    id: "accuracy_90",
    name: "90% Accuracy",
    description: "Reach 90% overall accuracy",
    icon: "🎯",
    check: (data) => (data.accuracy || 0) >= 90,
    progress: (data) => (data.accuracy || 0) / 90
  },
  {
    id: "perfect_score",
    name: "Perfect Score",
    description: "Get 100% on any quiz",
    icon: "🏆",
    check: (data) => (data.perfectScores || 0) >= 1,
    progress: (data) => (data.perfectScores || 0) / 1
  },
  {
    id: "flashcard_master",
    name: "Flashcard Master",
    description: "Master 50 flashcards",
    icon: "🧠",
    check: (data) => (data.masteredCards || 0) >= 50,
    progress: (data) => (data.masteredCards || 0) / 50
  },
  {
    id: "all_subjects",
    name: "PNLE Ready",
    description: "Complete quizzes in all 8 subjects",
    icon: "⭐",
    check: (data) => {
      const subjects = Object.keys(data.subjectProgress || {});
      return subjects.length >= 8;
    },
    progress: (data) => Object.keys(data.subjectProgress || {}).length / 8
  },
  {
    id: "streak_30",
    name: "30 Day Champion",
    description: "Maintain a 30-day study streak",
    icon: "👑",
    check: (data) => (data.streak || 0) >= 30,
    progress: (data) => (data.streak || 0) / 30
  },
  {
    id: "study_5h",
    name: "Focused Mind",
    description: "Study for 5 hours total",
    icon: "⏱️",
    check: (data) => (data.studyTime || 0) >= 18000,
    progress: (data) => (data.studyTime || 0) / 18000
  },
  {
    id: "study_25h",
    name: "Study Machine",
    description: "Study for 25 hours total",
    icon: "📚",
    check: (data) => (data.studyTime || 0) >= 90000,
    progress: (data) => (data.studyTime || 0) / 90000
  },
  {
    id: "study_50h",
    name: "Marathon Learner",
    description: "Study for 50 hours total",
    icon: "🎓",
    check: (data) => (data.studyTime || 0) >= 180000,
    progress: (data) => (data.studyTime || 0) / 180000
  },
  {
    id: "questions_500",
    name: "500 Questions",
    description: "Answer 500 questions total",
    icon: "🔢",
    check: (data) => (data.questionsAnswered || 0) >= 500,
    progress: (data) => (data.questionsAnswered || 0) / 500
  },
  {
    id: "quizzes_50",
    name: "Quiz Veteran",
    description: "Complete 50 quizzes",
    icon: "🗂️",
    check: (data) => (data.quizzesTaken || 0) >= 50,
    progress: (data) => (data.quizzesTaken || 0) / 50
  },
  {
    id: "perfect_10",
    name: "Flawless Ten",
    description: "Get 100% on 10 quizzes",
    icon: "💎",
    check: (data) => (data.perfectScores || 0) >= 10,
    progress: (data) => (data.perfectScores || 0) / 10
  }
];

// ============================================
// XP RULES
// ============================================

const XP_RULES = {
  dailyLogin: 10,
  quizComplete: 20,
  scoreBonus80: 30,
  perfectScore: 50,
  flashcardSession: 15,
  flashcardMaster: 5,
  dailyGoalMet: 25,
  streak7Bonus: 50,
  streak30Bonus: 100,
  allSubjectsBonus: 40
};

// ============================================
// LEVEL THRESHOLDS
// ============================================

const LEVEL_THRESHOLDS = [
  0,      // Level 1
  100,    // Level 2
  250,    // Level 3
  500,    // Level 4
  1000,   // Level 5
  2000,   // Level 6
  3500,   // Level 7
  5500,   // Level 8
  8000,   // Level 9
  11000,  // Level 10
  15000,  // Level 11
  20000,  // Level 12
  26000,  // Level 13
  33000,  // Level 14
  41000,  // Level 15
  50000,  // Level 16
  60000,  // Level 17
  72000,  // Level 18
  86000,  // Level 19
  100000  // Level 20
];

// ============================================
// DEFAULT PROFILE
// ============================================

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
  xp: 0,
  level: 1,
  weeklyXP: 0,
  weeklyXPWeekStart: null,
  totalCorrect: 0,
  totalQuestions: 0,
  perfectScores: 0,
  dailyGoal: 20,
  questionsToday: 0,
  questionsTodayDate: null,
  flashcardsToday: 0,
  flashcardsTodayDate: null,
  goalCompletedDates: [],
  badges: [],
  lastActionTimestamps: {},
  userProgress: {}
};

// ============================================
// HELPERS
// ============================================

export function getMonday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

function calculateLevel(xp) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      return i + 1;
    }
  }
  return 1;
}

function getLevelProgress(xp, level) {
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] || 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const progress = ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100;
  return Math.min(100, Math.max(0, progress));
}

function calculateRankingScore(data) {
  const xp = data.xp || 0;
  const streak = data.streak || 0;
  const avgScore = data.averageScore || 0;
  return Math.round(xp + (streak * 20) + (avgScore * 5));
}

// ============================================
// CORE PROFILE
// ============================================

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

export async function updateUserProfile(uid, fields) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, fields, { merge: true });
  return fields;
}

// ============================================
// STREAK
// ============================================

export async function bumpDailyStreak(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();
  const today = new Date().toISOString().slice(0, 10);

  if (data.lastActiveDate === today) {
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

  const updated = { ...data, ...updates };
  await checkStreakBonuses(uid, updated);

  return updated;
}

export async function checkStreakBonuses(uid, data) {
  const ref = doc(db, "users", uid);
  const streak = data.streak || 0;
  const bonuses = [];

  if (streak === 7) {
    bonuses.push({ type: "streak7", xp: 50 });
    await awardXP(uid, "streak7Bonus");
  } else if (streak === 30) {
    bonuses.push({ type: "streak30", xp: 100 });
    await awardXP(uid, "streak30Bonus");
  }

  return bonuses;
}

// ============================================
// XP SYSTEM
// ============================================

export async function awardXP(uid, action, metadata = {}) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();
  const xpToAdd = XP_RULES[action] || 0;

  if (xpToAdd === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const weekStart = getMonday(today);
  const dailyXP = (data.dailyXP?.[today] || 0) + xpToAdd;

  const newXP = (data.xp || 0) + xpToAdd;
  let newWeeklyXP = (data.weeklyXP || 0) + xpToAdd;
  if (data.weeklyXPWeekStart !== weekStart) {
    newWeeklyXP = xpToAdd;
  }
  const newLevel = calculateLevel(newXP);

  const updates = {
    xp: newXP,
    weeklyXP: newWeeklyXP,
    level: newLevel,
    weeklyXPWeekStart: weekStart,
    [`dailyXP.${today}`]: dailyXP,
    [`lastActionTimestamps.${action}`]: Date.now()
  };

  await setDoc(ref, updates, { merge: true });

  const updated = { ...data, ...updates };
  await checkAchievements(uid, updated);

  return { xpAdded: xpToAdd, newXP, newLevel };
}

export async function enforceDailyXPCap(uid, requestedXP) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return true;

  const data = snap.data();
  const today = new Date().toISOString().slice(0, 10);
  const dailyXP = data.dailyXP?.[today] || 0;

  if (dailyXP + requestedXP > 500) {
    return false;
  }

  return true;
}

// ============================================
// PERFORMANCE METRICS
// ============================================

export async function updateAverageScore(uid, newScore, totalQuestions) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return;

  const data = snap.data();
  const oldAvg = data.averageScore || 0;
  const oldCount = data.totalQuestions || 0;

  const newCount = oldCount + (totalQuestions || 1);
  const newAvg = Math.round(((oldAvg * oldCount) + newScore) / newCount);

  await updateDoc(ref, {
    averageScore: newAvg,
    totalQuestions: newCount,
    totalCorrect: (data.totalCorrect || 0) + Math.round((newScore / 100) * (totalQuestions || 1))
  });
}

// ============================================
// QUIZ RESULTS
// ============================================

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
  const prev = subjectProgress[subject] || { correct: 0, total: 0, answered: 0 };
  const subjCorrect = prev.correct + correct;
  const subjTotal = prev.total + total;
  subjectProgress[subject] = {
    correct: subjCorrect,
    total: subjTotal,
    answered: (prev.answered || 0) + total,
    accuracy: subjTotal ? Math.round((subjCorrect / subjTotal) * 100) : 0,
  };

  const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const updates = {
    quizzesTaken,
    questionsAnswered,
    correctAnswers,
    accuracy,
    perfectScores: Math.max(perfectScores, data.perfectScores || 0),
    subjectProgress,
    [`dailyXP.${new Date().toISOString().slice(0, 10)}`]: (data.dailyXP?.[new Date().toISOString().slice(0, 10)] || 0) + XP_RULES.quizComplete
  };

  await setDoc(ref, updates, { merge: true });

  const updated = { ...data, ...updates };

  await recordQuizAttempt(uid, subject, {
    total,
    correct,
    scorePct,
    completedAt: new Date()
  });

  await updateAverageScore(uid, scorePct, total);
  await awardXP(uid, "quizComplete");
  if (scorePct >= 80) await awardXP(uid, "scoreBonus80");
  if (scorePct === 100) await awardXP(uid, "perfectScore");
  await bumpDailyStreak(uid);
  await checkAchievements(uid, updated);

  return updated;
}

async function recordQuizAttempt(uid, quizId, { total, correct, scorePct, completedAt }) {
  const progressRef = doc(db, "userProgress", uid, "quizzes", quizId);
  const snap = await getDoc(progressRef);

  const prev = snap.exists() ? snap.data() : {};
  const attempts = (prev.attempts || 0) + 1;
  const prevBest = prev.bestScore || 0;
  const bestScore = Math.max(prevBest, scorePct);
  const completed = scorePct === 100 || total === correct;

  await setDoc(progressRef, {
    attempts,
    bestScore,
    completed,
    correctAnswers: (prev.correctAnswers || 0) + correct,
    totalQuestions: (prev.totalQuestions || 0) + total,
    lastAttempt: completedAt,
    lastAnsweredAt: completedAt,
    updatedAt: completedAt
  });
}

// ============================================
// FLASHCARDS
// ============================================

export async function recordFlashcardSession(uid, reviewedCount, masteredCount) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data();

  const updates = {
    masteredCards: Math.max(masteredCount, data.masteredCards || 0),
    [`dailyXP.${new Date().toISOString().slice(0, 10)}`]: (data.dailyXP?.[new Date().toISOString().slice(0, 10)] || 0) + XP_RULES.flashcardSession
  };

  await setDoc(ref, updates, { merge: true });

  await awardXP(uid, "flashcardSession");
  await bumpDailyStreak(uid);
  await checkAchievements(uid, { ...data, ...updates });

  return { ...data, ...updates };
}

// ============================================
// ACHIEVEMENTS
// ============================================

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

export function getAchievementStatus(data) {
  const unlocked = new Set(data.achievements || []);
  return ACHIEVEMENTS.map(ach => {
    const isUnlocked = unlocked.has(ach.id);
    let progress = isUnlocked ? 1 : 0;
    if (!isUnlocked && typeof ach.progress === "function") {
      const ratio = ach.progress(data);
      progress = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
    }
    return {
      ...ach,
      unlocked: isUnlocked,
      progress
    };
  });
}

export { calculateLevel, getLevelProgress, calculateRankingScore, LEVEL_THRESHOLDS, XP_RULES };

export async function recordPerfectScore(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data();
  const perfectScores = (data.perfectScores || 0) + 1;
  await setDoc(ref, { perfectScores }, { merge: true });

  await checkAchievements(uid, { ...data, perfectScores });
}

export async function updateMasteredCards(uid, count) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, { masteredCards: count }, { merge: true });

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await checkAchievements(uid, snap.data());
  }
}

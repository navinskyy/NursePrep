// ======================================
// SHARED SUBJECT DATA
// ======================================

export const SUBJECT_NAMES = {
    pnleSets: "Comprehensive PNLE SETS",
    fundamentals: "Foundation of Nursing",
    maternal: "Maternal & Child Nursing",
    community: "Community Health Nursing",
    medSurg: "Medical-Surgical Nursing",
    psychiatric: "Psychiatric Nursing",
    allTopics: "All Topics"
};

// ======================================
// SUBJECT ICONS
// ======================================

export const SUBJECT_ICONS = {
    pnleSets: "📚",
    fundamentals: "🏥",
    maternal: "👶",
    community: "🌍",
    medSurg: "🩺",
    psychiatric: "🧠",
    allTopics: "📋"
};

// ======================================
// SUBJECT COLORS
// ======================================

export const SUBJECT_COLORS = {
    pnleSets: "#FFD700",
    fundamentals: "#EC6FA0",
    maternal: "#FF9F7F",
    community: "#22C55E",
    medSurg: "#7C8CFF",
    psychiatric: "#A78BFA",
    allTopics: "#888888"
};

// ======================================
// SMALL HELPERS
// ======================================

export function pad(number) {
    return String(number).padStart(2, "0");
}

export function getSubjectFromURL(defaultSubject = "fundamentals") {

    const params = new URLSearchParams(window.location.search);

    return params.get("subject") || defaultSubject;

}

export function getGreeting() {

    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";

    if (hour < 18) return "Good afternoon";

    return "Good evening";

}

export function formatStudyTime(seconds = 0) {

    const hrs = Math.floor(seconds / 3600);

    const mins = Math.floor((seconds % 3600) / 60);

    return `${hrs}h ${mins}m`;

}

export function calculateAccuracy(correctAnswers, totalQuestions) {

    if (!totalQuestions) return 0;

    return Math.round((correctAnswers / totalQuestions) * 100);

}

export function percentage(value, total) {

    if (!total) return 0;

    return Math.round((value / total) * 100);

}

// ======================================
// SETTINGS (persisted to localStorage
// and mirrored to Firestore)
// ======================================

export const SETTINGS_STORAGE_KEY = "nurseprep:settings";

export const DEFAULT_SETTINGS = {
    dailyGoal: 20,
    questionTimer: "60",
    shuffleQuestions: true,
    reducedMotion: false
};

export function getUserSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveUserSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
        console.warn("Failed to persist settings locally:", err);
    }
}

// Returns the per-question timer duration in seconds.
// "0" means "no timer" — returns 0.
export function getQuestionTimerSeconds() {
    const raw = getUserSettings().questionTimer;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return parseInt(DEFAULT_SETTINGS.questionTimer, 10);
    return n;
}

export function getDailyGoal() {
    const n = parseInt(getUserSettings().dailyGoal, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SETTINGS.dailyGoal;
    return n;
}

// ======================================
// QUESTION BANK CACHE
// ======================================

let _questionBank = null;

// Some quizzes in quiz.json store the correct option under `correct_answer`
// instead of `answer`. Normalize every question so the rest of the app can
// rely on a single `answer` field (used for scoring and mistake detection).
function normalizeQuestion(q) {
    if (!q || typeof q !== "object") return q;
    if (q.answer === undefined || q.answer === null) {
        if (q.correct_answer !== undefined && q.correct_answer !== null) {
            return { ...q, answer: q.correct_answer };
        }
    }
    return q;
}

function normalizeQuestionBank(bank) {
    if (!bank || typeof bank !== "object") return bank;
    for (const key of Object.keys(bank)) {
        if (Array.isArray(bank[key])) {
            bank[key] = bank[key].map(normalizeQuestion);
        }
    }
    return bank;
}

export async function getQuestionBank() {
    if (_questionBank) return _questionBank;
    try {
        const res = await fetch("./data/quiz.json");
        _questionBank = normalizeQuestionBank(await res.json());
    } catch (e) {
        console.error("Failed to load question bank:", e);
        _questionBank = {};
    }
    return _questionBank;
}

export function getAvailableQuestionCount(quiz, bank) {
    if (!bank) return quiz.itemCount || 0;
    if (quiz.quizId && Array.isArray(bank[quiz.quizId])) {
        return bank[quiz.quizId].length;
    }
    if (quiz.subjectKey && Array.isArray(bank[quiz.subjectKey])) {
        return bank[quiz.subjectKey].length;
    }
    let total = 0;
    for (const key of Object.keys(bank)) {
        if (Array.isArray(bank[key])) {
            total += bank[key].length;
        }
    }
    return total;
}

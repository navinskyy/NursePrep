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
// QUESTION BANK CACHE
// ======================================

let _questionBank = null;

export async function getQuestionBank() {
    if (_questionBank) return _questionBank;
    try {
        const res = await fetch("./data/quiz.json");
        _questionBank = await res.json();
    } catch (e) {
        console.error("Failed to load question bank:", e);
        _questionBank = {};
    }
    return _questionBank;
}

export function getAvailableQuestionCount(quiz, bank) {
    if (!bank) return quiz.itemCount || 0;
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

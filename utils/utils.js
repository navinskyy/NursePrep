// ======================================
// SHARED SUBJECT DATA
// ======================================

export const SUBJECT_NAMES = {
    fundamentals: "Fundamentals of Nursing",
    medSurg: "Medical-Surgical Nursing",
    maternal: "Maternal Nursing",
    pediatric: "Pediatric Nursing",
    psychiatric: "Psychiatric Nursing",
    community: "Community Health Nursing",
    pharma: "Pharmacology",
    leadership: "Leadership & Management"
};

// ======================================
// SUBJECT ICONS
// ======================================

export const SUBJECT_ICONS = {
    fundamentals: "📘",
    medSurg: "🩺",
    maternal: "🤰",
    pediatric: "👶",
    psychiatric: "🧠",
    community: "🌍",
    pharma: "💊",
    leadership: "👩‍⚕️"
};

// ======================================
// SUBJECT COLORS
// ======================================

export const SUBJECT_COLORS = {
    fundamentals: "#EC6FA0",
    medSurg: "#7C8CFF",
    maternal: "#FF9F7F",
    pediatric: "#00C9A7",
    psychiatric: "#A78BFA",
    community: "#22C55E",
    pharma: "#38BDF8",
    leadership: "#FACC15"
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
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged
} from "firebase/auth";

import {
    doc,
    getDoc,
    collection,
    query,
    orderBy,
    getDocs
} from "firebase/firestore";

import { getAchievementStatus } from "./userProfile.js";

const SUBJECT_KEYS = [
    "fundamentals",
    "medSurg",
    "maternal",
    "pediatric",
    "psychiatric",
    "community",
    "pharma",
    "leadership"
];

const SUBJECT_LABELS = {
    fundamentals: "Fundamentals",
    medSurg: "Medical Surgical",
    maternal: "Maternal",
    pediatric: "Pediatric",
    psychiatric: "Psychiatric",
    community: "Community",
    pharma: "Pharmacology",
    leadership: "Leadership"
};

const SUBJECT_COLORS = {
    fundamentals: "#EC6FA0",
    medSurg: "#7C8CFF",
    maternal: "#FF9F7F",
    pediatric: "#00C9A7",
    psychiatric: "#A78BFA",
    community: "#22C55E",
    pharma: "#38BDF8",
    leadership: "#FACC15"
};

// ===========================
// ELEMENTS
// ===========================

const statQuestions = document.getElementById("statQuestions");
const statAccuracy = document.getElementById("statAccuracy");
const statStreak = document.getElementById("statStreak");
const statQuizzes = document.getElementById("statQuizzes");

const statQuestionsDesc = document.getElementById("statQuestionsDesc");
const statAccuracyDesc = document.getElementById("statAccuracyDesc");
const statStreakDesc = document.getElementById("statStreakDesc");
const statQuizzesDesc = document.getElementById("statQuizzesDesc");

const strongestSubjectName = document.getElementById("strongestSubjectName");
const strongestSubjectPct = document.getElementById("strongestSubjectPct");
const strongestSubjectDesc = document.getElementById("strongestSubjectDesc");
const weakestSubjectName = document.getElementById("weakestSubjectName");
const weakestSubjectPct = document.getElementById("weakestSubjectPct");
const weakestSubjectDesc = document.getElementById("weakestSubjectDesc");

const overallMastery = document.getElementById("overallMastery");

const quizHistoryEl = document.getElementById("quizHistory");

const sidebarStreak = document.getElementById("sidebarStreak");

// ===========================
// CHART INSTANCES
// ===========================

let subjectBarChart = null;
let progressRingChart = null;
let weeklyBarChart = null;
let accuracyTrendChart = null;

// ===========================
// CHART.JS GLOBAL DEFAULTS
// ===========================

Chart.defaults.color = "#B7BED2";
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;

const GRID_COLOR = "rgba(35, 44, 69, 0.6)";

// ===========================
// HELPERS
// ===========================

function timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

function getDayLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getDay()];
}

function getDayIndex(date) {
    const day = date.getDay();
    return day === 0 ? 6 : day - 1;
}

// ===========================
// SUBJECT PERFORMANCE BAR CHART
// ===========================

function renderSubjectBarChart(subjectProgress) {
    const ctx = document.getElementById("subjectBarChart");
    if (!ctx) return;

    if (subjectBarChart) subjectBarChart.destroy();

    const labels = SUBJECT_KEYS.map((k) => SUBJECT_LABELS[k] || k);
    const data = SUBJECT_KEYS.map((k) => subjectProgress[k] || 0);
    const colors = SUBJECT_KEYS.map((k) => SUBJECT_COLORS[k] || "#EC6FA0");

    subjectBarChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.map((c) => c + "33"),
                borderColor: colors,
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 700,
                easing: "easeOutQuart"
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#131A2C",
                    titleColor: "#F6F5F8",
                    bodyColor: "#B7BED2",
                    borderColor: "#232C45",
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.x}%`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: GRID_COLOR },
                    ticks: { callback: (v) => v + "%" }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } }
                }
            },
            animation: {
                duration: 800,
                easing: "easeOutQuart"
            }
        }
    });
}

// ===========================
// OVERALL PROGRESS RING
// ===========================

function renderProgressRing(subjectProgress) {
    const ctx = document.getElementById("progressRingChart");
    if (!ctx) return;

    if (progressRingChart) progressRingChart.destroy();

    const values = SUBJECT_KEYS.map((k) => subjectProgress[k] || 0);
    const avg = values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 0;

    if (overallMastery) overallMastery.textContent = avg + "%";

    progressRingChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            datasets: [{
                data: [avg, 100 - avg],
                backgroundColor: [
                    "rgba(236, 111, 160, 0.85)",
                    "rgba(35, 44, 69, 0.4)"
                ],
                borderWidth: 0,
                circumference: 360,
                rotation: -90
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: "78%",
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: {
                animateRotate: true,
                duration: 1000,
                easing: "easeOutQuart"
            }
        }
    });
}

// ===========================
// WEEKLY ACTIVITY BAR CHART
// ===========================

function renderWeeklyBarChart(activities) {
    const ctx = document.getElementById("weeklyBarChart");
    if (!ctx) return;

    if (weeklyBarChart) weeklyBarChart.destroy();

    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts = [0, 0, 0, 0, 0, 0, 0];

    activities.forEach((a) => {
        const ts = a.timestamp?.toDate ? a.timestamp.toDate() : null;
        if (!ts) return;
        const idx = getDayIndex(ts);
        counts[idx]++;
    });

    const maxCount = Math.max(...counts, 1);

    weeklyBarChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: dayLabels,
            datasets: [{
                data: counts,
                backgroundColor: counts.map((c) =>
                    c === maxCount ? "rgba(236, 111, 160, 0.8)" : "rgba(236, 111, 160, 0.25)"
                ),
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#131A2C",
                    titleColor: "#F6F5F8",
                    bodyColor: "#B7BED2",
                    borderColor: "#232C45",
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y} activity${ctx.parsed.y !== 1 ? "s" : ""}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 },
                    grid: { color: GRID_COLOR }
                }
            },
            animation: {
                duration: 800,
                easing: "easeOutQuart"
            }
        }
    });
}

// ===========================
// ACCURACY TREND LINE CHART
// ===========================

function renderAccuracyTrend(activities) {
    const ctx = document.getElementById("accuracyTrendChart");
    if (!ctx) return;

    if (accuracyTrendChart) accuracyTrendChart.destroy();

    const quizActivities = activities
        .filter((a) => a.type === "quiz" && a.score != null)
        .sort((a, b) => {
            const ta = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(0);
            const tb = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(0);
            return ta - tb;
        })
        .slice(-10);

    const labels = quizActivities.map((a, i) => {
        const d = a.timestamp?.toDate ? a.timestamp.toDate() : new Date();
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    const data = quizActivities.map((a) => a.score || 0);

    const gradientPlugin = {
        id: "gradientFill",
        beforeDatasetsDraw(chart) {
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return;
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(236, 111, 160, 0.25)");
            gradient.addColorStop(1, "rgba(236, 111, 160, 0.0)");
            chart.data.datasets[0].backgroundColor = gradient;
        }
    };

    accuracyTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                data,
                borderColor: "#EC6FA0",
                backgroundColor: "rgba(236, 111, 160, 0.08)",
                borderWidth: 2.5,
                pointBackgroundColor: "#EC6FA0",
                pointBorderColor: "#131A2C",
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: "#131A2C",
                    titleColor: "#F6F5F8",
                    bodyColor: "#B7BED2",
                    borderColor: "#232C45",
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 }, maxRotation: 0 }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: { stepSize: 25, callback: (v) => v + "%" },
                    grid: { color: GRID_COLOR }
                }
            },
            animation: {
                duration: 1000,
                easing: "easeOutQuart"
            }
        },
        plugins: [gradientPlugin]
    });
}

// ===========================
// QUIZ HISTORY
// ===========================

function renderQuizHistory(activities) {
    if (!quizHistoryEl) return;

    const quizActivities = activities
        .filter((a) => a.type === "quiz")
        .sort((a, b) => {
            const ta = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(0);
            const tb = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(0);
            return tb - ta;
        })
        .slice(0, 10);

    if (quizActivities.length === 0) {
        quizHistoryEl.innerHTML = '<p class="analytics-empty">No quiz history yet — it will appear here after your first quiz.</p>';
        return;
    }

    quizHistoryEl.innerHTML = "";

    quizActivities.forEach((a, i) => {
        const d = a.timestamp?.toDate ? a.timestamp.toDate() : new Date();
        const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });

        const score = a.score != null ? a.score : "—";
        const pctColor = score >= 80 ? "var(--mint)" : score >= 60 ? "var(--amber)" : "var(--pink-300)";

        const item = document.createElement("div");
        item.className = "quiz-history-item";
        item.style.animationDelay = `${i * 0.05}s`;

        item.innerHTML = `
            <div>
                <div class="quiz-history-date">${dayLabel}, ${dateLabel}</div>
                <div class="quiz-history-subject">${a.label || a.subject || "Quiz"}</div>
            </div>
            <div class="quiz-history-score" style="color:${pctColor}">${score}</div>
            <div class="quiz-history-pct">${typeof score === "number" ? score + "%" : ""}</div>
            <div class="quiz-history-bar"><span style="width:${typeof score === "number" ? score : 0}%"></span></div>
        `;

        quizHistoryEl.appendChild(item);
    });
}

// ===========================
// ACHIEVEMENTS
// ===========================

function renderAchievements(data) {
    const achievements = getAchievementStatus(data);
    const badges = document.querySelectorAll(".achievement-badge");

    const unlockedSet = new Set(achievements.filter(a => a.unlocked).map(a => a.id));

    badges.forEach((badge) => {
        const key = badge.dataset.badge;
        if (unlockedSet.has(key)) {
            badge.classList.remove("locked");
        } else {
            badge.classList.add("locked");
        }
    });
}

// ===========================
// MAIN RENDER
// ===========================

async function renderAnalytics(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            console.warn("No user document found.");
            return;
        }

        const data = userSnap.data();

        // Sidebar streak
        if (sidebarStreak) {
            sidebarStreak.textContent = `${data.streak || 0} days`;
        }

        // Top stats
        const questionsAnswered = data.questionsAnswered || 0;
        const quizzesTaken = data.quizzesTaken || 0;
        const accuracy = data.accuracy || 0;
        const streak = data.streak || 0;
        const longestStreak = data.longestStreak || 0;

        if (statQuestions) statQuestions.textContent = questionsAnswered;
        if (statAccuracy) statAccuracy.textContent = accuracy;
        if (statStreak) statStreak.textContent = streak;
        if (statQuizzes) statQuizzes.textContent = quizzesTaken;

        if (statQuestionsDesc) statQuestionsDesc.textContent = questionsAnswered > 0 ? `${questionsAnswered} questions done` : "Keep practicing!";
        if (statAccuracyDesc) statAccuracyDesc.textContent = accuracy > 0 ? `Accuracy across all quizzes` : "Keep improving!";
        if (statStreakDesc) statStreakDesc.textContent = `Best: ${longestStreak} days`;
        if (statQuizzesDesc) statQuizzesDesc.textContent = `${quizzesTaken} session${quizzesTaken !== 1 ? "s" : ""} total`;

        // Subject progress
        const subjectProgress = data.subjectProgress || {};

        // Normalize: if subjectProgress has quiz data objects instead of numbers
        const normalizedProgress = {};
        SUBJECT_KEYS.forEach((key) => {
            const val = subjectProgress[key];
            if (val == null) {
                normalizedProgress[key] = 0;
            } else if (typeof val === "number") {
                normalizedProgress[key] = Math.min(val, 100);
            } else if (typeof val === "object") {
                const acc = val.accuracy ?? val.progress ?? 0;
                normalizedProgress[key] = Math.min(Number(acc), 100);
            } else {
                normalizedProgress[key] = 0;
            }
        });

        renderSubjectBarChart(normalizedProgress);
        renderProgressRing(normalizedProgress);

        // Strongest / Weakest
        const attempted = SUBJECT_KEYS.filter((k) => normalizedProgress[k] > 0);
        if (attempted.length > 0) {
            const sorted = [...attempted].sort((a, b) => normalizedProgress[b] - normalizedProgress[a]);
            const strongest = sorted[0];
            const weakest = sorted[sorted.length - 1];

            if (strongestSubjectName) strongestSubjectName.textContent = SUBJECT_LABELS[strongest] || strongest;
            if (strongestSubjectPct) strongestSubjectPct.textContent = normalizedProgress[strongest] + "%";
            if (strongestSubjectDesc) {
                strongestSubjectDesc.textContent = normalizedProgress[strongest] >= 90
                    ? "Keep practicing to maintain mastery."
                    : "You're doing great — keep it up!";
            }
            if (weakestSubjectName) weakestSubjectName.textContent = SUBJECT_LABELS[weakest] || weakest;
            if (weakestSubjectPct) weakestSubjectPct.textContent = normalizedProgress[weakest] + "%";
            if (weakestSubjectDesc) {
                normalizedProgress[weakest] < 50
                    ? weakestSubjectDesc.textContent = "We recommend reviewing this subject."
                    : weakestSubjectDesc.textContent = "A little more practice will help.";
            }
        } else {
            if (strongestSubjectName) strongestSubjectName.textContent = "Not enough data";
            if (weakestSubjectName) weakestSubjectName.textContent = "Not enough data";
            if (strongestSubjectPct) strongestSubjectPct.textContent = "";
            if (weakestSubjectPct) weakestSubjectPct.textContent = "";
            if (strongestSubjectDesc) strongestSubjectDesc.textContent = "";
            if (weakestSubjectDesc) weakestSubjectDesc.textContent = "";
        }

        // Activity for weekly, trend, quiz history
        const activityRef = collection(db, "users", uid, "activity");
        const activityQuery = query(activityRef, orderBy("timestamp", "desc"));
        const activitySnap = await getDocs(activityQuery);

        const activities = [];
        activitySnap.forEach((docSnap) => {
            activities.push(docSnap.data());
        });

        renderWeeklyBarChart(activities);
        renderAccuracyTrend(activities);
        renderQuizHistory(activities);
        renderAchievements(data);

    } catch (err) {
        console.error("Analytics failed to load:", err);
    }
}

// ===========================
// AUTH
// ===========================

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    renderAnalytics(user.uid);
});
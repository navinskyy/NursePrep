import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "firebase/auth";

import {
    doc,
    getDoc,
    updateDoc,
    collection,
    getDocs,
    query,
    orderBy,
    limit,
    addDoc
} from "firebase/firestore";

import { ensureUserProfile, bumpDailyStreak, getAchievementStatus, awardXP, getMonday, checkAchievements } from "./userProfile.js";
import { getDailyGoal as readSavedDailyGoal, plural } from "../utils/utils.js";
import { animateIfAllowed, prefersReducedMotion, stagger } from "./motion.js";

// ===========================
// ELEMENTS
// ===========================

const greeting = document.getElementById("greeting");
const welcomeMessage = document.getElementById("welcomeMessage");

const questionsAnswered = document.getElementById("questionsAnswered");
const accuracy = document.getElementById("accuracy");
const streak = document.getElementById("streak");

const sidebarStreak = document.getElementById("sidebarStreak");

const bestStreak = document.getElementById("bestStreak");

const logoutBtn = document.getElementById("logoutBtn");

const goalFill = document.getElementById("goalFill");
const goalText = document.getElementById("goalText");
const goalEditBtn = document.getElementById("goalEditBtn");
const goalInput = document.getElementById("goalInput");
const goalMilestone = document.getElementById("goalMilestone");
const goalUpsellMore = document.getElementById("goalUpsellMore");
const goalUpsellFlashcards = document.getElementById("goalUpsellFlashcards");
const goalUpsellDone = document.getElementById("goalUpsellDone");

const continueLabel = document.getElementById("continueLabel");
const continueDetail = document.getElementById("continueDetail");
const continueLink = document.getElementById("continueLink");

const strongestName = document.getElementById("strongestSubjectName");
const strongestValue = document.getElementById("strongestSubjectValue");
const weakestName = document.getElementById("weakestSubjectName");
const weakestValue = document.getElementById("weakestSubjectValue");

const activityList = document.getElementById("activityList");

    const countdownDays = document.getElementById("countdownDays");
    const countdownHours = document.getElementById("countdownHours");
    const countdownMinutes = document.getElementById("countdownMinutes");
    const countdownSeconds = document.getElementById("countdownSeconds");
    const pnleExamDate = document.getElementById("pnleExamDate");

    const studyTimeTodayEl = document.getElementById("studyTimeToday");
    const startTimerBtn = document.getElementById("startTimerBtn");
    const stopTimerBtn = document.getElementById("stopTimerBtn");

    let studyTimerInterval = null;
    let studyStartTime = null;
    let studySecondsToday = 0;
    let currentAuthUid = null;

// ===========================
// GREETING
// ===========================

function getGreeting() {

    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";

    if (hour < 18) return "Good afternoon";

    return "Good evening";

}

function animateNumber(el, target, options = {}) {
    if (!el) return Promise.resolve();

    const current = Number.parseFloat(el.textContent) || 0;
    const next = Number.isFinite(target) ? target : 0;
    const suffix = options.suffix || "";

    if (prefersReducedMotion() || current === next) {
        el.textContent = `${Math.round(next)}${suffix}`;
        return Promise.resolve();
    }

    return animateIfAllowed({ value: current }, {
        value: next,
        duration: options.duration || 420,
        ease: "outCubic",
        onUpdate: (animation) => {
            el.textContent = `${Math.round(animation.targets[0].value)}${suffix}`;
        }
    });
}

function animateScaleProgress(el, percent) {
    if (!el) return Promise.resolve();

    const next = Math.max(0, Math.min(100, Number(percent) || 0));
    const scale = next / 100;

    el.style.width = "100%";
    el.style.transformOrigin = "left center";

    if (prefersReducedMotion()) {
        el.style.transform = `scaleX(${scale})`;
        return Promise.resolve();
    }

    return animateIfAllowed(el, {
        scaleX: scale,
        duration: 420,
        ease: "outCubic"
    });
}

function animateActivityItems() {
    if (!activityList || prefersReducedMotion()) return Promise.resolve();

    return animateIfAllowed(Array.from(activityList.children), {
        opacity: [0, 1],
        translateY: [6, 0],
        delay: stagger(35),
        duration: 180,
        ease: "outCubic"
    });
}

function animateWeeklyBars() {
    if (prefersReducedMotion()) return Promise.resolve();

    const bars = Array.from(document.querySelectorAll(".week-bar"));

    return animateIfAllowed(bars, {
        scaleY: [0, 1],
        delay: stagger(30),
        duration: 320,
        ease: "outCubic"
    });
}

// ===========================
// DAILY GOAL
// Lives in Firestore as users/{uid}.dailyGoal + .questionsToday, not a
// constant in this file. First time we see a user without a dailyGoal we
// write a default once so it's a real stored value from then on.
// ===========================

const DEFAULT_DAILY_GOAL = 20;

function renderGoal(answeredToday, dailyGoal) {

    if (!goalFill || !goalText) return;

    const percent = Math.min((answeredToday / dailyGoal) * 100, 100);

    goalText.textContent = `${answeredToday}/${dailyGoal} questions today`;
    void animateScaleProgress(goalFill, percent).catch(() => undefined);

}

// Pull the latest saved Daily Goal (local or remote) and re-render the goal
// widget. Called on storage events / visibility change so the Dashboard
// reflects Settings changes without a hard reload.
async function refreshDailyGoalFromSettings(userRef, answeredToday) {
    try {
        let remoteGoal = null;
        try {
            const snap = await getDoc(userRef);
            if (snap.exists() && Number.isFinite(snap.data().dailyGoal)) {
                remoteGoal = snap.data().dailyGoal;
            }
        } catch (err) {
            console.warn("Daily goal remote refresh failed:", err);
        }

        const localGoal = readSavedDailyGoal();
        const next = remoteGoal ?? localGoal;
        if (Number.isFinite(next) && next > 0) {
            renderGoal(answeredToday, next);
            wireGoalEditing(userRef, next, answeredToday);
        }
    } catch (err) {
        console.warn("Daily goal refresh failed:", err);
    }
}

function wireGoalEditing(userRef, initialGoal, answeredToday) {

    if (!goalEditBtn || !goalInput || !goalText) return;

    let currentGoal = initialGoal;

    goalEditBtn.addEventListener("click", () => {

        goalInput.value = currentGoal;
        goalInput.classList.add("is-editing");
        goalText.classList.add("is-editing");
        goalInput.focus();
        goalInput.select();

    });

    async function saveGoal() {

        goalInput.classList.remove("is-editing");
        goalText.classList.remove("is-editing");

        const parsed = parseInt(goalInput.value, 10);

        if (!Number.isFinite(parsed) || parsed <= 0) {
            renderGoal(answeredToday, currentGoal);
            return;
        }

        currentGoal = parsed;
        renderGoal(answeredToday, currentGoal);

        try {
            await updateDoc(userRef, { dailyGoal: currentGoal });
        } catch (err) {
            console.error("Couldn't save daily goal:", err);
        }

    }

    goalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") goalInput.blur();
        if (e.key === "Escape") { goalInput.value = currentGoal; goalInput.blur(); }
    });

    goalInput.addEventListener("blur", saveGoal);

}

// ===========================
// GOAL MILESTONE
// ===========================

let goalMilestoneShown = false;
let goalMilestoneDate = "";

function showGoalMilestone(userRef) {
    if (!goalMilestone) return;
    goalMilestone.style.display = "block";
    goalMilestoneShown = true;
    goalMilestoneDate = new Date().toISOString().slice(0, 10);
    void animateIfAllowed(goalMilestone, {
        opacity: [0, 1],
        translateY: [-4, 0],
        duration: 220,
        ease: "outCubic"
    }).catch(() => undefined);
    awardXP(userRef.id || "", "dailyGoalMet").catch(() => {});
}

function hideGoalMilestone() {
    if (!goalMilestone) return;
    goalMilestone.style.display = "none";
}

function wireGoalMilestone(userRef, dailyGoal) {
    if (!goalUpsellMore || !goalUpsellFlashcards || !goalUpsellDone) return;

    goalUpsellMore.addEventListener("click", async () => {
        const newGoal = dailyGoal + 5;
        try {
            await updateDoc(userRef, { dailyGoal: newGoal });
        } catch (err) {
            console.error("Couldn't update daily goal:", err);
        }
        goalMilestoneShown = false;
        hideGoalMilestone();
    });

    goalUpsellFlashcards.addEventListener("click", () => {
        window.location.href = "flashcards.html";
    });

    goalUpsellDone.addEventListener("click", () => {
        hideGoalMilestone();
    });
}

// ===========================
// STRONGEST / WEAKEST SUBJECT
// Computed from the same per-subject progress data already used to fill
// in the subject cards below — no separate hardcoded list.
// ===========================

function renderStrongestWeakest(subjectStats) {

    if (!strongestName || !weakestName) return;

    const attempted = subjectStats.filter((s) => s.value > 0);

    if (attempted.length === 0) {

        strongestName.textContent = "Not enough data yet";
        weakestName.textContent = "Not enough data yet";
        strongestName.classList.add("is-empty");
        weakestName.classList.add("is-empty");
        if (strongestValue) strongestValue.textContent = "Finish a quiz to see your strongest subject.";
        if (weakestValue) weakestValue.textContent = "We'll point out where to focus next.";
        return;

    }

    const sorted = [...attempted].sort((a, b) => b.value - a.value);

    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];

    strongestName.classList.remove("is-empty");
    weakestName.classList.remove("is-empty");
    strongestName.textContent = strongest.title;
    weakestName.textContent = weakest.title;
    if (strongestValue) void animateNumber(strongestValue, strongest.value, { suffix: "%" });
    if (weakestValue) void animateNumber(weakestValue, weakest.value, { suffix: "%" });

}

// ===========================
// CONTINUE WHERE YOU LEFT OFF
// Reads users/{uid}.lastActivity, written by activity.js whenever a quiz
// or flashcard session finishes.
// ===========================

function renderContinueCard(lastActivity) {

    if (!lastActivity || !lastActivity.subject) {

        if (continueLabel) continueLabel.textContent = "No sessions yet";
        if (continueDetail) continueDetail.textContent = "Start a quiz or a flashcard set to pick up here next time.";
        if (continueLink) {
            continueLink.textContent = "Browse subjects";
            continueLink.href = "subjects.html";
        }
        return;

    }

    if (continueLabel) continueLabel.textContent = lastActivity.label || lastActivity.subject;
    if (continueDetail) continueDetail.textContent = lastActivity.detail || "";
    if (continueLink) {
        continueLink.textContent = "Continue →";
        continueLink.href = lastActivity.path || "subjects.html";
    }

}

// ===========================
// RECENT ACTIVITY
// Reads the last 5 entries from users/{uid}/activity.
// ===========================

async function renderRecentActivity(uid) {

    if (!activityList) return;

    try {

        const activityRef = collection(db, "users", uid, "activity");
        const recentQuery = query(activityRef, orderBy("timestamp", "desc"), limit(5));
        const recentSnap = await getDocs(recentQuery);

        if (recentSnap.empty) {

            activityList.innerHTML = `<li class="activity-empty">No activity yet — it'll show up here after your first quiz or flashcard session.</li>`;
            return;

        }

        activityList.innerHTML = "";

        recentSnap.forEach((docSnap) => {

            const item = docSnap.data();

            const when = item.timestamp?.toDate ? item.timestamp.toDate() : null;

            const li = document.createElement("li");
            li.className = "activity-item";

            const dot = document.createElement("span");
            dot.className = `activity-dot activity-${item.type || "quiz"}`;

            const text = document.createElement("span");
            text.className = "activity-text";

            const strong = document.createElement("strong");
            strong.textContent = item.label || item.subject || "Study session";
            text.appendChild(strong);

            if (item.detail) {
                text.appendChild(document.createTextNode(" — " + item.detail));
            }

            const time = document.createElement("span");
            time.className = "activity-time";
            time.textContent = when ? timeAgo(when) : "";

            li.append(dot, text, time);
            activityList.appendChild(li);

        });
        animateActivityItems();

    } catch (err) {

        console.error("Couldn't load recent activity:", err);
        activityList.innerHTML = `<li class="activity-empty">Couldn't load recent activity.</li>`;

    }

}

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

// ===========================
// PNLE COUNTDOWN TIMER
// ===========================

// Scheduled PNLE dates (UTC). Add the next PRC-announced date here; the
// countdown always targets the first date that hasn't passed yet.
const PNLE_DATES = [
    Date.UTC(2026, 7, 29, 0, 0, 0),
];

function initPNLECountdown() {
    const now = new Date();
    const upcoming = PNLE_DATES.map((t) => new Date(t)).find((d) => d.toDateString() === now.toDateString() || d > now);
    const countdownEl = document.getElementById("pnleCountdown");

    if (!upcoming) {
        if (countdownEl) countdownEl.hidden = true;
        if (pnleExamDate) pnleExamDate.textContent = "The next PNLE date hasn't been announced yet. The countdown will start once PRC releases the schedule.";
        return;
    }

    const examDate = upcoming;
    const isToday = now.toDateString() === examDate.toDateString();

    if (pnleExamDate) {
        pnleExamDate.textContent = `Next PNLE: ${examDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    }

    function updateCountdown() {
        const now = new Date();
        let diff = examDate - now;

        if (diff <= 0) {
            if (countdownDays) countdownDays.textContent = "00";
            if (countdownHours) countdownHours.textContent = "00";
            if (countdownMinutes) countdownMinutes.textContent = "00";
            if (countdownSeconds) countdownSeconds.textContent = "00";
            if (pnleExamDate) pnleExamDate.textContent = isToday ? "PNLE exam is today! Good luck!" : "PNLE exam has passed.";
            return;
        }

        diff = Math.max(diff, 0);

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        if (countdownDays) countdownDays.textContent = String(days).padStart(2, "0");
        if (countdownHours) countdownHours.textContent = String(hours).padStart(2, "0");
        if (countdownMinutes) countdownMinutes.textContent = String(minutes).padStart(2, "0");
        if (countdownSeconds) countdownSeconds.textContent = String(seconds).padStart(2, "0");
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// ===========================
// STUDY TIME TRACKER
// ===========================

function loadStudyTimeData() {
    const stored = localStorage.getItem("studyTimeData");
    let data = {};

    if (stored) {
        try {
            data = JSON.parse(stored);
        } catch (e) {
            data = {};
        }
    }

    const now = new Date();
    const today = now.toLocaleDateString("en-CA");
    const todayDayKey = getDayKey(now);

    if (!data.date || data.date !== today) {
        data = {
            date: today,
            dayKey: todayDayKey,
            seconds: 0,
            weekly: data.weekly || {}
        };
        saveStudyTimeData(data);
    }

    if (data.dayKey !== todayDayKey) {
        data.dayKey = todayDayKey;
        saveStudyTimeData(data);
    }

    return data;
}

function saveStudyTimeData(data) {
    localStorage.setItem("studyTimeData", JSON.stringify(data));
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getDayKey(date) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

function getTimerStartTime() {
    const stored = localStorage.getItem("studyTimeTimerStart");
    if (!stored) return null;
    const ts = parseInt(stored, 10);
    return Number.isFinite(ts) ? ts : null;
}

function setTimerStartTime(ts) {
    localStorage.setItem("studyTimeTimerStart", String(ts));
}

function clearTimerStartTime() {
    localStorage.removeItem("studyTimeTimerStart");
}

function updateTimerDisplay() {
    if (!studyStartTime) return;

    const stored = loadStudyTimeData();
    const elapsed = Math.max(0, Math.floor((Date.now() - studyStartTime) / 1000));
    studySecondsToday = (stored.seconds || 0) + elapsed;

    if (studyTimeTodayEl) {
        studyTimeTodayEl.textContent = formatTime(Math.max(0, studySecondsToday));
    }
}

async function saveStudySessionToFirestore(uid, elapsedSeconds) {
    if (!uid || elapsedSeconds <= 0) return;

    try {
        const sessionsRef = collection(db, "users", uid, "studySessions");
        const now = new Date();
        await addDoc(sessionsRef, {
            startTime: new Date(now.getTime() - elapsedSeconds * 1000),
            endTime: now,
            durationSeconds: elapsedSeconds,
            date: now.toLocaleDateString("en-CA")
        });

        // Accumulate total study time on user doc
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            const newStudyTime = (data.studyTime || 0) + elapsedSeconds;
            await updateDoc(userRef, { studyTime: newStudyTime });
            
            // Check for study-time achievements
            await checkAchievements(uid, { ...data, studyTime: newStudyTime });
        }
    } catch (err) {
        console.error("Couldn't save study session:", err);
    }
}

function initTimeTracker(uid) {
    const data = loadStudyTimeData();
    studySecondsToday = data.seconds || 0;

    if (studyTimeTodayEl) {
        studyTimeTodayEl.textContent = formatTime(Math.max(0, studySecondsToday));
    }

    updateWeeklyBars(data);
    animateWeeklyBars();

    const savedStartTime = getTimerStartTime();

    if (savedStartTime && !studyTimerInterval) {
        studyStartTime = savedStartTime;
        studyTimerInterval = setInterval(updateTimerDisplay, 1000);
        updateTimerDisplay();
        startTimerBtn.disabled = true;
        stopTimerBtn.disabled = false;
    }

        if (startTimerBtn) {
            startTimerBtn.addEventListener("click", () => {
                if (studyTimerInterval) return;

                const stored = loadStudyTimeData();
                studySecondsToday = stored.seconds || 0;
                studyStartTime = Date.now();
                setTimerStartTime(studyStartTime);

                if (studyTimeTodayEl) {
                    studyTimeTodayEl.textContent = "00:00:00";
                }

                studyTimerInterval = setInterval(updateTimerDisplay, 1000);

                startTimerBtn.disabled = true;
                stopTimerBtn.disabled = false;
            });
        }

    if (stopTimerBtn) {
        stopTimerBtn.addEventListener("click", async () => {
            if (!studyTimerInterval) return;

            clearInterval(studyTimerInterval);
            studyTimerInterval = null;

            const elapsed = Math.max(0, Math.floor((Date.now() - studyStartTime) / 1000));

            const stored = loadStudyTimeData();
            stored.seconds = (stored.seconds || 0) + elapsed;

            const today = new Date();
            const dayKey = getDayKey(today);
            stored.weekly[dayKey] = (stored.weekly[dayKey] || 0) + elapsed;

            saveStudyTimeData(stored);
            clearTimerStartTime();

            studySecondsToday = stored.seconds || 0;

            if (studyTimeTodayEl) {
                studyTimeTodayEl.textContent = formatTime(Math.max(0, studySecondsToday));
            }

            updateWeeklyBars(stored);
            animateWeeklyBars();

            startTimerBtn.disabled = false;
            studyStartTime = null;

            await saveStudySessionToFirestore(currentAuthUid, elapsed);
        });
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            if (studyTimerInterval && studyStartTime) {
                updateTimerDisplay();
            } else if (!studyTimerInterval) {
                const savedStartTime = getTimerStartTime();
                if (savedStartTime) {
                    studyStartTime = savedStartTime;
                    studyTimerInterval = setInterval(updateTimerDisplay, 1000);
                    updateTimerDisplay();
                    startTimerBtn.disabled = true;
                    stopTimerBtn.disabled = false;
                }
            }
        }
    });
}

function updateWeeklyBars(data) {
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekly = data.weekly || {};
    const maxVal = Math.max(...Object.values(weekly), 1);

    document.querySelectorAll(".week-bar").forEach((bar) => {
        const day = bar.dataset.day;
        const val = weekly[day] || 0;
        const pct = Math.round((val / maxVal) * 100);
        bar.style.setProperty("--pct", pct + "%");
    });
}

function renderAchievements(data) {
    const achievements = getAchievementStatus(data);

    const elMap = {
        "first_quiz": document.getElementById("achFirstQuiz"),
        "streak_7": document.getElementById("achStreak7"),
        "questions_100": document.getElementById("ach100Q"),
        "accuracy_90": document.getElementById("ach90Acc"),
        "perfect_score": document.getElementById("achPerfect"),
        "flashcard_master": document.getElementById("achFlashMaster"),
        "all_subjects": document.getElementById("achAllSubj"),
        "streak_30": document.getElementById("achStreak30"),
    };

    const cardMap = {
        "first_quiz": document.querySelector('[data-ach="first_quiz"]'),
        "streak_7": document.querySelector('[data-ach="streak_7"]'),
        "questions_100": document.querySelector('[data-ach="questions_100"]'),
        "accuracy_90": document.querySelector('[data-ach="accuracy_90"]'),
        "perfect_score": document.querySelector('[data-ach="perfect_score"]'),
        "flashcard_master": document.querySelector('[data-ach="flashcard_master"]'),
        "all_subjects": document.querySelector('[data-ach="all_subjects"]'),
        "streak_30": document.querySelector('[data-ach="streak_30"]'),
    };

    achievements.forEach(ach => {
        const el = elMap[ach.id];
        const card = cardMap[ach.id];
        if (el) {
            el.textContent = ach.unlocked ? "Unlocked" : "Locked";
            el.className = `achievement-mini-status ${ach.unlocked ? "unlocked" : "locked"}`;
        }
        if (card) {
            card.className = `achievement-mini-card ${ach.unlocked ? "unlocked" : "locked"}`;
        }
    });
}

// ===========================
// AUTH
// ===========================

onAuthStateChanged(auth, async (user) => {

    if (!user) {

        window.location.href = "login.html";
        return;

    }

    try {

        const userRef = doc(db, "users", user.uid);

        let snap = await getDoc(userRef);

        // Self-heal: if for any reason the profile doc doesn't exist yet
        // (e.g. a signup write that failed to complete), create it now
        // instead of leaving the whole dashboard stuck on "Loading...".
        if (!snap.exists()) {

            console.warn("No profile doc found for this user — creating one now.");

            await ensureUserProfile(user.uid, {
                fullname: user.displayName,
                email: user.email,
            });

            snap = await getDoc(userRef);

        }

        const data = await bumpDailyStreak(user.uid) || snap.data();

        const todayStr = new Date().toISOString().slice(0, 10);
        const weekStart = getMonday(todayStr);

        const needsMigration = !("xp" in data) || !("level" in data) || !("weeklyXP" in data) || !data.weeklyXPWeekStart || data.weeklyXPWeekStart !== weekStart;

        if (needsMigration) {
            const updates = {
                xp: data.xp || 0,
                level: data.level || 1,
                weeklyXP: data.weeklyXP || 0,
                weeklyXPWeekStart: weekStart,
                totalCorrect: data.totalCorrect || data.correctAnswers || 0,
                totalQuestions: data.totalQuestions || data.questionsAnswered || 0,
                dailyGoal: data.dailyGoal || 20,
                questionsToday: data.questionsToday || 0,
                questionsTodayDate: data.questionsTodayDate || todayStr,
                flashcardsToday: data.flashcardsToday || 0,
                flashcardsTodayDate: data.flashcardsTodayDate || todayStr,
                goalCompletedDates: data.goalCompletedDates || [],
                badges: data.badges || [],
                lastActionTimestamps: data.lastActionTimestamps || {}
            };
            await updateDoc(userRef, updates);
        }

        // ======================================
        // LOAD SUBJECT PROGRESS
        // ======================================

            const flashProgressRef = doc(
                db,
                "users",
                user.uid,
                "progress",
                "flashcards"
            );

            const flashSnap = await getDoc(flashProgressRef);

            const flashProgress =
                flashSnap.exists()
                    ? flashSnap.data().subjectProgress || {}
                    : {};

            const quizProgress =
                data.subjectProgress || {};

        // =====================
        // Greeting
        // =====================

        if (greeting) {

            greeting.textContent =
                `${getGreeting()}, ${data.fullname || "Future RN"}`;

        }

        if (welcomeMessage) {

            welcomeMessage.textContent =
                "Let's continue your PNLE journey today.";

        }

        // =====================
        // Dashboard Stats
        // =====================

        if (questionsAnswered) void animateNumber(questionsAnswered, data.questionsAnswered || 0);

        if (accuracy) void animateNumber(accuracy, data.accuracy || 0);

        if (streak) void animateNumber(streak, data.streak || 0);

        const streakSuffix = document.getElementById("streakSuffix");
        if (streakSuffix) streakSuffix.textContent = (data.streak || 0) === 1 ? "day" : "days";

        if (sidebarStreak) {

            sidebarStreak.textContent = plural(data.streak || 0, "day");

        }

        if (bestStreak) {

            bestStreak.textContent =
                `Best streak: ${plural(data.longestStreak, "day")}`;

        }

        // ======================================
        // SUBJECT PROGRESS CARDS
        // (also collects the numbers renderStrongestWeakest needs)
        // ======================================

        const subjectStats = [];

        document.querySelectorAll(".subject-card").forEach((card) => {

            const titleEl = card.querySelector("h4");
            if (!titleEl) return;

            const title = titleEl.textContent.trim();

            const map = {

                "Comprehensive PNLE SETS": "pnleSets",
                "Foundation of Nursing": "fundamentals",
                "Maternal & Child Nursing": "maternal",
                "Community Health Nursing": "community",
                "Medical-Surgical Nursing": "medSurg",
                "Psychiatric Nursing": "psychiatric",
                "All Topics": "allTopics"

            };

            const key = map[title];

            const quizAccuracy =
                quizProgress[key]?.accuracy ?? 0;

            const flashAccuracy =
                flashProgress[key]?.progress ?? 0;

            let finalProgress = 0;

            if (quizAccuracy > 0 && flashAccuracy > 0) {

                finalProgress =
                    Math.round((quizAccuracy + flashAccuracy) / 2);

            }

            else if (quizAccuracy > 0) {

                finalProgress = quizAccuracy;

            }

            else {

                finalProgress = flashAccuracy;

            }

            finalProgress = Math.min(finalProgress, 100);

            const pct =
                card.querySelector("span[id$='Pct']");

            const bar =
                card.querySelector(".subject-progress span");

            if (pct)
                pct.textContent =
                    finalProgress + "%";

            if (bar) void animateScaleProgress(bar, finalProgress).catch(() => undefined);

            subjectStats.push({ title, key, value: finalProgress });

        });

        renderStrongestWeakest(subjectStats);

        // =====================
        // Daily Goal
        // =====================

        const dailyGoal = data.dailyGoal || DEFAULT_DAILY_GOAL;

        // First time we see this user, persist the default so it's a real
        // stored value from here on, not just an in-memory fallback.
        if (!data.dailyGoal) {
            updateDoc(userRef, { dailyGoal: DEFAULT_DAILY_GOAL })
                .catch((err) => console.error("Couldn't seed default daily goal:", err));
        }

        let questionsToday = data.questionsToday || 0;

        // Roll it over to 0 for a new day, and persist the rollover.
        if (data.questionsTodayDate !== todayStr) {

            questionsToday = 0;

            updateDoc(userRef, {
                questionsToday: 0,
                questionsTodayDate: todayStr
            }).catch((err) => console.error("Couldn't reset today's question count:", err));

        }

        renderGoal(questionsToday, dailyGoal);
        wireGoalEditing(userRef, dailyGoal, questionsToday);
        wireGoalMilestone(userRef, dailyGoal);

        // React to Settings changes without a manual reload:
        //  - "storage" fires when another tab/window updates the same
        //    localStorage key (and across same-tab via custom dispatch).
        //  - "pageshow"/"visibilitychange" re-read when Dashboard becomes
        //    visible again after navigating to Settings and back.
        const onSettingsChanged = () => {
            refreshDailyGoalFromSettings(userRef, questionsToday);
        };
        window.addEventListener("storage", (e) => {
            if (!e.key || e.key === "nurseprep:settings") onSettingsChanged();
        });
        window.addEventListener("pageshow", onSettingsChanged);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) onSettingsChanged();
        });

        if (goalMilestoneDate !== todayStr) {
            goalMilestoneShown = false;
            goalMilestoneDate = todayStr;
        }

        if (questionsToday >= dailyGoal && !goalMilestoneShown) {
            showGoalMilestone(userRef);
        }

        // =====================
        // Continue where you left off
        // =====================

        renderContinueCard(data.lastActivity);

        // =====================
        // Recent activity
        // =====================

        await renderRecentActivity(user.uid);

        // =====================
        // Achievements
        // =====================

        renderAchievements(data);

        initPNLECountdown();
        currentAuthUid = user.uid;
        initTimeTracker(user.uid);

    }

    catch (err) {

        console.error("Dashboard failed to load:", err);

        if (greeting) greeting.textContent = "Something went wrong";
        if (welcomeMessage) welcomeMessage.textContent = "Please refresh the page, or check the console for details.";

    }

});

// ===========================
// LOGOUT
// ===========================

if (logoutBtn) {

    logoutBtn.addEventListener("click", async () => {

        await signOut(auth);

        window.location.href = "login.html";

    });

}
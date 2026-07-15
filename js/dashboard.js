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
    limit
} from "firebase/firestore";

import { ensureUserProfile, bumpDailyStreak } from "./userProfile.js";

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

const continueLabel = document.getElementById("continueLabel");
const continueDetail = document.getElementById("continueDetail");
const continueLink = document.getElementById("continueLink");

const strongestName = document.getElementById("strongestSubjectName");
const strongestValue = document.getElementById("strongestSubjectValue");
const weakestName = document.getElementById("weakestSubjectName");
const weakestValue = document.getElementById("weakestSubjectValue");

const activityList = document.getElementById("activityList");

// ===========================
// GREETING
// ===========================

function getGreeting() {

    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";

    if (hour < 18) return "Good afternoon";

    return "Good evening";

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

    goalFill.style.width = percent + "%";
    goalText.textContent = `${answeredToday}/${dailyGoal} questions today`;

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
        if (strongestValue) strongestValue.textContent = "";
        if (weakestValue) weakestValue.textContent = "";
        return;

    }

    const sorted = [...attempted].sort((a, b) => b.value - a.value);

    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];

    strongestName.textContent = strongest.title;
    if (strongestValue) strongestValue.textContent = strongest.value + "%";

    weakestName.textContent = weakest.title;
    if (weakestValue) weakestValue.textContent = weakest.value + "%";

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

        if (questionsAnswered) {

            questionsAnswered.textContent =
                data.questionsAnswered || 0;

        }

        if (accuracy) {

            accuracy.textContent =
                data.accuracy || 0;

        }

        if (streak) {

            streak.textContent =
                data.streak || 0;

        }

        if (sidebarStreak) {

            sidebarStreak.textContent = `${data.streak || 0} days`;

        }

        if (bestStreak) {

            bestStreak.textContent =
                `Best streak: ${data.longestStreak || 0} days`;

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

                "Fundamentals": "fundamentals",
                "Medical Surgical": "medSurg",
                "OB": "maternal",
                "Pediatrics": "pediatric",
                "Psychiatric": "psychiatric",
                "Community Health": "community",
                "Pharmacology": "pharma",
                "Leadership": "leadership"

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

            if (bar)
                bar.style.width =
                    finalProgress + "%";

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

        const todayStr = new Date().toISOString().slice(0, 10);

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

        // =====================
        // Continue where you left off
        // =====================

        renderContinueCard(data.lastActivity);

        // =====================
        // Recent activity
        // =====================

        await renderRecentActivity(user.uid);

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
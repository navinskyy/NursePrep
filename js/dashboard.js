import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "firebase/auth";

import {
    doc,
    getDoc,
    collection,
    getDocs
} from "firebase/firestore";

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
// AUTH
// ===========================

onAuthStateChanged(auth, async (user) => {

    if (!user) {

        window.location.href = "login.html";
        return;

    }

    try {

        const userRef = doc(db, "users", user.uid);

        const snap = await getDoc(userRef);

        if (!snap.exists()) return;

        const data = snap.data();

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
                `${getGreeting()}, ${data.fullname}`;

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
        // ======================================

        document.querySelectorAll(".subject-card").forEach((card) => {

            const title =
                card.querySelector("h4").textContent;

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
        });

        // =====================
        // Daily Goal
        // =====================

        if (goalFill && goalText) {

            const answered = data.questionsAnswered || 0;

            const target = 100;

            const percent =
                Math.min((answered / target) * 100, 100);

            goalFill.style.width = percent + "%";

            goalText.textContent =
                `${answered}/${target} Questions`;

        }

    }

    catch (err) {

        console.error(err);

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
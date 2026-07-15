
import {
    auth,
    db
} from "../firebase/firebase.js";

import {
    doc,
    getDoc
} from "firebase/firestore";

const ICONS = {

    fundamentals: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
    `,

    medSurg: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M2 12H7L9.5 4L14.5 20L17 12H22"
                stroke-linecap="round"
                stroke-linejoin="round"/>
        </svg>
    `,

    maternal: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <circle cx="12" cy="6" r="3"/>

            <path
                d="M8 21C8 15 9.5 12 12 12C14.5 12 16 15 16 21"
                stroke-linecap="round"/>

        </svg>
    `,

    pediatric: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <circle cx="12" cy="8" r="3"/>

            <path
                d="M6 20C6 16.5 8.5 15 12 15C15.5 15 18 16.5 18 20"/>

        </svg>
    `,

    psychiatric: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <circle cx="12" cy="12" r="8"/>

            <path
                d="M12 8V12L15 14"
                stroke-linecap="round"/>

        </svg>
    `,

    community: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <circle cx="12" cy="12" r="9"/>

            <path d="M3 12H21"/>

            <path
                d="M12 3C14.5 6 14.5 18 12 21C9.5 18 9.5 6 12 3Z"/>

        </svg>
    `,

    pharma: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <rect x="4" y="5" width="12" height="16" rx="2"/>

            <rect x="8" y="3" width="12" height="16" rx="2"/>

        </svg>
    `,

    leadership: `
        <svg width="20" height="20" viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8">

            <circle cx="9" cy="8" r="3"/>

            <path
                d="M3 20C3 16.5 5.5 15 9 15C12.5 15 15 16.5 15 20"/>

            <path d="M16 15C19 15 21 16.5 21 19.5"/>

        </svg>
    `

};

const SUBJECT_NAMES = {

    fundamentals: "Fundamentals of Nursing",
    medSurg: "Medical-Surgical Nursing",
    maternal: "Maternal Nursing",
    pediatric: "Pediatric Nursing",
    psychiatric: "Psychiatric Nursing",
    community: "Community Health Nursing",
    pharma: "Pharmacology",
    leadership: "Leadership & Management"

};

const container = document.getElementById("subjectsGrid");

async function loadSubjects() {

    // Load quiz.json
    const response = await fetch("/data/quiz.json");

    if (!response.ok) {
        console.error("Failed to load quiz.json");
        return;
    }

    const quizData = await response.json();
    console.log("Quiz Data:", quizData);

    const user = auth.currentUser;

    if (!user) return;

    const snap = await getDoc(
        doc(db, "users", user.uid)
    );

    const data = snap.data() || {};
    if (sidebarStreak) {
    sidebarStreak.textContent = `${data.streak || 0} days`;
}
    const subjectProgress = data.subjectProgress || {};

    container.innerHTML = "";

    Object.keys(quizData).forEach((key) => {

        const stats = subjectProgress[key] || {
            answered: 0,
            correct: 0
        };

        const progress =
            stats.answered > 0
                ? Math.round((stats.correct / stats.answered) * 100)
                : 0;

        const questionCount = quizData[key].length;

        const notStarted = stats.answered === 0;

        const progressLabel = notStarted
            ? "Not started"
            : `${progress}%`;

        const card = document.createElement("div");

        card.className = "subject-card";

        card.innerHTML = `
            <div class="subject-top">
                <div class="subject-icon">
                    ${ICONS[key]}
                </div>

                <div class="subject-progress ${notStarted ? "not-started" : ""}">
                    ${progressLabel}
                </div>
            </div>

            <h3>${SUBJECT_NAMES[key]}</h3>

            <p>${questionCount} questions available</p>

            <div class="progress-track">
                <div class="progress-fill" style="width:${progress}%"></div>
            </div>

            <div class="subject-actions">
                <a href="quiz.html?subject=${key}" class="btn btn-primary">
                    Start Quiz
                </a>

                <a href="flashcards.html?subject=${key}" class="btn btn-secondary">
                    Flashcards
                </a>
            </div>
        `;

        container.appendChild(card);

    });

}

auth.onAuthStateChanged((user) => {

    if (user) {

        loadSubjects();

    }

});
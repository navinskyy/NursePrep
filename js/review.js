import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "firebase/auth";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    increment
} from "firebase/firestore";

import {
    saveWrongAnswers,
    getWrongAnswers,
    removeMistake,
    markMistakePracticed,
    getWrongAnswerCounts,
    getTotalWrongAnswerCount
} from "../services/wrongAnswerService.js";

import {
    recordActivity
} from "../js/activity.js";

import {
    bumpDailyStreak
} from "./userProfile.js";

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

const LETTERS = ["A", "B", "C", "D", "E", "F"];

let bank = {};
let mistakes = [];
let filteredMistakes = [];
let currentIdx = 0;
let currentSubject = "all";
let selectedAnswer = null;
let answered = false;

const reviewShell = document.getElementById("reviewShell");
const reviewContent = document.getElementById("reviewContent");
const subjectSelect = document.getElementById("subjectSelect");
const reviewCount = document.getElementById("reviewCount");
const reviewProgressFill = document.getElementById("reviewProgressFill");
const sidebarStreak = document.getElementById("sidebarStreak");

function getSubjectFromURL(defaultKey = "all") {
    const params = new URLSearchParams(window.location.search);
    return params.get("subject") || defaultKey;
}

async function loadBank() {
    try {
        const res = await fetch("./data/quiz.json");
        bank = await res.json();
    } catch (err) {
        console.error("Failed to load quiz data:", err);
        bank = {};
    }
}

function renderEmpty() {
    reviewContent.innerHTML = `
        <div class="review-empty">
            <div class="review-empty-icon">&#10003;</div>
            <h2>No mistakes yet</h2>
            <p>Complete a quiz and any wrong answers will appear here for review.</p>
            <a href="subjects.html" class="btn btn-primary">Take a Quiz</a>
        </div>
    `;
    reviewCount.textContent = "0 mistakes";
    reviewProgressFill.style.width = "0%";
}

function renderMistakeCard(mistake) {
    const q = {
        question: mistake.question,
        choices: mistake.choices,
        answer: mistake.answer
    };

    const total = filteredMistakes.length;
    const progress = total > 0 ? ((currentIdx + 1) / total) * 100 : 0;

    const practiceCount = mistake.practiceCount || 0;

    let choicesHTML = "";
    q.choices.forEach((text, i) => {
        let cls = "review-choice";
        if (answered) {
            if (i === q.answer) cls += " correct";
            else if (i === mistake.userAnswer && i !== q.answer) cls += " wrong";
        }
        if (selectedAnswer === i && !answered) cls += " selected";

        choicesHTML += `
            <div class="${cls}" data-idx="${i}" onclick="window._selectReviewAnswer(${i})">
                <span class="letter">${LETTERS[i]}</span>
                <span>${text}</span>
            </div>
        `;
    });

    const correctChoice = mistake.choices[mistake.answer];
    const wrongChoice = mistake.choices[mistake.userAnswer];
    const wrongLetter = LETTERS[mistake.userAnswer];
    const correctLetter = LETTERS[mistake.answer];

    const dynamicExplanation = `
        <div class="review-explanation-dynamic">
            <div class="explanation-why-wrong">
                <span class="feedback-label feedback-wrong">Why your answer is incorrect</span>
                <p class="feedback-choice">You selected: <strong>${wrongLetter}. ${wrongChoice}</strong></p>
                <p class="feedback-reason">This choice reflects a common misconception. In this scenario, the selected option fails to account for the priority nursing assessment or intervention required. Specifically, it overlooks critical patient safety considerations, misapplies the nursing process, or confuses similar clinical concepts. Choosing this could result in delayed treatment, improper documentation, or compromised patient outcomes.</p>
            </div>
            <div class="explanation-why-correct">
                <span class="feedback-label feedback-correct">Why the correct answer is right</span>
                <p class="feedback-choice">Correct answer: <strong>${correctLetter}. ${correctChoice}</strong></p>
                <p class="feedback-reason">${mistake.explanation || "This is the best answer based on standard nursing knowledge and clinical guidelines. It aligns with established protocols, prioritizes patient safety, and reflects evidence-based practice. This choice demonstrates the correct application of nursing principles to the given clinical situation."}</p>
            </div>
            <div class="explanation-takeaway">
                <span class="feedback-label feedback-tip">Key takeaway</span>
                <p>When facing similar questions, remember to prioritize patient safety, apply the nursing process systematically, and consider the most clinically significant finding first. Reviewing the correct rationale helps build the critical thinking skills needed for the PNLE and clinical practice.</p>
            </div>
        </div>
    `;

    const explanationHTML = answered
        ? `<div class="review-explanation show"><strong>Explanation:</strong> ${dynamicExplanation}</div>`
        : "";

    const actionsHTML = answered ? `
        <div class="review-actions">
            <button class="btn btn-secondary" id="reviewRemove" onclick="window._removeCurrentMistake()">
                Remove from list
            </button>
            <button class="btn btn-primary" id="reviewNext" onclick="window._goNextMistake()">
                ${currentIdx < total - 1 ? "Next" : "Finish"}
            </button>
        </div>
    ` : `
        <div class="review-actions">
            <div></div>
            <button class="btn btn-primary" id="reviewSubmit" onclick="window._submitReviewAnswer()">
                Submit Answer
            </button>
        </div>
    `;

    reviewContent.innerHTML = `
        <div class="review-card">
            <span class="review-q-label">
                ${SUBJECT_NAMES[mistake.subject] || mistake.subject}
                ${practiceCount > 0 ? `<span class="practice-badge">Practiced ${practiceCount}x</span>` : ""}
            </span>
            <div class="review-meta">
                <span>Question ${pad(currentIdx + 1)} of ${pad(total)}</span>
                <span>${Math.round(progress)}%</span>
            </div>
            <p class="review-question">${mistake.question}</p>
            <div class="review-choices" id="reviewChoices">
                ${choicesHTML}
            </div>
            ${explanationHTML}
            <p class="review-warning" id="reviewWarning">Please select an answer first.</p>
            ${actionsHTML}
        </div>
    `;

    reviewProgressFill.style.width = `${progress}%`;
}

function pad(n) {
    return String(n).padStart(2, "0");
}

window._selectReviewAnswer = function(idx) {
    if (answered) return;
    selectedAnswer = idx;
    const card = reviewContent.querySelector(".review-card");
    if (card) {
        card.querySelectorAll(".review-choice").forEach((el, i) => {
            el.classList.toggle("selected", i === idx);
        });
    }
};

window._submitReviewAnswer = async function() {
    if (selectedAnswer === null) {
        const warning = document.getElementById("reviewWarning");
        if (warning) warning.classList.add("show");
        return;
    }

    answered = true;
    const mistake = filteredMistakes[currentIdx];
    const isCorrect = selectedAnswer === mistake.answer;

    const card = reviewContent.querySelector(".review-card");
    if (card) {
        card.querySelectorAll(".review-choice").forEach((el, i) => {
            el.classList.remove("selected");
            el.style.cursor = "default";
            if (i === mistake.answer) el.classList.add("correct");
            else if (i === selectedAnswer && !isCorrect) el.classList.add("wrong");
        });

        const warning = document.getElementById("reviewWarning");
        if (warning) warning.classList.remove("show");
    }

    await markMistakePracticed(mistake.subject, mistake.idx);

    const user = auth.currentUser;
    if (user && isCorrect) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
            correctAnswers: increment(1),
            questionsAnswered: increment(1)
        }).catch(() => {});
    }

    renderMistakeCard(mistake);
};

window._goNextMistake = function() {
    if (currentIdx < filteredMistakes.length - 1) {
        currentIdx++;
        selectedAnswer = null;
        answered = false;
        renderMistakeCard(filteredMistakes[currentIdx]);
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
        showCompletion();
    }
};

window._removeCurrentMistake = async function() {
    const mistake = filteredMistakes[currentIdx];
    await removeMistake(mistake.subject, mistake.idx);
    filteredMistakes.splice(currentIdx, 1);
    mistakes = [...filteredMistakes];

    if (filteredMistakes.length === 0) {
        showCompletion();
    } else {
        if (currentIdx >= filteredMistakes.length) currentIdx = 0;
        selectedAnswer = null;
        answered = false;
        renderMistakeCard(filteredMistakes[currentIdx]);
        updateCounts();
    }
};

function showCompletion() {
    reviewContent.innerHTML = `
        <div class="review-complete">
            <span class="eyebrow">Session Complete</span>
            <h2>Great review!</h2>
            <p>Keep practicing and these mistakes will turn into strengths.</p>
            <div class="quiz-footer" style="justify-content:center;">
                <a href="dashboard.html" class="btn btn-primary">Back to Dashboard</a>
            </div>
        </div>
    `;
    reviewCount.textContent = "0 mistakes";
    reviewProgressFill.style.width = "0%";
}

async function loadMistakes() {
    let allMistakes = [];

    if (currentSubject === "all") {
        const all = await getAllWrongAnswers();
        for (const [subject, subjectMistakes] of Object.entries(all)) {
            subjectMistakes.forEach(m => {
                allMistakes.push({ ...m, subject });
            });
        }
    } else {
        console.log("[review] loading mistakes for subject:", currentSubject);
        const subjectMistakes = await getWrongAnswers(currentSubject);
        console.log("[review] got", subjectMistakes.length, "mistakes");
        allMistakes = subjectMistakes.map(m => ({ ...m, subject: currentSubject }));
    }

    mistakes = allMistakes;
    filteredMistakes = [...mistakes];
    currentIdx = 0;
    selectedAnswer = null;
    answered = false;

    updateCounts();

    if (filteredMistakes.length === 0) {
        renderEmpty();
    } else {
        renderMistakeCard(filteredMistakes[currentIdx]);
    }
}

async function updateCounts() {
    const subjectCount = mistakes.length;

    reviewCount.textContent = `${subjectCount} mistake${subjectCount !== 1 ? "s" : ""}`;

    const badge = document.getElementById("reviewBadge");
    if (badge) {
        badge.textContent = subjectCount;
        badge.style.display = subjectCount > 0 ? "inline-flex" : "none";
    }

    if (subjectCount === 0) {
        renderEmpty();
    }
}

subjectSelect.addEventListener("change", async (e) => {
    currentSubject = e.target.value;
    await loadMistakes();
});

document.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "SELECT") return;
    if (e.key === "ArrowRight" && !answered) {
        e.preventDefault();
        if (selectedAnswer === null) {
            window._selectReviewAnswer(0);
        } else {
            window._submitReviewAnswer();
        }
    } else if (e.key === "ArrowRight" && answered) {
        e.preventDefault();
        window._goNextMistake();
    }
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    await loadBank();
    currentSubject = getSubjectFromURL("all");
    subjectSelect.value = currentSubject;
    await loadMistakes();
});

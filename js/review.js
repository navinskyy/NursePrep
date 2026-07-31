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
    getAllWrongAnswers,
    removeMistake,
    markMistakePracticed,
    getWrongAnswerCounts,
    getTotalWrongAnswerCount,
    clearAllMistakes
} from "../services/wrongAnswerService.js";

import {
    recordActivity
} from "../js/activity.js";

import {
    bumpDailyStreak
} from "./userProfile.js";

// Inlined here (not relying on utils.js's classic-script globals inside this module)
const SUBJECT_NAMES = {
    pnleSets: "Comprehensive PNLE SETS",
    fundamentals: "Foundation of Nursing",
    maternal: "Maternal & Child Nursing",
    community: "Community Health Nursing",
    medSurg: "Medical-Surgical Nursing",
    psychiatric: "Psychiatric Nursing",
    allTopics: "All Topics"
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

let bank = {};
let mistakes = [];
let filteredMistakes = [];
let currentIdx = 0;
let currentSubject = "all";
let selectedAnswer = null;
let answered = false;
let catalog = null;

const reviewShell = document.getElementById("reviewShell");
const reviewContent = document.getElementById("reviewContent");
const subjectSelect = document.getElementById("subjectSelect");
const reviewCount = document.getElementById("reviewCount");
const reviewProgressFill = document.getElementById("reviewProgressFill");
const sidebarStreak = document.getElementById("sidebarStreak");

function getQuizTitle(quizId) {
    if (!catalog) return SUBJECT_NAMES[quizId] || quizId;
    const quiz = catalog.categories.flatMap(c => c.quizzes || []).find(q => q.quizId === quizId || q.subjectKey === quizId);
    return quiz ? quiz.title : (SUBJECT_NAMES[quizId] || quizId);
}

function getSubjectFromURL(defaultKey = "all") {
    const params = new URLSearchParams(window.location.search);
    return params.get("subject") || defaultKey;
}

function resolveSubjectKey(rawKey) {
    const legacy = {
        "fundamentals": "foundation-nursing-process-assessment",
        "maternal": "maternal-maternalHealth",
        "pediatric": "maternal-pediatric",
        "psychiatric": "psychiatric-1",
        "medSurg": "medSurg-1",
        "community": "community-1",
        "pharma": "pharma-1",
        "leadership": "leadership-1"
    };
    return legacy[rawKey] || rawKey;
}

// Returns every storage key a quiz's mistakes could have been saved under.
// Quizzes can be launched by quizId (quiz.html?quizId=) or by subject
// (quiz.html?subject=), and the catalog recently added a distinct subjectKey
// field, so the same quiz may have been persisted under any of these aliases.
function getEquivalentKeys(rawKey) {
    const keys = new Set();
    if (!rawKey) return keys;

    keys.add(rawKey);
    keys.add(resolveSubjectKey(rawKey));

    if (catalog && Array.isArray(catalog.categories)) {
        const quizzes = catalog.categories.flatMap(c => c.quizzes || []);
        for (const candidate of keys.size ? Array.from(keys) : []) {
            const quiz = quizzes.find(
                q => q.quizId === candidate || q.subjectKey === candidate
            );
            if (quiz) {
                if (quiz.quizId) keys.add(quiz.quizId);
                if (quiz.subjectKey) keys.add(quiz.subjectKey);
            }
        }
    }

    return keys;
}

// Maps any alias (quizId, subjectKey, legacy name) to the catalog quizId that
// the subject <select> uses as its option value.
function catalogQuizIdFor(rawKey) {
    if (!catalog || !Array.isArray(catalog.categories)) return null;
    const resolved = resolveSubjectKey(rawKey);
    const quiz = catalog.categories
        .flatMap(c => c.quizzes || [])
        .find(q =>
            q.quizId === rawKey ||
            q.subjectKey === rawKey ||
            q.quizId === resolved ||
            q.subjectKey === resolved
        );
    return quiz ? quiz.quizId : null;
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
                ${getQuizTitle(mistake.subject)}
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

async function loadCatalog() {
    try {
        const res = await fetch("./data/quiz-catalog.json");
        catalog = await res.json();
    } catch (err) {
        console.error("Failed to load quiz catalog:", err);
        catalog = { categories: [] };
    }
    return catalog;
}

function populateSubjectSelect() {
    if (!catalog) return;
    subjectSelect.innerHTML = '<option value="all">All Subjects</option>';

    for (const category of catalog.categories) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = `${category.icon} ${category.name}`;

        for (const quiz of category.quizzes) {
            const option = document.createElement("option");
            option.value = quiz.quizId;
            option.textContent = quiz.title;
            optgroup.appendChild(option);
        }

        subjectSelect.appendChild(optgroup);
    }
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

    try {
        await markMistakePracticed(mistake.subject, mistake.idx);

        const user = auth.currentUser;
        if (user && isCorrect) {
            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, {
                correctAnswers: increment(1),
                questionsAnswered: increment(1)
            }).catch(() => {});
        }
    } catch (err) {
        console.error("[review] Failed to update practice record:", err);
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

async function showCompletion() {
    await clearAllMistakes();
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
        // A quiz's mistakes may be stored under any of its aliases (quizId,
        // subjectKey, or a legacy subject name). Look up all of them and merge.
        const keys = Array.from(getEquivalentKeys(currentSubject));
        console.log("[review] loading mistakes for subject:", currentSubject, "keys:", keys);

        const seen = new Set();
        for (const key of keys) {
            const subjectMistakes = await getWrongAnswers(key);
            subjectMistakes.forEach(m => {
                // Dedupe in case the same question was persisted under two keys.
                const dedupeId = `${m.question}::${m.idx}`;
                if (seen.has(dedupeId)) return;
                seen.add(dedupeId);
                // Keep the real storage key so practice/remove target the
                // correct field in the Firestore document.
                allMistakes.push({ ...m, subject: key });
            });
        }
        console.log("[review] got", allMistakes.length, "mistakes across", keys.length, "keys");
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

    await loadCatalog();
    populateSubjectSelect();

    await loadBank();
    let subjectParam = getSubjectFromURL("all");
    let resolvedSubject = subjectParam === "all" ? "all" : resolveSubjectKey(subjectParam);
    
    if (resolvedSubject !== subjectParam) {
        const url = new URL(window.location);
        url.searchParams.set("subject", resolvedSubject);
        window.history.replaceState(null, "", url);
    }

    currentSubject = resolvedSubject;
    // The dropdown option values are quizIds; map whatever alias arrived in the
    // URL to the matching quizId so the correct option is selected.
    subjectSelect.value = catalogQuizIdFor(currentSubject) || currentSubject;
    await loadMistakes();
});

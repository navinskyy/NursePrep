import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "firebase/auth";

import {
    doc,
    getDoc,
    updateDoc,
    increment
} from "firebase/firestore";

import {
    saveWrongAnswers,
    getWrongAnswers,
    getAllWrongAnswers,
    removeMistake,
    markMistakePracticed,
    clearAllMistakes
} from "../services/wrongAnswerService.js";

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

// ======================================
// AUDIO — reuse quiz's Web Audio API tone
// infrastructure so sound stays consistent.
// ======================================

let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    audioUnlocked = audioCtx.state === "running";
    return audioCtx;
}

function playTone(freq, duration, volume, type = "sine") {
    const ctx = ensureAudio();
    if (!audioUnlocked) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
}

function playCorrectAnswerSound() {
    if (!audioUnlocked) return;
    playTone(660, 0.12, 0.22, "sine");
    setTimeout(() => playTone(880, 0.14, 0.22, "sine"), 80);
}

function playIncorrectAnswerSound() {
    if (!audioUnlocked) return;
    playTone(220, 0.14, 0.22, "square");
    setTimeout(() => playTone(180, 0.18, 0.18, "square"), 90);
}

function playClickSound() {
    if (!audioUnlocked) return;
    playTone(520, 0.04, 0.1, "sine");
}

document.addEventListener("click", () => ensureAudio(), { once: true });
document.addEventListener("keydown", () => ensureAudio(), { once: true });

// ======================================
// CATALOG + SUBJECT HELPERS
// ======================================

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

function getEquivalentKeys(rawKey) {
    const keys = new Set();
    if (!rawKey) return keys;
    keys.add(rawKey);
    keys.add(resolveSubjectKey(rawKey));
    if (catalog && Array.isArray(catalog.categories)) {
        const quizzes = catalog.categories.flatMap(c => c.quizzes || []);
        for (const candidate of Array.from(keys)) {
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

function pad(n) {
    return String(n).padStart(2, "0");
}

// ======================================
// LOADING / EMPTY / ERROR STATES
// ======================================

function renderLoading() {
    reviewContent.innerHTML = `
        <div class="review-card review-state" aria-busy="true" aria-live="polite">
            <span class="eyebrow">Loading</span>
            <div class="review-loading-row">
                <div class="review-skeleton-bar"></div>
                <div class="review-skeleton-bar short"></div>
            </div>
            <div class="review-loading-skeletons">
                <div class="review-skeleton-choice"></div>
                <div class="review-skeleton-choice"></div>
                <div class="review-skeleton-choice"></div>
                <div class="review-skeleton-choice"></div>
            </div>
            <p class="review-state-hint">Fetching the questions you got wrong…</p>
        </div>
    `;
    reviewCount.textContent = "— mistakes";
    reviewProgressFill.style.width = "0%";
}

function renderEmpty() {
    reviewContent.innerHTML = `
        <div class="review-card review-state review-empty-state">
            <div class="review-empty-icon" aria-hidden="true">&#10003;</div>
            <span class="eyebrow">Practice Mistakes</span>
            <h2>You're all caught up</h2>
            <p>No mistakes to review right now. Questions you answer incorrectly during quizzes will appear here so you can revisit the reasoning and lock it in.</p>
            <div class="review-empty-actions">
                <a href="subjects.html" class="btn btn-primary">Start a Quiz</a>
                <a href="dashboard.html" class="btn btn-secondary">Back to Dashboard</a>
            </div>
        </div>
    `;
    reviewCount.textContent = "0 mistakes";
    reviewProgressFill.style.width = "0%";
}

function renderError() {
    reviewContent.innerHTML = `
        <div class="review-card review-state review-error-state">
            <div class="review-error-icon" aria-hidden="true">!</div>
            <span class="eyebrow">Practice Mistakes</span>
            <h2>Couldn't load your mistakes</h2>
            <p>Something went wrong while loading your saved mistakes. Check your connection and try again.</p>
            <div class="review-empty-actions">
                <button class="btn btn-primary" id="reviewRetry">Try Again</button>
                <a href="dashboard.html" class="btn btn-secondary">Back to Dashboard</a>
            </div>
        </div>
    `;
    reviewCount.textContent = "— mistakes";
    reviewProgressFill.style.width = "0%";

    const retry = document.getElementById("reviewRetry");
    if (retry) retry.addEventListener("click", () => loadMistakes());
}

// ======================================
// MAIN MISTAKE CARD RENDER
// ======================================

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function buildFeedbackPanel(mistake) {
    const correctIdx = mistake.answer;
    const userIdx = mistake.userAnswer;
    const correctLetter = LETTERS[correctIdx];
    const userLetter = LETTERS[userIdx];
    const correctText = mistake.choices[correctIdx];
    const userText = mistake.choices[userIdx];

    const rationale = mistake.explanation ||
        "This is the best answer based on standard nursing knowledge and clinical guidelines. It aligns with established protocols, prioritizes patient safety, and reflects evidence-based practice.";

    return `
        <div class="review-feedback" role="status" aria-live="polite" aria-atomic="true">
            <div class="review-feedback-row review-feedback-user">
                <span class="review-feedback-label">Your answer</span>
                <p class="review-feedback-choice">
                    <span class="review-feedback-letter">${escapeHtml(userLetter)}</span>
                    <span class="review-feedback-text">${escapeHtml(userText)}</span>
                </p>
            </div>
            <div class="review-feedback-row review-feedback-correct">
                <span class="review-feedback-label review-feedback-label-correct">Correct answer</span>
                <p class="review-feedback-choice">
                    <span class="review-feedback-letter review-feedback-letter-correct">${escapeHtml(correctLetter)}</span>
                    <span class="review-feedback-text">${escapeHtml(correctText)}</span>
                </p>
            </div>
            <div class="review-feedback-row review-feedback-rationale">
                <span class="review-feedback-label review-feedback-label-rationale">Rationale</span>
                <p class="review-feedback-reason">${escapeHtml(rationale)}</p>
            </div>
        </div>
    `;
}

function renderMistakeCard(mistake) {
    const total = filteredMistakes.length;
    const totalCount = mistakes.length;
    const progress = total > 0 ? ((currentIdx + 1) / total) * 100 : 0;
    const practiceCount = mistake.practiceCount || 0;

    const quizTitle = getQuizTitle(mistake.subject);

    // Build choice buttons. We use real <button> elements for full keyboard
    // accessibility and a clear interactive hit target.
    let choicesHTML = "";
    mistake.choices.forEach((text, i) => {
        let stateClass = "";
        let stateTag = "";

        if (answered) {
            if (i === mistake.answer) {
                stateClass = "is-correct";
                stateTag = `<span class="review-choice-tag" aria-hidden="true">Correct answer</span>`;
            } else if (i === mistake.userAnswer) {
                stateClass = "is-user-pick";
                stateTag = `<span class="review-choice-tag" aria-hidden="true">Your answer</span>`;
            } else {
                stateClass = "is-dimmed";
            }
        } else if (selectedAnswer === i) {
            stateClass = "is-selected";
        }

        const pressedAttr = answered
            ? (i === mistake.answer ? "true" : "false")
            : (selectedAnswer === i ? "true" : "false");
        const disabledAttr = answered ? "disabled" : "";

        choicesHTML += `
            <button type="button"
                    class="review-choice ${stateClass}"
                    data-idx="${i}"
                    role="radio"
                    aria-checked="${pressedAttr}"
                    aria-label="Option ${LETTERS[i]}: ${escapeHtml(text)}"
                    ${disabledAttr}>
                <span class="review-choice-letter" aria-hidden="true">${LETTERS[i]}</span>
                <span class="review-choice-text">${escapeHtml(text)}</span>
                ${stateTag}
            </button>
        `;
    });

    const feedbackHTML = answered ? buildFeedbackPanel(mistake) : "";

    const isLast = currentIdx >= total - 1;
    const remaining = Math.max(0, total - currentIdx - 1);
    const primaryLabel = answered
        ? (isLast ? (remaining === 0 && totalCount > 0 ? "Finish Review" : "Next") : "Next Question")
        : "Select an answer";

    reviewContent.innerHTML = `
        <article class="review-card" aria-labelledby="reviewQuestion">
            <header class="review-card-header">
                <div class="review-card-meta">
                    <span class="eyebrow review-card-eyebrow">Review Mistakes</span>
                    <h1 class="review-card-title" id="reviewQuestion">${escapeHtml(quizTitle)}</h1>
                </div>
                <div class="review-card-progress" aria-label="Progress through review">
                    <span class="review-progress-count">Question ${pad(currentIdx + 1)} of ${pad(total)}</span>
                    <span class="review-progress-percent">${Math.round(progress)}%</span>
                </div>
            </header>

            <div class="review-card-tags">
                <span class="review-tag review-tag-subject">${escapeHtml(quizTitle)}</span>
                ${practiceCount > 0 ? `<span class="review-tag review-tag-practice">Practiced ${practiceCount}x</span>` : ""}
            </div>

            <p class="review-question">${escapeHtml(mistake.question)}</p>

            <div class="review-choices" id="reviewChoices" role="radiogroup" aria-label="Answer choices">
                ${choicesHTML}
            </div>

            <div class="review-feedback-wrap">
                ${feedbackHTML}
            </div>

            <p class="review-warning" id="reviewWarning" role="alert">Please select an answer first.</p>

            <div class="review-actions">
                <button type="button" class="btn btn-secondary" id="reviewPrevBtn" ${currentIdx === 0 || !answered ? "disabled" : ""}>
                    Previous
                </button>
                <div class="review-actions-right">
                    ${answered ? `
                        <button type="button" class="btn btn-secondary review-remove-btn" id="reviewRemoveBtn">
                            Remove from list
                        </button>
                        <button type="button" class="btn btn-primary" id="reviewNextBtn" disabled>
                            ${escapeHtml(primaryLabel)}
                        </button>
                    ` : `
                        <span class="review-helper-text">Choose an answer to see feedback</span>
                    `}
                </div>
            </div>
        </article>
    `;

    reviewProgressFill.style.width = `${progress}%`;
    reviewCount.textContent = `${total} mistake${total !== 1 ? "s" : ""}`;

    bindCardEvents();
}

// ======================================
// EVENT WIRING (event delegation on the
// always-present reviewContent container
// so re-renders never lose listeners)
// ======================================

function bindCardEvents() {
    const choicesContainer = document.getElementById("reviewChoices");
    if (choicesContainer && !choicesContainer.dataset.wired) {
        choicesContainer.dataset.wired = "true";
        choicesContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".review-choice");
            if (!btn) return;
            const idx = Number(btn.dataset.idx);
            if (Number.isFinite(idx)) selectAnswer(idx);
        });
    }

    const nextBtn = document.getElementById("reviewNextBtn");
    if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.addEventListener("click", goNextMistake);
    }

    const removeBtn = document.getElementById("reviewRemoveBtn");
    if (removeBtn) {
        removeBtn.addEventListener("click", removeCurrentMistake);
    }

    const prevBtn = document.getElementById("reviewPrevBtn");
    if (prevBtn) {
        prevBtn.addEventListener("click", goPrevMistake);
    }
}

// ======================================
// ANSWER INTERACTION
// ======================================

async function selectAnswer(idx) {
    if (answered) return;
    selectedAnswer = idx;
    playClickSound();

    // Lightweight pre-submit visual: just mark the picked choice as selected.
    const card = reviewContent.querySelector(".review-card");
    if (!card) return;
    card.querySelectorAll(".review-choice").forEach((el, i) => {
        el.classList.toggle("is-selected", i === idx);
        el.setAttribute("aria-checked", i === idx ? "true" : "false");
    });

    // Brief visual confirmation then evaluate on the next frame so the
    // user perceives the click as a deliberate selection.
    evaluateAnswer(idx);
}

async function evaluateAnswer(idx) {
    const mistake = filteredMistakes[currentIdx];
    const isCorrect = idx === mistake.answer;

    answered = true;
    selectedAnswer = idx;

    if (isCorrect) {
        playCorrectAnswerSound();
    } else {
        playIncorrectAnswerSound();
    }

    // Re-render the card so all post-answer visuals (correct highlight,
    // tags, feedback panel, Next button) are present in the DOM at once.
    renderMistakeCard(mistake);

    // Persist practice count and (on correct) tally stats. Failures here
    // shouldn't block the user's UI flow.
    try {
        await markMistakePracticed(mistake.subject, mistake.idx);
        // Update local practiceCount for immediate display.
        mistake.practiceCount = (mistake.practiceCount || 0) + 1;

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
}

// ======================================
// NAVIGATION
// ======================================

function goNextMistake() {
    if (!answered) return;
    if (currentIdx < filteredMistakes.length - 1) {
        currentIdx++;
        selectedAnswer = null;
        answered = false;
        renderMistakeCard(filteredMistakes[currentIdx]);
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
        showCompletion();
    }
}

function goPrevMistake() {
    if (currentIdx === 0) return;
    currentIdx--;
    selectedAnswer = null;
    answered = false;
    renderMistakeCard(filteredMistakes[currentIdx]);
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function removeCurrentMistake() {
    const mistake = filteredMistakes[currentIdx];
    try {
        await removeMistake(mistake.subject, mistake.idx);
    } catch (err) {
        console.error("[review] Failed to remove mistake:", err);
    }
    filteredMistakes.splice(currentIdx, 1);
    mistakes = [...filteredMistakes];

    if (filteredMistakes.length === 0) {
        renderEmpty();
        updateCounts();
        return;
    }
    if (currentIdx >= filteredMistakes.length) currentIdx = 0;
    selectedAnswer = null;
    answered = false;
    renderMistakeCard(filteredMistakes[currentIdx]);
    updateCounts();
}

async function showCompletion() {
    try {
        await clearAllMistakes();
    } catch (err) {
        console.warn("[review] Failed to clear mistakes:", err);
    }
    const total = mistakes.length;

    reviewContent.innerHTML = `
        <div class="review-card review-state review-complete-state">
            <div class="review-complete-icon" aria-hidden="true">&#10003;</div>
            <span class="eyebrow">Review Complete</span>
            <h2>Great review session</h2>
            <p>You reviewed ${total} mistake${total !== 1 ? "s" : ""}. Revisiting the rationale is the fastest way to lock in the reasoning.</p>
            <div class="review-empty-actions">
                <a href="subjects.html" class="btn btn-primary">Take a Quiz</a>
                <a href="dashboard.html" class="btn btn-secondary">Back to Dashboard</a>
            </div>
        </div>
    `;
    reviewCount.textContent = "0 mistakes";
    reviewProgressFill.style.width = "100%";
}

// ======================================
// CATALOG LOAD + DATA PIPELINE
// ======================================

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

async function loadMistakes() {
    renderLoading();

    let allMistakes = [];
    try {
        if (currentSubject === "all") {
            const all = await getAllWrongAnswers();
            for (const [subject, subjectMistakes] of Object.entries(all)) {
                subjectMistakes.forEach(m => {
                    allMistakes.push({ ...m, subject });
                });
            }
        } else {
            const keys = Array.from(getEquivalentKeys(currentSubject));
            const seen = new Set();
            for (const key of keys) {
                const subjectMistakes = await getWrongAnswers(key);
                subjectMistakes.forEach(m => {
                    const dedupeId = `${m.question}::${m.idx}`;
                    if (seen.has(dedupeId)) return;
                    seen.add(dedupeId);
                    allMistakes.push({ ...m, subject: key });
                });
            }
        }
    } catch (err) {
        console.error("[review] Failed to load mistakes:", err);
        renderError();
        return;
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
}

// ======================================
// GLOBAL EVENT BINDINGS
// ======================================

subjectSelect.addEventListener("change", async (e) => {
    currentSubject = e.target.value;
    await loadMistakes();
});

document.addEventListener("keydown", (e) => {
    if (document.activeElement && document.activeElement.tagName === "SELECT") return;
    if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!answered) {
            if (selectedAnswer === null) selectAnswer(0);
            else goNextMistake();
        } else {
            goNextMistake();
        }
    } else if (e.key === "ArrowLeft") {
        if (answered) goPrevMistake();
    } else if (/^[1-4]$/.test(e.key)) {
        if (!answered) {
            const idx = Number(e.key) - 1;
            if (filteredMistakes[currentIdx] && filteredMistakes[currentIdx].choices[idx]) {
                selectAnswer(idx);
            }
        }
    }
});

// ======================================
// AUTH + INIT
// ======================================

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
    subjectSelect.value = catalogQuizIdFor(currentSubject) || currentSubject;
    await loadMistakes();
});
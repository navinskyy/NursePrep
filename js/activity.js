import { db } from "../firebase/firebase.js";

import {
    doc,
    updateDoc,
    collection,
    addDoc,
    serverTimestamp,
    increment
} from "firebase/firestore";

/**
 * Call this once a quiz or flashcard session finishes scoring, from
 * quiz.js / flashcards.js. It's what makes "Continue where you left off"
 * and "Recent activity" on the dashboard real instead of hardcoded.
 *
 * Note: XP and streak are awarded by recordQuizResult / recordFlashcardSession
 * in userProfile.js, not here. This function only tracks the activity feed
 * and daily question/card counters.
 */
export async function recordActivity(uid, activity) {

    if (!uid || !activity) return;

    const todayStr = new Date().toISOString().slice(0, 10);

    const payload = {
        type: activity.type || "quiz",
        subject: activity.subject || "",
        subjectKey: activity.subjectKey || "",
        label: activity.label || activity.subject || "Study session",
        detail: activity.detail || "",
        score: activity.score ?? null,
        path: activity.path || "subjects.html",
        timestamp: serverTimestamp()
    };

    await addDoc(collection(db, "users", uid, "activity"), payload);

    const userRef = doc(db, "users", uid);

    await updateDoc(userRef, {
        lastActivity: payload,
        questionsToday: increment(activity.questionsCount || 0),
        questionsTodayDate: todayStr,
        flashcardsToday: increment(activity.flashcardsCount || 0),
        flashcardsTodayDate: todayStr
    });
}

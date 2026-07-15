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
 * Example, at the end of a quiz submit handler:
 *
 *   import { recordActivity } from "./activity.js";
 *
 *   await recordActivity(user.uid, {
 *     type: "quiz",                              // "quiz" | "flashcards"
 *     subject: "Fundamentals",                    // matches the h4 text on the dashboard subject cards
 *     subjectKey: "fundamentals",                 // matches the keys used in subjectProgress
 *     label: "Fundamentals quiz",                 // shown as the bold line in the activity feed
 *     detail: "Scored 82% on 20 questions",        // shown next to it
 *     score: 82,
 *     path: "quiz.html?subject=fundamentals",      // where "Continue →" should send them
 *     questionsCount: 20                           // how many questions this session added to today's goal
 *   });
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

    // 1. Add it to the activity feed (users/{uid}/activity)
    await addDoc(collection(db, "users", uid, "activity"), payload);

    // 2. Mirror it onto the user doc so "continue where you left off" can
    //    read it in a single get instead of a second query, and bump
    //    today's question count for the daily-goal bar.
    const userRef = doc(db, "users", uid);

    await updateDoc(userRef, {
        lastActivity: payload,
        questionsToday: increment(activity.questionsCount || 0),
        questionsTodayDate: todayStr
    });

}
import { auth, db } from "../firebase/firebase.js";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    arrayUnion,
    arrayRemove
} from "firebase/firestore";

function getWrongAnswersRef() {
    const user = auth.currentUser;
    if (!user) return null;
    return doc(db, "users", user.uid, "wrongAnswers", "master");
}

export async function saveWrongAnswers(subjectKey, mistakes) {
    const ref = getWrongAnswersRef();
    if (!ref) return;

    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};

    const existing = data[subjectKey]?.mistakes || [];
    const existingMap = new Map(existing.map(m => [m.idx, m]));

    mistakes.forEach(m => {
        const key = m.idx;
        if (!existingMap.has(key)) {
            existingMap.set(key, {
                ...m,
                savedAt: Date.now(),
                practiceCount: 0
            });
        }
    });

    const toSave = Array.from(existingMap.values());
    console.log("[wrongAnswerService] saving", toSave.length, "mistakes for", subjectKey, "path:", ref.path);

    await setDoc(ref, {
        [subjectKey]: {
            mistakes: toSave,
            lastUpdated: Date.now()
        }
    }, { merge: true });

    console.log("[wrongAnswerService] save complete for", subjectKey);
}

export async function getWrongAnswers(subjectKey) {
    const ref = getWrongAnswersRef();
    if (!ref) return [];

    const snap = await getDoc(ref);
    if (!snap.exists()) {
        console.log("[wrongAnswerService] doc does not exist");
        return [];
    }

    const data = snap.data();
    const result = data[subjectKey]?.mistakes || [];
    console.log("[wrongAnswerService] getWrongAnswers", subjectKey, "returned", result.length, "items. doc keys:", Object.keys(data));
    return result;
}

export async function getAllWrongAnswers() {
    const ref = getWrongAnswersRef();
    if (!ref) return {};

    const snap = await getDoc(ref);
    if (!snap.exists()) {
        console.log("[wrongAnswerService] getAll: doc does not exist");
        return {};
    }

    const data = snap.data();
    const result = {};
    for (const [subject, val] of Object.entries(data)) {
        if (subject !== "lastUpdated" && val.mistakes) {
            result[subject] = val.mistakes;
        }
    }
    console.log("[wrongAnswerService] getAllWrongAnswers returned", Object.keys(result).length, "subjects. doc keys:", Object.keys(data));
    return result;
}

export async function markMistakePracticed(subjectKey, questionIdx) {
    const ref = getWrongAnswersRef();
    if (!ref) return;

    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data();
    const mistakes = data[subjectKey]?.mistakes || [];
    const updated = mistakes.map(m => {
        if (m.idx === questionIdx) {
            return { ...m, practiceCount: (m.practiceCount || 0) + 1 };
        }
        return m;
    });

    await setDoc(ref, {
        [subjectKey]: { mistakes: updated }
    }, { merge: true });
}

export async function removeMistake(subjectKey, questionIdx) {
    const ref = getWrongAnswersRef();
    if (!ref) return;

    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data();
    const mistakes = (data[subjectKey]?.mistakes || []).filter(
        m => m.idx !== questionIdx
    );

    await setDoc(ref, {
        [subjectKey]: { mistakes }
    }, { merge: true });
}

export async function getWrongAnswerCounts() {
    const all = await getAllWrongAnswers();
    const counts = {};
    for (const [subject, mistakes] of Object.entries(all)) {
        counts[subject] = mistakes.length;
    }
    return counts;
}

export async function getTotalWrongAnswerCount() {
    const all = await getAllWrongAnswers();
    return Object.values(all).reduce((sum, mistakes) => sum + mistakes.length, 0);
}

import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";

import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

const sidebarStreak = document.getElementById("sidebarStreak");
const reviewBadge = document.getElementById("reviewBadge");

auth.onAuthStateChanged(async (user) => {
    if (!user || !sidebarStreak) return;

    const snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) return;

    const data = snap.data();

    sidebarStreak.textContent = `${data.streak || 0} days`;

    if (reviewBadge) {
        try {
            const total = await getTotalWrongAnswerCount();
            reviewBadge.textContent = total;
            reviewBadge.style.display = total > 0 ? "inline-flex" : "none";
        } catch (err) {
            console.error("Failed to load review badge count:", err);
        }
    }
});
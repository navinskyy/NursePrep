import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";

const sidebarStreak = document.getElementById("sidebarStreak");

auth.onAuthStateChanged(async (user) => {
    if (!user || !sidebarStreak) return;

    const snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) return;

    const data = snap.data();

    sidebarStreak.textContent = `${data.streak || 0} days`;
});
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged
} from "firebase/auth";

import {
    doc,
    getDoc,
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    where
} from "firebase/firestore";

import {
    calculateRankingScore,
    getLevelProgress,
    calculateLevel,
    LEVEL_THRESHOLDS,
    getMonday
} from "./userProfile.js";

const leaderboardList = document.getElementById("leaderboardList");
const tabs = document.querySelectorAll(".leaderboard-tabs .tab");
const sidebarStreak = document.getElementById("sidebarStreak");

let currentTab = "alltime";

const BADGE_RULES = [
    { id: "top1", label: "👑 #1", icon: "👑", description: "Top ranked this week", condition: (e) => e.rank === 1 },
    { id: "top3", label: "🥇 Top 3", icon: "🥇", description: "Top 3 this week", condition: (e) => e.rank <= 3 },
    { id: "streak7", label: "🔥 7-Day Streak", icon: "🔥", description: "7 consecutive days", condition: (e) => e.streak >= 7 },
    { id: "streak30", label: "👑 30-Day Streak", icon: "👑", description: "30 consecutive days", condition: (e) => e.streak >= 30 },
    { id: "highestAccuracy", label: "🎯 Sniper", icon: "🎯", description: "90%+ average accuracy", condition: (e) => e.averageScore >= 90 },
    { id: "level10", label: "⭐ Veteran", icon: "⭐", description: "Reached Level 10", condition: (e) => e.level >= 10 },
    { id: "marathon", label: "🏃 Marathon", icon: "🏃", description: "1000+ XP", condition: (e) => e.xp >= 1000 }
];

function renderLeaderboardCard(entry, rank) {
    const badges = BADGE_RULES
        .filter(b => b.condition({ ...entry, rank }))
        .map(b => `<span class="lb-badge" title="${b.description}">${b.icon}</span>`)
        .join("");

    const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";

    return `
        <div class="leaderboard-card ${rankClass}">
            <div class="lb-rank">#${rank}</div>
            <div class="lb-user">
                <img class="lb-avatar" src="${entry.photoURL || `https://placehold.co/80x80/131A2C/EC6FA0?text=${(entry.fullname || "R").charAt(0).toUpperCase()}`}" alt="">
                <span class="lb-name">${entry.fullname || "Anonymous"}</span>
            </div>
            <div class="lb-level">Lv.${entry.level}</div>
            <div class="lb-xp">${(entry.xp || 0).toLocaleString()}</div>
            <div class="lb-streak">🔥 ${entry.streak || 0}</div>
            <div class="lb-score">${(entry.rankingScore || 0).toLocaleString()}</div>
            <div class="lb-badges">${badges}</div>
        </div>
    `;
}

async function getAllTimeLeaderboard() {
    const q = query(
        collection(db, "users"),
        orderBy("xp", "desc"),
        limit(100)
    );

    const snapshot = await getDocs(q);
    const entries = snapshot.docs.map((docSnap, index) => {
        const data = docSnap.data();
        return {
            uid: docSnap.id,
            rank: index + 1,
            ...data,
            level: data.level || calculateLevel(data.xp || 0)
        };
    });

    entries.sort((a, b) => {
        const scoreA = calculateRankingScore(a);
        const scoreB = calculateRankingScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.longestStreak || 0) - (a.longestStreak || 0);
    });

    entries.forEach((entry, index) => {
        entry.rank = index + 1;
        entry.rankingScore = calculateRankingScore(entry);
    });

    return entries;
}

async function getWeeklyLeaderboard() {
    const today = new Date().toISOString().slice(0, 10);
    const monday = getMonday(today);

    const q = query(
        collection(db, "users"),
        orderBy("weeklyXP", "desc"),
        limit(100)
    );

    const snapshot = await getDocs(q);
    let entries = snapshot.docs.map((docSnap, index) => {
        const data = docSnap.data();
        return {
            uid: docSnap.id,
            rank: index + 1,
            ...data,
            level: data.level || calculateLevel(data.xp || 0)
        };
    });

    entries = entries.filter(entry => entry.weeklyXPWeekStart === monday);

    entries.sort((a, b) => {
        const scoreA = calculateRankingScore(a);
        const scoreB = calculateRankingScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.longestStreak || 0) - (a.longestStreak || 0);
    });

    entries.forEach((entry, index) => {
        entry.rank = index + 1;
        entry.rankingScore = calculateRankingScore(entry);
    });

    return entries;
}

function renderLeaderboard(entries) {
    if (!leaderboardList) return;

    if (entries.length === 0) {
        leaderboardList.innerHTML = '<div class="leaderboard-empty">No rankings yet. Be the first to study!</div>';
        return;
    }

    leaderboardList.innerHTML = entries.map((entry, i) => renderLeaderboardCard(entry, i + 1)).join("");
}

async function loadTab(tab) {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '<div class="leaderboard-empty">Loading rankings…</div>';

    try {
        let entries;
        if (tab === "weekly") {
            entries = await getWeeklyLeaderboard();
        } else {
            entries = await getAllTimeLeaderboard();
        }
        renderLeaderboard(entries);
    } catch (err) {
        console.error("Failed to load leaderboard:", err);
        leaderboardList.innerHTML = '<div class="leaderboard-empty">Could not load leaderboard.</div>';
    }
}

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentTab = tab.dataset.tab;
        loadTab(currentTab);
    });
});

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    if (sidebarStreak) {
        try {
            const userRef = doc(db, "users", user.uid);
            const snap = await getDoc(userRef);
            if (snap.exists()) {
                sidebarStreak.textContent = `${snap.data().streak || 0} days`;
            }
        } catch (err) {
            console.error("Failed to load streak:", err);
        }
    }

    loadTab(currentTab);
});

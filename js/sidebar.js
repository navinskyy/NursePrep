import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";

import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

const sidebarStreak = document.getElementById("sidebarStreak");
const reviewBadge = document.getElementById("reviewBadge");

function initNavIndicator() {
    const nav = document.querySelector(".dash-nav");
    if (!nav) return;

    const indicator = document.createElement("div");
    indicator.className = "dash-nav-indicator";
    indicator.setAttribute("aria-hidden", "true");
    nav.appendChild(indicator);

    const activeLink = nav.querySelector("a.active");
    if (activeLink) {
        positionIndicator(activeLink);
    }

    nav.querySelectorAll("a").forEach(link => {
        link.addEventListener("mouseenter", () => {
            if (!link.classList.contains("active")) {
                positionIndicator(link);
            }
        });

        link.addEventListener("mouseleave", () => {
            const activeLink = nav.querySelector("a.active");
            if (activeLink) {
                positionIndicator(activeLink);
            }
        });
    });

    window.addEventListener("resize", () => {
        const activeLink = nav.querySelector("a.active");
        if (activeLink) {
            positionIndicator(activeLink);
        }
    });
}

function positionIndicator(link) {
    const nav = document.querySelector(".dash-nav");
    if (!nav) return;

    const indicator = nav.querySelector(".dash-nav-indicator");
    if (!indicator) return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();

    indicator.style.top = `${linkRect.top - navRect.top}px`;
    indicator.style.height = `${linkRect.height}px`;
}

function animatePageEnter() {
    const main = document.querySelector(".dash-main");
    if (!main) return;

    main.classList.add("page-enter");

    main.addEventListener("animationend", () => {
        main.classList.remove("page-enter");
    }, { once: true });
}

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    initNavIndicator();
    animatePageEnter();

    if (sidebarStreak) {
        try {
            const snap = await getDoc(doc(db, "users", user.uid));
            if (snap.exists()) {
                sidebarStreak.textContent = `${snap.data().streak || 0} days`;
            }
        } catch (err) {
            console.error("Failed to load streak:", err);
        }
    }

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

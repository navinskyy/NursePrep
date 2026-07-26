import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";

import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

const sidebarStreak = document.getElementById("sidebarStreak");
const reviewBadge = document.getElementById("reviewBadge");

function initMobileMenu() {
    const toggle = document.querySelector(".menu-toggle");
    const sidebar = document.querySelector(".dash-sidebar");
    const overlay = document.querySelector(".sidebar-overlay");

    if (!toggle || !sidebar) return;

    function openMenu() {
        sidebar.classList.add("is-open");
        if (overlay) overlay.classList.add("show");
        document.body.style.overflow = "hidden";
    }

    function closeMenu() {
        sidebar.classList.remove("is-open");
        if (overlay) overlay.classList.remove("show");
        document.body.style.overflow = "";
    }

    toggle.addEventListener("click", () => {
        if (sidebar.classList.contains("is-open")) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    if (overlay) {
        overlay.addEventListener("click", closeMenu);
    }

    sidebar.querySelectorAll(".dash-nav a").forEach(link => {
        link.addEventListener("click", () => {
            if (window.innerWidth <= 768) {
                closeMenu();
            }
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
            closeMenu();
        }
    });
}

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
    initMobileMenu();
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

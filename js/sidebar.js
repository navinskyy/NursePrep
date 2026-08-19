import { auth, db } from "../firebase/firebase.js";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { getTotalWrongAnswerCount } from "../services/wrongAnswerService.js";

/* ============================================================
   NursePrep — Sidebar (single source of truth)
   ------------------------------------------------------------
   The sidebar markup lives here and is injected into every
   authenticated page. This removes the duplicated inline markup
   that had drifted out of sync across pages. Dynamic data
   (streak, review count) is hydrated after auth resolves.
   ============================================================ */

const SIDEBAR_ID = "dashSidebar";

// Brand lockup (logo + wordmark).
const BRAND_SVG = `
  <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <circle cx="13" cy="13" r="12" stroke="#EC6FA0" stroke-width="1.4"/>
    <path d="M4 13H8L10.5 6L14 20L16 13H22" stroke="#EC6FA0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;

// Primary navigation — grouped sections, the single source every page renders.
const NAV_GROUPS = [
  {
    label: "Study",
    items: [
      { href: "dashboard.html",  label: "Dashboard",  icon: `<path d="M3 11L12 4L21 11"/><path d="M5 10V20H19V10"/>` },
      { href: "subjects.html",   label: "Subjects",   icon: `<path d="M4 5C4 5 8 3 12 5C16 3 20 5 20 5V18C20 18 16 16 12 18C8 16 4 18 4 18V5Z"/>` },
      { href: "flashcards.html", label: "Flashcards", icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>` },
    ],
  },
  {
    label: "Progress",
    items: [
      { href: "review.html",    label: "Review Mistakes", icon: `<path d="M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7m-9-7l4 4-4 4"/>`, badgeId: "reviewBadge" },
      { href: "analytics.html", label: "Analytics",       icon: `<rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>` },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "leaderboard.html", label: "Leaderboard", icon: `<path d="M8 21h8M12 17v4M7 4h10v5a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4z"/>` },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "profile.html",  label: "Profile",  icon: `<circle cx="12" cy="8" r="3.4"/><path d="M5 20C5 16 8 14 12 14C16 14 19 16 19 20"/>` },
      { href: "settings.html", label: "Settings", icon: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>` },
    ],
  },
];

// The current page filename, e.g. "dashboard.html".
function currentPage() {
  const file = window.location.pathname.split("/").pop();
  return file && file.length ? file : "";
}

function navLinkHTML(item, isActive) {
  const badge = item.badgeId
    ? `<span class="review-badge" id="${item.badgeId}">0</span>`
    : "";
  const activeAttrs = isActive ? ` class="active" aria-current="page"` : "";
  return `<a href="${item.href}" title="${item.label}"${activeAttrs}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>
      <span class="nav-label">${item.label}</span>
      ${badge}
    </a>`;
}

function navGroupHTML(group, page) {
  const slug = group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const items = group.items
    .map((item) => navLinkHTML(item, item.href === page))
    .join("\n        ");
  return `<div class="nav-group" data-group="${slug}">
        <button class="nav-group-header" type="button" aria-expanded="true" aria-controls="navgroup-${slug}">
          <span class="nav-group-label">${group.label}</span>
          <svg class="nav-group-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-group-items" id="navgroup-${slug}">
          ${items}
        </div>
      </div>`;
}

function sidebarHTML() {
  const page = currentPage();
  const groups = NAV_GROUPS
    .map((group) => navGroupHTML(group, page))
    .join("\n      ");

  return `
  <header class="mobile-topbar">
    <button class="menu-toggle" type="button" aria-label="Open navigation menu" aria-controls="${SIDEBAR_ID}" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
    <div class="topbar-brand">${BRAND_SVG}<span>NursePrep</span></div>
  </header>

  <aside class="dash-sidebar" id="${SIDEBAR_ID}" aria-label="Sidebar">
    <div class="brand">
      ${BRAND_SVG}
      <span class="brand-wordmark">NursePrep</span>
      <button class="sidebar-collapse" type="button" aria-label="Collapse sidebar" aria-expanded="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
      </button>
    </div>

    <nav class="dash-nav" aria-label="Primary">
      ${groups}
    </nav>

    <div class="dash-sidebar-bottom">
      <div class="sidebar-account">
        <a class="account-card" href="profile.html" title="Profile" aria-label="View your profile">
          <img class="account-avatar" id="sidebarAvatar" src="https://placehold.co/64x64/131A2C/EC6FA0?text=RN" alt="" width="32" height="32">
          <span class="account-meta">
            <span class="account-name" id="sidebarName">Future RN</span>
            <span class="account-email" id="sidebarEmail"></span>
          </span>
        </a>
        <button class="btn btn-secondary sidebar-logout" id="sidebarLogout" type="button" title="Log out">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Log out</span>
        </button>
      </div>

      <div class="dash-sidebar-foot">
        <span class="eyebrow">Streak</span>
        <p><strong id="sidebarStreak">0 days</strong> — keep it going 🔥</p>
      </div>
    </div>
  </aside>

  <div class="sidebar-overlay" aria-hidden="true"></div>`;
}

// Inject the sidebar once, synchronously, so the layout (which reserves
// a fixed left margin) is filled immediately and other page scripts can
// find #sidebarStreak / #reviewBadge.
function injectSidebar() {
  if (document.querySelector(".dash-sidebar")) return;
  document.body.insertAdjacentHTML("afterbegin", sidebarHTML());
}

function initMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const sidebar = document.querySelector(".dash-sidebar");
  const overlay = document.querySelector(".sidebar-overlay");

  if (!toggle || !sidebar) return;

  const isMobile = () => window.innerWidth <= 768;
  let lastFocused = null;

  const focusablesIn = (el) =>
    Array.from(
      el.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((n) => n.offsetParent !== null);

  // On mobile, a closed drawer must be out of the tab order and a11y tree.
  function syncInert() {
    const hidden = isMobile() && !sidebar.classList.contains("is-open");
    sidebar.inert = hidden;
    sidebar.setAttribute("aria-hidden", String(hidden));
  }

  function openMenu() {
    lastFocused = document.activeElement;
    sidebar.classList.add("is-open");
    syncInert();
    if (overlay) overlay.classList.add("show");
    document.body.style.overflow = "hidden";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
    // Move focus into the drawer for keyboard/screen-reader users.
    const first = focusablesIn(sidebar)[0];
    if (first) first.focus();
  }

  function closeMenu({ restoreFocus = true } = {}) {
    sidebar.classList.remove("is-open");
    if (overlay) overlay.classList.remove("show");
    document.body.style.overflow = "";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
    if (restoreFocus && lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
    syncInert();
  }

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (overlay) {
    overlay.addEventListener("click", () => closeMenu());
  }

  sidebar.querySelectorAll(".dash-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      if (isMobile()) closeMenu({ restoreFocus: false });
    });
  });

  document.addEventListener("keydown", (e) => {
    if (!sidebar.classList.contains("is-open")) return;

    if (e.key === "Escape") {
      closeMenu();
      return;
    }

    // Trap focus within the drawer while it is open on mobile.
    if (e.key === "Tab" && isMobile()) {
      const focusables = focusablesIn(sidebar);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Reset drawer state when growing past the mobile breakpoint.
  window.addEventListener("resize", () => {
    if (!isMobile() && sidebar.classList.contains("is-open")) {
      closeMenu({ restoreFocus: false });
    }
    syncInert();
  });

  syncInert();
}

const NAVGROUPS_KEY = "np-collapsed-navgroups";

function readCollapsedGroups() {
  try {
    return JSON.parse(localStorage.getItem(NAVGROUPS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeCollapsedGroups(list) {
  try {
    localStorage.setItem(NAVGROUPS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function initNavGroups() {
  const nav = document.querySelector(".dash-nav");
  if (!nav) return;

  const collapsed = readCollapsedGroups();

  nav.querySelectorAll(".nav-group").forEach((group) => {
    const slug = group.getAttribute("data-group");
    const header = group.querySelector(".nav-group-header");
    if (!header) return;

    // Restore saved state, but never hide the group with the active page.
    const hasActive = !!group.querySelector("a.active");
    const startCollapsed = collapsed.includes(slug) && !hasActive;
    group.classList.toggle("collapsed", startCollapsed);
    header.setAttribute("aria-expanded", String(!startCollapsed));

    header.addEventListener("click", () => {
      const nowCollapsed = !group.classList.contains("collapsed");
      group.classList.toggle("collapsed", nowCollapsed);
      header.setAttribute("aria-expanded", String(!nowCollapsed));

      const list = readCollapsedGroups();
      const idx = list.indexOf(slug);
      if (nowCollapsed && idx === -1) list.push(slug);
      if (!nowCollapsed && idx !== -1) list.splice(idx, 1);
      writeCollapsedGroups(list);
    });
  });
}

function animatePageEnter() {
  const main = document.querySelector(".dash-main");
  if (!main) return;

  main.classList.add("page-enter");
  main.addEventListener("animationend", () => {
    main.classList.remove("page-enter");
  }, { once: true });
}

function fallbackAvatar(name) {
  const initial = (name || "R").trim().charAt(0).toUpperCase() || "R";
  return `https://placehold.co/64x64/131A2C/EC6FA0?text=${encodeURIComponent(initial)}`;
}

async function hydrateUser(user) {
  const nameEl = document.getElementById("sidebarName");
  const emailEl = document.getElementById("sidebarEmail");
  const avatarEl = document.getElementById("sidebarAvatar");
  const streakEl = document.getElementById("sidebarStreak");

  // Seed from the auth record so the account shows instantly.
  const authName = user.displayName || (user.email ? user.email.split("@")[0] : "Future RN");
  if (nameEl) nameEl.textContent = authName;
  if (emailEl) emailEl.textContent = user.email || "";
  if (avatarEl) avatarEl.src = user.photoURL || fallbackAvatar(authName);

  // Enrich from the Firestore profile (single read powers streak + account).
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const data = snap.data();
    const name = data.fullname || authName;
    if (streakEl) streakEl.textContent = `${data.streak || 0} days`;
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = data.email || user.email || "";
    if (avatarEl) avatarEl.src = data.photoURL || user.photoURL || fallbackAvatar(name);
  } catch (err) {
    console.error("Failed to load user profile:", err);
  }
}

function initSidebarLogout() {
  const btn = document.getElementById("sidebarLogout");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to log out of NursePrep?")) return;
    try {
      await signOut(auth);
      window.location.href = "login.html";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  });
}

const COLLAPSE_KEY = "np-sidebar-collapsed";

// Desktop-only: collapse the sidebar to an icon rail. Persisted across pages.
function initSidebarCollapse() {
  const btn = document.querySelector(".sidebar-collapse");
  const body = document.body;

  const apply = (collapsed) => {
    body.classList.toggle("sidebar-collapsed", collapsed);
    if (btn) {
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    }
  };

  // Restore persisted state immediately (no entry animation).
  apply(localStorage.getItem(COLLAPSE_KEY) === "1");

  if (btn) {
    btn.addEventListener("click", () => {
      const collapsed = !body.classList.contains("sidebar-collapsed");
      apply(collapsed);
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      } catch {
        /* storage unavailable — non-fatal */
      }
    });
  }

  // Enable width/margin transitions only after the initial state is set,
  // so restoring a collapsed sidebar doesn't animate on page load.
  requestAnimationFrame(() => body.classList.add("sidebar-transitions"));
}

async function hydrateReviewBadge() {
  const reviewBadge = document.getElementById("reviewBadge");
  if (!reviewBadge) return;
  try {
    const total = await getTotalWrongAnswerCount();
    reviewBadge.textContent = total;
    reviewBadge.classList.toggle("show", total > 0);
  } catch (err) {
    console.error("Failed to load review badge count:", err);
  }
}

// ---- Boot ----------------------------------------------------
injectSidebar();
initSidebarCollapse();
initNavGroups();
initMobileMenu();
initSidebarLogout();
animatePageEnter();

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  hydrateUser(user);
  hydrateReviewBadge();
});

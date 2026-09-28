import { animateIfAllowed, prefersReducedMotion, stagger } from "./motion.js";

const authShell = document.querySelector(".auth-shell");
const authCard = document.querySelector(".auth-card");
const authAside = document.querySelector(".auth-aside");

function animateAuthEntrance() {
  if (!authShell || prefersReducedMotion()) return;

  const panels = [authCard, authAside].filter(Boolean);
  void animateIfAllowed(panels, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: 280,
    ease: "outCubic"
  }).catch(() => undefined);

  const details = authShell.querySelectorAll(
    ".auth-card h2, .auth-card > p, .field, .auth-submit, .google-btn, .auth-divider, .small-text, .bottom-text, .auth-quote h1, .auth-quote p, .feature-list, .auth-foot-caption"
  );

  void animateIfAllowed(details, {
    opacity: [0, 1],
    translateY: [6, 0],
    delay: stagger(25),
    duration: 220,
    ease: "outCubic"
  }).catch(() => undefined);
}

animateAuthEntrance();

import { animate, stagger } from "animejs";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion() {
  return reducedMotionQuery.matches ||
    document.documentElement.classList.contains("user-reduced-motion") ||
    document.body.classList.contains("user-reduced-motion");
}

export function animationPromise(animation) {
  return animation.then(() => undefined);
}

export function animateIfAllowed(targets, parameters) {
  if (prefersReducedMotion()) return Promise.resolve();
  return animationPromise(animate(targets, parameters));
}

export { stagger };

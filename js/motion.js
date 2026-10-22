import { animate, stagger, utils } from "animejs";

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

/** Cancels running animations on targets that are about to be re-rendered or removed. */
export function stopAnimations(targets) {
  try {
    utils.remove(targets);
  } catch {
    /* nothing running */
  }
}

export { stagger };

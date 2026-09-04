import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { DEFAULT_SETTINGS, getUserSettings, saveUserSettings, SETTINGS_STORAGE_KEY } from "../utils/utils.js";

const form = document.getElementById("settingsForm");
const dailyGoalEl = document.getElementById("dailyGoal");
const questionTimerEl = document.getElementById("questionTimer");
const shuffleQuestionsEl = document.getElementById("shuffleQuestions");
const reducedMotionEl = document.getElementById("reducedMotion");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");
const saveStatus = document.getElementById("saveStatus");
const toast = document.getElementById("toast");

const DEFAULTS = DEFAULT_SETTINGS;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function applyMotionPreference(enabled) {
  document.documentElement.classList.toggle("user-reduced-motion", enabled);
}

function loadLocalSettings() {
  return getUserSettings();
}

function saveLocalSettings(settings) {
  saveUserSettings(settings);
}

function applyToForm(settings) {
  dailyGoalEl.value = settings.dailyGoal;
  questionTimerEl.value = String(settings.questionTimer);
  shuffleQuestionsEl.checked = !!settings.shuffleQuestions;
  reducedMotionEl.checked = !!settings.reducedMotion;
}

function readFromForm() {
  const daily = Math.max(5, Math.min(200, Number(dailyGoalEl.value) || DEFAULTS.dailyGoal));
  return {
    dailyGoal: daily,
    questionTimer: questionTimerEl.value,
    shuffleQuestions: shuffleQuestionsEl.checked,
    reducedMotion: reducedMotionEl.checked
  };
}

async function loadFromFirestore(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "preferences", "ui"));
    if (snap.exists()) {
      return { ...DEFAULTS, ...snap.data() };
    }
  } catch (err) {
    console.warn("Failed to load settings from Firestore:", err);
  }
  return null;
}

async function saveToFirestore(uid, settings) {
  try {
    // Save full settings object under preferences/ui for Settings UI.
    await setDoc(doc(db, "users", uid, "preferences", "ui"), {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Mirror individual fields onto the main user doc so Dashboard reads
    // them from the single source of truth (users/{uid}).
    const userDocUpdates = {};
    if (Number.isFinite(settings.dailyGoal)) {
      userDocUpdates.dailyGoal = settings.dailyGoal;
    }
    if (typeof settings.questionTimer === "string") {
      userDocUpdates.questionTimer = settings.questionTimer;
    }
    if (Object.keys(userDocUpdates).length > 0) {
      await setDoc(doc(db, "users", uid), userDocUpdates, { merge: true });
    }
  } catch (err) {
    console.warn("Failed to save settings to Firestore:", err);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  let settings = loadLocalSettings();

  const remote = await loadFromFirestore(user.uid);
  if (remote) {
    settings = { ...settings, ...remote };
    saveLocalSettings(settings);
  }

  applyToForm(settings);
  applyMotionPreference(settings.reducedMotion);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = readFromForm();
    saveLocalSettings(next);
    applyMotionPreference(next.reducedMotion);

    // Notify same-tab listeners (Dashboard on pageshow/visibilitychange will
    // also re-read on navigation; this catches any other in-tab observers).
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_STORAGE_KEY }));
    } catch {
      // Older browsers: ignore — page navigation covers Dashboard reload.
    }

    saveStatus.textContent = "Saving…";
    await saveToFirestore(user.uid, next);
    saveStatus.textContent = "Saved.";
    showToast("Settings saved.");

    setTimeout(() => { saveStatus.textContent = ""; }, 2000);
  });

  reducedMotionEl.addEventListener("change", () => {
    applyMotionPreference(reducedMotionEl.checked);
  });

  changePasswordBtn?.addEventListener("click", () => {
    window.location.href = "profile.html#change-password";
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await auth.signOut();
      window.location.href = "login.html";
    } catch (err) {
      console.error("Logout failed:", err);
      showToast("Could not log out.");
    }
  });
});

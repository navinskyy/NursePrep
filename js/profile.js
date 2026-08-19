import { auth } from "../firebase/firebase.js";
import {
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { ensureUserProfile, updateUserProfile, getAchievementStatus, calculateLevel, getLevelProgress, calculateRankingScore, LEVEL_THRESHOLDS } from "./userProfile.js";

// ======================================
// ELEMENTS
// ======================================

const profileImage = document.getElementById("profileImage");
const avatarInput = document.getElementById("avatarInput");

const profileName = document.getElementById("profileName");
const profileCourse = document.getElementById("profileCourse");
const profileStatus = document.getElementById("profileStatus");

const levelBadge = document.getElementById("levelBadge");
const xpText = document.getElementById("xpText");
const xpFill = document.getElementById("xpFill");
const rankingChip = document.getElementById("rankingChip");
const totalXpChip = document.getElementById("totalXpChip");
const profileMemberSince = document.getElementById("profileMemberSince");

const profileEmail = document.getElementById("profileEmail");
const profileSchool = document.getElementById("profileSchool");
const profileCourseFull = document.getElementById("profileCourseFull");
const profileYear = document.getElementById("profileYear");

const statQuestions = document.getElementById("statQuestions");
const statAccuracy = document.getElementById("statAccuracy");
const statStreak = document.getElementById("statStreak");
const statBest = document.getElementById("statBest");
const statQuizzes = document.getElementById("statQuizzes");
const statStudyTime = document.getElementById("statStudyTime");
const statMastered = document.getElementById("statMastered");
const statPerfect = document.getElementById("statPerfect");

const achievementsGrid = document.getElementById("achievementsGrid");
const achievementsCount = document.getElementById("achievementsCount");
const achBar = document.getElementById("achBar");

const sidebarStreak = document.getElementById("sidebarStreak");

const editProfileBtn = document.getElementById("editProfileBtn");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");
const logoutBtn2 = document.getElementById("logoutBtn2");

const editModal = document.getElementById("editModal");
const editName = document.getElementById("editName");
const editSchool = document.getElementById("editSchool");
const editCourse = document.getElementById("editCourse");
const editYear = document.getElementById("editYear");
const cancelEdit = document.getElementById("cancelEdit");
const saveProfile = document.getElementById("saveProfile");

const passwordModal = document.getElementById("passwordModal");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmNewPassword = document.getElementById("confirmNewPassword");
const cancelPassword = document.getElementById("cancelPassword");
const savePassword = document.getElementById("savePassword");

const logoutModal = document.getElementById("logoutModal");
const cancelLogout = document.getElementById("cancelLogout");
const confirmLogout = document.getElementById("confirmLogout");

const loading = document.getElementById("loadingOverlay");
const toast = document.getElementById("toast");

let uid = null;
let currentData = null;

// ======================================
// HELPERS
// ======================================

function showLoading() {
  loading.classList.add("show");
}

function hideLoading() {
  loading.classList.remove("show");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function fallbackAvatar(name) {
  const initial = (name || "R").trim().charAt(0).toUpperCase();
  return `https://placehold.co/200x200/131A2C/EC6FA0?text=${initial}`;
}

// Format a whole number with thousands separators (e.g. 12,340).
function formatNum(n) {
  return (Number(n) || 0).toLocaleString();
}

// Turn a duration in seconds into a compact, human label (e.g. "2h 15m").
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return "0m";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

// Firestore timestamps expose toDate(); new profiles hold an unresolved
// sentinel until the next read, so guard before formatting.
function formatMemberSince(createdAt) {
  try {
    const date = createdAt?.toDate ? createdAt.toDate() : (createdAt ? new Date(createdAt) : null);
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

function renderAchievements(data) {
  if (!achievementsGrid) return;

  const achievements = getAchievementStatus(data);
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  if (achievementsCount) {
    achievementsCount.textContent = `${unlockedCount} / ${achievements.length} unlocked`;
  }

  if (achBar) {
    const pct = achievements.length ? (unlockedCount / achievements.length) * 100 : 0;
    achBar.style.width = `${pct}%`;
  }

  // Surface earned badges first, then the closest-to-unlock ones, so the
  // most relevant progress is always at the top of the grid.
  const ordered = [...achievements].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return (b.progress || 0) - (a.progress || 0);
  });

  achievementsGrid.innerHTML = ordered.map(ach => {
    const pct = Math.round((ach.progress || 0) * 100);
    const progressBar = ach.unlocked
      ? ""
      : `<div class="achievement-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${ach.name} progress">
           <span style="width:${pct}%"></span>
         </div>`;

    return `
    <div class="achievement-card ${ach.unlocked ? "unlocked" : "locked"}">
      <div class="achievement-icon">${ach.icon}</div>
      <div class="achievement-info">
        <h4>${ach.name}</h4>
        <p>${ach.description}</p>
        ${progressBar}
      </div>
      <div class="achievement-badge" aria-hidden="true">
        ${ach.unlocked ? "&#10003;" : "&#128274;"}
      </div>
    </div>
  `;
  }).join("");
}

// ======================================
// RENDER
// ======================================

function renderProfile(data) {
  currentData = data;

  profileImage.src = data.photoURL || fallbackAvatar(data.fullname);
  profileName.textContent = data.fullname || "Future RN";
  profileCourse.textContent = data.course || "PNLE Reviewer";

  if (profileStatus) {
    profileStatus.textContent = (data.streak || 0) > 0 ? "Active reviewer" : "New reviewer";
  }

  const level = data.level || calculateLevel(data.xp || 0);
  const xp = data.xp || 0;
  const levelProgress = getLevelProgress(xp, level);
  const nextLevelXP = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const currentLevelXP = LEVEL_THRESHOLDS[level - 1] || 0;
  const rankingScore = calculateRankingScore(data);
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;

  if (levelBadge) levelBadge.textContent = `Lv.${level}`;
  if (xpText) {
    xpText.textContent = isMaxLevel
      ? "Max level"
      : `${formatNum(xp - currentLevelXP)} / ${formatNum(nextLevelXP - currentLevelXP)} XP`;
  }
  if (xpFill) xpFill.style.width = `${isMaxLevel ? 100 : levelProgress}%`;
  if (rankingChip) rankingChip.textContent = `Rank Score: ${formatNum(rankingScore)}`;
  if (totalXpChip) totalXpChip.textContent = `${formatNum(xp)} XP total`;

  const memberSince = formatMemberSince(data.createdAt);
  if (profileMemberSince) {
    if (memberSince) {
      profileMemberSince.textContent = `Member since ${memberSince}`;
      profileMemberSince.hidden = false;
    } else {
      profileMemberSince.hidden = true;
    }
  }

  profileEmail.textContent = data.email || "—";
  profileSchool.textContent = data.school || "Not set";
  profileCourseFull.textContent = data.course || "Not set";
  profileYear.textContent = data.yearLevel || "Not set";

  statQuestions.textContent = formatNum(data.questionsAnswered);
  statAccuracy.textContent = `${data.accuracy || 0}%`;
  statStreak.textContent = formatNum(data.streak);
  statBest.textContent = formatNum(data.longestStreak);
  statQuizzes.textContent = formatNum(data.quizzesTaken);
  if (statStudyTime) statStudyTime.textContent = formatDuration(data.studyTime);
  if (statMastered) statMastered.textContent = formatNum(data.masteredCards);
  if (statPerfect) statPerfect.textContent = formatNum(data.perfectScores);

  if (sidebarStreak) {
    sidebarStreak.textContent = `${data.streak || 0} days`;
  }

  renderAchievements(data);
}

// ======================================
// AVATAR UPLOAD
// ======================================

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Resizes an image file down to maxSize (longest side) and compresses it
 * to a JPEG data URL. This lets us store the avatar directly as a string
 * in the Firestore document — no Firebase Storage (Blaze plan) needed.
 * A 300px JPEG at 0.7 quality is typically 20–40KB, well under Firestore's
 * 1MB per-document limit.
 */
function resizeAndCompressImage(file, maxSize = 300, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        let { width, height } = img;

        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = () => reject(new Error("Couldn't read that image file."));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error("Couldn't read the selected file."));
    reader.readAsDataURL(file);
  });
}

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files[0];
  if (!file || !uid) return;

  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    avatarInput.value = "";
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    showToast("Image is too large — please choose one under 8MB.");
    avatarInput.value = "";
    return;
  }

  try {
    showLoading();

    console.log("Avatar upload: compressing image…");
    const photoURL = await withTimeout(resizeAndCompressImage(file), 10000, "Image processing");

    console.log("Avatar upload: saving to Firestore…", `${Math.round(photoURL.length / 1024)}KB`);
    await updateUserProfile(uid, { photoURL });

    profileImage.src = photoURL;
    currentData.photoURL = photoURL;

    hideLoading();
    showToast("Photo updated!");
    console.log("Avatar upload: done.");
  } catch (err) {
    console.error("Avatar upload failed:", err.code || "", err.message || err);
    hideLoading();
    showToast(err.message?.includes("timed out")
      ? "Image processing timed out. Try a smaller photo."
      : "Couldn't upload photo. Please try again.");
  } finally {
    avatarInput.value = "";
  }
});

// ======================================
// EDIT PROFILE MODAL
// ======================================

editProfileBtn.addEventListener("click", () => {
  editName.value = currentData?.fullname || "";
  editSchool.value = currentData?.school || "";
  editCourse.value = currentData?.course || "";
  editYear.value = currentData?.yearLevel || "";
  editModal.classList.add("show");
  openModalFocus(editModal);
});

cancelEdit.addEventListener("click", () => {
  editModal.classList.remove("show");
});

editModal.addEventListener("click", (e) => {
  if (e.target === editModal) editModal.classList.remove("show");
});

saveProfile.addEventListener("click", async () => {
  if (!uid) return;

  const fields = {
    fullname: editName.value.trim() || currentData.fullname,
    school: editSchool.value.trim(),
    course: editCourse.value.trim(),
    yearLevel: editYear.value.trim(),
  };

  try {
    showLoading();
    await updateUserProfile(uid, fields);
    renderProfile({ ...currentData, ...fields });
    editModal.classList.remove("show");
    hideLoading();
    showToast("Profile updated!");
  } catch (err) {
    console.error("Failed to save profile:", err);
    hideLoading();
    showToast("Couldn't save changes. Please try again.");
  }
});

// ======================================
// CHANGE PASSWORD
// ======================================

changePasswordBtn.addEventListener("click", () => {
  currentPassword.value = "";
  newPassword.value = "";
  confirmNewPassword.value = "";
  passwordModal.classList.add("show");
  openModalFocus(passwordModal);
});

cancelPassword.addEventListener("click", () => {
  passwordModal.classList.remove("show");
});

passwordModal.addEventListener("click", (e) => {
  if (e.target === passwordModal) passwordModal.classList.remove("show");
});

savePassword.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  if (!currentPassword.value || !newPassword.value || !confirmNewPassword.value) {
    showToast("Please fill in all fields.");
    return;
  }

  if (newPassword.value.length < 6) {
    showToast("New password must be at least 6 characters.");
    return;
  }

  if (newPassword.value !== confirmNewPassword.value) {
    showToast("New passwords do not match.");
    return;
  }

  try {
    showLoading();

    // Firebase requires a recent sign-in before allowing a password change
    const credential = EmailAuthProvider.credential(user.email, currentPassword.value);
    await reauthenticateWithCredential(user, credential);

    await updatePassword(user, newPassword.value);

    hideLoading();
    passwordModal.classList.remove("show");
    showToast("Password updated successfully!");
  } catch (err) {
    console.error("Password change failed:", err);
    hideLoading();

    let message = "Couldn't update password.";
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      message = "Current password is incorrect.";
    } else if (err.code === "auth/weak-password") {
      message = "New password is too weak.";
    }
    showToast(message);
  }
});

// ======================================
// LOGOUT (with confirmation)
// ======================================

function openLogoutConfirm() {
  logoutModal.classList.add("show");
  openModalFocus(logoutModal);
}

logoutBtn?.addEventListener("click", openLogoutConfirm);
logoutBtn2?.addEventListener("click", openLogoutConfirm);

cancelLogout.addEventListener("click", () => {
  logoutModal.classList.remove("show");
});

logoutModal.addEventListener("click", (e) => {
  if (e.target === logoutModal) logoutModal.classList.remove("show");
});

confirmLogout.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});

// ======================================
// MODAL KEYBOARD & FOCUS UX
// ======================================

const allModals = [editModal, passwordModal, logoutModal];

// Move focus into a modal when it opens (keyboard + screen-reader users).
function openModalFocus(modal) {
  requestAnimationFrame(() => {
    const target = modal.querySelector(
      'input, button.btn-primary, button.btn-danger, button'
    );
    if (target && typeof target.focus === "function") target.focus();
  });
}

// Escape closes the open modal; Enter inside a field triggers its action.
document.addEventListener("keydown", (e) => {
  const openModal = allModals.find((m) => m && m.classList.contains("show"));
  if (!openModal) return;

  if (e.key === "Escape") {
    e.preventDefault();
    openModal.classList.remove("show");
    return;
  }

  if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
    e.preventDefault();
    const primary = openModal.querySelector(
      ".modal-actions .btn-primary, .modal-actions .btn-danger"
    );
    if (primary) primary.click();
  }
});

// ======================================
// AUTH CHECK
// ======================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  uid = user.uid;

  try {
    const data = await ensureUserProfile(uid, {
      fullname: user.displayName,
      email: user.email,
    });
    renderProfile(data);
  } catch (err) {
    console.error("Failed to load profile:", err);
    profileName.textContent = "Something went wrong";
    profileCourse.textContent = "Please refresh the page.";
  }
});
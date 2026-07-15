import {
    auth,
    googleProvider
} from "../firebase/firebase.js";

import {
    signInWithEmailAndPassword,
    signInWithPopup,
    sendPasswordResetEmail,
    browserLocalPersistence,
    browserSessionPersistence,
    setPersistence,
    onAuthStateChanged
} from "firebase/auth";

import { ensureUserProfile } from "./userProfile.js";

console.log("✅ login.js loaded");

// ====================
// Elements
// ====================

const loginForm = document.getElementById("loginForm");

const email = document.getElementById("email");
const password = document.getElementById("password");

const rememberMe = document.getElementById("rememberMe");

const googleLogin = document.getElementById("googleLogin");

const forgotPassword = document.getElementById("forgotPassword");

const togglePassword = document.getElementById("togglePassword");

const loading = document.getElementById("loadingOverlay");

const toast = document.getElementById("toast");

// ====================
// Loading
// ====================

function showLoading() {
    loading.style.display = "flex";
}

function hideLoading() {
    loading.style.display = "none";
}

// ====================
// Toast
// ====================

function showToast(message) {

    toast.textContent = message;

    toast.classList.add("show");

    setTimeout(() => {

        toast.classList.remove("show");

    }, 3000);

}

// ====================
// Toggle Password
// ====================

togglePassword.addEventListener("click", () => {

    password.type =
        password.type === "password"
            ? "text"
            : "password";

});

// ====================
// Email Login
// ====================

loginForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    console.log("🟢 Login button clicked");

    try {

        showLoading();

        await setPersistence(

            auth,

            rememberMe.checked
                ? browserLocalPersistence
                : browserSessionPersistence

        );

        const credential = await signInWithEmailAndPassword(

            auth,

            email.value,

            password.value

        );

        console.log("✅ Login Success");

        hideLoading();

        showToast("Welcome back!");

        setTimeout(() => {

            window.location.href = "dashboard.html";

        }, 1000);

    }

    catch (error) {

        console.error(error);

        hideLoading();

        let message = "Login Failed.";

        switch (error.code) {

            case "auth/user-not-found":

                message = "User not found.";

                break;

            case "auth/wrong-password":

                message = "Incorrect password.";

                break;

            case "auth/invalid-email":

                message = "Invalid email.";

                break;

            case "auth/invalid-credential":

                message = "Invalid email or password.";

                break;

        }

        showToast(message);

    }

});

// ====================
// Google Login
// ====================

googleLogin.addEventListener("click", async () => {

    try {

        showLoading();

        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        console.log("Google User:", user);
        console.log("UID:", user.uid);

        // Single shared function — same shape as every other signup path,
        // and never overwrites an existing profile.
        await ensureUserProfile(user.uid, {
            fullname: user.displayName,
            email: user.email,
        });

        hideLoading();

        showToast("Google Login Successful!");

        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 1000);

    }

    catch (error) {

        console.error("Google login failed:", error);

        hideLoading();

        showToast(error.message);

    }

});

// ====================
// Forgot Password
// ====================

forgotPassword.addEventListener("click", async (e) => {

    e.preventDefault();

    if (email.value === "") {

        showToast("Enter your email first.");

        return;

    }

    try {

        await sendPasswordResetEmail(

            auth,

            email.value

        );

        showToast("Password reset email sent.");

    }

    catch (error) {

        console.error(error);

        showToast(error.message);

    }

});

// ====================
// Auto Login
// ====================

onAuthStateChanged(auth, (user) => {

    if (user) {

        window.location.href = "dashboard.html";

    }

});
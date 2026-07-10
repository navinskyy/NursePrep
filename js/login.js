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

    console.log("Email:", email.value);
    console.log("Password:", password.value);

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
        console.log(credential.user);

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

    console.log("🟢 Google Login Clicked");

    try {

        showLoading();

        const result = await signInWithPopup(

            auth,

            googleProvider

        );

        console.log(result.user);

        hideLoading();

        showToast("Google Login Successful!");

        setTimeout(() => {

            window.location.href = "dashboard.html";

        }, 1000);

    }

    catch (error) {

        console.error(error);

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

    console.log("🔥 Auth State Changed");
    console.log(user);

    if (user) {

        console.log("➡️ Redirecting to dashboard...");

        window.location.href = "dashboard.html";

    } else {

        console.log("❌ No user logged in.");

    }

});
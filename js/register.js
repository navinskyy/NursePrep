import {
    auth,
    db,
    googleProvider
} from "../firebase/firebase.js";

import {
    createUserWithEmailAndPassword,
    signInWithPopup,
    updateProfile
} from "firebase/auth";

import {
    doc,
    setDoc,
    serverTimestamp
} from "firebase/firestore";


// =======================
// Elements
// =======================

const form = document.getElementById("registerForm");

const fullname = document.getElementById("fullname");
const email = document.getElementById("email");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");

const togglePassword = document.getElementById("togglePassword");
const toggleConfirm = document.getElementById("toggleConfirm");

const strengthBar = document.getElementById("strengthBar");
const strengthText = document.getElementById("strengthText");

const googleBtn = document.getElementById("googleRegister");

const loading = document.getElementById("loadingOverlay");
const toast = document.getElementById("toast");

// =======================
// Helpers
// =======================

function showLoading() {
    loading.style.display = "flex";
}

function hideLoading() {
    loading.style.display = "none";
}

function showToast(message) {

    toast.textContent = message;

    toast.classList.add("show");

    setTimeout(() => {

        toast.classList.remove("show");

    }, 3000);

}

// =======================
// Password Visibility
// =======================

togglePassword.addEventListener("click", () => {

    password.type =
        password.type === "password"
        ? "text"
        : "password";

});

toggleConfirm.addEventListener("click", () => {

    confirmPassword.type =
        confirmPassword.type === "password"
        ? "text"
        : "password";

});

// =======================
// Password Strength
// =======================

password.addEventListener("input", () => {

    let score = 0;

    if(password.value.length >= 8) score++;

    if(/[A-Z]/.test(password.value)) score++;

    if(/[0-9]/.test(password.value)) score++;

    if(/[!@#$%^&*]/.test(password.value)) score++;

    const percent = score * 25;

    strengthBar.style.width = percent + "%";

    if(score === 1){

        strengthBar.style.background = "#ef4444";
        strengthText.textContent = "Weak";

    }

    else if(score === 2){

        strengthBar.style.background = "#f59e0b";
        strengthText.textContent = "Fair";

    }

    else if(score === 3){

        strengthBar.style.background = "#3b82f6";
        strengthText.textContent = "Good";

    }

    else if(score === 4){

        strengthBar.style.background = "#22c55e";
        strengthText.textContent = "Strong";

    }

});

// =======================
// Register
// =======================

form.addEventListener("submit", async(e)=>{

    e.preventDefault();

    if(password.value !== confirmPassword.value){

        showToast("Passwords do not match.");

        return;

    }

    try{

        showLoading();

        const credential =
            await createUserWithEmailAndPassword(
                auth,
                email.value,
                password.value
            );

        const user = credential.user;

        // Save name to Firebase Authentication
        await updateProfile(user, {
            displayName: fullname.value
        });

        // Save user data to Firestore
        await setDoc(

            doc(db, "users", user.uid),

            {

                uid: user.uid,

                fullname: fullname.value,

                email: user.email,

                questionsAnswered: 0,

                quizzesTaken: 0,

                accuracy: 0,

                streak: 0,

                masteredCards: 0,

                studyTime: 0,

                createdAt: serverTimestamp()

            }

        );

        hideLoading();

        showToast("Welcome to NursePrep!");

        setTimeout(()=>{

            window.location.href="dashboard.html";

        },1200);

    }

    catch(error){

        hideLoading();

        showToast(error.message);

    }

});

// =======================
// Google Register
// =======================

googleBtn.addEventListener("click", async()=>{

    try{

        showLoading();

        const result =
            await signInWithPopup(
                auth,
                googleProvider
            );

        const user = result.user;

      await setDoc(doc(db, "users", user.uid), {

                uid: user.uid,

                fullname: user.displayName,

                email: user.email,

                questionsAnswered: 0,

                quizzesTaken: 0,

                correctAnswers: 0,

                accuracy: 0,

                streak: 0,

                longestStreak: 0,

                masteredCards: 0,

                studyTime: 0,

                createdAt: serverTimestamp()

            }, { merge: true });

        hideLoading();

        showToast("Google Sign In Successful!");

        setTimeout(()=>{

            window.location.href="dashboard.html";

        },1000);

    }

    catch(error){

        hideLoading();

        showToast(error.message);

    }

});
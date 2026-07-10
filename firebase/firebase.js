// Firebase Core
import { initializeApp } from "firebase/app";

// Firebase Services
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBiDvAdvBVq75oDCPu9YuQqPwcQlhK08oo",
  authDomain: "nurseprep-43bd1.firebaseapp.com",
  projectId: "nurseprep-43bd1",
  storageBucket: "nurseprep-43bd1.firebasestorage.app",
  messagingSenderId: "150180119305",
  appId: "1:150180119305:web:7e05d1b1ff8db914c8c9d8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Authentication
const auth = getAuth(app);

// Google Provider
const googleProvider = new GoogleAuthProvider();

// Firestore Database
const db = getFirestore(app);

export {
  app,
  auth,
  db,
  googleProvider
};

export default app;
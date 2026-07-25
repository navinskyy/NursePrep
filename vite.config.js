import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        login: resolve(__dirname, "login.html"),
        register: resolve(__dirname, "register.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        subjects: resolve(__dirname, "subjects.html"),
        flashcards: resolve(__dirname, "flashcards.html"),
        quiz: resolve(__dirname, "quiz.html"),
        analytics: resolve(__dirname, "analytics.html"),
        review: resolve(__dirname, "review.html"),
        profile: resolve(__dirname, "profile.html")
      }
    }
  }
});
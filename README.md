# NursePrep

A personalized Philippine Nurse Licensure Examination (PNLE) review platform with adaptive quizzes, flashcards, progress tracking, and AI-powered explanations.

## Overview

NursePrep is a web-based study companion built for Filipino nursing graduates preparing for the PNLE. It combines timed adaptive quizzes, spaced-repetition flashcards, performance analytics, and an AI tutor into a single, focused study environment.

## Features

- **Adaptive Quizzes** — Topic-tagged question bank with per-question timer, instant feedback, and rationale after every item.
- **Immediate Answer Feedback** — Choices reveal correct/incorrect state the moment you pick, with the rationale shown before moving on.
- **Configurable Quiz Timer** — Per-question duration set in Settings (defaults to 60s) syncs across the dashboard, settings page, and quiz runner.
- **Daily Goal** — Adjustable daily question target that drives the dashboard progress ring.
- **Review Mistakes** — Filtered re-run of any questions you got wrong, with full immediate feedback and rationale.
- **Spaced-Repetition Flashcards** — Lightweight review cards with a built-in "Again / Hard / Good / Easy" scheduler.
- **Analytics Dashboard** — Accuracy, streaks, weak topics, and recent attempts at a glance.
- **Leaderboard** — Friendly comparison with other NursePrep learners.
- **Achievements** — Unlockable badges for streaks, accuracy, and consistency.
- **AI Explanations** — Optional AI-assisted rationale for any question.
- **Authentication & Cloud Sync** — Firebase Auth + Firestore, so your progress follows you across devices.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES Modules), HTML5, modern CSS (custom properties, grid, container queries)
- **Build:** Vite
- **Auth & Data:** Firebase Authentication, Cloud Firestore
- **Data:** Local JSON question bank (`public/data/quiz.json`, `public/data/quiz-catalog.json`)

## Project Structure

```
NursePrep/
├── index.html              # Landing page
├── login.html / register.html
├── dashboard.html          # Main study hub
├── quiz.html               # Adaptive quiz runner (with timer)
├── review.html             # Review-mistakes runner
├── flashcards.html         # Spaced-repetition flashcards
├── analytics.html          # Performance dashboard
├── leaderboard.html
├── profile.html
├── settings.html           # Question timer & daily goal
├── subjects.html           # Topic catalog
├── js/                     # Page-specific logic
│   ├── quiz.js             #   Quiz + timer engine
│   ├── review.js           #   Review-mistakes runner
│   ├── dashboard.js        #   Daily goal sync
│   ├── settings.js         #   Settings → Firestore mirror
│   └── ...
├── css/                    # Per-page and global styles
├── utils/utils.js          # Shared helpers (settings, audio, etc.)
├── public/data/            # Question bank
└── dist/                   # Production build output
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Firebase project (Auth + Firestore enabled)

### Install

```bash
npm install
```

### Develop

```bash
npm run dev
```

### Build

```bash
npm run build
```

The compiled assets land in `dist/`.

## Quiz Timer

Each question has a configurable countdown timer (default **60s**). The timer is defined in Settings and synced to your profile, so it stays consistent between sessions and devices.

- **State machine:** `idle → running → timeout / answered`
- **Visual phases:** calm (green) → warning (amber, ≤25%) → urgent (orange, ≤10%) → critical (red, ≤5s)
- **Accessibility:** ARIA `timer` role, live time updates throttled to 250ms, honors `prefers-reduced-motion`
- **Default value source:** `utils/utils.js → DEFAULT_SETTINGS.questionTimer`

## Changelog

### 2026-09-04 — Quiz UX overhaul & timer reliability

- **Immediate answer feedback** in the quiz runner — picking a choice now reveals the correct answer and rationale instantly; removed the manual Submit step.
- **Quiz timer is now configurable and synced** — `Settings → Question Timer` defaults to 60s, is stored on the user's Firestore doc, and is picked up live by the dashboard and quiz.
- **Dashboard ↔ Settings sync** — daily goal and question timer updates propagate across tabs and sessions via `storage` / `pageshow` / `visibilitychange` events.
- **Review Mistakes rewrite** — converted choices from inline `onclick` `<div>`s to real `<button role="radio">` elements with event delegation, proper focus / hover / keyboard states, skeleton loaders, and a feedback panel showing your answer, the correct answer, and the rationale.
- **Timer Impeccable polish** — larger tabular-num digits, phase-separated color states, 250ms tick resolution, `data-state` / `aria-label` wiring, and reduced-motion handling.
- **Bug fix: timer crash on first question** — `quiz.js` referenced a `submitBtn` element that was removed from the markup, throwing a `TypeError` and preventing `startTimer()` from ever running. All three references are now guarded.
- Code-side audio cues for correct / incorrect answers reuse the shared `playTone` helper.
- Build artifacts (`dist/`) refreshed.

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/awesome`)
3. Commit your changes
4. Push to your fork and open a Pull Request

## License

MIT — see [LICENSE](LICENSE) if present.

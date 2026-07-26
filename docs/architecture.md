# NursePrep — UI/UX Architecture & Firestore Schema

## 1. Navigation & User Flow

```
Dashboard
  └── Subjects (Hub)
        ├── Category Card (e.g., "Comprehensive PNLE Sets")
        │     └── Quiz List (all quizzes in category)
        │           └── Quiz Card → Start / Continue
        └── Category Card (e.g., "Foundation of Nursing")
              └── Quiz List
                    └── Quiz Card → Start / Continue
```

**Flow:** Dashboard → Subjects → Category → Quiz List → Quiz

## 2. Firestore Database Schema

### 2.1 `quizCategories` Collection

```
quizCategories/
  ├── pnleSets/
  │   ├── categoryId: "pnleSets"
  │   ├── name: "Comprehensive PNLE Sets"
  │   ├── icon: "📚"
  │   ├── description: "..."
  │   ├── order: 1
  │   └── quizzes (sub-collection)
  │       ├── set1-part1/
  │       │   ├── quizId: "pnle-set1-part1"
  │       │   ├── title: "PNLE Set 1 - Part 1"
  │       │   ├── itemCount: 100
  │       │   ├── difficulty: "Medium"
  │       │   ├── description: "..."
  │       │   ├── categoryId: "pnleSets"
  │       │   ├── subcategoryId: "set1"
  │       │   └── order: 1
  │       └── ...
  ├── foundation/
  │   ├── categoryId: "foundation"
  │   ├── name: "Foundation of Nursing"
  │   ├── icon: "🏥"
  │   ├── description: "..."
  │   ├── order: 2
  │   └── quizzes/
  │       ├── history/
  │       │   ├── quizId: "foundation-history"
  │       │   └── ...
  │       ├── infectionControl/
  │       │   └── ...
  │       └── nursingProcess/
  │           └── ...
  ├── maternalChild/
  ├── community/
  ├── medSurg/
  ├── psychiatric/
  └── allTopics/
```

### 2.2 `questions` Collection

```
questions/
  ├── {questionId}/
  │   ├── questionId: "q-001"
  │   ├── quizId: "pnle-set1-part1"
  │   ├── categoryId: "pnleSets"
  │   ├── questionText: "..."
  │   ├── choices: ["A", "B", "C", "D"]
  │   ├── correctAnswer: 0
  │   ├── explanation: "..."
  │   ├── difficulty: "Medium"
  │   └── tags: ["nursing-process", "assessment"]
```

**Indexes:**
- `quizId` (single field)
- `categoryId` + `difficulty` (composite)

### 2.3 `userProgress` Collection

```
userProgress/
  ├── {userId}/
  │   ├── pnle-set1-part1/
  │   │   ├── bestScore: 85
  │   │   ├── attempts: 3
  │   │   ├── lastAttempt: timestamp
  │   │   ├── completed: true
  │   │   ├── correctAnswers: 85
  │   │   ├── totalQuestions: 100
  │   │   └── lastAnsweredAt: timestamp
  │   └── foundation-history/
  │       ├── bestScore: 0
  │       ├── attempts: 0
  │       └── ...
```

## 3. UI/UX Design Specifications

### 3.1 Subjects Page (Hub)

- **Category Cards** — Large cards with icon, name, quiz count, overall progress
- **Filter/Search** — Filter categories by name
- **Progress Ring** — Overall category completion percentage

### 3.2 Quiz List Page

- **Quiz Cards** with:
  - Status badge: `New` | `Not Attempted` | `Completed ✅` | `Retake`
  - Best Score (%)
  - Number of Attempts
  - Last Attempt Date
  - Star rating (based on best score)
  - Context-aware CTA: `Start Quiz` | `Continue` | `Retake`
  - Item count & difficulty

### 3.3 Quiz Card States

| Status | Condition | CTA Button |
|--------|-----------|------------|
| New | attempts === 0 | Start Quiz |
| Not Attempted | attempts === 0 (category view) | Start Quiz |
| In Progress | answered > 0 && answered < total | Continue |
| Completed | answered === total && correct === total | Retake |
| Retake | completed but score < 100% | Retake |

## 4. Content Integration Strategy

- All questions include `explanation` with **Why correct** and **Why others are incorrect** sections
- Questions are tagged by `categoryId`, `subcategoryId`, and `tags` for filtered review
- Wrong answers are stored in `wrongAnswers` sub-collection under `userProgress/{userId}/wrongAnswers/`

## 5. Migration Path

1. Seed `quizCategories` from existing subject keys
2. Map existing `quiz.json` questions to quiz IDs
3. Create `quiz-catalog.json` for static metadata
4. Update `userProfile.js` to track per-quiz progress
5. Update UI to read from new data sources

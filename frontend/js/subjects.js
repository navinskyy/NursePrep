const subjects = [
  { name: "Fundamentals of Nursing",   key: "fundamentals", questions: 120, progress: 65 },
  { name: "Medical-Surgical Nursing",  key: "medSurg",      questions: 220, progress: 40 },
  { name: "Maternal Nursing",          key: "maternal",     questions: 90,  progress: 15 },
  { name: "Pediatric Nursing",         key: "pediatric",    questions: 100, progress: 20 },
  { name: "Psychiatric Nursing",       key: "psychiatric",  questions: 80,  progress: 10 },
  { name: "Community Health Nursing",  key: "community",    questions: 95,  progress: 55 },
  { name: "Pharmacology",              key: "pharma",       questions: 130, progress: 0  },
  { name: "Leadership & Management",   key: "leadership",   questions: 70,  progress: 5  },
];

// Line icons matching the rest of the site's SVG icon style (stroke="currentColor")
const ICONS = {
  fundamentals: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
  medSurg:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12H7L9.5 4L14.5 20L17 12H22" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  maternal:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="6" r="3"/><path d="M8 21C8 15 9.5 12 12 12C14.5 12 16 15 16 21" stroke-linecap="round"/></svg>',
  pediatric:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3"/><path d="M6 20C6 16.5 8.5 15 12 15C15.5 15 18 16.5 18 20"/></svg>',
  psychiatric:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8V12L15 14" stroke-linecap="round"/></svg>',
  community:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12H21M12 3C14.5 6 14.5 18 12 21C9.5 18 9.5 6 12 3Z"/></svg>',
  pharma:       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="12" height="16" rx="2"/><rect x="8" y="3" width="12" height="16" rx="2"/></svg>',
  leadership:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 20C3 16.5 5.5 15 9 15C12.5 15 15 16.5 15 20"/><path d="M16 15C19 15 21 16.5 21 19.5"/></svg>',
};

const container = document.getElementById("subjectsGrid");

subjects.forEach((subject) => {
  const notStarted = subject.progress === 0;
  const progressLabel = notStarted ? "Not started" : `${subject.progress}%`;

  const card = document.createElement("div");
  card.className = "subject-card";
  card.innerHTML = `
    <div class="subject-top">
      <div class="subject-icon">${ICONS[subject.key] || ""}</div>
      <div class="subject-progress ${notStarted ? "not-started" : ""}">${progressLabel}</div>
    </div>

    <h3>${subject.name}</h3>
    <p>${subject.questions} questions available</p>

    <div class="progress-track">
      <div class="progress-fill" style="width:${subject.progress}%"></div>
    </div>

    <div class="subject-actions">
      <a href="quiz.html?subject=${subject.key}" class="btn btn-primary">Start Quiz</a>
      <a href="flashcards.html?subject=${subject.key}" class="btn btn-secondary">Flashcards</a>
    </div>
  `;

  container.appendChild(card);
});
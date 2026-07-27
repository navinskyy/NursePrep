const fs = require('fs');
const path = 'C:/Users/Navin/Downloads/NursePrep/public/data/';

const exam1Questions = [
  {
    question: "A 10 year old who has sustained a head injury is brought to the emergency department by his mother. A diagnosis of a mild concussion is made. At the time of discharge, nurse Ron should instruct the mother to:",
    choices: ["Withhold food and fluids for 24 hours.", "Allow him to play outdoors with his friends.", "Arrange for a follow up visit with the child's primary care provider in one week.", "Check for any change in responsiveness every two hours until the follow-up visit."],
    answer: 3,
    explanation: "Signs of an epidural hematoma in children usually do not appear for 24 hours or more hours; a follow-up visit usually is arranged for one to two days after the injury."
  },
  {
    question: "A male client has suffered a motor accident and is now suffering from hypovolemic shock. Nurse Helen should frequency assess the client's vital signs during the compensatory stage of shock, because:",
    choices: ["Arteriolar constriction occurs", "The cardiac workload decreases", "Decreased contractility of the heart occurs", "The parasympathetic nervous system is triggered"],
    answer: 0,
    explanation: "The early compensation of shock is cardiovascular and is seen in changes in pulse, BP, and pulse pressure; blood is shunted to vital centers, particularly heart and brain."
  },
  {
    question: "A paranoid male client with schizophrenia is losing weight, reluctant to eat, and voicing concerns about being poisoned. The best intervention by nurse Dina would be to:",
    choices: ["Allow the client to open canned or pre-packaged food", "Restrict the client to his room until 2 lbs are gained", "Have a staff member personally taste all of the client's food", "Tell the client the food has been x-rayed by the staff and is safe"],
    answer: 0,
    explanation: "The client's comfort, safety, and nutritional status are the priorities; the client may feel comfortable to eat if the food has been sealed before reaching the mental health facility."
  },
  {
    question: "One day the mother of a young adult confides to nurse Frida that she is very troubled by he child's emotional illness. The nurse's most therapeutic initial response would be:",
    choices: ["You may be able to lessen your feelings of guilt by seeking counseling", "It would be helpful if you become involved in volunteer work at this time", "I recognize it's hard to deal with this, but try to remember that this too shall pass", "Joining a support group of parents who are coping with this problem can be quite helpful."],
    answer: 3,
    explanation: "Taking with others in similar circumstances provides support and allows for sharing of experiences."
  },
  {
    question: "To check for wound hemorrhage after a client has had a surgery for the removal of a tumor in the neck, nurse grace should:",
    choices: ["Loosen an edge of the dressing and lift it to see the wound", "Observe the dressing at the back of the neck for the presence of blood", "Outline the blood as it appears on the dressing to observe any progression", "Press gently around the incision to express accumulated blood from the wound"],
    answer: 2,
    explanation: "Drainage flows by gravity."
  },
  {
    question: "A 16-year-old primigravida arrives at the labor and birthing unit in her 38th week of gestation and states that she is labor. To verify that the client is in true labor nurse Trina should:",
    choices: ["Obtain sides for a fern test", "Time any uterine contractions", "Prepare her for a pelvic examination", "Apply nitrazine paper to moist vaginal tissue"],
    answer: 2,
    explanation: "Pelvic examination would reveal dilation and effacement"
  },
  {
    question: "As part of the diagnostic workup for pulmonic stenosis, a child has cardiac catheterization. Nurse Julius is aware that children with pulmonic stenosis have increased pressure:",
    choices: ["In the pulmonary vein", "In the pulmonary artery", "On the left side of the heart", "On the right side of the heart"],
    answer: 3,
    explanation: "Pulmonic stenosis increases resistance to blood flow, causing right ventricular hyperthrophy; with right ventricular failure there is an increase in pressure on the right side of the heart."
  },
  {
    question: "An obese client asks nurse Julius how to lose weight. Before answering, the nurse should remember that long-term weight loss occurs best when:",
    choices: ["Eating patterns are altered", "Fats are limited in the diet", "Carbohydrates are regulated", "Exercise is a major component"],
    answer: 0,
    explanation: "A new dietary regimen, with a balance of foods from the food pyramid, must be established and continued for weight reduction to occur and be maintained."
  },
  {
    question: "As a very anxious female client is talking to the nurse May, she starts crying. She appears to be upset that she cannot control her crying. The most appropriate response by the nurse would be:",
    choices: ["Is talking about your problem upsetting you?", "It is Ok to cry; I'll just stay with you for now", "You look upset; lets talk about why you are crying.", "Sometimes it helps to get it out of your system."],
    answer: 1,
    explanation: "This portrays a nonjudgmental attitude that recognizes the client's needs."
  },
  {
    question: "A patient has partial-thickness burns to both legs and portions of his trunk. Which of the following I.V. fluids is given first?",
    choices: ["Albumin", "D5W", "Lactated Ringer's solution", "0.9% sodium chloride solution with 2 mEq of potassium per 100 ml"],
    answer: 2,
    explanation: "Lactated Ringer's solution replaces lost sodium and corrects metabolic acidosis, both of which commonly occur following a burn. Albumin is used as adjunct therapy, not primary fluid replacement. Dextrose isn't given to burn patients during the first 24 hours because it can cause pseudodiabetes. The patient is hyperkalemic from the potassium shift from the intracellular space to the plasma, so potassium would be detrimental."
  }
];

const exam1Data = { questions: exam1Questions };

fs.writeFileSync(path + 'pnle-exam-1.json', JSON.stringify(exam1Data, null, 2));
console.log('Created pnle-exam-1.json with', exam1Questions.length, 'questions');

const exam2Data = { questions: [] };
fs.writeFileSync(path + 'pnle-exam-2.json', JSON.stringify(exam2Data, null, 2));
console.log('Created pnle-exam-2.json with 0 questions');

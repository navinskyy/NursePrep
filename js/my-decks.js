/* ============================================================
   NursePrep — My Decks page (library + deck editor)
   Data access lives in customDecks.js; study mode is the
   existing flashcards.html, opened with ?deck=<id>.
   ============================================================ */
import { auth } from "../firebase/firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  DECK_CATEGORIES,
  LIMITS,
  addCards,
  createDeck,
  deleteCard,
  deleteDeck,
  describeError,
  getDeck,
  listCards,
  listDeckProgress,
  listDecks,
  parseBulk,
  updateCard,
  updateDeck,
  validateCard,
  validateDeck,
} from "./customDecks.js";
import { icon } from "./icons.js";
import { plural } from "../utils/utils.js";
import { animateIfAllowed, prefersReducedMotion, stagger, stopAnimations } from "./motion.js";

// ---------- state ----------
let uid = null;
let decks = [];
let progressMap = {};
let currentDeck = null;
let cards = [];
let editingCardId = null;
let busy = false; // one write at a time; blocks duplicate submissions

// ---------- elements ----------
const $ = (id) => document.getElementById(id);
const libraryView = $("libraryView");
const libraryBody = $("libraryBody");
const decksFilters = $("decksFilters");
const deckSearch = $("deckSearch");
const deckFilter = $("deckFilter");
const editorView = $("editorView");
const cardList = $("cardList");
const cardsEmpty = $("cardsEmpty");
const live = $("decksLive");

const deckDialog = $("deckDialog");
const deckForm = $("deckForm");
const deckTitle = $("deckTitle");
const deckDescription = $("deckDescription");
const deckCategory = $("deckCategory");
const deckSaveBtn = $("deckSaveBtn");
const deckFormError = $("deckFormError");

const confirmDialog = $("confirmDialog");

const addCardForm = $("addCardForm");
const newFront = $("newFront");
const newBack = $("newBack");
const addCardBtn = $("addCardBtn");

const bulkPanel = $("bulkPanel");
const bulkToggleBtn = $("bulkToggleBtn");
const bulkInput = $("bulkInput");
const bulkPreview = $("bulkPreview");

// ---------- helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) {
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function toast(message, type = "success") {
  const stack = $("toastStack");
  const node = el("div", `toast toast-${type}`, message);
  node.setAttribute("role", type === "error" ? "alert" : "status");
  node.style.transition = "none"; // anime.js drives entry
  stack.appendChild(node);
  if (prefersReducedMotion()) node.classList.add("show");
  else {
    node.style.opacity = "0";
    void animateIfAllowed(node, { opacity: [0, 1], translateY: [10, 0], duration: 220, ease: "outCubic" });
  }
  setTimeout(() => {
    stopAnimations(node);
    if (prefersReducedMotion()) { node.remove(); return; }
    animateIfAllowed(node, { opacity: [1, 0], translateY: [0, 6], duration: 180, ease: "inCubic" })
      .finally(() => node.remove());
  }, type === "error" ? 5000 : 2600);
}

function setLoading(button, loading) {
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
  button.setAttribute("aria-busy", String(loading));
}

const TIMEOUT_MS = 15000;
/** Firestore keeps offline writes pending forever; fail fast so the user can retry. */
async function guarded(work) {
  if (!navigator.onLine) {
    const e = new Error("offline");
    e.code = "unavailable";
    throw e;
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error("timeout");
      e.code = "unavailable";
      reject(e);
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function fieldError(input, errorEl, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  errorEl.textContent = message || "";
}

function formatRelative(ts) {
  const date = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!date) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

// ---------- confirm dialog ----------
function confirmAction({ title, body, confirmLabel = "Delete", onConfirm }) {
  return new Promise((resolve) => {
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    $("confirmError").textContent = "";
    const ok = $("confirmOk");
    const cancel = $("confirmCancel");
    ok.textContent = confirmLabel;
    ok.className = confirmLabel === "Leave" || confirmLabel === "Discard" ? "btn btn-primary" : "btn btn-danger-solid";

    const finish = (result) => {
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      confirmDialog.removeEventListener("cancel", onEsc);
      if (confirmDialog.open) confirmDialog.close();
      resolve(result);
    };
    const onCancel = () => finish(false);
    const onEsc = (e) => { e.preventDefault(); if (!ok.disabled) finish(false); };
    const onOk = async () => {
      if (!onConfirm) { finish(true); return; }
      setLoading(ok, true);
      cancel.disabled = true;
      try {
        await onConfirm();
        finish(true);
      } catch (err) {
        $("confirmError").textContent = describeError(err);
      } finally {
        setLoading(ok, false);
        cancel.disabled = false;
      }
    };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    confirmDialog.addEventListener("cancel", onEsc);
    openDialog(confirmDialog, cancel);
  });
}

function openDialog(dialog, focusTarget) {
  dialog.showModal();
  focusTarget?.focus();
  void animateIfAllowed(dialog, { opacity: [0, 1], translateY: [8, 0], scale: [0.98, 1], duration: 200, ease: "outCubic" });
}

// ---------- unsaved changes ----------
function hasUnsavedChanges() {
  if (editorView.hidden) return false;
  if (newFront.value.trim() || newBack.value.trim()) return true;
  if (!bulkPanel.hidden && bulkInput.value.trim()) return true;
  if (editingCardId) {
    const card = cards.find((c) => c.id === editingCardId);
    const row = cardList.querySelector(`[data-id="${editingCardId}"]`);
    const f = row?.querySelector(".edit-front")?.value ?? "";
    const b = row?.querySelector(".edit-back")?.value ?? "";
    if (card && (f.trim() !== card.front || b.trim() !== card.back)) return true;
  }
  return false;
}

window.addEventListener("beforeunload", (e) => {
  if (hasUnsavedChanges() || busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function confirmLeave() {
  if (!hasUnsavedChanges()) return true;
  return confirmAction({
    title: "Leave without saving?",
    body: "You have card text that hasn't been added yet. If you leave now, it will be lost.",
    confirmLabel: "Leave",
  });
}

// ---------- routing ----------
function deckIdFromURL() {
  return new URLSearchParams(window.location.search).get("deck");
}

async function navigate(deckId, { push = true } = {}) {
  if (push) {
    const url = new URL(window.location);
    if (deckId) url.searchParams.set("deck", deckId);
    else url.searchParams.delete("deck");
    history.pushState({ deckId }, "", url);
  }
  if (deckId) await openEditor(deckId);
  else await showLibrary();
}

window.addEventListener("popstate", async () => {
  const target = deckIdFromURL();
  const leavingEditor = !editorView.hidden && target !== currentDeck?.id;
  if (leavingEditor && !(await confirmLeave())) {
    // stay put: restore the editor URL
    const url = new URL(window.location);
    url.searchParams.set("deck", currentDeck.id);
    history.pushState({ deckId: currentDeck.id }, "", url);
    return;
  }
  void navigate(target, { push: false });
});

// ============================================================
// LIBRARY
// ============================================================
function populateCategorySelects() {
  Object.entries(DECK_CATEGORIES).forEach(([value, label]) => {
    deckFilter.add(new Option(label, value));
    deckCategory.add(new Option(label, value));
  });
}

function renderLibraryState({ title, body, actionLabel, onAction, iconName = "layers" }) {
  libraryBody.replaceChildren();
  const box = el("div", "decks-state");
  const ic = el("span", "decks-state-icon");
  ic.innerHTML = icon(iconName, 26);
  box.append(ic, el("h2", "", title), el("p", "", body));
  if (actionLabel) {
    const btn = el("button", "btn btn-primary", actionLabel);
    btn.type = "button";
    btn.addEventListener("click", onAction);
    box.append(btn);
  }
  libraryBody.append(box);
  void animateIfAllowed(box, { opacity: [0, 1], translateY: [8, 0], duration: 240, ease: "outCubic" });
}

async function showLibrary() {
  document.title = "My Decks | NursePrep";
  editorView.hidden = true;
  libraryView.hidden = false;
  currentDeck = null;
  cards = [];
  editingCardId = null;
  await loadLibrary();
}

async function loadLibrary() {
  libraryBody.setAttribute("aria-busy", "true");
  libraryBody.innerHTML = `<div class="deck-grid" aria-hidden="true">${'<div class="deck-card is-skeleton"></div>'.repeat(3)}</div>`;
  try {
    [decks, progressMap] = await guarded(() => Promise.all([listDecks(uid), listDeckProgress(uid)]));
    renderLibrary();
  } catch (err) {
    console.error("Failed to load decks:", err);
    decksFilters.hidden = true;
    renderLibraryState({
      title: "Couldn't load your decks",
      body: describeError(err).replace("saving", "loading"),
      actionLabel: "Try again",
      onAction: () => void loadLibrary(),
      iconName: "alert",
    });
  } finally {
    libraryBody.setAttribute("aria-busy", "false");
  }
}

function renderLibrary({ animate = true } = {}) {
  stopAnimations(libraryBody.querySelectorAll(".deck-card"));

  if (!decks.length) {
    decksFilters.hidden = true;
    renderLibraryState({
      title: "Create your first deck",
      body: "Turn your own review notes into flashcards. Your decks are private and you can study them with the same tools as the NursePrep decks.",
      actionLabel: "Create your first deck",
      onAction: () => openDeckDialog("create"),
    });
    return;
  }

  decksFilters.hidden = false;
  const q = deckSearch.value.trim().toLowerCase();
  const cat = deckFilter.value;
  const visible = decks.filter((d) =>
    (!cat || d.category === cat) &&
    (!q || d.title.toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q)));

  libraryBody.replaceChildren();
  if (!visible.length) {
    libraryBody.append(el("p", "no-results", "No decks match your search."));
    return;
  }

  const grid = el("ul", "deck-grid");
  visible.forEach((d) => grid.append(deckCard(d)));
  libraryBody.append(grid);

  if (animate) {
    void animateIfAllowed(grid.children, {
      opacity: [0, 1], translateY: [12, 0], delay: stagger(40, { start: 0 }), duration: 260, ease: "outCubic",
    });
    const bars = grid.querySelectorAll(".deck-progress span");
    bars.forEach((bar) => {
      const p = bar.dataset.p;
      if (prefersReducedMotion()) { bar.style.setProperty("--p", p); return; }
      void animateIfAllowed(bar, { scaleX: [0, Number(p)], duration: 420, delay: 120, ease: "outCubic" })
        .then(() => bar.style.setProperty("--p", p));
    });
  }
}

function deckCard(d) {
  const li = el("li", "deck-card");
  const progress = progressMap[d.id] || {};
  const masteredCount = Math.min(d.cardCount || 0, (progress.mastered || []).length);
  const pct = d.cardCount ? masteredCount / d.cardCount : 0;

  li.append(el("span", "deck-category", DECK_CATEGORIES[d.category] || "Deck"));
  li.append(el("h2", "deck-title", d.title));
  if (d.description) li.append(el("p", "deck-description", d.description));

  const stats = el("div", "deck-stats");
  const left = el("span");
  const countStrong = el("strong", "", String(d.cardCount || 0));
  left.append(countStrong, ` ${d.cardCount === 1 ? "card" : "cards"}`);
  const right = el("span", "", progress.lastStudiedAt
    ? `${masteredCount} mastered · studied ${formatRelative(progress.lastStudiedAt)}`
    : "Not studied yet");
  stats.append(left, right);
  li.append(stats);

  const bar = el("div", "deck-progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", `${d.title}: ${Math.round(pct * 100)}% mastered`);
  bar.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("span");
  fill.dataset.p = pct.toFixed(3);
  if (prefersReducedMotion()) fill.style.setProperty("--p", fill.dataset.p);
  bar.append(fill);
  li.append(bar);

  const actions = el("div", "deck-actions");
  if (d.cardCount > 0) {
    const study = el("a", "btn btn-primary btn-sm", "Study");
    study.href = `flashcards.html?deck=${encodeURIComponent(d.id)}`;
    study.setAttribute("aria-label", `Study ${d.title}`);
    actions.append(study);
  }
  const edit = el("button", `btn ${d.cardCount > 0 ? "btn-secondary" : "btn-primary"} btn-sm`, d.cardCount > 0 ? "Edit" : "Add cards");
  edit.type = "button";
  edit.setAttribute("aria-label", `${d.cardCount > 0 ? "Edit" : "Add cards to"} ${d.title}`);
  edit.addEventListener("click", () => void navigate(d.id));
  const del = el("button", "icon-btn danger");
  del.type = "button";
  del.setAttribute("aria-label", `Delete ${d.title}`);
  del.title = "Delete deck";
  del.innerHTML = icon("trash", 18);
  del.addEventListener("click", () => void confirmDeleteDeck(d));
  actions.append(edit, del);
  li.append(actions);
  return li;
}

async function confirmDeleteDeck(d) {
  const deleted = await confirmAction({
    title: "Delete this deck?",
    body: `"${d.title}" and its ${plural(d.cardCount || 0, "card")} will be permanently deleted, along with your study progress. This can't be undone.`,
    confirmLabel: "Delete deck",
    onConfirm: () => guarded(() => deleteDeck(uid, d.id)),
  });
  if (!deleted) return;
  decks = decks.filter((x) => x.id !== d.id);
  delete progressMap[d.id];
  toast(`Deleted "${d.title}"`);
  announce("Deck deleted");
  if (currentDeck?.id === d.id) await navigate(null);
  else renderLibrary({ animate: false });
  $("newDeckBtn").focus();
}

deckSearch.addEventListener("input", () => renderLibrary({ animate: false }));
deckFilter.addEventListener("change", () => renderLibrary());

// ============================================================
// CREATE / EDIT DECK DIALOG
// ============================================================
let dialogMode = "create";
let dialogInitial = null;

function openDeckDialog(mode) {
  dialogMode = mode;
  const deck = mode === "edit" ? currentDeck : null;
  $("deckDialogTitle").textContent = mode === "edit" ? "Edit deck details" : "New deck";
  deckSaveBtn.textContent = mode === "edit" ? "Save changes" : "Create deck";
  deckTitle.value = deck?.title || "";
  deckDescription.value = deck?.description || "";
  deckCategory.value = deck?.category || deckFilter.value || "fundamentals";
  dialogInitial = { title: deckTitle.value, description: deckDescription.value, category: deckCategory.value };
  [["deckTitle", "deckTitleError"], ["deckDescription", "deckDescriptionError"], ["deckCategory", "deckCategoryError"]]
    .forEach(([i, e]) => fieldError($(i), $(e), ""));
  deckFormError.textContent = "";
  openDialog(deckDialog, deckTitle);
}

function deckDialogDirty() {
  return dialogInitial && (deckTitle.value !== dialogInitial.title ||
    deckDescription.value !== dialogInitial.description || deckCategory.value !== dialogInitial.category);
}

async function closeDeckDialog() {
  if (busy) return;
  if (deckDialogDirty()) {
    const discard = await confirmAction({
      title: "Discard changes?",
      body: "What you typed in this form will be lost.",
      confirmLabel: "Discard",
    });
    if (!discard) { deckTitle.focus(); return; }
  }
  deckDialog.close();
}

$("deckCancelBtn").addEventListener("click", () => void closeDeckDialog());
deckDialog.addEventListener("cancel", (e) => { e.preventDefault(); void closeDeckDialog(); });

deckForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const input = { title: deckTitle.value, description: deckDescription.value, category: deckCategory.value };
  const errors = validateDeck(input);
  fieldError(deckTitle, $("deckTitleError"), errors.title);
  fieldError(deckDescription, $("deckDescriptionError"), errors.description);
  fieldError(deckCategory, $("deckCategoryError"), errors.category);
  deckFormError.textContent = "";
  if (Object.keys(errors).length) {
    (errors.title ? deckTitle : errors.description ? deckDescription : deckCategory).focus();
    return;
  }

  busy = true;
  setLoading(deckSaveBtn, true);
  try {
    if (dialogMode === "edit") {
      await guarded(() => updateDeck(uid, currentDeck.id, input));
      Object.assign(currentDeck, { title: input.title.trim(), description: input.description.trim(), category: input.category });
      renderEditorHeader();
      dialogInitial = null;
      deckDialog.close();
      toast("Deck details saved");
    } else {
      const id = await guarded(() => createDeck(uid, input));
      dialogInitial = null;
      deckDialog.close();
      toast(`Created "${input.title.trim()}"`);
      await navigate(id);
      newFront.focus();
    }
  } catch (err) {
    console.error("Deck save failed:", err);
    deckFormError.textContent = describeError(err);
  } finally {
    busy = false;
    setLoading(deckSaveBtn, false);
  }
});

$("newDeckBtn").addEventListener("click", () => openDeckDialog("create"));
$("editDetailsBtn").addEventListener("click", () => openDeckDialog("edit"));

// ============================================================
// EDITOR
// ============================================================
function renderEditorHeader() {
  $("editorHeading").textContent = currentDeck.title;
  document.title = `${currentDeck.title} | My Decks | NursePrep`;
  $("editorCategory").textContent = DECK_CATEGORIES[currentDeck.category] || "Deck";
  updateCount();
}

function updateCount() {
  currentDeck.cardCount = cards.length;
  $("editorCount").textContent = plural(cards.length, "card");
  const study = $("studyDeckBtn");
  study.href = `flashcards.html?deck=${encodeURIComponent(currentDeck.id)}`;
  study.setAttribute("aria-disabled", String(cards.length === 0));
  study.classList.toggle("is-disabled", cards.length === 0);
  cardsEmpty.hidden = cards.length > 0;
  const idx = decks.findIndex((d) => d.id === currentDeck.id);
  if (idx >= 0) decks[idx] = { ...decks[idx], ...currentDeck };
}

$("studyDeckBtn").addEventListener("click", (e) => {
  if (cards.length === 0) {
    e.preventDefault();
    announce("Add at least one card before studying this deck.");
    newFront.focus();
  }
});

async function openEditor(deckId) {
  libraryView.hidden = true;
  editorView.hidden = false;
  editorView.setAttribute("aria-busy", "true");
  $("editorHeading").textContent = "Loading deck…";
  $("editorCategory").textContent = "";
  $("editorCount").textContent = "";
  cardList.replaceChildren();
  cardsEmpty.hidden = true;
  editingCardId = null;
  resetAddForm();
  closeBulk();
  try {
    const [deck, deckCards] = await guarded(() => Promise.all([getDeck(uid, deckId), listCards(uid, deckId)]));
    currentDeck = deck;
    cards = deckCards;
    renderEditorHeader();
    renderCards();
    void animateIfAllowed(editorView, { opacity: [0, 1], translateY: [8, 0], duration: 240, ease: "outCubic" });
  } catch (err) {
    console.error("Failed to open deck:", err);
    currentDeck = null;
    $("editorHeading").textContent = err.code === "not-found" ? "Deck not found" : "Couldn't open this deck";
    cardsEmpty.hidden = false;
    cardsEmpty.textContent = err.code === "not-found"
      ? "This deck may have been deleted. Go back to My decks to see your other decks."
      : describeError(err).replace("saving", "loading");
  } finally {
    editorView.setAttribute("aria-busy", "false");
  }
}

function renderCards() {
  stopAnimations(cardList.children);
  cardList.replaceChildren(...cards.map((c, i) => cardRow(c, i)));
  updateCount();
}

function cardRow(card, index) {
  const li = el("li", "card-row");
  li.dataset.id = card.id;
  li.append(el("span", "card-num", String(index + 1)));

  const front = el("div", "card-side");
  front.append(el("span", "card-side-label", "Front"), el("p", "card-side-text", card.front));
  const back = el("div", "card-side back");
  back.append(el("span", "card-side-label", "Back"), el("p", "card-side-text back", card.back));

  const actions = el("div", "card-row-actions");
  const edit = el("button", "icon-btn");
  edit.type = "button";
  edit.innerHTML = icon("pencil", 16);
  edit.setAttribute("aria-label", `Edit card ${index + 1}`);
  edit.addEventListener("click", () => void startEdit(card.id));
  const del = el("button", "icon-btn danger");
  del.type = "button";
  del.innerHTML = icon("trash", 16);
  del.setAttribute("aria-label", `Delete card ${index + 1}`);
  del.addEventListener("click", () => void confirmDeleteCard(card.id));
  actions.append(edit, del);

  li.append(front, back, actions);
  return li;
}

// ----- add card -----
function resetAddForm() {
  newFront.value = "";
  newBack.value = "";
  fieldError(newFront, $("newFrontError"), "");
  fieldError(newBack, $("newBackError"), "");
}

async function addCardFromForm() {
  if (busy || !currentDeck) return;
  const input = { front: newFront.value, back: newBack.value };
  const errors = validateCard(input);
  fieldError(newFront, $("newFrontError"), errors.front);
  fieldError(newBack, $("newBackError"), errors.back);
  if (errors.front) { newFront.focus(); return; }
  if (errors.back) { newBack.focus(); return; }

  busy = true;
  setLoading(addCardBtn, true);
  try {
    const [created] = await guarded(() => addCards(uid, currentDeck.id, [input], { currentCount: cards.length }));
    cards.push(created);
    const row = cardRow(created, cards.length - 1);
    row.classList.add("is-new");
    cardList.append(row);
    updateCount();
    resetAddForm();
    newFront.focus();
    announce(`Card ${cards.length} added`);
    void animateIfAllowed(row, { opacity: [0, 1], translateY: [10, 0], duration: 240, ease: "outCubic" })
      .then(() => setTimeout(() => row.classList.remove("is-new"), 1200));
  } catch (err) {
    console.error("Add card failed:", err);
    toast(describeError(err), "error");
  } finally {
    busy = false;
    setLoading(addCardBtn, false);
  }
}

addCardForm.addEventListener("submit", (e) => { e.preventDefault(); void addCardFromForm(); });
newFront.addEventListener("input", () => fieldError(newFront, $("newFrontError"), ""));
newBack.addEventListener("input", () => fieldError(newBack, $("newBackError"), ""));
[newFront, newBack].forEach((ta) => ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void addCardFromForm();
  }
}));

// ----- edit card -----
async function startEdit(cardId) {
  if (busy) return;
  if (editingCardId && editingCardId !== cardId && !(await cancelEdit())) return;
  const card = cards.find((c) => c.id === cardId);
  const row = cardList.querySelector(`[data-id="${cardId}"]`);
  if (!card || !row) return;
  editingCardId = cardId;
  const index = cards.indexOf(card);
  row.classList.add("is-editing");
  row.replaceChildren(el("span", "card-num", String(index + 1)));

  const form = el("form", "card-edit-form");
  form.noValidate = true;
  form.innerHTML = `
    <div class="card-fields">
      <div class="field">
        <label class="field-label" for="editFront-${cardId}">Front</label>
        <textarea class="textarea edit-front" id="editFront-${cardId}" rows="3" maxlength="${LIMITS.front}" aria-describedby="editFrontErr-${cardId}"></textarea>
        <span class="field-error" id="editFrontErr-${cardId}"></span>
      </div>
      <div class="field">
        <label class="field-label" for="editBack-${cardId}">Back</label>
        <textarea class="textarea edit-back" id="editBack-${cardId}" rows="3" maxlength="${LIMITS.back}" aria-describedby="editBackErr-${cardId}"></textarea>
        <span class="field-error" id="editBackErr-${cardId}"></span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-act="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" type="submit">Save card</button>
    </div>`;
  row.append(form);
  const f = form.querySelector(".edit-front");
  const b = form.querySelector(".edit-back");
  f.value = card.front;
  b.value = card.back;
  f.focus();

  form.querySelector('[data-act="cancel"]').addEventListener("click", () => void cancelEdit());
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); void cancelEdit(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const input = { front: f.value, back: b.value };
    const errors = validateCard(input);
    fieldError(f, form.querySelector(`#editFrontErr-${cardId}`), errors.front);
    fieldError(b, form.querySelector(`#editBackErr-${cardId}`), errors.back);
    if (errors.front || errors.back) { (errors.front ? f : b).focus(); return; }
    const saveBtn = form.querySelector('[type="submit"]');
    busy = true;
    setLoading(saveBtn, true);
    try {
      await guarded(() => updateCard(uid, currentDeck.id, cardId, input));
      card.front = input.front.trim();
      card.back = input.back.trim();
      editingCardId = null;
      const fresh = cardRow(card, index);
      row.replaceWith(fresh);
      fresh.querySelector('[aria-label^="Edit"]').focus();
      toast("Card saved");
    } catch (err) {
      console.error("Update card failed:", err);
      toast(describeError(err), "error");
    } finally {
      busy = false;
      setLoading(saveBtn, false);
    }
  });
}

/** Returns false if the user chose to keep editing. */
async function cancelEdit() {
  if (!editingCardId) return true;
  const card = cards.find((c) => c.id === editingCardId);
  const row = cardList.querySelector(`[data-id="${editingCardId}"]`);
  const f = row?.querySelector(".edit-front")?.value ?? "";
  const b = row?.querySelector(".edit-back")?.value ?? "";
  if (card && (f.trim() !== card.front || b.trim() !== card.back)) {
    const discard = await confirmAction({
      title: "Discard your edits?",
      body: "Changes to this card haven't been saved.",
      confirmLabel: "Discard",
    });
    if (!discard) { row?.querySelector(".edit-front")?.focus(); return false; }
  }
  const index = cards.indexOf(card);
  editingCardId = null;
  if (row && card) {
    const fresh = cardRow(card, index);
    row.replaceWith(fresh);
    fresh.querySelector('[aria-label^="Edit"]').focus();
  }
  return true;
}

// ----- delete card -----
async function confirmDeleteCard(cardId) {
  if (busy) return;
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;
  const excerpt = card.front.length > 90 ? `${card.front.slice(0, 90)}…` : card.front;
  const deleted = await confirmAction({
    title: "Delete this card?",
    body: `"${excerpt}" will be removed from this deck. This can't be undone.`,
    confirmLabel: "Delete card",
    onConfirm: () => guarded(() => deleteCard(uid, currentDeck.id, cardId)),
  });
  if (!deleted) return;
  const row = cardList.querySelector(`[data-id="${cardId}"]`);
  const nextFocus = row?.nextElementSibling || row?.previousElementSibling;
  cards = cards.filter((c) => c.id !== cardId);
  if (editingCardId === cardId) editingCardId = null;
  const finish = () => {
    renderCards();
    const target = nextFocus && cardList.querySelector(`[data-id="${nextFocus.dataset.id}"] [aria-label^="Edit"]`);
    (target || newFront).focus();
  };
  if (row && !prefersReducedMotion()) {
    animateIfAllowed(row, { opacity: [1, 0], translateX: [0, -12], duration: 180, ease: "inCubic" }).finally(finish);
  } else finish();
  toast("Card deleted");
}

// ----- bulk import -----
let parsedBulk = null;

function closeBulk() {
  bulkPanel.hidden = true;
  bulkToggleBtn.setAttribute("aria-expanded", "false");
  bulkInput.value = "";
  bulkPreview.replaceChildren();
  parsedBulk = null;
}

bulkToggleBtn.addEventListener("click", () => {
  const opening = bulkPanel.hidden;
  if (!opening) { closeBulk(); return; }
  bulkPanel.hidden = false;
  bulkToggleBtn.setAttribute("aria-expanded", "true");
  bulkInput.focus();
  void animateIfAllowed(bulkPanel, { opacity: [0, 1], translateY: [6, 0], duration: 200, ease: "outCubic" });
});

$("bulkCancelBtn").addEventListener("click", async () => {
  if (bulkInput.value.trim()) {
    const discard = await confirmAction({ title: "Discard pasted cards?", body: "The text you pasted will be cleared.", confirmLabel: "Discard" });
    if (!discard) return;
  }
  closeBulk();
  bulkToggleBtn.focus();
});

bulkInput.addEventListener("input", () => {
  if (parsedBulk) { parsedBulk = null; bulkPreview.replaceChildren(); }
});

$("bulkPreviewBtn").addEventListener("click", () => {
  bulkPreview.replaceChildren();
  if (!bulkInput.value.trim()) {
    bulkPreview.append(el("p", "bulk-summary", "Paste at least one card in the box above."));
    bulkInput.focus();
    return;
  }
  parsedBulk = parseBulk(bulkInput.value);
  const { cards: ready, problems } = parsedBulk;
  const room = LIMITS.cardsPerDeck - cards.length;

  const summary = el("p", "bulk-summary");
  summary.textContent = problems.length
    ? `${plural(ready.length, "card")} ready. ${plural(problems.length, "entry", "entries")} need fixing; they'll stay in the box so you can correct them.`
    : `${plural(ready.length, "card")} ready to add.`;
  bulkPreview.append(summary);

  problems.forEach((p) => {
    const box = el("div", "bulk-problem");
    box.append(el("p", "", `Line ${p.line}: ${p.message}`));
    box.append(el("pre", "", p.text));
    bulkPreview.append(box);
  });

  if (ready.length) {
    const list = el("ul", "bulk-list");
    ready.forEach((c) => {
      const li = el("li");
      li.append(el("span", "bulk-front", c.front), el("span", "bulk-back", c.back));
      list.append(li);
    });
    bulkPreview.append(list);

    const actions = el("div", "form-actions");
    const add = el("button", "btn btn-primary", ready.length > room ? `Deck limit is ${LIMITS.cardsPerDeck} cards` : `Add ${plural(ready.length, "card")}`);
    add.type = "button";
    add.disabled = ready.length > room;
    add.addEventListener("click", () => void addBulk(add));
    actions.append(add);
    bulkPreview.append(actions);
  }
  announce(summary.textContent);
});

async function addBulk(button) {
  if (busy || !parsedBulk?.cards.length) return;
  busy = true;
  setLoading(button, true);
  try {
    const created = await guarded(() => addCards(uid, currentDeck.id, parsedBulk.cards, { currentCount: cards.length }));
    const startIndex = cards.length;
    cards.push(...created);
    const rows = created.map((c, i) => {
      const r = cardRow(c, startIndex + i);
      r.classList.add("is-new");
      return r;
    });
    cardList.append(...rows);
    updateCount();
    void animateIfAllowed(rows, { opacity: [0, 1], translateY: [10, 0], delay: stagger(25), duration: 220, ease: "outCubic" })
      .then(() => setTimeout(() => rows.forEach((r) => r.classList.remove("is-new")), 1200));

    const leftovers = parsedBulk.problems.map((p) => p.text).join("\n\n");
    toast(`Added ${plural(created.length, "card")}`);
    if (leftovers) {
      bulkInput.value = leftovers;
      parsedBulk = null;
      bulkPreview.replaceChildren(el("p", "bulk-summary", "The entries that need fixing are still in the box. Correct them and preview again."));
      bulkInput.focus();
    } else {
      closeBulk();
      bulkToggleBtn.focus();
    }
  } catch (err) {
    console.error("Bulk add failed:", err);
    toast(describeError(err), "error");
  } finally {
    busy = false;
    setLoading(button, false);
  }
}

// ----- back link -----
$("backToLibrary").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!(await confirmLeave())) return;
  resetAddForm();
  closeBulk();
  editingCardId = null;
  await navigate(null);
  $("newDeckBtn").focus();
});

// ---------- offline banner ----------
function syncOnline() { $("offlineBanner").hidden = navigator.onLine; }
window.addEventListener("online", syncOnline);
window.addEventListener("offline", syncOnline);

// ---------- boot ----------
populateCategorySelects();
syncOnline();

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  if (uid === user.uid) return;
  uid = user.uid;
  void navigate(deckIdFromURL(), { push: false });
});

import { analyzeText } from "./ai.js";

const board = document.getElementById("board");
const homeView = document.querySelector('[data-view="home"]');
const inputView = document.querySelector('[data-view="input"]');
const resultView = document.querySelector('[data-view="result"]');
const stickyView = document.querySelector('[data-view="sticky-notes"]');
const noteTitleHeader = document.getElementById("noteTitleHeader");
const resultTitle = document.getElementById("resultTitle");
const backToHomeBtn = document.getElementById("backToHomeBtn");
const stickyTabBtn = document.getElementById("stickyTabBtn");
const teamTabBtn = document.getElementById("teamTabBtn");
const discussionTabBtn = document.getElementById("discussionTabBtn");
const savedNotesList = document.getElementById("savedNotesList");
const stickyBackBtn = document.getElementById("stickyBackBtn");
const teamBackBtn = document.getElementById("teamBackBtn");
const teamList = document.getElementById("teamList");
const addMemberBtn = document.getElementById("addMemberBtn");
const teamModal = document.getElementById("teamModal");
const teamForm = document.getElementById("teamForm");
const teamSubmitBtn = teamForm?.querySelector('button[type="submit"]');
const memberNameInput = document.getElementById("memberName");
const memberEmailInput = document.getElementById("memberEmail");
const memberRoleInput = document.getElementById("memberRole");
const memberIsLeadInput = document.getElementById("memberIsLead");
const teamCancelBtn = document.getElementById("teamCancelBtn");

// Confirm modal elements
const confirmModal = document.getElementById("confirmModal");
const confirmMessage = document.getElementById("confirmMessage");
const confirmOkBtn = document.getElementById("confirmOkBtn");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
let confirmCallback = null;

// Step flow elements
const createNoteBtn = document.getElementById("createNoteBtn");
const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const nameCancelBtn = document.getElementById("nameCancelBtn");
const nameContinueBtn = document.getElementById("nameContinueBtn");
const contentStep = document.getElementById("contentStep");
const contentInput = document.getElementById("contentInput");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const contentStepTitle = document.getElementById("contentStepTitle");
const finalizeNoteBtn = document.getElementById("finalizeNoteBtn");

let currentNoteName = "";
let selectedFiles = [];
const LOCAL_DB_KEY = "sticky_notes_db";
const TEAM_DB_KEY = "team_store";
let currentView = document.querySelector('.view.active')?.getAttribute('data-view') || "home";
let previousView = null;
let entryView = null; // Track which view opened result-view
const viewHistory = [currentView];

const TYPE_ORDER = ["task", "decision", "question"];
const TYPE_LABELS = {
  task: "Tasks",
  decision: "Decisions",
  question: "Questions"
};

const teamStore = {
  members: [],
  load() {
    try {
      const raw = localStorage.getItem(TEAM_DB_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  },
  persist() {
    try {
      localStorage.setItem(TEAM_DB_KEY, JSON.stringify(this.members));
    } catch (_e) {
      /* no-op */
    }
  },
  init() {
    this.members = this.load();
    return this.members;
  },
  getMembers() {
    return [...this.members];
  },
  addMember(member) {
    const payload = {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: member.name?.trim() || "Unnamed",
      email: member.email?.trim() || "",
      role: member.role?.trim() || "",
      isLead: Boolean(member.isLead)
    };

    if (payload.isLead) {
      this.members = this.members.map((m) => ({ ...m, isLead: false }));
    }

    this.members.push(payload);
    this.persist();
    return payload;
  },
  setLead(id) {
    this.members = this.members.map((m) => ({ ...m, isLead: m.id === id }));
    this.persist();
  },
  removeMember(id) {
    this.members = this.members.filter((m) => m.id !== id);
    this.persist();
  },
  clearIfCorrupt() {
    if (!Array.isArray(this.members)) {
      this.members = [];
      this.persist();
    }
  }
};

function updateViewClasses() {
  const views = document.querySelectorAll('[data-view]');
  views.forEach((v) => {
    const isMatch = v.getAttribute('data-view') === currentView;
    v.classList.toggle('active', isMatch);
    v.setAttribute('aria-hidden', (!isMatch).toString());
  });
}

function updateBackVisibility() {
  // Show back button based on current view rules
  const showBack = currentView !== "home";
  [backToHomeBtn, stickyBackBtn].forEach((btn) => {
    if (!btn) return;
    btn.style.display = showBack ? "inline-flex" : "none";
  });
}

function setActiveNav(tabId) {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.id === tabId);
  });
}

/**
 * Centralized navigation helper to keep state/history in sync.
 * @param {"home"|"sticky-notes"|"input"|"result"} target
 * @param {{ replaceHistory?: boolean; entrySource?: string }} options
 */
function navigateTo(target, options = {}) {
  const { replaceHistory = false, entrySource } = options;
  if (!target) return;

  // If we are replacing the top of the stack (e.g., back from result), drop it first
  if (replaceHistory && viewHistory.length) {
    viewHistory.pop();
  }

  const nextIsSame = currentView === target && !replaceHistory;
  if (nextIsSame) {
    updateViewClasses();
    updateBackVisibility();
    return;
  }

  const prev = currentView;
  previousView = prev;
  currentView = target;

  // Close any open modals when navigating away from team view
  if (prev === "team" && target !== "team") {
    const teamModal = document.getElementById("teamModal");
    const confirmModal = document.getElementById("confirmModal");
    if (teamModal) teamModal.classList.remove("show");
    if (confirmModal) confirmModal.classList.remove("show");
  }

  // Track entry for result view so back knows where to go
  if (target === "result") {
    entryView = entrySource || prev || "home";
  }

  // Avoid duplicate entries when replacing or navigating to same top view
  const last = viewHistory[viewHistory.length - 1];
  if (last !== target) {
    viewHistory.push(target);
  }

  updateViewClasses();
  updateBackVisibility();
}

function goBack() {
  // From result-view, jump back to entryView (sticky-notes or input/home)
  if (currentView === "result") {
    const destination = entryView || previousView || "home";
    entryView = null;
    navigateTo(destination, { replaceHistory: true });
    return;
  }

  // Nothing to do from home
  if (currentView === "home") return;

  // Standard history pop
  if (viewHistory.length > 1) {
    viewHistory.pop();
    currentView = viewHistory[viewHistory.length - 1];
    previousView = viewHistory.length > 1 ? viewHistory[viewHistory.length - 2] : null;
    updateViewClasses();
    updateBackVisibility();
  }
}

function setNoteTitle(name) {
  currentNoteName = name || "Untitled note";
  contentStepTitle.textContent = currentNoteName;
  noteTitleHeader.textContent = currentNoteName;
  resultTitle.textContent = currentNoteName;
}

function getAllNotes() {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to read saved notes", e);
    return [];
  }
}

function saveAllNotes(notes) {
  try {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(notes));
  } catch (e) {
    console.warn("Failed to write notes", e);
  }
}

function saveNewNote(title, stickyNotes) {
  const notes = getAllNotes();
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const payload = {
    id,
    title,
    createdAt: new Date().toISOString(),
    stickyNotes: (stickyNotes || []).map((n) => JSON.stringify(n))
  };
  notes.unshift(payload);
  saveAllNotes(notes);
  return payload;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch (_e) {
    return "";
  }
}

function openTeamModal() {
  console.log("Opening team modal");
  if (!teamModal) {
    console.error("Team modal element not found!");
    return;
  }
  teamModal.classList.add("show");
  teamModal.setAttribute("aria-hidden", "false");
  console.log("Modal classes after open:", teamModal.className);
  setTimeout(() => memberNameInput?.focus(), 60);
}

function closeTeamModal() {
  console.log("Attempting to close modal");
  if (!teamModal) {
    console.warn("Modal element not found");
    return;
  }
  teamModal.classList.remove("show");
  teamModal.setAttribute("aria-hidden", "true");
  console.log("Modal closed");

  if (teamForm) {
    teamForm.reset();
    console.log("Form reset");
  }
  if (memberIsLeadInput) {
    memberIsLeadInput.checked = false;
    console.log("Lead checkbox reset");
  }
}

function showConfirmDialog(message, onConfirm) {
  if (!confirmModal) return;
  
  // Close any other open modals first
  if (teamModal && teamModal.classList.contains("show")) {
    closeTeamModal();
  }
  if (nameModal && nameModal.classList.contains("show")) {
    nameModal.classList.remove("show");
    nameModal.setAttribute("aria-hidden", "true");
  }
  
  confirmMessage.textContent = message;
  confirmCallback = onConfirm;
  confirmModal.classList.add("show");
  confirmModal.setAttribute("aria-hidden", "false");
}

function closeConfirmDialog() {
  if (!confirmModal) return;
  confirmModal.classList.remove("show");
  confirmModal.setAttribute("aria-hidden", "true");
  confirmCallback = null;
}

function renderTeamList() {
  console.log("Rendering team list");
  if (!teamList) {
    console.warn("Team list element not found");
    return;
  }
  teamList.replaceChildren();

  const members = teamStore.getMembers();
  console.log("Current team members:", members);
  
  if (!members.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "team-empty-state";
    emptyState.innerHTML = `<p>No team members yet.<br>Click "+ Add" to get started.</p>`;
    teamList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "team-row";

    // Info container (name + email)
    const info = document.createElement("div");
    info.className = "team-info";

    const nameEl = document.createElement("div");
    nameEl.className = "team-name";
    nameEl.textContent = member.name || "Unnamed";

    const emailEl = document.createElement("div");
    emailEl.className = "team-email";
    emailEl.textContent = member.email || "";

    info.appendChild(nameEl);
    info.appendChild(emailEl);

    // Action area (Lead label OR Make Lead action + Remove button)
    const action = document.createElement("div");
    action.className = "team-action";

    const actionGroup = document.createElement("div");
    actionGroup.className = "team-action-group";

    if (member.isLead) {
      const leadLabel = document.createElement("span");
      leadLabel.className = "lead-label";
      leadLabel.textContent = "Lead";
      actionGroup.appendChild(leadLabel);
    } else {
      const makeLeadBtn = document.createElement("button");
      makeLeadBtn.type = "button";
      makeLeadBtn.className = "make-lead-action";
      makeLeadBtn.textContent = "Make Lead";
      makeLeadBtn.onclick = () => {
        teamStore.setLead(member.id);
        renderTeamList();
      };
      actionGroup.appendChild(makeLeadBtn);
    }

    // Remove button (always shown)
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-member-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove member";
    removeBtn.setAttribute("aria-label", `Remove ${member.name}`);
    removeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Remove button clicked for:", member.name);
      
      showConfirmDialog(`Remove ${member.name} from the team?`, () => {
        console.log("Removing member:", member.id);
        teamStore.removeMember(member.id);
        console.log("Members after removal:", teamStore.getMembers());
        renderTeamList();
      });
    };

    action.appendChild(actionGroup);
    action.appendChild(removeBtn);
    console.log("Remove button added for:", member.name);

    row.appendChild(info);
    row.appendChild(action);
    fragment.appendChild(row);
  });

  teamList.appendChild(fragment);
  console.log("Team list rendered successfully");
}

function renderSavedNotesList(notes) {
  if (!savedNotesList) return;
  savedNotesList.replaceChildren();

  if (!notes.length) {
    savedNotesList.appendChild(document.createTextNode("No saved notes yet."));
    return;
  }

  const fragment = document.createDocumentFragment();
  notes.forEach((note) => {
    const card = document.createElement("div");
    card.className = "saved-note-card";
    card.onclick = () => openNote(note.id);

    const titleEl = document.createElement("p");
    titleEl.className = "saved-note-title";
    titleEl.textContent = note.title || "Untitled";

    const metaEl = document.createElement("p");
    metaEl.className = "saved-note-meta";
    metaEl.textContent = formatDate(note.createdAt);

    card.appendChild(titleEl);
    card.appendChild(metaEl);
    fragment.appendChild(card);
  });

  savedNotesList.appendChild(fragment);
}

function loadSavedNotes() {
  const notes = getAllNotes();
  renderSavedNotesList(notes);
}

function openNote(noteId) {
  const notes = getAllNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  setNoteTitle(note.title || "Untitled note");
  const parsedNotes = (note.stickyNotes || []).map((s) => {
    try {
      const obj = JSON.parse(s);
      return obj && obj.type && obj.text ? obj : { type: "task", text: String(s) };
    } catch (_e) {
      return { type: "task", text: String(s) };
    }
  });

    navigateTo("result", { entrySource: "sticky-notes" });
  renderStructuredNotes(parsedNotes);
}

// ============================================
// Page/Slide Metadata Management
// ============================================

/**
 * Mock function to get current page/slide number
 * TODO: Replace with actual Express Document API call
 * Future: await document.getCurrentPage() or document.getCurrentSlide()
 * 
 * @returns {Object} Object with pageNumber and documentType
 */
function getCurrentPageInfo() {
  // Mock implementation - returns current page/slide number
  // In future, this will call: document.getCurrentPage() or document.getCurrentSlide()
  return {
    pageNumber: 1, // Mock: always returns page 1 for now
    documentType: 'page' // 'page' for pages, 'slide' for slides
  };
  
  // Future Express API integration example:
  // const document = await addonSdk.document.getDocument();
  // const currentPage = await document.getCurrentPage();
  // return {
  //   pageNumber: currentPage.index + 1, // 1-indexed for display
  //   documentType: document.type === 'presentation' ? 'slide' : 'page'
  // };
}

/**
 * Data model for sticky notes
 * Extensible structure for future Express Document API integration
 * 
 * @typedef {Object} NoteMetadata
 * @property {number} pageNumber - The page/slide number (1-indexed)
 * @property {string} documentType - 'page' or 'slide'
 * @property {string} [pageId] - Future: Express document page ID
 * @property {Object} [pageBounds] - Future: Bounds of the page in document coordinates
 */

/**
 * Applies page/slide metadata to a note element
 * Stores metadata in data attributes for future Express API integration
 * 
 * @param {HTMLElement} noteElement - The sticky note element
 * @param {NoteMetadata} metadata - Page/slide metadata
 */
function applyNoteMetadata(noteElement, metadata) {
  // Store metadata in data attributes for future Express API integration
  noteElement.setAttribute('data-page-number', metadata.pageNumber.toString());
  noteElement.setAttribute('data-document-type', metadata.documentType);
  
  // Future: Store Express document page ID when available
  // if (metadata.pageId) {
  //   noteElement.setAttribute('data-page-id', metadata.pageId);
  // }
  
  // Future: Store page bounds for canvas positioning
  // if (metadata.pageBounds) {
  //   noteElement.setAttribute('data-page-bounds', JSON.stringify(metadata.pageBounds));
  // }
}

/**
 * Renders the page/slide tag on a note element
 * Creates a subtle tag showing "Page X" or "Slide X"
 * 
 * @param {HTMLElement} noteElement - The sticky note element
 */
function renderPageTag(noteElement) {
  // Remove existing tag if present
  const existingTag = noteElement.querySelector('.sticky-page-tag');
  if (existingTag) {
    existingTag.remove();
  }
  
  // Get metadata from data attributes
  const pageNumber = noteElement.getAttribute('data-page-number');
  const documentType = noteElement.getAttribute('data-document-type');
  
  if (!pageNumber || !documentType) {
    return; // No metadata, skip tag rendering
  }
  
  // Create tag element
  const tag = document.createElement('div');
  tag.className = 'sticky-page-tag';
  const label = documentType === 'slide' ? 'Slide' : 'Page';
  tag.textContent = `${label} ${pageNumber}`;
  
  // Insert tag at the beginning of the note (before content)
  noteElement.insertBefore(tag, noteElement.firstChild);
}

/**
 * Updates page/slide metadata for a note
 * Future: Called when user navigates to different page/slide in Express
 * 
 * @param {HTMLElement} noteElement - The sticky note element
 * @param {NoteMetadata} metadata - New page/slide metadata
 */
function updateNoteMetadata(noteElement, metadata) {
  applyNoteMetadata(noteElement, metadata);
  renderPageTag(noteElement);
}

/**
 * Future: Listen for page/slide changes in Express document
 * This will be called when Express Document API notifies of page changes
 * 
 * Example future implementation:
 * 
 * addonSdk.document.onPageChange((newPage) => {
 *   const currentPageInfo = {
 *     pageNumber: newPage.index + 1,
 *     documentType: document.type === 'presentation' ? 'slide' : 'page',
 *     pageId: newPage.id
 *   };
 *   
 *   // Update all notes created on current page
 *   const notes = board.querySelectorAll('.sticky');
 *   notes.forEach(note => {
 *     // Only update notes that don't have explicit page assignment
 *     if (!note.hasAttribute('data-page-locked')) {
 *       updateNoteMetadata(note, currentPageInfo);
 *     }
 *   });
 * });
 */

// Existing AI analyze flow (reused for Step 2)
async function runAiOnContent() {
  board.replaceChildren(document.createTextNode("Analyzing with AI…"));

  try {
    const notes = await analyzeText(contentInput.value, selectedFiles);
    renderStructuredNotes(notes);
    saveNewNote(currentNoteName || "Untitled note", notes);
    loadSavedNotes();
  } catch (e) {
    board.replaceChildren(document.createTextNode("AI failed. Is backend running?"));
  }
}

// ============================================
// Two-step Create Note flow (name -> content)
// ============================================

function showNameModal() {
  nameModal.classList.add("show");
  nameModal.setAttribute("aria-hidden", "false");
  setTimeout(() => nameInput.focus(), 80);
}

function hideNameModal() {
  nameModal.classList.remove("show");
  nameModal.setAttribute("aria-hidden", "true");
  nameInput.value = "";
}

function showContentStep(name) {
  setNoteTitle(name || "Untitled note");
  contentStep.classList.add("show");
  contentStep.setAttribute("aria-hidden", "false");
  board.replaceChildren();
  navigateTo("input");
  setTimeout(() => contentInput.focus(), 50);
}

function resetContentStep() {
  contentInput.value = "";
  contentStepTitle.textContent = "Untitled note";
  contentStep.classList.remove("show");
  contentStep.setAttribute("aria-hidden", "true");
  selectedFiles = [];
  renderFileList();
}

// Launch Step 1
createNoteBtn.onclick = () => {
  resetContentStep();
  showNameModal();
};

// Team: open add member modal
if (addMemberBtn) {
  addMemberBtn.onclick = () => {
    console.log("Add Member button clicked");
    setActiveNav("teamTabBtn");
    navigateTo("team");
    // Small delay to ensure view transition completes before opening modal
    setTimeout(() => openTeamModal(), 50);
  };
} else {
  console.error("Add Member button not found!");
}

// Team: cancel/close modal
if (teamCancelBtn) {
  teamCancelBtn.onclick = () => closeTeamModal();
}

// Close team modal when clicking backdrop
if (teamModal) {
  teamModal.addEventListener("click", (e) => {
    if (e.target === teamModal) {
      closeTeamModal();
    }
  });
}

// Confirm modal handlers
if (confirmOkBtn) {
  confirmOkBtn.onclick = () => {
    if (confirmCallback) {
      confirmCallback();
    }
    closeConfirmDialog();
  };
}

if (confirmCancelBtn) {
  confirmCancelBtn.onclick = () => {
    closeConfirmDialog();
  };
}

// Close confirm modal when clicking backdrop
if (confirmModal) {
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) {
      closeConfirmDialog();
    }
  });
}

// Team form submit - single handler
if (teamForm) {
  console.log("Attaching submit event listener to team form");
  
  const handleSubmit = (e) => {
    console.log("=== FORM SUBMIT EVENT TRIGGERED ===");
    e.preventDefault();
    e.stopPropagation();

    try {
      const name = memberNameInput?.value.trim();
      const email = memberEmailInput?.value.trim();
      const role = memberRoleInput?.value.trim();
      const isLead = Boolean(memberIsLeadInput?.checked);

      console.log("Member details:", { name, email, role, isLead });

      if (!name || !email || !role) {
        console.warn("Missing required fields");
        alert("Please fill in all required fields (Name, Email, and Role)");
        return;
      }

      const newMember = teamStore.addMember({ name, email, role, isLead });
      console.log("Member added to store:", newMember);
      console.log("All members:", teamStore.getMembers());

      renderTeamList();
      console.log("Team list rendered");

      closeTeamModal();
      console.log("Modal closed");
    } catch (error) {
      console.error("Error in form submission:", error);
    }
  };
  
  teamForm.addEventListener("submit", handleSubmit);
  
  // Also add click handler to submit button as backup
  const submitBtn = teamForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    console.log("Also attaching click handler to submit button");
    submitBtn.addEventListener("click", (e) => {
      console.log("Submit button clicked directly");
      e.preventDefault();
      handleSubmit(e);
    });
  }
  
  console.log("Submit event listener attached successfully");
} else {
  console.error("Team form not found - cannot attach submit listener");
}

// Cancel Step 1
nameCancelBtn.onclick = () => {
  hideNameModal();
};

// Close when clicking the dimmed background
nameModal.addEventListener("click", (e) => {
  if (e.target === nameModal) {
    hideNameModal();
  }
});

// Continue to Step 2
nameContinueBtn.onclick = () => {
  const name = nameInput.value.trim() || "Untitled note";
  hideNameModal();
  showContentStep(name);
};

// Step 1 keyboard handling
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    nameContinueBtn.click();
  }
  if (e.key === "Escape") {
    hideNameModal();
  }
});

// Step 2 primary action -> AI analysis
finalizeNoteBtn.onclick = () => {
  // Move to result view immediately and show pending state
  board.replaceChildren(document.createTextNode("Analyzing with AI…"));
  navigateTo("result", { entrySource: "home" });
  runAiOnContent();
};

// Back navigation using history
backToHomeBtn.onclick = () => {
  resetContentStep();
  board.replaceChildren();
  goBack();
};

// Tab navigation
if (stickyTabBtn) {
  stickyTabBtn.addEventListener("click", () => {
    setActiveNav("stickyTabBtn");
    loadSavedNotes();
    navigateTo("sticky-notes");
  });
}

if (teamTabBtn) {
  teamTabBtn.addEventListener("click", () => {
    setActiveNav("teamTabBtn");
    renderTeamList();
    navigateTo("team");
  });
}

if (discussionTabBtn) {
  discussionTabBtn.addEventListener("click", () => {
    setActiveNav("discussionTabBtn");
    navigateTo("discussion");
  });
}

// Back from sticky notes list to home
if (stickyBackBtn) {
  stickyBackBtn.addEventListener("click", () => {
    goBack();
  });
}

// Back from team view to home
if (teamBackBtn) {
  teamBackBtn.addEventListener("click", () => {
    setActiveNav("stickyTabBtn");
    navigateTo("home");
  });
}

// Initial load of saved notes and team data
console.log("Initializing app...");
console.log("Team elements check:");
console.log("  addMemberBtn:", addMemberBtn ? "FOUND" : "NOT FOUND");
console.log("  teamModal:", teamModal ? "FOUND" : "NOT FOUND");
console.log("  teamForm:", teamForm ? "FOUND" : "NOT FOUND");
console.log("  teamList:", teamList ? "FOUND" : "NOT FOUND");
console.log("  memberNameInput:", memberNameInput ? "FOUND" : "NOT FOUND");
console.log("  memberEmailInput:", memberEmailInput ? "FOUND" : "NOT FOUND");
console.log("  memberRoleInput:", memberRoleInput ? "FOUND" : "NOT FOUND");
console.log("  teamCancelBtn:", teamCancelBtn ? "FOUND" : "NOT FOUND");

loadSavedNotes();
teamStore.init();
teamStore.clearIfCorrupt();
console.log("Team store initialized with members:", teamStore.getMembers());
renderTeamList();
console.log("Initial render complete");

// Sync initial view state
updateViewClasses();
updateBackVisibility();

// Upload handling
uploadBtn.onclick = () => {
  fileInput.click();
};

fileInput.onchange = (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  selectedFiles = [...selectedFiles, ...files];
  renderFileList();
  fileInput.value = "";
};

function removeFileAt(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.textContent = file.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
    removeBtn.textContent = "✕";
    removeBtn.onclick = () => removeFileAt(idx);

    chip.appendChild(removeBtn);
    fileListEl.appendChild(chip);
  });
}

// ============================================
// Structured layout for sticky notes
// ============================================

function getOrCreateHeader(type) {
  let header = board.querySelector(`[data-header="${type}"]`);
  if (!header) {
    header = document.createElement("div");
    header.className = "sticky-type-header";
    header.setAttribute("data-header", type);
    board.appendChild(header);
  }
  header.textContent = TYPE_LABELS[type] || type;
  return header;
}

function renderStructuredNotes(notes) {
  board.replaceChildren();

  const fragment = document.createDocumentFragment();

  notes.forEach((n) => {
    const noteType = TYPE_ORDER.includes(n.type) ? n.type : "task";
    const div = document.createElement("div");
    div.className = `sticky ${noteType}`;
    div.setAttribute("data-note-type", noteType);

    // Page metadata
    const pageInfo = getCurrentPageInfo();
    applyNoteMetadata(div, pageInfo);

    // Content
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "sticky-content";
    contentWrapper.textContent = n.text;
    div.appendChild(contentWrapper);

    // Render page/slide tag
    renderPageTag(div);

    // Setup collapse button
    setupCollapseButton(div);

    // Make note draggable
    makeDraggable(div);

    // Store that this was not originally editable
    div.setAttribute("data-original-editable", "false");

    fragment.appendChild(div);
  });

  board.appendChild(fragment);
}

// ============================================
// Drag-and-Drop functionality
// ============================================

/**
 * Makes a sticky note draggable within the board container
 * Uses mouse/pointer events (not HTML5 drag API) for iframe compatibility
 * @param {HTMLElement} noteElement - The sticky note element to make draggable
 */
function makeDraggable(noteElement) {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let hasMoved = false; // Track if mouse actually moved (to distinguish drag from click)

  /**
   * Get current position of note (from style or default)
   */
  function getNotePosition() {
    const rect = noteElement.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    
    // If note already has positioned styles, use them
    const left = noteElement.style.left ? parseFloat(noteElement.style.left) : rect.left - boardRect.left;
    const top = noteElement.style.top ? parseFloat(noteElement.style.top) : rect.top - boardRect.top;
    
    return { left, top };
  }

  /**
   * Handle mouse down - start drag operation
   */
  function handleMouseDown(e) {
    // Don't start drag if clicking on a link or button inside the note
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
      return;
    }

    // For contenteditable notes, only start drag if user clicks on non-text area
    // or if they click and move (not just click to edit)
    if (noteElement.contentEditable === 'true') {
      // Allow a small delay to see if user is clicking to edit or drag
      hasMoved = false;
      
      // If user clicks in the middle of text, assume they want to edit
      // We'll start drag only if they move the mouse
      const clickX = e.clientX;
      const clickY = e.clientY;
      
      // Store initial click position
      dragStartX = clickX;
      dragStartY = clickY;
      
      // Get initial note position
      const pos = getNotePosition();
      initialLeft = pos.left;
      initialTop = pos.top;
      
      // Set up move handler to detect actual movement
      document.addEventListener('mousemove', checkForDrag);
      document.addEventListener('mouseup', cancelDrag);
      
      return;
    }

    // For non-editable notes, start drag immediately
    startDrag(e);
  }

  /**
   * Check if user is actually dragging (moved mouse) vs just clicking
   */
  function checkForDrag(e) {
    const moveThreshold = 5; // pixels
    const deltaX = Math.abs(e.clientX - dragStartX);
    const deltaY = Math.abs(e.clientY - dragStartY);
    
    if (deltaX > moveThreshold || deltaY > moveThreshold) {
      // User is dragging, not just clicking
      hasMoved = true;
      document.removeEventListener('mousemove', checkForDrag);
      document.removeEventListener('mouseup', cancelDrag);
      
      // Prevent text selection
      e.preventDefault();
      
      // Start the actual drag
      startDrag({ clientX: dragStartX, clientY: dragStartY });
      
      // Continue with drag
      handleMouseMove(e);
    }
  }

  /**
   * Cancel drag if user just clicked (didn't move)
   */
  function cancelDrag() {
    document.removeEventListener('mousemove', checkForDrag);
    document.removeEventListener('mouseup', cancelDrag);
  }

  /**
   * Start drag operation
   */
  function startDrag(e) {
    isDragging = true;
    hasMoved = true;
    noteElement.classList.add('dragging');
    
    // Update mouse position if provided (for immediate drag start)
    // Otherwise use already-set values (for contenteditable delayed drag)
    if (e && e.clientX !== undefined) {
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    }
    
    // Get initial note position (recalculate to ensure accuracy)
    const pos = getNotePosition();
    initialLeft = pos.left;
    initialTop = pos.top;
    
    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    
    // Add global event listeners for smooth dragging
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Prevent default to avoid text selection
    if (e && e.preventDefault) {
      e.preventDefault();
    }
  }

  /**
   * Handle mouse move - update note position during drag
   */
  function handleMouseMove(e) {
    if (!isDragging) return;
    
    // Calculate new position relative to board
    const boardRect = board.getBoundingClientRect();
    const newLeft = initialLeft + (e.clientX - dragStartX);
    const newTop = initialTop + (e.clientY - dragStartY);
    
    // Constrain horizontally to board boundaries
    const noteRect = noteElement.getBoundingClientRect();
    const minLeft = 0;
    const maxLeft = Math.max(0, boardRect.width - noteRect.width);
    
    // Allow vertical movement freely (board will expand if needed)
    const minTop = 0;
    
    // Apply constrained position (horizontal constraint, vertical free)
    noteElement.style.left = `${Math.max(minLeft, Math.min(maxLeft, newLeft))}px`;
    noteElement.style.top = `${Math.max(minTop, newTop)}px`;
    
    // Dynamically expand board height if note goes beyond current height
    const noteBottom = newTop + noteRect.height;
    const currentBoardHeight = board.offsetHeight;
    if (noteBottom > currentBoardHeight) {
      board.style.minHeight = `${noteBottom + 20}px`; // Add some padding
    }
  }

  /**
   * Handle mouse up - end drag operation
   */
  function handleMouseUp(e) {
    if (!isDragging) return;
    
    isDragging = false;
    noteElement.classList.remove('dragging');
    
    // Restore text selection
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // If this was a contenteditable note and user didn't actually drag,
    // allow normal text editing
    if (noteElement.contentEditable === 'true' && !hasMoved) {
      // User just clicked to edit, not drag
      noteElement.focus();
    }
  }

  // Attach mousedown listener to note
  noteElement.addEventListener('mousedown', handleMouseDown);
}

/**
 * Initialize drag functionality for all existing notes
 */
function initializeDragForAllNotes() {
  const notes = board.querySelectorAll('.sticky');
  notes.forEach(note => {
    // Only initialize if not already draggable
    if (!note.hasAttribute('data-draggable')) {
      note.setAttribute('data-draggable', 'true');
      makeDraggable(note);
    }
  });
}

// ============================================
// Collapse/Expand functionality
// ============================================

/**
 * Wraps note content and adds collapse button to a note element
 * @param {HTMLElement} noteElement - The sticky note element
 */
function setupCollapseButton(noteElement) {
  // Skip if already set up
  if (noteElement.querySelector('.sticky-collapse-btn')) {
    return;
  }

  // Check if content wrapper already exists
  let contentWrapper = noteElement.querySelector('.sticky-content');
  
  if (!contentWrapper) {
    // Need to create wrapper - store original content
    const originalContent = noteElement.textContent || noteElement.innerText;
    const isEditable = noteElement.contentEditable === 'true';
    
    // Create content wrapper
    contentWrapper = document.createElement('div');
    contentWrapper.className = 'sticky-content';
    
    // Move existing content into wrapper
    if (isEditable) {
      // For editable notes, preserve contentEditable on wrapper
      contentWrapper.contentEditable = 'true';
      contentWrapper.textContent = originalContent;
      noteElement.textContent = '';
      noteElement.appendChild(contentWrapper);
      noteElement.contentEditable = 'false';
    } else {
      // For non-editable notes, just wrap the text
      contentWrapper.textContent = originalContent;
      noteElement.textContent = '';
      noteElement.appendChild(contentWrapper);
    }
    
    // Store original state if not already stored
    if (!noteElement.hasAttribute('data-original-editable')) {
      noteElement.setAttribute('data-original-editable', isEditable ? 'true' : 'false');
    }
  }
  
  // Create collapse button
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'sticky-collapse-btn';
  collapseBtn.innerHTML = '⊖';
  collapseBtn.setAttribute('aria-label', 'Collapse note');
  collapseBtn.title = 'Collapse note';
  
  // Add click handler (stop propagation to prevent drag)
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapse(noteElement);
  });
  
  noteElement.appendChild(collapseBtn);
}

/**
 * Collapses a note into a small colored dot
 * @param {HTMLElement} noteElement - The sticky note element to collapse
 */
function collapseNote(noteElement) {
  if (noteElement.classList.contains('collapsed')) {
    return; // Already collapsed
  }
  
  // Store original position and dimensions
  const rect = noteElement.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  const left = noteElement.style.left || `${rect.left - boardRect.left}px`;
  const top = noteElement.style.top || `${rect.top - boardRect.top}px`;
  
  noteElement.setAttribute('data-original-left', left);
  noteElement.setAttribute('data-original-top', top);
  noteElement.setAttribute('data-original-width', rect.width.toString());
  noteElement.setAttribute('data-original-height', rect.height.toString());
  
  // Add collapsed class
  noteElement.classList.add('collapsed');
  noteElement.setAttribute('data-collapsed', 'true');
  
  // Cluster with other collapsed notes of same type
  clusterCollapsedNotes(noteElement);
}

/**
 * Expands a collapsed note back to full size
 * @param {HTMLElement} noteElement - The sticky note element to expand
 */
function expandNote(noteElement) {
  if (!noteElement.classList.contains('collapsed')) {
    return; // Already expanded
  }
  
  // Restore original position
  const originalLeft = noteElement.getAttribute('data-original-left');
  const originalTop = noteElement.getAttribute('data-original-top');
  
  if (originalLeft) {
    noteElement.style.left = originalLeft;
  }
  if (originalTop) {
    noteElement.style.top = originalTop;
  }
  
  // Remove collapsed class
  noteElement.classList.remove('collapsed');
  noteElement.setAttribute('data-collapsed', 'false');
  
  // Restore editable state if it was editable
  const wasEditable = noteElement.getAttribute('data-original-editable') === 'true';
  if (wasEditable) {
    const contentWrapper = noteElement.querySelector('.sticky-content');
    if (contentWrapper) {
      contentWrapper.contentEditable = 'true';
    }
  }
}

/**
 * Toggles collapse/expand state of a note
 * @param {HTMLElement} noteElement - The sticky note element
 */
function toggleCollapse(noteElement) {
  if (noteElement.classList.contains('collapsed')) {
    expandNote(noteElement);
  } else {
    collapseNote(noteElement);
  }
}

/**
 * Clusters collapsed notes of the same type together
 * @param {HTMLElement} noteElement - The note that was just collapsed
 */
function clusterCollapsedNotes(noteElement) {
  const noteType = noteElement.className.split(' ').find(cls => 
    ['task', 'decision', 'question', 'personal', 'mention', 'suggestion'].includes(cls)
  );
  
  if (!noteType) return;
  
  // Find all collapsed notes of the same type
  const collapsedSameType = Array.from(board.querySelectorAll('.sticky.collapsed'))
    .filter(note => note !== noteElement && note.classList.contains(noteType));
  
  if (collapsedSameType.length === 0) {
    // First collapsed note of this type - position it in a cluster area
    const clusterX = 20;
    const clusterY = 20 + (['task', 'decision', 'question', 'personal', 'mention', 'suggestion'].indexOf(noteType) * 30);
    noteElement.style.left = `${clusterX}px`;
    noteElement.style.top = `${clusterY}px`;
    return;
  }
  
  // Find the rightmost/topmost position in the cluster
  let maxRight = 0;
  let clusterTop = 0;
  
  collapsedSameType.forEach(note => {
    const left = parseFloat(note.style.left) || 0;
    const right = left + 24; // 24px is collapsed note width
    if (right > maxRight) {
      maxRight = right;
    }
    if (clusterTop === 0) {
      clusterTop = parseFloat(note.style.top) || 0;
    }
  });
  
  // Position new collapsed note next to the cluster
  const spacing = 4; // Small gap between clustered dots
  noteElement.style.left = `${maxRight + spacing}px`;
  noteElement.style.top = `${clusterTop}px`;
  
  // If cluster is getting too wide, start a new row
  const boardWidth = board.getBoundingClientRect().width;
  if (maxRight + spacing + 24 > boardWidth - 20) {
    // Start new row below
    noteElement.style.left = `20px`;
    noteElement.style.top = `${clusterTop + 28}px`; // 24px dot + 4px spacing
  }
}

// Add click handler to collapsed notes to expand them
// Note: Drag functionality still works on collapsed notes via makeDraggable
// This handler only expands on a simple click (not drag)
let collapseClickStart = null;
document.addEventListener('mousedown', (e) => {
  const collapsedNote = e.target.closest('.sticky.collapsed');
  if (collapsedNote && !e.target.closest('.sticky-collapse-btn')) {
    collapseClickStart = { x: e.clientX, y: e.clientY, note: collapsedNote };
  }
});

document.addEventListener('mouseup', (e) => {
  if (collapseClickStart) {
    const { x, y, note } = collapseClickStart;
    const deltaX = Math.abs(e.clientX - x);
    const deltaY = Math.abs(e.clientY - y);
    
    // If mouse moved less than 5px, treat as click and expand
    if (deltaX < 5 && deltaY < 5 && note === e.target.closest('.sticky.collapsed')) {
      expandNote(note);
    }
    
    collapseClickStart = null;
  }
});

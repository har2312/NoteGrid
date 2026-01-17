
import { analyzeText } from "./ai.js";
import { fetchCurrentMember, fetchMemberCards, createTrelloTask } from "./trello.js";

// --------------------------------------------
// Canvas element attachment (Document Sandbox)
// --------------------------------------------
let addOnUISdk = null;
let sandboxProxy = null;
let sandboxConnectState = "init"; // init | connecting | connected | error
let sandboxConnectError = "";
let sandboxConnectAttempts = 0;

async function initAddOnSdkAndSandboxProxy() {
  if (sandboxProxy) return sandboxProxy;
  if (sandboxConnectState === "connecting") return null;

  sandboxConnectState = "connecting";
  sandboxConnectAttempts += 1;

  try {
    addOnUISdk = (await import("https://express.adobe.com/static/add-on-sdk/sdk.js")).default;
    await addOnUISdk.ready;
    const runtime = addOnUISdk?.instance?.runtime;
    const entrypointType = addOnUISdk?.instance?.entrypointType;
    const runtimeType = runtime?.type;
    const hasApiProxy = typeof runtime?.apiProxy === "function";
    const manifestEp0 = addOnUISdk?.instance?.manifest?.entryPoints?.[0];
    const manifestSandbox = manifestEp0?.documentSandbox;
    if (!hasApiProxy) {
      throw new Error(
        `addOnUISdk.instance.runtime.apiProxy is unavailable | entrypointType=${entrypointType} runtimeType=${runtimeType} manifest.documentSandbox=${manifestSandbox}`
      );
    }
    sandboxProxy = await addOnUISdk.instance.runtime.apiProxy(
      addOnUISdk.constants?.RuntimeType?.documentSandbox || "documentSandbox"
    );
    sandboxConnectState = "connected";
    sandboxConnectError = "";
    console.log("[NoteGrid] Connected to documentSandbox.");
    return sandboxProxy;
  } catch (e) {
    sandboxConnectState = "error";
    sandboxProxy = null;
    sandboxConnectError = String(e && e.message ? e.message : e);
    console.warn("[NoteGrid] Failed to connect to documentSandbox:", e);
    return null;
  }
}

initAddOnSdkAndSandboxProxy();

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
const tasksTabBtn = document.getElementById("tasksTabBtn");
const tasksView = document.querySelector('[data-view="tasks"]');
const refreshTasksBtn = document.getElementById("refreshTasksBtn");
const tasksLoadingState = document.getElementById("tasksLoadingState");
const tasksErrorState = document.getElementById("tasksErrorState");
const tasksAssignedToMeList = document.getElementById("tasksAssignedToMe");
const tasksAssignedByMeInProgressList = document.getElementById("tasksAssignedByMeInProgress");
const tasksAssignedByMeCompletedList = document.getElementById("tasksAssignedByMeCompleted");
const savedNotesList = document.getElementById("savedNotesList");
const stickyBackBtn = document.getElementById("stickyBackBtn");
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

const TASKS_CACHE_TTL = 1000 * 60 * 5; // 5 minutes
const MAX_TASKS_PER_SECTION = 30;
const tasksState = {
  loading: false,
  lastFetchedAt: 0,
  assignedToMe: [],
  assignedByMe: {
    inProgress: [],
    completed: []
  },
  currentUser: null,
  error: ""
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

async function maybeCreateMentionTask({ trelloTitle, trelloDescription }) {
  if (!trelloTitle && !trelloDescription) {
    return;
  }

  try {
    const card = await createTrelloTask(trelloTitle, trelloDescription);
    if (card) {
      console.log("Created Trello task for mention:", card.id);
    }
  } catch (error) {
    console.warn("Failed to create Trello task for mention", error);
  }
}

function setTasksLoading(isLoading) {
  if (!tasksLoadingState) return;
  tasksLoadingState.hidden = !isLoading;
}

function setTasksError(message) {
  if (!tasksErrorState) return;
  if (message) {
    tasksErrorState.textContent = message;
    tasksErrorState.hidden = false;
  } else {
    tasksErrorState.textContent = "";
    tasksErrorState.hidden = true;
  }
}

function formatRelativeTime(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function truncateText(text = "", maxLength = 160) {
  const safe = text.trim();
  if (!safe) return "";
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength - 1)}…`;
}

function getInitials(input = "") {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return initials.toUpperCase();
}

function createAvatarElement(member = {}, currentUserId) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-avatar";

  const displayName = member?.fullName || member?.username || "Unknown";
  const isSelf = member?.id && member.id === currentUserId;
  wrapper.title = isSelf ? `${displayName} (You)` : displayName;

  const avatarUrl = member?.avatarUrl;
  if (avatarUrl) {
    const img = document.createElement("img");
    img.alt = displayName;
    img.src = avatarUrl.endsWith(".png") ? avatarUrl : `${avatarUrl}/50.png`;
    wrapper.appendChild(img);
  } else {
    wrapper.classList.add("task-avatar--initials");
    wrapper.textContent = member?.initials?.toUpperCase() || getInitials(displayName);
  }

  return wrapper;
}

function createTaskCard(card, statusConfig, currentUserId) {
  const statusLabel = statusConfig?.statusLabel || "Task";
  const statusTone = statusConfig?.statusTone || "todo";

  const cardEl = document.createElement("article");
  cardEl.className = "task-card";

  const header = document.createElement("div");
  header.className = "task-card-header";

  const title = document.createElement("h3");
  title.className = "task-card-title";
  title.textContent = card?.name?.trim() || "Untitled card";
  header.appendChild(title);

  const badge = document.createElement("span");
  badge.className = `task-badge task-badge--${statusTone}`;
  badge.textContent = statusLabel;
  header.appendChild(badge);

  cardEl.appendChild(header);

  const descText = truncateText(card?.desc || "");
  if (descText) {
    const desc = document.createElement("p");
    desc.className = "task-card-desc";
    desc.textContent = descText;
    cardEl.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "task-card-meta";
  const updatedLabel = document.createElement("span");
  updatedLabel.textContent = `Updated ${formatRelativeTime(card?.dateLastActivity)}`;
  meta.appendChild(updatedLabel);
  if (card?.memberCreator?.fullName) {
    const creatorLabel = document.createElement("span");
    creatorLabel.textContent = `Creator: ${card.memberCreator.fullName}`;
    meta.appendChild(creatorLabel);
  }
  cardEl.appendChild(meta);

  const avatarsWrap = document.createElement("div");
  avatarsWrap.className = "task-avatars";
  const members = Array.isArray(card?.members) ? card.members : [];
  if (members.length) {
    members.slice(0, 4).forEach((member) => {
      avatarsWrap.appendChild(createAvatarElement(member, currentUserId));
    });
    if (members.length > 4) {
      const overflow = document.createElement("span");
      overflow.className = "task-pill";
      overflow.textContent = `+${members.length - 4}`;
      avatarsWrap.appendChild(overflow);
    }
  } else {
    const unassigned = document.createElement("span");
    unassigned.className = "task-pill";
    unassigned.textContent = "Unassigned";
    avatarsWrap.appendChild(unassigned);
  }
  cardEl.appendChild(avatarsWrap);

  return cardEl;
}

function renderTaskList(container, tasks, { emptyMessage, statusLabel, statusTone }) {
  if (!container) return;
  container.replaceChildren();
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "tasks-empty";
    empty.textContent = emptyMessage || "No tasks found";
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  list.slice(0, MAX_TASKS_PER_SECTION).forEach((card) => {
    fragment.appendChild(
      createTaskCard(card, { statusLabel, statusTone }, tasksState.currentUser?.id || null)
    );
  });
  container.appendChild(fragment);
}

function renderTasksBoard() {
  renderTaskList(tasksAssignedToMeList, tasksState.assignedToMe, {
    emptyMessage: "No tasks found — you're all caught up!",
    statusLabel: "To Do",
    statusTone: "todo"
  });

  renderTaskList(tasksAssignedByMeInProgressList, tasksState.assignedByMe.inProgress, {
    emptyMessage: "No active assignments right now.",
    statusLabel: "In Progress",
    statusTone: "in-progress"
  });

  renderTaskList(tasksAssignedByMeCompletedList, tasksState.assignedByMe.completed, {
    emptyMessage: "No completed tasks yet.",
    statusLabel: "Done",
    statusTone: "done"
  });
}

function isCardAssignedByUser(card, currentUserId) {
  if (!card || !currentUserId) return false;
  if (card.idMemberCreator === currentUserId) return true;
  const memberIds = Array.isArray(card.idMembers) ? card.idMembers : [];
  return memberIds.includes(currentUserId) && memberIds.some((id) => id !== currentUserId);
}

function sortCardsByActivity(list) {
  return [...list].sort((a, b) => {
    const aTime = new Date(a?.dateLastActivity || 0).getTime();
    const bTime = new Date(b?.dateLastActivity || 0).getTime();
    return bTime - aTime;
  });
}

async function loadTasks(forceRefresh = false) {
  if (!tasksView) return;
  if (tasksState.loading) return;
  const now = Date.now();
  const isFresh = now - tasksState.lastFetchedAt < TASKS_CACHE_TTL;
  if (!forceRefresh && tasksState.lastFetchedAt && isFresh) {
    renderTasksBoard();
    return;
  }

  tasksState.loading = true;
  setTasksError("");
  setTasksLoading(true);

  try {
    const [currentUser, cards] = await Promise.all([
      fetchCurrentMember(),
      fetchMemberCards()
    ]);

    tasksState.currentUser = currentUser;

    const assignedToMe = cards.filter((card) => {
      const members = Array.isArray(card?.idMembers) ? card.idMembers : [];
      return members.includes(currentUser.id) && !card.closed;
    });

    const assignedByMeAll = cards.filter((card) => isCardAssignedByUser(card, currentUser.id));

    tasksState.assignedToMe = sortCardsByActivity(assignedToMe);
    tasksState.assignedByMe = {
      inProgress: sortCardsByActivity(assignedByMeAll.filter((card) => !card.closed)),
      completed: sortCardsByActivity(assignedByMeAll.filter((card) => card.closed))
    };
    tasksState.lastFetchedAt = now;
    renderTasksBoard();
  } catch (error) {
    console.error("Failed to load Trello tasks", error);
    tasksState.error = error.message || "Unable to load Trello tasks.";
    setTasksError(tasksState.error);
    tasksState.assignedToMe = [];
    tasksState.assignedByMe = { inProgress: [], completed: [] };
    renderTasksBoard();
  } finally {
    tasksState.loading = false;
    setTasksLoading(false);
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

if (tasksTabBtn) {
  tasksTabBtn.addEventListener("click", () => {
    setActiveNav("tasksTabBtn");
    navigateTo("tasks");
    loadTasks();
  });
}

if (refreshTasksBtn) {
  refreshTasksBtn.addEventListener("click", () => {
    loadTasks(true);
  });
}

if (tasksView) {
  setActiveNav("tasksTabBtn");
  loadTasks(true);
}

// Discussion tab handler is now at the bottom of the file

// Back from sticky notes list to home
if (stickyBackBtn) {
  stickyBackBtn.addEventListener("click", () => {
    goBack();
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
// ============================================
// DISCUSSION TAB WITH @MENTIONS
// ============================================

const DISCUSSION_DB_KEY = "discussion_messages";
const discussionBackBtn = document.getElementById("discussionBackBtn");
const discussionInput = document.getElementById("discussionInput");
const discussionTextareaShell = document.getElementById("discussionTextareaShell") || discussionInput?.closest(".textarea-shell");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const messagesFeed = document.getElementById("messagesFeed");
const mentionDropdown = document.getElementById("mentionDropdown");
const discussionInputOverlay = document.getElementById("discussionInputOverlay");
const discussionInputPlaceholder = discussionInput?.getAttribute("placeholder") || "";
const selectedCanvasNodeChip = document.getElementById("selectedCanvasNodeChip");
const selectedCanvasNodeTitle = document.getElementById("selectedCanvasNodeTitle");
const selectedCanvasNodeHint = document.getElementById("selectedCanvasNodeHint");
const dismissSelectedCanvasNodeBtn = document.getElementById("dismissSelectedCanvasNodeBtn");
const canvasAttachmentStatus = document.getElementById("canvasAttachmentStatus");
const composerAttachmentsEl = document.getElementById("composerAttachments");

// Discussion state
let discussionMessages = [];
let mentionStartIndex = -1;
let mentionQuery = "";
let currentMentions = [];
let isMentionOpen = false;
let mentionCandidates = [];
let activeMentionIndex = 0;

// Attachment + tagging state (discussion)
const NODE_TAG_PREFIX = "NG-";
const NODE_TAG_COUNTER_KEY = "notegrid_next_node_tag";
let currentSelection = null; // { nodeId, nodeType, tag }
let pendingAttachments = []; // { nodeId, nodeType, tag }
let dismissedSelectionNodeId = null;


function setCanvasStatus(text) {
  if (canvasAttachmentStatus) canvasAttachmentStatus.textContent = text;
}

function formatNodeTag(n) {
  const num = Math.max(1, Number(n || 1));
  return `${NODE_TAG_PREFIX}${String(num).padStart(3, "0")}`;
}

function nextNodeTag() {
  const raw = localStorage.getItem(NODE_TAG_COUNTER_KEY);
  const next = raw ? Number(raw) : 1;
  const tag = formatNodeTag(next);
  localStorage.setItem(NODE_TAG_COUNTER_KEY, String(next + 1));
  return tag;
}

function insertAtCursor(textarea, textToInsert) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + textToInsert + after;
  const nextPos = before.length + textToInsert.length;
  textarea.setSelectionRange(nextPos, nextPos);
}

function renderComposerAttachments() {
  if (!composerAttachmentsEl) return;
  composerAttachmentsEl.replaceChildren();
  if (!pendingAttachments.length) {
    if (discussionTextareaShell) discussionTextareaShell.classList.remove("has-attachment");
    updateSelectionChip();
    return;
  }

  if (discussionTextareaShell) discussionTextareaShell.classList.add("has-attachment");

  const fragment = document.createDocumentFragment();
  pendingAttachments.forEach((att, idx) => {
    const row = document.createElement("div");
    row.className = "composer-attachment";

    const badge = document.createElement("span");
    badge.className = "composer-attachment-badge";
    badge.textContent = `[${att.tag}] ${att.nodeType}`;

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "node-id-link";
    jump.textContent = `[${att.tag}]`;
    jump.onclick = () => jumpToTag(att.tag);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-attachment-btn";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove attachment");
    removeBtn.onclick = () => {
      pendingAttachments.splice(idx, 1);
      renderComposerAttachments();
    };

    row.appendChild(badge);
    row.appendChild(jump);
    row.appendChild(removeBtn);
    fragment.appendChild(row);
  });

  composerAttachmentsEl.appendChild(fragment);
  // Keep UI consistent: if we have an attachment (purple badge),
  // hide the separate "Selected: ..." pill to avoid redundancy.
  updateSelectionChip();
}

async function ensureSelectionHasTag(sel) {
  if (!sel?.nodeId) return null;
  if (!sandboxProxy?.ensureTag) return null;

  if (sel.tag) return sel.tag;
  const tag = nextNodeTag();
  const saved = await sandboxProxy.ensureTag(sel.nodeId, tag);
  return saved || tag;
}

function updateSelectionChip() {
  if (!selectedCanvasNodeChip) return;

  // If something is already attached in the composer, that purple badge should be the
  // single indicator. Hide the separate selection pill to keep the UI clean.
  if (Array.isArray(pendingAttachments) && pendingAttachments.length > 0) {
    selectedCanvasNodeChip.setAttribute("aria-hidden", "true");
    selectedCanvasNodeChip.draggable = false;
    if (discussionTextareaShell) discussionTextareaShell.classList.remove("has-selection");
    return;
  }

  if (!currentSelection?.nodeId) {
    selectedCanvasNodeChip.setAttribute("aria-hidden", "true");
    selectedCanvasNodeChip.draggable = false;
    if (discussionTextareaShell) discussionTextareaShell.classList.remove("has-selection");
    if (selectedCanvasNodeTitle) selectedCanvasNodeTitle.textContent = "";
    if (selectedCanvasNodeHint) selectedCanvasNodeHint.textContent = "Select something on the canvas";
    return;
  }

  selectedCanvasNodeChip.setAttribute("aria-hidden", "false");
  selectedCanvasNodeChip.draggable = true;
  if (discussionTextareaShell) discussionTextareaShell.classList.add("has-selection");
  if (selectedCanvasNodeTitle) {
    // Keep it compact (this is now inside the textbox area)
    selectedCanvasNodeTitle.textContent = currentSelection.tag
      ? `Selected: [${currentSelection.tag}] ${currentSelection.nodeType}`
      : `Selected: ${currentSelection.nodeType}`;
  }
  if (selectedCanvasNodeHint) {
    selectedCanvasNodeHint.textContent = currentSelection.tag
      ? "Drag into the textbox to attach (or click to attach)"
      : "Click to assign ID + attach";
  }
}

async function pollSelectionAndCount() {
  if (!sandboxProxy?.getSelection) {
    await initAddOnSdkAndSandboxProxy();

    if (!sandboxProxy?.getSelection) {
      if (sandboxConnectState === "connecting") {
        setCanvasStatus("Canvas attachment: connecting to sandbox…");
        return;
      }
      if (sandboxConnectState === "error") {
        setCanvasStatus(
          `Canvas attachment: sandbox not connected. ${sandboxConnectAttempts > 1 ? "Retrying… " : ""}` +
            `(${sandboxConnectError || "unknown error"})`
        );
        // Auto-retry (manifest might not be reloaded yet in Express)
        if (sandboxConnectAttempts < 10) {
          setTimeout(() => initAddOnSdkAndSandboxProxy(), 1500);
        }
        return;
      }
      setCanvasStatus("Canvas attachment: sandbox not connected (click Add-on Dev Refresh).");
      return;
    }
  }

  try {
    const sel = await sandboxProxy.getSelection();
    // If user dismissed this selection, keep it hidden until they pick a different element.
    if (sel?.nodeId && dismissedSelectionNodeId && sel.nodeId === dismissedSelectionNodeId) {
      currentSelection = null;
    } else {
      currentSelection = sel || null;
      dismissedSelectionNodeId = null;
    }

    if (!currentSelection) {
      setCanvasStatus("Canvas attachment: select an element on the canvas.");
      updateSelectionChip();
    } else {
      // Do NOT assign IDs just by clicking around. IDs are assigned only when user attaches.
      const count = Number(currentSelection.selectionCount || 1);
      const prefix = count > 1 ? `Canvas attachment: ${count} selected, using the first. ` : "Canvas attachment: ";
      setCanvasStatus(prefix + (currentSelection.tag ? "ready." : "ready — click chip to attach."));
      updateSelectionChip();
    }
  } catch (_e) {
    setCanvasStatus("Canvas attachment: waiting for sandbox…");
  }
}

async function attachCurrentSelectionToComposer() {
  if (!currentSelection?.nodeId) {
    alert("Select an element on the canvas first.");
    return;
  }
  const tag = currentSelection.tag || (await ensureSelectionHasTag(currentSelection));
  if (!tag) {
    alert("Could not assign an ID to the selected element.");
    return;
  }
  // Make the tag available immediately (avoid needing a second click / waiting for poll).
  currentSelection.tag = tag;
  updateSelectionChip();

  const payload = {
    nodeId: currentSelection.nodeId,
    nodeType: currentSelection.nodeType,
    tag
  };
  // Only allow ONE attachment at a time in the composer.
  pendingAttachments = [payload];
  renderComposerAttachments();

  // Insert the id into message text so it's visible to everyone
  // Do NOT auto-insert [NG-###] into the textarea when attaching; otherwise
  // it can appear "tagged twice" (once as attachment + once in text).
}

async function jumpToTag(tag) {
  if (!tag) return;
  if (!sandboxProxy?.focusByTag) {
    alert("Canvas jump not available. Refresh the add-on.");
    return;
  }
  const res = await sandboxProxy.focusByTag(tag);
  if (!res?.ok) {
    alert(`Couldn't find element ${tag} on the canvas.`);
  }
}

/**
 * Discussion Data Store
 */
const discussionStore = {
  load() {
    try {
      const raw = localStorage.getItem(DISCUSSION_DB_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Failed to load discussion messages", e);
      return [];
    }
  },
  
  persist(messages) {
    try {
      localStorage.setItem(DISCUSSION_DB_KEY, JSON.stringify(messages));
    } catch (e) {
      console.warn("Failed to persist discussion messages", e);
    }
  },
  
  addMessage(message) {
    discussionMessages.push(message);
    this.persist(discussionMessages);
  },
  
  getMessages() {
    return [...discussionMessages];
  }
};

/**
 * Initialize discussion tab
 */
function initDiscussion() {
  discussionMessages = discussionStore.load();
  renderMessages();
}

/**
 * Get mention candidates (Everyone + Team Lead + All Members)
 */
function getMentionCandidates(query = "") {
  const candidates = [];
  
  // @Everyone option
  candidates.push({
    id: "everyone",
    label: "@Everyone",
    type: "everyone",
    name: "Everyone",
    role: "Notify all team members"
  });
  
  // Get team members
  const members = teamStore.getMembers();
  
  // Add team lead first if exists
  const lead = members.find(m => m.isLead);
  if (lead) {
    candidates.push({
      id: lead.id,
      label: `@${lead.name}`,
      type: "lead",
      name: lead.name,
      role: lead.role,
      isLead: true
    });
  }
  
  // Add all other members
  members
    .filter(m => !m.isLead)
    .forEach(member => {
      candidates.push({
        id: member.id,
        label: `@${member.name}`,
        type: "user",
        name: member.name,
        role: member.role,
        isLead: false
      });
    });
  
  // Filter by query if provided
  if (query) {
    const lowerQuery = query.toLowerCase();
    return candidates.filter(c => 
      c.name.toLowerCase().includes(lowerQuery) ||
      c.label.toLowerCase().includes(lowerQuery)
    );
  }
  
  return candidates;
}

/**
 * Show mention dropdown
 */
function showMentionDropdown(query = "") {
  mentionQuery = query;
  mentionCandidates = getMentionCandidates(query);
  
  if (mentionCandidates.length === 0) {
    hideMentionDropdown();
    return;
  }
  
  activeMentionIndex = 0;
  isMentionOpen = true;
  
  mentionDropdown.innerHTML = "";
  mentionDropdown.setAttribute("aria-hidden", "false");
  
  mentionCandidates.forEach((candidate, index) => {
    const option = document.createElement("div");
    option.className = "mention-option";
    if (index === activeMentionIndex) {
      option.classList.add("selected");
    }
    
    option.setAttribute("data-mention-id", candidate.id);
    option.setAttribute("data-mention-label", candidate.label);
    option.setAttribute("data-mention-type", candidate.type);
    
    const nameEl = document.createElement("div");
    nameEl.className = "mention-option-name";
    nameEl.textContent = candidate.name;
    
    if (candidate.isLead) {
      const badge = document.createElement("span");
      badge.className = "mention-option-badge";
      badge.textContent = "LEAD";
      nameEl.appendChild(badge);
    }
    
    const roleEl = document.createElement("div");
    roleEl.className = "mention-option-role";
    roleEl.textContent = candidate.role;
    
    option.appendChild(nameEl);
    option.appendChild(roleEl);
    
    // Click handler
    option.addEventListener("click", () => {
      completeMention(candidate);
    });
    
    mentionDropdown.appendChild(option);
  });
}

/**
 * Hide mention dropdown
 */
function hideMentionDropdown() {
  isMentionOpen = false;
  mentionDropdown.setAttribute("aria-hidden", "true");
  mentionDropdown.innerHTML = "";
  mentionStartIndex = -1;
  mentionQuery = "";
  activeMentionIndex = 0;
  mentionCandidates = [];
}

/**
 * Complete mention selection without sending message
 */
function completeMention(mention) {
  if (!mention || mentionStartIndex < 0) return;
  const text = discussionInput.value;
  const before = text.substring(0, mentionStartIndex);
  const after = text.substring(discussionInput.selectionStart);
  // If we have a selected element tag, append it to the mention so tagged member can jump by id.
  const tag = currentSelection?.tag;
  const insertion = tag ? `${mention.label} [${tag}] ` : `${mention.label} `;
  const newText = before + insertion + after;
  discussionInput.value = newText;
  const cursorPos = before.length + insertion.length;
  discussionInput.setSelectionRange(cursorPos, cursorPos);
  hideMentionDropdown();
  updateInputPreview();
  discussionInput.focus();
}

/**
 * Handle input in discussion textarea
 */
function handleDiscussionInput(e) {
  const text = discussionInput.value;
  const cursorPos = discussionInput.selectionStart;
  
  // Check if @ was just typed
  if (e.inputType === "insertText" && e.data === "@") {
    mentionStartIndex = cursorPos - 1;
    showMentionDropdown("");
    return;
  }
  
  // If mention dropdown is visible, update query
  if (isMentionOpen && mentionStartIndex >= 0) {
    const query = text.substring(mentionStartIndex + 1, cursorPos);
    
    // If user moved cursor before @, close dropdown
    if (cursorPos < mentionStartIndex) {
      hideMentionDropdown();
      return;
    }
    
    // If space or newline after @, close dropdown
    if (query.includes(" ") || query.includes("\n")) {
      hideMentionDropdown();
      return;
    }
    
    // Update dropdown with query
    showMentionDropdown(query);
  }

  updateInputPreview();
}

/**
 * Handle keydown in discussion textarea
 */
function handleDiscussionKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    if (isMentionOpen) {
      e.preventDefault();
      const mention = mentionCandidates[activeMentionIndex] || mentionCandidates[0];
      if (mention) {
        completeMention(mention);
      }
      return;
    }
    e.preventDefault();
    sendMessage();
    return;
  }

  if (!isMentionOpen) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeMentionIndex = Math.min(activeMentionIndex + 1, Math.max(mentionCandidates.length - 1, 0));
    updateSelectedOption();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeMentionIndex = Math.max(activeMentionIndex - 1, 0);
    updateSelectedOption();
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideMentionDropdown();
  }
}

/**
 * Update selected option in dropdown
 */
function updateSelectedOption() {
  const options = mentionDropdown.querySelectorAll(".mention-option");
  options.forEach((option, index) => {
    option.classList.toggle("selected", index === activeMentionIndex);
  });
  
  // Scroll selected option into view
  const selected = options[activeMentionIndex];
  if (selected) {
    selected.scrollIntoView({ block: "nearest" });
  }
}

function updateInputPreview() {
  if (!discussionInputOverlay) return;
  const value = discussionInput?.value || "";

  if (!value) {
    const placeholderText = discussionInputPlaceholder || "Type a message...";
    discussionInputOverlay.innerHTML = `<span class="input-placeholder">${escapeHtml(placeholderText)}</span>`;
    return;
  }

  let rendered = escapeHtml(value);

  const mentionCatalog = getMentionCandidates().reduce((map, candidate) => {
    if (!map.has(candidate.label)) {
      map.set(candidate.label, candidate.type);
    }
    return map;
  }, new Map());

  mentionCatalog.forEach((type, label) => {
    const regex = new RegExp(escapeRegExp(label), "g");
    const mentionHtml = `<span class="mention ${type}">${escapeHtml(label)}</span>`;
    rendered = rendered.replace(regex, mentionHtml);
  });

  rendered = rendered.replace(/\n/g, "<br>");
  discussionInputOverlay.innerHTML = rendered;
}

/**
 * Parse text and extract mentions
 * Returns { text: string, mentions: array }
 * 
 * Matches @username patterns (stops at first space/punctuation)
 * Supports both inserted mentions (from dropdown) and manually typed @tags
 */
function parseMessageWithMentions(text) {
  const mentions = [];
  // Match @ followed by word characters only (no spaces, stops at first space/punctuation)
  const mentionRegex = /@(\w+)/g;
  
  console.log("🔍 Parsing message for mentions:", text);
  
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const mentionName = match[1];
    console.log(`🔍 Found @mention: "${mentionName}"`);
    
    // Check if it matches @Everyone
    if (mentionName.toLowerCase() === "everyone") {
      mentions.push({
        id: "everyone",
        label: "@Everyone",
        type: "everyone"
      });
      console.log("  ✅ Matched @Everyone");
      continue;
    }
    
    // Check if it matches a team member
    const members = teamStore.getMembers();
    console.log(`  🔍 Searching in team (${members.length} members):`, members.map(m => m.name));
    
    const member = members.find(m => 
      m.name.toLowerCase() === mentionName.toLowerCase()
    );
    
    if (member) {
      mentions.push({
        id: member.id,
        label: `@${member.name}`,
        type: member.isLead ? "lead" : "user"
      });
      console.log(`  ✅ Matched team member: ${member.name} (${member.email})`);
    } else {
      console.log(`  ⚠️ No team member found matching: "${mentionName}"`);
    }
  }
  
  console.log(`🔍 Final mentions array:`, mentions);
  return { text, mentions };
}

/**
 * Notify tagged users via email (fire-and-forget)
 * Safety features:
 * - Ignores @Everyone mentions (only notifies individual users/leads)
 * - Deduplicates by email (same user tagged multiple times = 1 email)
 * - Skips unmatched tags (if @username not in team store)
 * - Skips users without email addresses
 * - Logs success/failure without blocking UI
 */
async function notifyTaggedUsers({ text, mentions }) {
  // Guard: no mentions at all
  if (!mentions || mentions.length === 0) {
    console.log("📧 No tags detected, skipping email notifications");
    return;
  }

  // Filter to only user/lead mentions (ignore @Everyone)
  const taggable = mentions.filter((m) => m && (m.type === "user" || m.type === "lead"));
  
  if (!taggable.length) {
    console.log("📧 No individual user tags found (only @Everyone), skipping email");
    return;
  }

  const members = teamStore.getMembers();
  const seenEmails = new Set();
  const notifiedUsers = [];

  // Build notification payloads (deduplicate by email)
  const payloads = taggable
    .map((mention) => {
      const member = members.find((m) => m.id === mention.id);
      
      // Skip if member not found in team store
      if (!member) {
        console.log(`📧 Skipped tag: ${mention.label} (not found in team)`);
        return null;
      }

      const email = member.email?.trim();
      
      // Skip if no email address
      if (!email) {
        console.log(`📧 Skipped tag: ${mention.label} (no email address)`);
        return null;
      }

      // Skip duplicate emails (same user tagged multiple times)
      const key = email.toLowerCase();
      if (seenEmails.has(key)) {
        console.log(`📧 Skipped duplicate tag: ${mention.label}`);
        return null;
      }
      seenEmails.add(key);

      const memberDisplayName = member.name?.trim() || mention.label?.replace(/^@/, "") || "User";
      notifiedUsers.push(memberDisplayName);

      return {
        email,
        taggedUser: memberDisplayName,
        taggedBy: "You",
        message: text,
        context: "Discussion Panel",
        trelloTitle: `Mention: ${memberDisplayName}`,
        trelloDescription: text
      };
    })
    .filter(Boolean);

  // Guard: no valid payloads after filtering
  if (!payloads.length) {
    console.log("📧 No valid email recipients after filtering");
    return;
  }

  console.log(`📧 Sending notifications to: ${notifiedUsers.join(", ")}`);

  // Send all notifications (non-blocking, fire-and-forget)
  const results = await Promise.allSettled(
    payloads.map((payload) =>
      fetch("http://localhost:3001/notify/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(async (res) => {
          if (!res.ok) {
            const error = await res.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(error.error || `HTTP ${res.status}`);
          }
          return payload;
        })
        .then((resolvedPayload) => {
          maybeCreateMentionTask({
            trelloTitle: resolvedPayload.trelloTitle,
            trelloDescription: resolvedPayload.trelloDescription
          });
          return resolvedPayload.taggedUser;
        })
    )
  );

  // Log results
  const succeeded = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.filter((r) => r.status === "rejected").map((r) => r.reason);

  if (succeeded.length > 0) {
    console.log(`✅ Email notifications sent successfully to: ${succeeded.join(", ")}`);
  }

  if (failed.length > 0) {
    console.warn(`⚠️ Failed to notify ${failed.length} user(s):`, failed);
  }
}

/**
 * Send message
 */
function sendMessage() {
  let text = discussionInput.value.trim();
  
  if (!text && pendingAttachments.length === 0) return;

  // Snapshot attachments for the message, then clear composer state deterministically.
  const attachmentsToSend = Array.isArray(pendingAttachments) ? [...pendingAttachments] : [];
  
  // If we have an attachment, avoid sending the same [NG-###] again in text
  // (users sometimes typed it manually or old behavior inserted it).
  const attachedTag = pendingAttachments?.[0]?.tag;
  if (attachedTag) {
    const re = new RegExp(`\\s*\\[${escapeRegExp(attachedTag)}\\]\\s*`, "g");
    text = text.replace(re, " ").replace(/\s{2,}/g, " ").trim();
  }

  // Parse mentions from text
  const { mentions } = parseMessageWithMentions(text);
  
  // Create message object
  const message = {
    id: crypto && crypto.randomUUID ? crypto.randomUUID() : `msg_${Date.now()}`,
    text,
    mentions,
    attachments: attachmentsToSend,
    createdBy: "me",
    createdAt: Date.now()
  };
  
  // Add to store
  discussionStore.addMessage(message);

  // Notify tagged users (fire-and-forget; don't block UI)
  notifyTaggedUsers({ text, mentions }).catch((e) => {
    console.warn("Tag notification failed:", e);
  });
  
  // Clear input and mentions
  discussionInput.value = "";
  currentMentions = [];
  pendingAttachments = [];
  renderComposerAttachments();
  updateInputPreview();
  
  // Re-render messages
  renderMessages();
  
  // Scroll to bottom
  messagesFeed.scrollTop = messagesFeed.scrollHeight;
}

/**
 * Render all messages
 */
function renderMessages() {
  messagesFeed.innerHTML = "";
  
  if (discussionMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "discussion-empty";
    empty.innerHTML = "<p>No messages yet. Start a discussion with your team!</p>";
    messagesFeed.appendChild(empty);
    return;
  }
  
  discussionMessages.forEach(message => {
    const messageEl = createMessageElement(message);
    messagesFeed.appendChild(messageEl);
  });
}

/**
 * Create message DOM element
 */
function createMessageElement(message) {
  const messageEl = document.createElement("div");
  messageEl.className = "message";
  if (message.createdBy === "me") {
    messageEl.classList.add("me");
  }
  
  // Header with author and time
  const header = document.createElement("div");
  header.className = "message-header";
  
  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = message.createdBy === "me" ? "You" : message.createdBy;
  
  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatMessageTime(message.createdAt);
  
  header.appendChild(author);
  header.appendChild(time);
  
  // Message text with rendered mentions
  const textEl = document.createElement("div");
  textEl.className = "message-text";
  textEl.innerHTML = renderMessageText(message.text, message.mentions);
  
  messageEl.appendChild(header);
  messageEl.appendChild(textEl);

  const atts = Array.isArray(message.attachments) ? message.attachments : [];
  if (atts.length) {
    const wrap = document.createElement("div");
    wrap.className = "message-attachments";
    atts.forEach((att) => {
      if (!att?.tag) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "node-id-link";
      btn.textContent = `[${att.tag}] ${att.nodeType || "Element"}`;
      btn.setAttribute("data-node-tag", att.tag);
      wrap.appendChild(btn);
    });
    messageEl.appendChild(wrap);
  }
  
  return messageEl;
}

/**
 * Render message text with styled mentions
 */
function renderMessageText(text, mentions) {
  if (!mentions || mentions.length === 0) {
    // Linkify node tags like [NG-001]
    return escapeHtml(text).replace(/\[(NG-\d{3})\]/g, `<button type="button" class="node-id-link" data-node-tag="$1">[$1]</button>`);
  }
  
  let result = escapeHtml(text);
  
  // Replace mentions with styled spans
  mentions.forEach(mention => {
    const mentionHtml = `<span class="mention ${mention.type}">${escapeHtml(mention.label)}</span>`;
    const regex = new RegExp(escapeRegExp(escapeHtml(mention.label)), "g");
    result = result.replace(regex, mentionHtml);
  });

  // Linkify node tags like [NG-001]
  result = result.replace(/\[(NG-\d{3})\]/g, `<button type="button" class="node-id-link" data-node-tag="$1">[$1]</button>`);
  return result;
}

/**
 * Format message timestamp
 */
function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return date.toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape regex special characters
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Event Listeners for Discussion
if (discussionInput) {
  discussionInput.addEventListener("input", handleDiscussionInput);
  discussionInput.addEventListener("keydown", handleDiscussionKeydown);
}

if (sendMessageBtn) {
  sendMessageBtn.addEventListener("click", sendMessage);
}

// Click-to-jump for any [NG-###] link in messages
if (messagesFeed) {
  messagesFeed.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".node-id-link");
    const tag = btn?.getAttribute?.("data-node-tag");
    if (tag) {
      e.preventDefault();
      jumpToTag(tag);
    }
  });
}

// Back button for discussion
if (discussionBackBtn) {
  discussionBackBtn.addEventListener("click", () => {
    setActiveNav("stickyTabBtn");
    navigateTo("home");
  });
}

// Update discussion tab click handler to load messages
const originalDiscussionClickHandler = discussionTabBtn?.onclick;
if (discussionTabBtn) {
  discussionTabBtn.addEventListener("click", () => {
    setActiveNav("discussionTabBtn");
    initDiscussion(); // Load and render messages
    pollSelectionAndCount();
    navigateTo("discussion");
  });
}

// Selection chip interactions
if (selectedCanvasNodeChip) {
  selectedCanvasNodeChip.addEventListener("click", () => {
    attachCurrentSelectionToComposer();
  });
  selectedCanvasNodeChip.addEventListener("dragstart", (e) => {
    if (!currentSelection?.nodeId || !currentSelection?.tag) {
      // Assigning IDs is async, so drag can't start yet.
      e.preventDefault();
      setCanvasStatus("Canvas attachment: click the chip once to assign an ID, then drag.");
      return;
    }
    try {
      const payload = JSON.stringify({
        nodeId: currentSelection.nodeId,
        nodeType: currentSelection.nodeType,
        tag: currentSelection.tag
      });
      e.dataTransfer?.setData?.("application/x-notegrid-node", payload);
      e.dataTransfer?.setData?.("text/plain", payload);
      e.dataTransfer.effectAllowed = "copy";
    } catch (_err) {
      // ignore
    }
  });
}

// Dismiss selection (×) inside the selection chip.
// This doesn't change the canvas selection in Express; it just hides the pill until selection changes.
if (dismissSelectedCanvasNodeBtn) {
  dismissSelectedCanvasNodeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentSelection?.nodeId) dismissedSelectionNodeId = currentSelection.nodeId;
    currentSelection = null;
    setCanvasStatus("Canvas attachment: selection cleared.");
    updateSelectionChip();
  });
}

function tryReadDroppedNodePayload(dt) {
  if (!dt) return null;
  const raw = dt.getData("application/x-notegrid-node") || dt.getData("text/plain");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function handleNodeDrop(e) {
  e.preventDefault();
  const payload = tryReadDroppedNodePayload(e.dataTransfer);
  if (!payload?.tag || !payload?.nodeId) return;
  // Only allow ONE attachment at a time in the composer.
  pendingAttachments = [payload];
  renderComposerAttachments();
  // Don't auto-write the tag into the textarea (avoids duplicates).
}

// Allow dropping the node chip into the discussion textarea area.
const dropTargets = [
  discussionInput,
  discussionInput?.closest?.(".textarea-shell"),
  discussionInput?.closest?.(".discussion-input-area")
].filter(Boolean);
dropTargets.forEach((el) => {
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", handleNodeDrop);
});

// Poll canvas selection (UI side timers are allowed)
setInterval(pollSelectionAndCount, 1200);

updateInputPreview();
// Initialize on load
initDiscussion();

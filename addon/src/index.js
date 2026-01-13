import { analyzeText } from "./ai.js";

const board = document.getElementById("board");
const btn = document.getElementById("analyzeBtn");
const input = document.getElementById("inputText");

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

// Existing AI analyze flow (unchanged)
btn.onclick = async () => {
  board.innerHTML = "Analyzing with AI…";

  try {
    const notes = await analyzeText(input.value);
    board.innerHTML = "";

    notes.forEach((n, index) => {
      const div = document.createElement("div");
      div.className = `sticky ${n.type}`;
      div.setAttribute("data-note-type", n.type);
      
      // Get current page/slide metadata
      const pageInfo = getCurrentPageInfo();
      applyNoteMetadata(div, pageInfo);
      
      // Create content wrapper
      const contentWrapper = document.createElement("div");
      contentWrapper.className = "sticky-content";
      contentWrapper.textContent = n.text;
      div.appendChild(contentWrapper);
      
      // Set initial position in a staggered grid pattern
      const cols = 3;
      const col = index % cols;
      const row = Math.floor(index / cols);
      const spacing = 160; // pixels between notes
      div.style.left = `${col * spacing}px`;
      div.style.top = `${row * spacing}px`;
      
      board.appendChild(div);
      
      // Render page/slide tag
      renderPageTag(div);
      
      // Setup collapse button
      setupCollapseButton(div);
      
      // Make note draggable
      makeDraggable(div);
      
      // Store that this was not originally editable
      div.setAttribute("data-original-editable", "false");
    });
  } catch (e) {
    board.innerHTML = "AI failed. Is backend running?";
  }
};

// ============================================
// Create New Note functionality
// ============================================

const createNoteBtn = document.getElementById("createNoteBtn");
const modal = document.getElementById("noteTypeModal");
const closeModalBtn = document.getElementById("closeModal");
const createNoteModalBtn = document.getElementById("createNoteModalBtn");
const noteTitleInput = document.getElementById("noteTitleInput");

/**
 * Shows the create note modal
 */
function showModal() {
  modal.classList.add("show");
  // Focus the input field
  setTimeout(() => {
    noteTitleInput.focus();
  }, 100);
}

/**
 * Hides the create note modal and clears input
 */
function hideModal() {
  modal.classList.remove("show");
  noteTitleInput.value = "";
}

/**
 * Creates a new editable sticky note with the given title
 * @param {string} title - The note title
 */
function createNewNote(title) {
  // Default to "task" type for now (can be extended later)
  const type = "task";
  
  // Create the sticky note element
  const noteDiv = document.createElement("div");
  noteDiv.className = `sticky ${type}`;
  noteDiv.setAttribute("data-note-type", type);
  
  // Create content wrapper for editable content
  const contentWrapper = document.createElement("div");
  contentWrapper.className = "sticky-content";
  contentWrapper.contentEditable = true;
  
  // Set note content to the title (or placeholder if empty)
  contentWrapper.textContent = title.trim() || "Start writing your note...";
  
  noteDiv.appendChild(contentWrapper);
  
  // Get current page/slide metadata and apply to note
  const pageInfo = getCurrentPageInfo();
  applyNoteMetadata(noteDiv, pageInfo);
  
  // Set initial position (staggered to avoid overlap)
  const existingNotes = board.querySelectorAll('.sticky');
  const cols = 3;
  const index = existingNotes.length;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const spacing = 160; // pixels between notes
  noteDiv.style.left = `${col * spacing}px`;
  noteDiv.style.top = `${row * spacing}px`;
  
  // Add to board
  board.appendChild(noteDiv);
  
  // Render page/slide tag
  renderPageTag(noteDiv);
  
  // Setup collapse button
  setupCollapseButton(noteDiv);
  
  // Make note draggable
  makeDraggable(noteDiv);
  
  // Store that this was originally editable
  noteDiv.setAttribute("data-original-editable", "true");
  
  // Immediately focus the content for editing
  contentWrapper.focus();
  
  // If no title was provided, select placeholder text
  if (!title.trim()) {
    const range = document.createRange();
    range.selectNodeContents(contentWrapper);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

// Event listeners for Create New Note flow
createNoteBtn.onclick = showModal;

closeModalBtn.onclick = hideModal;

// Close modal when clicking outside
modal.onclick = (e) => {
  if (e.target === modal) {
    hideModal();
  }
};

// Handle Create button click
createNoteModalBtn.onclick = () => {
  const title = noteTitleInput.value.trim();
  if (title) {
    createNewNote(title);
    hideModal();
  } else {
    // If no title, still create note with placeholder
    createNewNote("");
    hideModal();
  }
};

// Handle Enter key in input field
noteTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    createNoteModalBtn.click();
  }
  
  // Close modal on Escape
  if (e.key === "Escape") {
    hideModal();
  }
});

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

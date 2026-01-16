/*
 * expressAdapter.js
 * Centralized bridge to the Adobe Express Add-on SDK. This module is the ONLY
 * place where real SDK calls are made; UI layers receive normalized data and
 * subscribe to state changes without touching the SDK directly.
 *
 * Hackathon assumptions:
 * - SDK APIs (document/selection) are available once `sdk.ready()` resolves.
 * - The document payload exposes `pages` with `elements` and selection events
 *   fire with enough metadata to build user-friendly chips.
 * Production TODOs are marked inline where retries/permissions would be needed.
 */

const registryListeners = new Set();
const selectionListeners = new Set();

let sdkRef = null;
let documentApi = null;
let selectionApi = null;
let initialized = false;

const elementsById = new Map();
let currentSelectedElement = null;

/**
 * Normalizes raw SDK element payloads into the shape our UI consumes.
 * Hackathon assumption: Express returns `name`, `type`, `id`, and `pageIndex`.
 * Production TODO: Handle missing metadata + localized names.
 */
function normalizeElement(raw, pageIndex = 0) {
  if (!raw || !raw.id) {
    return null;
  }

  const friendlyName = raw.name?.trim() || `Element ${raw.id.slice(-4)}`;
  let type = raw.type || "shape";
  if (!["text", "image", "shape"].includes(type)) {
    type = "shape";
  }

  return {
    id: raw.id,
    name: friendlyName,
    type,
    page: typeof raw.pageNumber === "number" ? raw.pageNumber : pageIndex + 1
  };
}

function notifyRegistryListeners() {
  const snapshot = getRegistry();
  registryListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("Registry listener failed", error);
    }
  });
}

function notifySelectionListeners() {
  const snapshot = getSelectedElement();
  selectionListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("Selection listener failed", error);
    }
  });
}

async function ensureSdk() {
  if (initialized) {
    return sdkRef;
  }

  // REAL SDK access: grab the Adobe Express Add-on SDK from the sandbox iframe.
  sdkRef = window?.adobe?.express?.addon?.sdk || null;
  if (!sdkRef) {
    throw new Error("Adobe Express SDK not found on window");
  }

  // REAL SDK call: wait for Express to signal readiness before subscribing.
  if (sdkRef.ready) {
    await sdkRef.ready();
  }

  documentApi = sdkRef.document;
  selectionApi = sdkRef.selection;
  if (!documentApi || !selectionApi) {
    throw new Error("Adobe Express SDK missing document or selection modules");
  }

  bindDocumentEvents();
  await refreshRegistry();
  await refreshSelection();

  initialized = true;
  return sdkRef;
}

function bindDocumentEvents() {
  if (!documentApi || !selectionApi) {
    return;
  }

  // REAL SDK event hooks – exact names align with Express Add-on SDK.
  selectionApi.onSelectionChanged?.(handleSelectionChanged);
  documentApi.onElementsAdded?.(handleElementsAdded);
  documentApi.onElementsRemoved?.(handleElementsRemoved);
  documentApi.onPageChanged?.(handlePageChanged);
}

async function refreshRegistry() {
  if (!documentApi) return;

  try {
    // REAL SDK call: fetch the current document structure.
    const structure = await documentApi.getDocumentStructure();
    elementsById.clear();

    const pages = structure?.pages || [];
    pages.forEach((page, index) => {
      const pageElements = page?.elements || [];
      pageElements.forEach((element) => {
        const normalized = normalizeElement(element, index);
        if (normalized) {
          elementsById.set(normalized.id, normalized);
        }
      });
    });

    notifyRegistryListeners();
  } catch (error) {
    console.error("Failed to refresh Express registry", error);
    // Production TODO: Surface non-blocking error state to the UI + retry.
  }
}

async function refreshSelection() {
  if (!selectionApi) return;
  try {
    // REAL SDK call: read the current canvas selection.
    const selection = await selectionApi.getSelection();
    const pool = Array.isArray(selection?.elements) ? selection.elements : Array.isArray(selection) ? selection : [];
    const first = Array.isArray(pool) ? pool[0] : null;
    if (!first) {
      currentSelectedElement = null;
      notifySelectionListeners();
      return;
    }
    const normalized = normalizeElement(first, first.pageNumber ?? 0);
    currentSelectedElement = normalized;
    if (normalized && !elementsById.has(normalized.id)) {
      elementsById.set(normalized.id, normalized);
      notifyRegistryListeners();
    }
    notifySelectionListeners();
  } catch (error) {
    console.error("Failed to refresh selection", error);
    currentSelectedElement = null;
    notifySelectionListeners();
  }
}

function handleSelectionChanged(event) {
  // REAL SDK event payload: event.elements contains the selection array.
  const payload = Array.isArray(event?.elements) ? event.elements : Array.isArray(event) ? event : [];
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first) {
    currentSelectedElement = null;
    notifySelectionListeners();
    return;
  }
  const normalized = normalizeElement(first, first.pageNumber ?? 0);
  currentSelectedElement = normalized;
  if (normalized && !elementsById.has(normalized.id)) {
    elementsById.set(normalized.id, normalized);
    notifyRegistryListeners();
  }
  notifySelectionListeners();
}

function handleElementsAdded(event) {
  const added = Array.isArray(event?.elements) ? event.elements : [];
  let hasChanges = false;
  added.forEach((element) => {
    const normalized = normalizeElement(element, element.pageNumber ?? 0);
    if (normalized) {
      elementsById.set(normalized.id, normalized);
      hasChanges = true;
    }
  });
  if (hasChanges) {
    notifyRegistryListeners();
  }
}

function handleElementsRemoved(event) {
  const removed = Array.isArray(event?.elements) ? event.elements : [];
  let hasChanges = false;
  removed.forEach((element) => {
    if (elementsById.delete(element.id)) {
      hasChanges = true;
    }
    if (currentSelectedElement?.id === element.id) {
      currentSelectedElement = null;
      notifySelectionListeners();
    }
  });
  if (hasChanges) {
    notifyRegistryListeners();
  }
}

function handlePageChanged(event) {
  // REAL SDK event: refresh registry to capture new page context.
  void event; // Hackathon note: future versions may inspect event metadata.
  refreshRegistry();
}

function getRegistry() {
  return Array.from(elementsById.values());
}

function getElementById(id) {
  return elementsById.get(id) || null;
}

function getSelectedElement() {
  return currentSelectedElement ? { ...currentSelectedElement } : null;
}

function subscribeRegistry(listener) {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

function subscribeSelection(listener) {
  selectionListeners.add(listener);
  return () => selectionListeners.delete(listener);
}

async function focusElement(elementId) {
  if (!documentApi || !elementId || typeof documentApi.navigateToElement !== "function") {
    throw new Error("Express document API is not ready for navigation");
  }
  try {
    // REAL SDK calls: navigate to the page, focus + highlight the element.
    await documentApi.navigateToElement(elementId);
    await documentApi.flashElement?.(elementId);
  } catch (error) {
    console.error("Failed to focus Express element", error);
    throw error;
  }
}

export default {
  init: ensureSdk,
  getRegistry,
  getElementById,
  getSelectedElement,
  subscribeRegistry,
  subscribeSelection,
  focusElement
};

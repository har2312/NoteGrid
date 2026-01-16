import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor, viewport, EditorEvent } from "express-document-sdk";

const TAG_KEY = "notegridId";

function getFirstSelection() {
  const sel =
    editor.context.selectionIncludingNonEditable ||
    editor.context.selection ||
    [];
  return sel && sel.length ? sel[0] : null;
}

function* walkAllNodes() {
  const root = editor.documentRoot;
  if (!root?.pages) return;
  for (const page of root.pages.toArray()) {
    for (const artboard of page.artboards.toArray()) {
      yield* walkVisualSubtree(artboard);
    }
  }
}

function* walkVisualSubtree(node) {
  if (!node) return;
  yield node;
  // allChildren exists on BaseNode; may be iterable
  const kids = node.allChildren;
  if (!kids) return;
  for (const child of kids) {
    yield* walkVisualSubtree(child);
  }
}

function findNodeById(nodeId) {
  for (const n of walkAllNodes()) {
    if (n?.id === nodeId) return n;
  }
  return null;
}

function findNodeByTag(tag) {
  for (const n of walkAllNodes()) {
    try {
      const t = n?.addOnData?.getItem?.(TAG_KEY);
      if (t === tag) return n;
    } catch (_e) {
      // ignore
    }
  }
  return null;
}

async function setTagOnNode(nodeId, tag) {
  const node = findNodeById(nodeId);
  if (!node) return false;
  await editor.queueAsyncEdit(() => {
    node.addOnData.setItem(TAG_KEY, String(tag));
  });
  return true;
}

function getTagOnNode(nodeId) {
  const node = findNodeById(nodeId);
  if (!node) return null;
  try {
    return node.addOnData.getItem(TAG_KEY) || null;
  } catch (_e) {
    return null;
  }
}

function countTaggedNodes() {
  let count = 0;
  for (const n of walkAllNodes()) {
    try {
      if (n?.addOnData?.getItem?.(TAG_KEY)) count += 1;
    } catch (_e) {
      // ignore
    }
  }
  return count;
}

function focusNode(node) {
  if (!node) return { ok: false };
  try {
    viewport.bringIntoView(node);
  } catch (_e) {
    // ignore
  }
  try {
    editor.context.selection = node;
  } catch (_e) {
    // ignore (locked/non-editable)
  }
  return { ok: true, nodeId: node.id, nodeType: node.type };
}

let lastSelection = null;
try {
  editor.context.on(EditorEvent.selectionChange, () => {
    // read-only: safe
    const node = getFirstSelection();
    lastSelection = node ? { nodeId: node.id, nodeType: node.type } : null;
  });
} catch (_e) {
  // ignore
}

addOnSandboxSdk.instance.runtime.exposeApi({
  getSelection() {
    const sel =
      editor.context.selectionIncludingNonEditable ||
      editor.context.selection ||
      [];
    const node = sel && sel.length ? sel[0] : null;
    if (!node) return null;
    return {
      nodeId: node.id,
      nodeType: node.type,
      tag: getTagOnNode(node.id),
      selectionCount: sel.length
    };
  },
  getTaggedCount() {
    return countTaggedNodes();
  },
  async ensureTag(nodeId, tag) {
    const existing = getTagOnNode(nodeId);
    if (existing) return existing;
    await setTagOnNode(nodeId, tag);
    return getTagOnNode(nodeId);
  },
  focusByTag(tag) {
    const node = findNodeByTag(tag);
    return focusNode(node);
  },
  focusByNodeId(nodeId) {
    const node = findNodeById(nodeId);
    return focusNode(node);
  }
});


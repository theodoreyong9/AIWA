// desktop-layout.js — the data model and pure logic behind drag-and-
// drop desktop icons and folders, adapted from the real mechanism in
// YourMine's desk.js (pointer-based drag, drop-onto-icon creates a
// folder, drag-out-of-folder ejects) — scoped down deliberately: AIWA's
// desktop is a single page of pinned modules, not YourMine's paginated
// multi-screen desktop with edge-scroll-to-next-page, so that part is
// not reproduced here; nothing about the pinning/rank logic already
// built (main.js's pinnedIds()) changes, this sits on top of it.
//
// Kept pure and fully testable on purpose: the actual pointer-event
// wiring (drag threshold, ghost element following the cursor, cell hit-
// testing against the real DOM grid) is real code but requires an
// actual browser to verify, following this project's established
// discipline of separating that untestable half from logic that
// doesn't need a DOM at all — every rule about WHERE an icon ends up
// after a drag lives here, not scattered through event handlers.

/**
 * @typedef {{ kind: 'icon', moduleId: string }} DesktopIconItem
 * @typedef {{ kind: 'folder', id: string, label: string, moduleIds: string[] }} DesktopFolderItem
 * @typedef {DesktopIconItem | DesktopFolderItem} DesktopItem
 */

/**
 * Builds an initial layout from a flat list of pinned module ids —
 * what every existing desktop already has today, before any folder or
 * reorder has ever happened. Order is preserved exactly.
 * @param {string[]} moduleIds
 * @returns {DesktopItem[]}
 */
export function layoutFromPinnedIds(moduleIds) {
  return moduleIds.map((moduleId) => ({ kind: 'icon', moduleId }));
}

/**
 * Every module id currently on the desktop, top-level or inside a
 * folder — what rank-sorting and pin-toggling (main.js's existing
 * pinnedIds()-based logic) need to keep working unchanged regardless
 * of whether an icon happens to be inside a folder right now.
 * @param {DesktopItem[]} layout
 * @returns {string[]}
 */
export function allModuleIdsInLayout(layout) {
  const ids = [];
  for (const item of layout) {
    if (item.kind === 'icon') ids.push(item.moduleId);
    else ids.push(...item.moduleIds);
  }
  return ids;
}

/**
 * Reorders the desktop — dragging an icon (or folder) to a new
 * position among top-level items. Out-of-range indices are clamped
 * rather than throwing, since a real drag's drop coordinates are
 * never perfectly bounded.
 * @param {DesktopItem[]} layout
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {DesktopItem[]}
 */
export function moveItem(layout, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= layout.length) return layout;
  const clampedTo = Math.max(0, Math.min(toIndex, layout.length - 1));
  const next = [...layout];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/**
 * Drops one top-level icon onto another top-level icon — the real
 * mechanism, matching desk.js: dropping icon A onto icon B, neither
 * already a folder, replaces B's position with a brand-new folder
 * containing both, A removed from its old position. Dropping onto an
 * existing folder instead appends into it (mergeIntoFolder handles
 * that case) — this function is specifically the "two bare icons
 * collide" case.
 *
 * @param {DesktopItem[]} layout
 * @param {number} draggedIndex
 * @param {number} targetIndex
 * @param {() => string} makeFolderId — injected so callers control id
 *   generation (e.g. crypto.randomUUID() in the real app, a fixed
 *   sequence in tests) rather than this pure function reaching for a
 *   global itself.
 * @returns {DesktopItem[]}
 */
export function createFolderFromDrop(layout, draggedIndex, targetIndex, makeFolderId) {
  if (draggedIndex === targetIndex) return layout;
  const dragged = layout[draggedIndex];
  const target = layout[targetIndex];
  if (!dragged || !target || dragged.kind !== 'icon' || target.kind !== 'icon') return layout;

  const folder = { kind: 'folder', id: makeFolderId(), label: 'Folder', moduleIds: [target.moduleId, dragged.moduleId] };
  const withoutDragged = layout.filter((_, i) => i !== draggedIndex);
  const targetIndexAfterRemoval = withoutDragged.indexOf(target);
  const next = [...withoutDragged];
  next[targetIndexAfterRemoval] = folder;
  return next;
}

/**
 * Drops a bare icon onto an existing folder — appends into it rather
 * than creating a nested folder (folders never contain folders, the
 * same flat-one-level-deep choice desk.js effectively makes for
 * AIWA's simpler single-page scope). Dropping a module id that is
 * already inside the target folder is a no-op, not a duplicate entry.
 *
 * @param {DesktopItem[]} layout
 * @param {number} draggedIndex
 * @param {string} targetFolderId
 * @returns {DesktopItem[]}
 */
export function mergeIntoFolder(layout, draggedIndex, targetFolderId) {
  const dragged = layout[draggedIndex];
  if (!dragged || dragged.kind !== 'icon') return layout;
  const folderIndex = layout.findIndex((it) => it.kind === 'folder' && it.id === targetFolderId);
  if (folderIndex === -1) return layout;

  const folder = layout[folderIndex];
  if (folder.moduleIds.includes(dragged.moduleId)) return layout; // already inside — no-op, not a duplicate

  const withoutDragged = layout.filter((_, i) => i !== draggedIndex);
  const newFolderIndex = withoutDragged.findIndex((it) => it.kind === 'folder' && it.id === targetFolderId);
  const next = [...withoutDragged];
  next[newFolderIndex] = { ...folder, moduleIds: [...folder.moduleIds, dragged.moduleId] };
  return next;
}

/**
 * Removes one module id from a folder — dragging an icon out (desk.js's
 * "drop zone" / drag-outside-the-panel gesture). The ejected icon
 * reappears as a bare top-level item, appended at the end of the
 * desktop. Deliberately does NOT auto-dissolve a folder left with only
 * one item — a folder the user made stays a folder until they choose
 * to empty it entirely, rather than silently vanishing under them.
 *
 * @param {DesktopItem[]} layout
 * @param {string} folderId
 * @param {string} moduleId
 * @returns {DesktopItem[]}
 */
export function ejectFromFolder(layout, folderId, moduleId) {
  const folderIndex = layout.findIndex((it) => it.kind === 'folder' && it.id === folderId);
  if (folderIndex === -1) return layout;
  const folder = layout[folderIndex];
  if (!folder.moduleIds.includes(moduleId)) return layout;

  const remaining = folder.moduleIds.filter((id) => id !== moduleId);
  const next = [...layout];
  if (remaining.length === 0) {
    next.splice(folderIndex, 1); // an emptied folder is removed, not left as an empty husk
  } else {
    next[folderIndex] = { ...folder, moduleIds: remaining };
  }
  next.push({ kind: 'icon', moduleId });
  return next;
}

/**
 * Renames a folder — the one piece of folder metadata a user directly
 * edits (matching desk.js's long-press-to-rename gesture). Unknown
 * folder id is a no-op, not an error — a rename racing a deletion
 * should not throw.
 * @param {DesktopItem[]} layout
 * @param {string} folderId
 * @param {string} newLabel
 * @returns {DesktopItem[]}
 */
export function renameFolder(layout, folderId, newLabel) {
  const trimmed = newLabel.trim();
  if (!trimmed) return layout;
  return layout.map((it) => (it.kind === 'folder' && it.id === folderId ? { ...it, label: trimmed } : it));
}

/**
 * Removes a module id entirely from the desktop (top-level or inside
 * any folder) — what "unpin" needs now that a module might be nested.
 * An emptied folder is removed, matching ejectFromFolder's own rule.
 * @param {DesktopItem[]} layout
 * @param {string} moduleId
 * @returns {DesktopItem[]}
 */
export function removeModuleFromLayout(layout, moduleId) {
  const next = [];
  for (const item of layout) {
    if (item.kind === 'icon') {
      if (item.moduleId !== moduleId) next.push(item);
    } else {
      const remaining = item.moduleIds.filter((id) => id !== moduleId);
      if (remaining.length > 0) next.push({ ...item, moduleIds: remaining });
      // an emptied folder is dropped silently, same rule as ejectFromFolder
    }
  }
  return next;
}

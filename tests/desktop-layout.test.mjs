import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutFromPinnedIds, allModuleIdsInLayout, moveItem, createFolderFromDrop,
  mergeIntoFolder, ejectFromFolder, renameFolder, removeModuleFromLayout,
} from '../public/js/core/desktop/desktop-layout.js';

test('layoutFromPinnedIds preserves order exactly, matching what every existing desktop already has', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js', 'c.js']);
  assert.deepEqual(layout, [{ kind: 'icon', moduleId: 'a.js' }, { kind: 'icon', moduleId: 'b.js' }, { kind: 'icon', moduleId: 'c.js' }]);
});

test('allModuleIdsInLayout flattens both top-level icons and folder contents', () => {
  const layout = [{ kind: 'icon', moduleId: 'a.js' }, { kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['b.js', 'c.js'] }];
  assert.deepEqual(allModuleIdsInLayout(layout), ['a.js', 'b.js', 'c.js']);
});

test('moveItem reorders top-level items', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js', 'c.js']);
  const moved = moveItem(layout, 0, 2);
  assert.deepEqual(allModuleIdsInLayout(moved), ['b.js', 'c.js', 'a.js']);
});

test('moveItem clamps an out-of-range target index rather than throwing', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js']);
  assert.doesNotThrow(() => moveItem(layout, 0, 999));
  assert.doesNotThrow(() => moveItem(layout, 0, -50));
});

test('moveItem with an out-of-range source index is a no-op, not a crash', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js']);
  const result = moveItem(layout, 99, 0);
  assert.deepEqual(result, layout);
});

test('createFolderFromDrop: dropping one bare icon onto another creates a real folder containing both', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js', 'c.js']);
  const next = createFolderFromDrop(layout, 0, 1, () => 'folder-1'); // drag a.js onto b.js
  const folder = next.find((it) => it.kind === 'folder');
  assert.ok(folder);
  assert.equal(folder.id, 'folder-1');
  assert.deepEqual(folder.moduleIds, ['b.js', 'a.js']); // target first, then dragged
  assert.equal(next.length, 2); // a.js's old slot is gone, folder replaces b.js's slot, c.js untouched
  assert.ok(next.some((it) => it.kind === 'icon' && it.moduleId === 'c.js'));
});

test('createFolderFromDrop is a no-op when dragged and target are the same index', () => {
  const layout = layoutFromPinnedIds(['a.js']);
  assert.deepEqual(createFolderFromDrop(layout, 0, 0, () => 'x'), layout);
});

test('createFolderFromDrop is a no-op if the target is already a folder — that case is mergeIntoFolder\'s job, not this one\'s', () => {
  const layout = [{ kind: 'icon', moduleId: 'a.js' }, { kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['b.js'] }];
  const result = createFolderFromDrop(layout, 0, 1, () => 'x');
  assert.deepEqual(result, layout);
});

test('mergeIntoFolder appends a dropped icon into an existing folder', () => {
  const layout = [{ kind: 'icon', moduleId: 'a.js' }, { kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['b.js'] }];
  const next = mergeIntoFolder(layout, 0, 'f1');
  const folder = next.find((it) => it.kind === 'folder');
  assert.deepEqual(folder.moduleIds, ['b.js', 'a.js']);
  assert.equal(next.length, 1); // a.js's top-level slot is gone
});

test('mergeIntoFolder dropping an id already inside the folder is a no-op, not a duplicate', () => {
  const layout = [{ kind: 'icon', moduleId: 'a.js' }, { kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js', 'b.js'] }];
  const next = mergeIntoFolder(layout, 0, 'f1');
  assert.deepEqual(next, layout);
});

test('mergeIntoFolder targeting an unknown folder id is a no-op', () => {
  const layout = layoutFromPinnedIds(['a.js']);
  const next = mergeIntoFolder(layout, 0, 'nonexistent');
  assert.deepEqual(next, layout);
});

test('ejectFromFolder removes the module from the folder and reappears as a bare top-level icon', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js', 'b.js'] }];
  const next = ejectFromFolder(layout, 'f1', 'a.js');
  const folder = next.find((it) => it.kind === 'folder');
  assert.deepEqual(folder.moduleIds, ['b.js']);
  assert.ok(next.some((it) => it.kind === 'icon' && it.moduleId === 'a.js'));
});

test('ejectFromFolder removes the folder entirely once it is emptied, not left as an empty husk', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js'] }];
  const next = ejectFromFolder(layout, 'f1', 'a.js');
  assert.equal(next.some((it) => it.kind === 'folder'), false);
  assert.deepEqual(next, [{ kind: 'icon', moduleId: 'a.js' }]);
});

test('ejectFromFolder does NOT auto-dissolve a folder left with exactly one item — a deliberate scope choice', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js', 'b.js'] }];
  const next = ejectFromFolder(layout, 'f1', 'a.js');
  const folder = next.find((it) => it.kind === 'folder');
  assert.ok(folder, 'a folder with one remaining item must still be a folder, not silently unwrapped');
  assert.deepEqual(folder.moduleIds, ['b.js']);
});

test('ejectFromFolder is a no-op for an unknown folder or a module not actually in it', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js'] }];
  assert.deepEqual(ejectFromFolder(layout, 'nonexistent', 'a.js'), layout);
  assert.deepEqual(ejectFromFolder(layout, 'f1', 'not-in-folder.js'), layout);
});

test('renameFolder updates only the targeted folder\'s label', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Folder', moduleIds: ['a.js'] }, { kind: 'folder', id: 'f2', label: 'Folder', moduleIds: ['b.js'] }];
  const next = renameFolder(layout, 'f1', 'Games');
  assert.equal(next.find((it) => it.id === 'f1').label, 'Games');
  assert.equal(next.find((it) => it.id === 'f2').label, 'Folder');
});

test('renameFolder trims whitespace and rejects an empty/whitespace-only name as a no-op', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Folder', moduleIds: ['a.js'] }];
  assert.equal(renameFolder(layout, 'f1', '  Tools  ').find((it) => it.id === 'f1').label, 'Tools');
  assert.deepEqual(renameFolder(layout, 'f1', '   '), layout);
});

test('removeModuleFromLayout removes a bare top-level icon', () => {
  const layout = layoutFromPinnedIds(['a.js', 'b.js']);
  assert.deepEqual(allModuleIdsInLayout(removeModuleFromLayout(layout, 'a.js')), ['b.js']);
});

test('removeModuleFromLayout removes a module nested inside a folder, without touching other folder members', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js', 'b.js'] }];
  const next = removeModuleFromLayout(layout, 'a.js');
  assert.deepEqual(next, [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['b.js'] }]);
});

test('removeModuleFromLayout drops a folder entirely once its last member is removed', () => {
  const layout = [{ kind: 'folder', id: 'f1', label: 'Games', moduleIds: ['a.js'] }];
  assert.deepEqual(removeModuleFromLayout(layout, 'a.js'), []);
});

test('a full realistic sequence — reorder, fold, merge, eject — composes correctly end to end', () => {
  let layout = layoutFromPinnedIds(['weather.js', 'chess.js', 'notes.js']);
  layout = createFolderFromDrop(layout, 0, 1, () => 'utility-folder'); // weather.js onto chess.js
  assert.deepEqual(allModuleIdsInLayout(layout).sort(), ['chess.js', 'notes.js', 'weather.js'].sort());

  layout = layoutFromPinnedIds(['weather.js', 'chess.js', 'notes.js']);
  layout = createFolderFromDrop(layout, 0, 1, () => 'utility-folder');
  const folderIndex = layout.findIndex((it) => it.kind === 'folder');
  const notesIndex = layout.findIndex((it) => it.kind === 'icon' && it.moduleId === 'notes.js');
  layout = mergeIntoFolder(layout, notesIndex, layout[folderIndex].id);
  assert.deepEqual(layout[0].moduleIds.sort(), ['chess.js', 'notes.js', 'weather.js'].sort());

  layout = ejectFromFolder(layout, layout[0].id, 'chess.js');
  assert.ok(layout.some((it) => it.kind === 'icon' && it.moduleId === 'chess.js'));
  assert.deepEqual(allModuleIdsInLayout(layout).sort(), ['chess.js', 'notes.js', 'weather.js'].sort());
});

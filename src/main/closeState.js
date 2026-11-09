// closeState.js — one tiny piece of shared state between the IPC channel that
// reports an unsaved editor and the BrowserWindow close guard.

let editorDirty = false

export function setEditorDirty(value) {
  editorDirty = Boolean(value)
}

export function isEditorDirty() {
  return editorDirty
}

import { contextBridge, ipcRenderer } from 'electron'

// The renderer has no Node access (contextIsolation on, nodeIntegration off).
// Every main-process call it can make is listed here.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  teachers: {
    list: () => invoke('teachers:list'),
    save: (teacher) => invoke('teachers:save', teacher),
    delete: (id) => invoke('teachers:delete', id)
  },

  subjects: {
    list: () => invoke('subjects:list'),
    save: (subject) => invoke('subjects:save', subject),
    delete: (id) => invoke('subjects:delete', id)
  },

  venues: {
    list: () => invoke('venues:list'),
    save: (venue) => invoke('venues:save', venue),
    delete: (id) => invoke('venues:delete', id)
  },

  timetables: {
    list: () => invoke('timetables:list'),
    save: (timetable) => invoke('timetables:save', timetable),
    delete: (id) => invoke('timetables:delete', id),
    validate: (id) => invoke('timetable:validate', id)
  },

  sections: {
    list: (timetableId) => invoke('sections:list', timetableId),
    save: (section) => invoke('sections:save', section),
    delete: (id) => invoke('sections:delete', id)
  },

  allocations: {
    list: (sectionId) => invoke('allocations:list', sectionId),
    save: (sectionId, subjectId, teacherIds) =>
      invoke('allocations:save', sectionId, subjectId, teacherIds),
    delete: (id) => invoke('allocations:delete', id)
  },

  slots: {
    listBySection: (sectionId) => invoke('slots:listBySection', sectionId),
    save: (slot, teacherIds = [], slotId = null) =>
      invoke('slots:save', slot, teacherIds, slotId),
    check: (slot, teacherIds = [], slotId = null) =>
      invoke('slots:check', slot, teacherIds, slotId),
    busy: (timetableId, day, startPeriod, span, ignoreSlotId = null, mergeGroup = null) =>
      invoke('slots:busy', timetableId, day, startPeriod, span, ignoreSlotId, mergeGroup),
    mergeCandidates: (slot, teacherIds = [], slotId = null) =>
      invoke('slots:merge-candidates', slot, teacherIds, slotId),
    joinMerge: (slot, candidateSlotId) => invoke('slots:join-merge', slot, candidateSlotId),
    leaveGroup: (slotId, slot = null, teacherIds = null) =>
      invoke('slots:leave-group', slotId, slot, teacherIds),
    delete: (id) => invoke('slots:delete', id)
  },

  views: {
    faculty: (timetableId, teacherId) => invoke('views:faculty', timetableId, teacherId),
    venue: (timetableId, venueId) => invoke('views:venue', timetableId, venueId),
    free: (timetableId, kind, id) => invoke('views:free', timetableId, kind, id),
    summary: (timetableId) => invoke('views:summary', timetableId)
  },

  exportData: {
    chooseFolder: () => invoke('export:choose-folder'),
    // format: 'excel' | 'pdf' | 'both' ("both" writes the workbook and its
    // PDF twin; the single flow asks for one path and derives the other).
    single: (kind, timetableId, id, format) => invoke('export:single', kind, timetableId, id, format),
    one: (timetableId, kind, id, dir, format) =>
      invoke('export:one', timetableId, kind, id, dir, format),
    combined: (timetableId, kind, dir, format) => invoke('export:combined', timetableId, kind, dir, format),
    preview: (kind, timetableId, id) => invoke('export:preview', kind, timetableId, id),
    openFolder: (folder) => invoke('export:open-folder', folder)
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('Preload failed to expose the API:', error)
}

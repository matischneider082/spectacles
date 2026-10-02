import { addSubtask, addTask, attachScreenshot, completeTask, createChange, getChange, listChanges } from '../work.js';

export function createAdapter({ cwd }) {
  return {
    createChange: (title) => createChange(cwd, title),
    addTask: (slug, text) => addTask(cwd, slug, text),
    addSubtask: (slug, parentId, text) => addSubtask(cwd, slug, parentId, text),
    completeTask: (slug, number, resolution) => completeTask(cwd, slug, number, resolution),
    attachScreenshot: (slug, id, file) => attachScreenshot(cwd, slug, id, file),
    getChange: (slug) => getChange(cwd, slug),
    listChanges: () => listChanges(cwd),
  };
}

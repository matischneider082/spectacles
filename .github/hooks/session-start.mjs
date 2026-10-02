import { listChanges } from '../../app/work.js';
import { progress } from '../../app/task-view.js';

const changes = listChanges(process.cwd());
const summary = changes.length
  ? changes.map((change) => `${change.slug}: ${progress(change)} tasks`).join(', ')
  : 'No local changes yet.';

process.stdout.write(JSON.stringify({
  additionalContext: `Spectacles local OpenSpec work: ${summary} Use the spectacles-work skill for creating or updating work. Linear and Jira are not connected.`,
}));

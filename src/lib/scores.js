export function todayInLosAngeles(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatEntryDate(date, locales) {
  return new Intl.DateTimeFormat(locales, { timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

async function scoresRequest(options) {
  const response = await fetch('/api/scores', { credentials: 'same-origin', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Your scores could not be saved. Please try again.');
  if (!Array.isArray(body.entries)) throw new Error('Your scores could not be read. Please try again.');
  return body.entries;
}

export function loadScores(signal) {
  return scoresRequest({ signal });
}

export function saveScore(entry) {
  return scoresRequest({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
}

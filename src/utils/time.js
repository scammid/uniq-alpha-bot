// Normalizes a timestamp of unknown shape (ms epoch, seconds epoch, or an
// ISO/date string) into a ms epoch number, or 0 if it can't be parsed.
//
// Why this exists: mint/win date comparisons (`Date.now() - endDate`) only
// work correctly if endDate is already a ms epoch number. If the Alphabot
// API ever returns seconds, or an ISO string, that math silently produces
// wrong (often NaN or huge) results — which for the win-alert check meant
// every win would look "not recent" and would be skipped without any error.
function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    // A ms epoch has 13 digits from ~2001 onward; a seconds epoch has 10.
    // Anything below 1e12 is treated as seconds and scaled up.
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === 'string') {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && value.trim() !== '') return normalizeTimestamp(asNum);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

module.exports = { normalizeTimestamp };

// Shows a stored date as a calendar date. Formatted in UTC, so a date saved as
// midnight UTC doesn't shift to the previous day for users west of UTC. Missing
// or invalid values show as "—": new Date(null) would otherwise show 1/1/1970.
export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

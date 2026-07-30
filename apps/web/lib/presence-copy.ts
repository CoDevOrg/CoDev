/** Human-readable collaboration presence for the IDE topbar. */
export function formatPresenceCopy(peopleCount: number): string {
  const count = Math.max(0, Math.floor(peopleCount));
  if (count <= 0) return "Just you";
  if (count === 1) return "1 person here";
  return `${count} people here`;
}

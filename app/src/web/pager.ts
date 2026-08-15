// Block pagination: show 5 page numbers at a time (1~5, 6~10, …).
// "‹" steps into the previous block, "›" into the next one.
export function pageBlock(current: number, total: number, size = 5) {
  const start = Math.floor((current - 1) / size) * size + 1;
  const end = Math.min(total, start + size - 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return { pages, hasPrev: start > 1, hasNext: end < total };
}

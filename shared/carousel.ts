export function loopScroll(left: number, cycle: number) {
  if (cycle <= 0) return 0;
  return (((left % cycle) + cycle) % cycle) + cycle;
}

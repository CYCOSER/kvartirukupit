export type UnfoldState = 'before' | 'open' | 'after';

export function nextUnfoldState(
  state: UnfoldState,
  top: number,
  bottom: number,
  viewport: number,
  direction: number,
): UnfoldState {
  if (state === 'before') {
    if (top < 0) return 'after';
    return direction > 0 && top <= viewport * 0.5 ? 'open' : state;
  }
  if (state === 'after') {
    if (top > viewport) return 'before';
    return direction < 0 && top >= viewport * 0.5 ? 'open' : state;
  }
  if (direction > 0 && bottom <= viewport * 0.5) return 'after';
  if (direction < 0 && top >= viewport * 0.5) return 'before';
  return state;
}

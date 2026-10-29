export type UnfoldState = 'before' | 'open';

export function nextUnfoldState(
  state: UnfoldState,
  top: number,
  viewport: number,
): UnfoldState {
  return state === 'open' || top <= viewport * 0.5 ? 'open' : 'before';
}

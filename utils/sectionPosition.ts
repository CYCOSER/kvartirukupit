export function sectionPosition(hash: string) {
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return;
  window.dispatchEvent(new CustomEvent('unfold:navigate', { detail: target }));
  return { el: target, top: 24, behavior: 'instant' as const };
}

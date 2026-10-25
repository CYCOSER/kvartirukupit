export function useAutoResizeTextarea(value: () => string) {
  const field = ref<HTMLTextAreaElement>();
  let observer: ResizeObserver | undefined;

  function resize() {
    if (!field.value) return;
    field.value.style.height = 'auto';
    field.value.style.height = `${field.value.scrollHeight + 2}px`;
  }

  watch(value, () => nextTick(resize));
  onMounted(() => {
    resize();
    let width = 0;
    observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    if (field.value) observer.observe(field.value);
  });
  onBeforeUnmount(() => observer?.disconnect());

  return field;
}

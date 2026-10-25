export type ImportObject = {
  id: string | number;
  title: string;
  category: string;
  location: string;
  address: string;
  price: number | null;
  area: number | null;
  bedrooms: number | null;
  floors: number | null;
  developer: string | null;
  layoutCount?: number;
  supported: boolean;
  existingId: string | null;
};

export const emptyImportFilters = () => ({
  query: "",
  category: "",
  city: "",
  developer: "",
  rooms: "",
  status: "",
  sort: "title",
  minPrice: "" as string | number,
  maxPrice: "" as string | number,
  minArea: "" as string | number,
  maxArea: "" as string | number,
});
export type ImportFilters = ReturnType<typeof emptyImportFilters>;

function bound(value: string | number) {
  return value === "" ? null : Number(value);
}

export function importFilterError(filters: ImportFilters): string {
  for (const [min, max, label] of [
    [filters.minPrice, filters.maxPrice, "цены"],
    [filters.minArea, filters.maxArea, "площади"],
  ] as const) {
    const lower = bound(min),
      upper = bound(max);
    if (
      [lower, upper].some(
        (value) => value !== null && (!Number.isFinite(value) || value < 0),
      )
    )
      return "Укажите положительное число или 0 в фильтрах цены и площади.";
    if (lower !== null && upper !== null && lower > upper)
      return `Минимум ${label} не может быть больше максимума.`;
  }
  return "";
}

export function filterImportObjects(
  items: ImportObject[],
  filters: ImportFilters,
): ImportObject[] {
  if (importFilterError(filters)) return [];
  const search = filters.query.trim().toLocaleLowerCase("ru");
  const inRange = (
    value: number | null,
    min: string | number,
    max: string | number,
  ) => {
    const lower = bound(min),
      upper = bound(max);
    if (lower === null && upper === null) return true;
    return (
      value != null &&
      Number.isFinite(value) &&
      (lower === null || value >= lower) &&
      (upper === null || value <= upper)
    );
  };
  const result = items.filter(
    (item) =>
      (!filters.category || item.category === filters.category) &&
      (!filters.city || item.location === filters.city) &&
      (!filters.developer || item.developer === filters.developer) &&
      (!filters.rooms ||
        (item.bedrooms != null &&
          (filters.rooms === "4+"
            ? item.bedrooms >= 4
            : item.bedrooms === Number(filters.rooms)))) &&
      (!filters.status ||
        (filters.status === "ready"
          ? item.supported && !item.existingId
          : filters.status === "imported"
            ? !!item.existingId
            : !item.supported)) &&
      inRange(item.price, filters.minPrice, filters.maxPrice) &&
      inRange(item.area, filters.minArea, filters.maxArea) &&
      `${item.id} ${item.title} ${item.location} ${item.address} ${item.developer || ""}`
        .toLocaleLowerCase("ru")
        .includes(search),
  );
  return result.sort((a, b) => {
    if (filters.sort === "title")
      return a.title.localeCompare(b.title, "ru", { numeric: true });
    const field = filters.sort.startsWith("area") ? "area" : "price";
    const left = a[field],
      right = b[field];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return (left - right) * (filters.sort.endsWith("desc") ? -1 : 1);
  });
}

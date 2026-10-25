import type { Property } from "./property";

export type AdminSortField =
  "title" | "price" | "area" | "status" | "published";
export type AdminSortDirection = "asc" | "desc";

export function sortAdminProperties<T extends Pick<Property, AdminSortField>>(
  items: T[],
  field: AdminSortField | null,
  direction: AdminSortDirection,
) {
  if (!field) return items;
  const sign = direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    const a = left[field],
      b = right[field];
    // Unknown prices and areas stay at the end in either direction.
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    if (field === "title")
      return String(a).localeCompare(String(b), "ru", { numeric: true }) * sign;
    if (field === "status") {
      const order = { available: 0, reserved: 1, sold: 2 };
      return (order[left.status] - order[right.status]) * sign;
    }
    return (Number(a) - Number(b)) * sign;
  });
}

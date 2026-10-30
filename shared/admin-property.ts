import type { Property } from "./property";

export type AdminPropertyListItem = Pick<
  Property,
  | "id"
  | "title"
  | "type"
  | "location"
  | "address"
  | "price"
  | "area"
  | "status"
  | "published"
  | "featured"
  | "elite"
  | "housingMarket"
  | "demo"
  | "sourceUrl"
  | "sourceName"
> & { images: { file: string }[] };

export const adminPropertyTypes = {
  complex: "Жилой комплекс",
  apartment: "Квартира",
  elite_apartment: "Элитная квартира",
} as const;

export function adminPropertyType(
  property: Pick<Property, "type" | "elite">,
): keyof typeof adminPropertyTypes {
  return property.type === "apartment" && property.elite
    ? "elite_apartment"
    : property.type;
}

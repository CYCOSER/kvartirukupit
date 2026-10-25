import { z } from "zod";
export const types = {
  complex: "Жилой комплекс",
  apartment: "Квартира",
};
export const statuses = {
  available: "В продаже",
  reserved: "Забронирован",
  sold: "Продан",
};
export const leadStatuses = {
  new: "Новая",
  in_progress: "В работе",
  done: "Завершена",
};
const coastalLocations = new Set([
  "зеленоградск",
  "светлогорск",
  "пионерский",
  "балтийск",
  "янтарный",
  "приморск",
  "сокольники",
  "малиновка",
  "куликово",
  "заостровье",
  "отрадное",
  "приморье",
  "донское",
  "филино",
  "лесной",
  "рыбачий",
  "морское",
]);
export function isCoastalLocation(location: string) {
  return location.split(",").some((part) =>
    coastalLocations.has(
      part
        .trim()
        .toLowerCase()
        .replace(/^(?:г\.|город\s+|п\.|пос\.|пос[её]лок\s+)\s*/, ""),
    ),
  );
}
export function seaDistanceLabel(
  property: Pick<PropertyInput, "location" | "seaDistance">,
) {
  const distance = property.seaDistance;
  if (!isCoastalLocation(property.location) || distance == null) return null;
  return distance < 1000
    ? `${distance.toLocaleString("ru-RU")} м до моря`
    : `${(distance / 1000).toLocaleString("ru-RU")} км до моря`;
}
export function apartmentTitle(bedrooms: number | null | undefined, area: number | null | undefined) {
  const rooms = bedrooms === 0 ? "Студия" : bedrooms == null ? "Квартира" : `${bedrooms}-к кв.`;
  return area ? `${rooms} ${area} м²` : rooms;
}

export function formatReadiness(value: string, constructionStatus?: string | null) {
  let text = value.trim().replace(/(^|[\s,;])([1-4])\s*кв(?:артал)?\.?/gi,
    (_, prefix, quarter) => `${prefix}${["I", "II", "III", "IV"][Number(quarter) - 1]} кв.`);
  const status = constructionStatus?.trim();
  if (status && text.toLocaleLowerCase("ru").startsWith(status.toLocaleLowerCase("ru"))) {
    const remainder = text.slice(status.length);
    if (!remainder || /^\s*[,;:—–-]/.test(remainder)) text = remainder.replace(/^\s*[,;:—–-]\s*/, "");
  }
  return text;
}

export function propertyAddress(property: Pick<PropertyInput, "address" | "location">) {
  const address = property.address.trim();
  const city = property.location.trim();
  const normalized = address.toLocaleLowerCase("ru").replace(/^(?:г\.\s*|г\s+|город\s+)/, "");
  const prefix = city.toLocaleLowerCase("ru").replace(/^(?:г\.\s*|г\s+|город\s+)/, "");
  return !address ? city : !city || normalized === prefix || normalized.startsWith(prefix + ",") || normalized.startsWith(prefix + " ")
    ? address : `${city}, ${address}`;
}

export function withPublicTitle<T extends Pick<Property, "title" | "bedrooms" | "area" | "sourceMode"> & { type: string }>(property: T): T {
  if (property.type !== "apartment" || property.sourceMode !== "nmarket-copy") return property;
  const rooms = property.bedrooms === 0 ? "Студия" : property.bedrooms == null ? "Квартира" : `${property.bedrooms}-комнатная квартира`;
  const legacyTitle = [rooms, property.area ? `${property.area} м²` : ""].filter(Boolean).join(" · ");
  return property.title === legacyTitle || property.title.startsWith(`${legacyTitle} · `)
    ? { ...property, title: apartmentTitle(property.bedrooms, property.area) }
    : property;
}

const sourceComplexId = z.string().trim().max(100).regex(/^[a-zA-Z0-9._:-]+$/).nullable().optional();
export const propertySchema = z.object({
  title: z.string().trim().min(3).max(500),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  type: z.enum(["complex", "apartment"]),
  complexId: z.string().trim().min(1).max(100).nullable().optional(),
  nmarketComplexId: sourceComplexId,
  rf39ComplexId: sourceComplexId,
  rf39BuildingId: sourceComplexId,
  location: z.string().trim().min(2).max(150),
  address: z.string().trim().max(2000).default(""),
  latitude: z.number().finite().min(-90).max(90).nullable().default(null),
  longitude: z.number().finite().min(-180).max(180).nullable().default(null),
  price: z.number().int().min(0).max(2000000000).nullable(),
  status: z.enum(["available", "reserved", "sold"]),
  area: z.number().positive().max(10000).nullable(),
  landArea: z.number().min(0).max(10000).nullable(),
  bedrooms: z.number().int().min(0).max(100).nullable(),
  floors: z.number().int().min(1).max(100).nullable(),
  readiness: z.string().trim().min(2).max(100),
  finish: z.string().trim().min(2).max(100),
  seaDistance: z.number().min(0).max(100000).nullish(),
  description: z.string().trim().max(30000),
  utilities: z.array(z.string().trim().min(1).max(120)).max(20),
  published: z.boolean(),
  featured: z.boolean(),
  elite: z.boolean().default(false),
  demo: z.boolean(),
}).refine((property) => (property.latitude === null) === (property.longitude === null), {
  path: ["latitude"],
  message: "Укажите широту и долготу вместе или оставьте оба поля пустыми",
}).refine((property) => !property.elite || property.type === "apartment", {
  path: ["elite"],
  message: "В элитный каталог можно добавить только квартиру",
}).refine((property) => !property.complexId || property.type === "apartment", {
  path: ["complexId"],
  message: "К жилому комплексу можно привязать только квартиру",
});
export const leadSchema = z.object({
  purpose: z.literal("buyer").default("buyer"),
  name: z.string().trim().max(100).default(""),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()\-]{10,25}$/)
    .refine(
      (v) =>
        v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15,
    ),
  comment: z.string().trim().max(2000).default(""),
  consent: z.literal(true),
  propertyId: z.string().max(100).optional(),
  website: z.string().max(200).default(""),
});
export type PropertyInput = z.infer<typeof propertySchema>;
export type Property = PropertyInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  sourceMode: string | null;
  sourceNote: string | null;
  sourceFetchedAt: string | null;
  developer: string | null;
  district: string | null;
  completionDate: string | null;
  constructionStatus: string | null;
  priceKind: string | null;
  priceSourceUrl: string | null;
  priceArea: number | null;
  images: { id: string; file: string; alt: string; order: number; kind?: "photo" | "plan" }[];
  complex?: Pick<Property, "id" | "title" | "slug" | "published"> | null;
  apartments?: RelatedApartment[];
};
export type RelatedApartment = Pick<Property,
  "id" | "title" | "slug" | "published" | "price" | "area" | "bedrooms" | "status" | "images"
>;
export type CatalogMapItem = Pick<Property,
  "id" | "slug" | "title" | "type" | "location" | "address" | "price" |
  "priceKind" | "area" | "bedrooms" | "status" | "elite" | "latitude" | "longitude" | "images" |
  "developer" | "constructionStatus" | "priceArea" | "readiness" | "sourceMode" | "complex"
>;
export function money(value: number | null) {
  return value === null
    ? "Цена по запросу"
    : new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}
export function countLabel(
  value: number,
  one: string,
  few: string,
  many: string,
) {
  const form = new Intl.PluralRules("ru-RU").select(value);
  return `${value.toLocaleString("ru-RU")} ${form === "one" ? one : form === "few" ? few : many}`;
}

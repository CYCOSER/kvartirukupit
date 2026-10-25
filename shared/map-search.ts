import { z } from "zod";

export const mapSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200).regex(/^[^\u0000-\u001f\u007f]+$/)
    .transform((value) => value.replace(/\s+/g, " ")),
});

export type MapSearchResult = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  bounds?: [south: number, west: number, north: number, east: number];
};

export function sortByAddressDistance<T extends { latitude: number | null; longitude: number | null }>(
  items: T[], address?: Pick<MapSearchResult, "latitude" | "longitude">,
): T[] {
  if (!address) return items;
  const radians = Math.PI / 180;
  return items.map((item, index) => {
    let distance = Infinity;
    if (item.latitude !== null && item.longitude !== null) {
      const latitudeDelta = (item.latitude - address.latitude) * radians;
      const longitudeDelta = (item.longitude - address.longitude) * radians;
      // The Haversine angular term preserves distance order without converting to metres.
      distance = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(address.latitude * radians) * Math.cos(item.latitude * radians)
        * Math.sin(longitudeDelta / 2) ** 2;
    }
    return { item, index, distance };
  }).sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ item }) => item);
}

import { z } from "zod";
import type { MapSearchResult } from "../../shared/map-search";

const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const latitude = coordinate.pipe(z.number().min(-90).max(90));
const longitude = coordinate.pipe(z.number().min(-180).max(180));
const resultSchema = z.object({
  place_id: z.union([z.number().int().nonnegative(), z.string().min(1).max(100)]),
  display_name: z.string().trim().min(1).max(1000),
  lat: latitude,
  lon: longitude,
  boundingbox: z.unknown().optional(),
});
const boundsSchema = z.tuple([latitude, latitude, longitude, longitude])
  .refine(([south, north, west, east]) => south <= north && west <= east);

export class MapSearchError extends Error {
  constructor(public statusCode: 429 | 503) {
    super(statusCode === 429 ? "Search rate limit exceeded" : "Address search unavailable");
  }
}

export function createMapSearch(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { items: MapSearchResult[]; expires: number }>();
  const pending = new Map<string, Promise<MapSearchResult[]>>();
  let nextRequestAt = 0;

  return async (query: string, providerUrl: string, siteUrl: string): Promise<MapSearchResult[]> => {
    const key = providerUrl + "\n" + query.toLocaleLowerCase("ru-RU");
    const time = now();
    for (const [cachedKey, entry] of cache) if (entry.expires <= time) cache.delete(cachedKey);
    const cached = cache.get(key);
    if (cached) return cached.items;
    const active = pending.get(key);
    if (active) return active;
    // Public Nominatim allows one request/second across the app, including distinct users.
    if (time < nextRequestAt) throw new MapSearchError(429);
    nextRequestAt = time + 1100;

    const request = (async () => {
      try {
        const url = new URL(providerUrl);
        url.searchParams.set("q", query);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "5");
        url.searchParams.set("addressdetails", "0");
        url.searchParams.set("accept-language", "ru");
        url.searchParams.set("viewbox", "19.5,55.3,22.9,54.1");
        url.searchParams.set("bounded", "0");
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: "application/json", "User-Agent": `KvartiruKupit/1.0 (+${siteUrl})` },
        });
        if (!response.ok) throw new MapSearchError(503);
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new MapSearchError(503);
        const items: MapSearchResult[] = [];
        for (const row of body.slice(0, 5)) {
          const parsed = resultSchema.safeParse(row);
          if (!parsed.success) continue;
          const value = parsed.data;
          const bounds = boundsSchema.safeParse(value.boundingbox);
          items.push({
            id: String(value.place_id), label: value.display_name,
            latitude: value.lat, longitude: value.lon,
            ...(bounds.success ? { bounds: [bounds.data[0], bounds.data[2], bounds.data[1], bounds.data[3]] as [number, number, number, number] } : {}),
          });
        }
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, { items, expires: now() + 24 * 60 * 60 * 1000 });
        return items;
      } catch (error) {
        throw error instanceof MapSearchError ? error : new MapSearchError(503);
      }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

// shortcut: the deployment has one web process; share this cache/limiter before adding replicas.
export const searchMapAddress = createMapSearch();

import test from "node:test";
import assert from "node:assert/strict";
import { mapSearchQuerySchema, sortByAddressDistance } from "../shared/map-search";
import { createMapSearch, MapSearchError } from "../server/utils/map-search";

const provider = "https://nominatim.openstreetmap.org/search";
const site = "https://example.test";
const row = { place_id: 1, display_name: "Берлин, Германия", lat: "52.52", lon: "13.40", boundingbox: ["52.3", "52.7", "13.1", "13.8"] };

test("address distance orders filtered items nearest first, keeps ties stable, and restores the source order", () => {
  const items = [
    { id: "missing-a", latitude: null, longitude: null },
    { id: "far", latitude: 1, longitude: 0 },
    { id: "near-a", latitude: 0, longitude: 0.1 },
    { id: "missing-b", latitude: null, longitude: null },
    { id: "near-b", latitude: 0, longitude: 0.1 },
    { id: "at-address", latitude: 0, longitude: 0 },
  ];
  const original = items.map((item) => item.id);
  const address = { latitude: 0, longitude: 0 };
  assert.deepEqual(sortByAddressDistance(items, address).map((item) => item.id),
    ["at-address", "near-a", "near-b", "far", "missing-a", "missing-b"]);
  assert.deepEqual(items.map((item) => item.id), original);
  assert.strictEqual(sortByAddressDistance(items), items);
  assert.deepEqual(sortByAddressDistance(items.filter((item) => item.id !== "at-address"), address).map((item) => item.id),
    ["near-a", "near-b", "far", "missing-a", "missing-b"]);
  assert.deepEqual(sortByAddressDistance([
    { id: "south", latitude: 79, longitude: 0 },
    { id: "east", latitude: 80, longitude: 5 },
  ], { latitude: 80, longitude: 0 }).map((item) => item.id), ["east", "south"]);
});

test("address query validates length and control characters and normalizes whitespace", () => {
  assert.deepEqual(mapSearchQuerySchema.parse({ q: "  Берлин   Германия  " }), { q: "Берлин Германия" });
  for (const q of ["", "a", "a".repeat(201), "ул.\nМира", ["Москва"]])
    assert.equal(mapSearchQuerySchema.safeParse({ q }).success, false);
});

test("address search is global with regional bias, limits results, validates coordinates and converts bounds", async () => {
  let captured: URL | undefined;
  let headers: Headers | undefined;
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    captured = new URL(String(input));
    headers = new Headers(init?.headers);
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json([row, { ...row, place_id: 2, lat: "0", lon: "0", boundingbox: [] },
      { ...row, lat: "91" }, { ...row, lon: "" }, { ...row, place_id: 5, boundingbox: ["53", "52", "13", "14"] },
      { ...row, place_id: 6 }]);
  }) as typeof fetch;
  const items = await createMapSearch(fetcher)("Берлин", provider, site);
  assert.equal(captured!.searchParams.get("q"), "Берлин");
  assert.equal(captured!.searchParams.get("limit"), "5");
  assert.equal(captured!.searchParams.get("bounded"), "0");
  assert.equal(captured!.searchParams.has("countrycodes"), false);
  assert.match(headers!.get("User-Agent")!, /KvartiruKupit\/1.0/);
  assert.deepEqual(items, [
    { id: "1", label: row.display_name, latitude: 52.52, longitude: 13.4, bounds: [52.3, 13.1, 52.7, 13.8] },
    { id: "2", label: row.display_name, latitude: 0, longitude: 0 },
    { id: "5", label: row.display_name, latitude: 52.52, longitude: 13.4 },
  ]);
});

test("cache and deduplication avoid repeated provider requests; all users share the request gate", async () => {
  let time = 1000;
  let calls = 0;
  let complete: ((response: Response) => void) | undefined;
  const search = createMapSearch((() => {
    calls++;
    return new Promise<Response>((resolve) => { complete = resolve; });
  }) as typeof fetch, () => time);
  const first = search("Берлин", provider, site);
  const same = search("берлин", provider, site);
  await assert.rejects(search("Москва", provider, site), (error) => error instanceof MapSearchError && error.statusCode === 429);
  assert.equal(calls, 1);
  complete!(Response.json([row]));
  assert.deepEqual(await first, await same);
  await search("Берлин", provider, site);
  assert.equal(calls, 1);
  time = 2100;
  const different = search("Москва", provider, site);
  complete!(Response.json([]));
  assert.deepEqual(await different, []);
  assert.equal(calls, 2);
  time += 24 * 60 * 60 * 1000 + 1;
  const expired = search("Берлин", provider, site);
  complete!(Response.json([row]));
  await expired;
  assert.equal(calls, 3);
});

test("provider failures expose only a safe unavailable error and can be retried", async () => {
  let time = 0;
  let calls = 0;
  const search = createMapSearch((() => {
    calls++;
    if (calls === 1) throw new Error("private provider detail");
    return Promise.resolve(Response.json([row]));
  }) as typeof fetch, () => time);
  await assert.rejects(search("Берлин", provider, site), (error) =>
    error instanceof MapSearchError && error.statusCode === 503 && !error.message.includes("private"));
  time = 1100;
  assert.equal((await search("Берлин", provider, site)).length, 1);
  for (const response of [Response.json({}, { status: 200 }), new Response("limited", { status: 429 })]) {
    const failing = createMapSearch((async () => response) as typeof fetch);
    await assert.rejects(failing("Берлин", provider, site), (error) => error instanceof MapSearchError && error.statusCode === 503);
  }
});

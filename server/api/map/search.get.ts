import { mapSearchQuerySchema } from "../../../shared/map-search";
import { MapSearchError, searchMapAddress } from "../../utils/map-search";

export default defineEventHandler(async (event) => {
  limit(event, "map-search", 20, 60000);
  const parsed = mapSearchQuerySchema.safeParse(getQuery(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Enter an address from 2 to 200 characters" });
  const config = useRuntimeConfig(event);
  try {
    const items = await searchMapAddress(parsed.data.q, config.mapSearchUrl, config.public.siteUrl);
    setHeader(event, "Cache-Control", "public, max-age=3600");
    return { items };
  } catch (error) {
    const statusCode = error instanceof MapSearchError ? error.statusCode : 503;
    if (statusCode === 429) setHeader(event, "Retry-After", 1);
    throw createError({ statusCode, statusMessage: statusCode === 429
      ? "Please wait a moment before searching again" : "Address search is temporarily unavailable" });
  }
});

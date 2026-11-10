import type { Property } from "./property";

export type ArticleRecommendation = {
  id: string;
  slug: string;
  title: string;
  image: string;
  imageAlt: string;
};

export type ProjectRecommendation = Pick<
  Property,
  | "id"
  | "title"
  | "slug"
  | "type"
  | "images"
  | "status"
  | "address"
  | "location"
  | "area"
  | "developer"
  | "constructionStatus"
  | "priceKind"
  | "price"
  | "readiness"
  | "sourceMode"
>;

export function randomArticleRecommendations<T>(
  candidates: readonly T[],
  limit = 3,
  random: () => number = Math.random,
): T[] {
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled.slice(0, limit);
}

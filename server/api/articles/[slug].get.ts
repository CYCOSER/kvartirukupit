import {
  randomArticleRecommendations,
  type ProjectRecommendation,
} from "~/shared/article-recommendations";
import type { Property } from "~/shared/property";

function isPropertyStatus(value: string): value is Property["status"] {
  return value === "available" || value === "reserved" || value === "sold";
}

export default defineEventHandler(async (event) => {
  const article = await db.article.findFirst({
    where: {
      slug: getRouterParam(event, "slug"),
      published: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    },
    include: {
      tagRelations: {
        select: { tagId: true, tag: { select: { name: true } } },
      },
    },
  });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: "Статья не найдена" });

  const tagIds = [...new Set(article.tagRelations.map(({ tagId }) => tagId))];
  const [articleCandidates, projectCandidates] = tagIds.length
    ? await Promise.all([
        db.article.findMany({
          where: {
            id: { not: article.id },
            published: true,
            OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
            tagRelations: { some: { tagId: { in: tagIds } } },
          },
          select: {
            id: true,
            slug: true,
            title: true,
            image: true,
            imageAlt: true,
          },
        }),
        db.property.findMany({
          where: {
            type: "complex",
            published: true,
            tagRelations: { some: { tagId: { in: tagIds } } },
          },
          select: {
            id: true,
            title: true,
            slug: true,
            type: true,
            images: {
              where: { kind: "photo" },
              orderBy: { order: "asc" },
              take: 1,
              select: {
                id: true,
                file: true,
                alt: true,
                order: true,
                kind: true,
              },
            },
            status: true,
            address: true,
            location: true,
            area: true,
            developer: true,
            constructionStatus: true,
            priceKind: true,
            price: true,
            readiness: true,
            sourceMode: true,
          },
        }),
      ])
    : [[], []];

  const recommendedProjects: ProjectRecommendation[] = projectCandidates
    .filter((project) => isPropertyStatus(project.status))
    .map((project) => ({
      ...project,
      type: "complex",
      images: project.images.map((image) => ({
        ...image,
        kind: "photo" as const,
      })),
    }));

  return {
    ...article,
    recommendedArticles: randomArticleRecommendations(articleCandidates, 3),
    recommendedProjects: randomArticleRecommendations(recommendedProjects, 2),
  };
});

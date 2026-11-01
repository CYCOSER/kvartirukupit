import { PrismaClient } from "@prisma/client";
import { articleSchema } from "../shared/article";
import { mortgageArticles } from "../prisma/mortgage-articles";

const db = new PrismaClient();
try {
  const result = await db.article.createMany({
    data: mortgageArticles.map((article) => ({
      ...articleSchema.parse(article),
      image: "/images/mortgage-planning.webp",
      publishedAt: new Date(),
    })),
    // A manual content release must preserve existing editorial changes.
    skipDuplicates: true,
  });
  console.log(JSON.stringify({ created: result.count }));
} finally {
  await db.$disconnect();
}

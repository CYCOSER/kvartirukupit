import sanitizeHtml from "sanitize-html";
import type { H3Event } from "h3";
import { articleSchema } from "../../shared/article";
import { articleContentToHtml } from "../../shared/article-content";

export async function parseArticleBody(event: H3Event) {
  const body: unknown = await readBody(event);
  if (
    typeof body !== "object" ||
    body === null ||
    !("content" in body) ||
    typeof body.content !== "string"
  )
    return articleSchema.safeParse(body);

  return articleSchema.safeParse({
    ...body,
    content: sanitizeArticleContent(body.content),
  });
}

const articleHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "h2",
    "h3",
    "strong",
    "em",
    "u",
    "s",
    "a",
    "blockquote",
    "ol",
    "ul",
    "li",
  ],
  allowedAttributes: {
    a: ["href", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

export function sanitizeArticleContent(content: string): string {
  return sanitizeHtml(articleContentToHtml(content), articleHtmlOptions);
}

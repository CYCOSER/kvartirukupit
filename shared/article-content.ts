import { articleBlocks } from "./article";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isArticleHtml(content: string): boolean {
  return /<(?:p|h2|h3|ul|ol|li|blockquote|strong|em|u|s|a|br)(?:\s|\/?>)/i.test(
    content,
  );
}

export function articleContentToHtml(content: string): string {
  if (isArticleHtml(content)) return content;

  return articleBlocks(content)
    .map((block) => {
      if (block.type === "h2" || block.type === "h3")
        return `<${block.type}>${escapeHtml(block.text)}</${block.type}>`;
      if (block.type === "list")
        return `<ul>${block.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`;
      if (block.type === "link")
        return `<p><a href="${escapeHtml(block.href)}">${escapeHtml(block.text)}</a></p>`;
      return `<p>${escapeHtml(block.text).replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("");
}

import { z } from 'zod';

const russianSlugLetters: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function articleSlugFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => russianSlugLetters[letter])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
    .replace(/-+$/g, '');
}

export const articleSchema = z.object({
  title: z.string().trim().min(3).max(150),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(150),
  excerpt: z.string().trim().min(10).max(400),
  content: z.string().trim().min(30).max(18000),
  seoTitle: z.string().trim().max(150).default(''),
  seoDescription: z.string().trim().max(300).default(''),
  published: z.boolean().default(false),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type ArticleInput = z.infer<typeof articleSchema>;
export type Article = ArticleInput & {
  id: string;
  image: string;
  publishedAt: string | null;
  updatedAt: string;
};
// A deliberately limited, HTML-free format: headings, lists and paragraphs.
export function articleBlocks(content: string) {
  return content
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/);
      const link = block.match(
        /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+|\/blog\/[a-z0-9-]+)\)$/,
      );
      if (link)
        return [{ type: 'link', text: link[1], href: link[2], items: [] }];
      if (lines.every((line) => /^- /.test(line)))
        return [
          {
            type: 'list',
            text: '',
            href: '',
            items: lines.map((line) => line.slice(2)),
          },
        ];
      return lines.some((line) => /^#{2,3} /.test(line))
        ? lines.map((line) => ({
            type: line.startsWith('### ')
              ? 'h3'
              : line.startsWith('## ')
                ? 'h2'
                : 'p',
            text: line.replace(/^#{2,3} /, ''),
            href: '',
            items: [],
          }))
        : [{ type: 'p', text: block, href: '', items: [] }];
    });
}

import { tagInclude } from '../../../utils/tag-definitions';

export default defineEventHandler(() =>
  db.tagTask.findMany({
    include: { tag: { include: tagInclude } },
    orderBy: { createdAt: "desc" },
  }),
);

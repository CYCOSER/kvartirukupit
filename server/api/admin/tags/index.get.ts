import { defineEventHandler } from 'h3';
import { db } from '../../../utils/db';
import { tagInclude } from '../../../utils/tag-definitions';

export default defineEventHandler(() => db.tag.findMany({ orderBy: { name: 'asc' }, include: tagInclude }));

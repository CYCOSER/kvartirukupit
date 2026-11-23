import { defineEventHandler } from 'h3';
import { db } from '../../../utils/db';

export default defineEventHandler(() => db.propertyFeature.findMany({
  orderBy: [{ group: 'asc' }, { name: 'asc' }],
}));

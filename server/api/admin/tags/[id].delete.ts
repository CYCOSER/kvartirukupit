import { defineEventHandler, getRouterParam } from 'h3';
import { deleteTagDefinition } from '../../../utils/tag-definitions';

export default defineEventHandler(event => deleteTagDefinition(getRouterParam(event, 'id')!));

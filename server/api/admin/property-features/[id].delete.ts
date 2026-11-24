import { defineEventHandler, getRouterParam } from 'h3';
import { deletePropertyFeature } from '../../../utils/tag-definitions';

export default defineEventHandler(event => deletePropertyFeature(getRouterParam(event, 'id')!));

import { defineEventHandler, getRouterParam } from 'h3';
import { updateAgentPropertyDescription } from '../../../../../utils/agent-properties';

export default defineEventHandler(event => updateAgentPropertyDescription(getRouterParam(event, 'id')!, ''));

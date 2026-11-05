import { defineEventHandler } from 'h3';
import { getRf39FeedSettings } from '../../utils/rf39-feed-settings';
import { requireAdmin } from '../../utils/security';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  return getRf39FeedSettings(owner.id);
});

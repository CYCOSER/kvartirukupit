import { defineEventHandler, readBody } from 'h3';
import { requireAdmin } from '../../../utils/security';
import {
  setPrivacyPolicyVersion,
  type PrivacyPolicyVersion,
} from '../../../utils/privacy-policy';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  const body = await readBody(event);
  const version = await setPrivacyPolicyVersion(
    {
      version: typeof body.version === 'string' ? body.version : undefined,
      effectiveAt: typeof body.effectiveAt === 'string' ? body.effectiveAt : undefined,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
    },
    owner.id,
    owner.email,
  );
  return version satisfies PrivacyPolicyVersion;
});
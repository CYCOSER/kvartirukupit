import { defineEventHandler } from 'h3';
import { getPrivacyPolicyVersion } from '../utils/privacy-policy';

export default defineEventHandler(async () => {
  return getPrivacyPolicyVersion();
});
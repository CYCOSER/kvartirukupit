import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

type Session = Awaited<ReturnType<APIRequestContext['storageState']>>;
export const test = base.extend<{}, { adminSession: Session }>({
  adminSession: [async ({ playwright }, use) => {
    const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
    const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100';
    const api = await playwright.request.newContext({ baseURL: origin });
    try {
      expect((await api.post('/api/admin/login', {
        headers: { Origin: origin }, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
      })).status()).toBe(200);
      await use(await api.storageState());
    } finally { await api.dispose(); }
  }, { scope: 'worker' }],
  storageState: async ({ adminSession }, use) => { await use(adminSession); },
});

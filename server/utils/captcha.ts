import { createError, type H3Event } from 'h3';
import { clientIp } from './rate-limit';

export async function verifyLeadCaptcha(event: H3Event, token: string) {
  const config = useRuntimeConfig(event);
  if (!config.smartCaptchaSecretKey || !config.public.smartCaptchaSiteKey)
    throw createError({ statusCode: 503, statusMessage: 'Captcha is not configured' });
  if (!token)
    throw createError({ statusCode: 403, statusMessage: 'Captcha verification required' });

  const body = new URLSearchParams({ secret: config.smartCaptchaSecretKey, token });
  const ip = clientIp(event);
  if (ip) body.set('ip', ip);

  let result: { status?: string; host?: string };
  try {
    const response = await fetch('https://smartcaptcha.cloud.yandex.ru/validate', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Captcha service rejected request');
    result = await response.json();
    if (!result || typeof result !== 'object' || typeof result.status !== 'string')
      throw new Error('Invalid captcha response');
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Captcha service unavailable' });
  }

  const site = new URL(config.public.siteUrl);
  let host = '';
  if (typeof result.host === 'string' && /^[^/?#@\\\s]+$/.test(result.host)) {
    try {
      host = new URL(site.protocol + '//' + result.host).host;
    } catch {
      // Malformed provider responses must never authorize a submission.
    }
  }
  if (result.status !== 'ok' || host !== site.host)
    throw createError({ statusCode: 403, statusMessage: 'Captcha verification failed' });
}

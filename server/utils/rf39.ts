import { createError } from 'h3';
import { parseRf39Response } from './rf39-data';

export async function rf39ReadBody(response: Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit)
    throw new Error('Invalid CRM response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('CRM response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}

export async function fetchRf39Objects(token: string, offset = 0, id?: number | string) {
  if (!token) throw createError({ statusCode: 503, data: { message: 'Подключение CRM не настроено. Добавьте NUXT_RF39_TOKEN на сервере.' } });
  if (id !== undefined && (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(String(id)) || String(id).split(',').length > 100 ||
      String(id).split(',').some(value => !Number.isSafeInteger(Number(value)))))
    throw createError({ statusCode: 400, data: { message: 'Некорректные ID объектов CRM.' } });
  try {
    const request = () => fetch('https://crm.rf39.ru/api/objects', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      // The compact response omits area and rooms needed by catalog filters.
      body: new URLSearchParams({ token, full: '1', params: JSON.stringify({
        limit: typeof id === 'number' ? 1 : 100, offset,
        filter: { published: true, archived: false, ...(id ? { id } : {}) },
      }) }),
    });
    let response;
    try { response = await request(); }
    catch (error) {
      // This read-only request can fail before connecting; retry that failure once.
      if (!(error instanceof TypeError) || (error.cause as { code?: string } | undefined)?.code !== 'UND_ERR_CONNECT_TIMEOUT') throw error;
      response = await request();
    }
    return parseRf39Response(JSON.parse((await rf39ReadBody(response, 32 * 1024 * 1024)).toString('utf8')));
  } catch {
    // Never forward upstream errors: they can include the token or private contact data.
    throw createError({ statusCode: 502, data: { message: 'Не удалось получить объекты CRM. Проверьте подключение и API-ключ, затем повторите запрос.' } });
  }
}

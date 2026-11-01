import { test, expect } from '@playwright/test';

test('SSR normalizes canonicals and returns 404 for a missing catalog page', async ({ request }) => {
  const response = await request.get('/catalog/?utm_source=seo-check');
  expect(response.status()).toBe(200);
  const html = await response.text();
  const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
  expect(canonical).toBeTruthy();
  expect(new URL(canonical!).pathname).toBe('/catalog');
  expect(new URL(canonical!).search).toBe('');

  const catalog = await (await request.get('/api/properties?type=complex&elite=false')).json();
  const missing = await request.get('/catalog?page=' + (Math.max(1, catalog.pages) + 1));
  expect(missing.status()).toBe(404);
  expect((await request.get('/catalog?page=10001')).status()).toBe(404);
});

test('property SSR metadata uses the property title and its own photo', async ({ request }) => {
  const catalog = await (await request.get('/api/properties?type=complex&elite=false')).json();
  test.skip(!catalog.items.length, 'No published complexes to inspect');
  const property = catalog.items[0];
  const image = property.images.find((item: { kind: string }) => item.kind !== 'plan') || property.images[0];
  const response = await request.get('/catalog/' + property.slug);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const description = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1];
  expect(description).toContain(property.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  if (image) {
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)?.[1];
    expect(new URL(ogImage!).pathname).toBe(new URL(image.file, 'https://example.test').pathname);
  }
});

import { test, expect } from "@playwright/test";

test("llms.txt is served and contains site summary", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const text = await response.text();
  expect(text).toContain("# Квартирукупить");
  expect(text).toContain("## Description");
  expect(text).toContain("## Navigation");
  expect(text).toContain("## Catalog");
  expect(text).toContain("## Blog");
  expect(text).toContain("## Contact");
  expect(text).toContain("## Robots");
  expect(text).toContain("/sitemap.xml");
  expect(text).toContain("/llms.txt");
  // At least one catalog link and one blog link when data exists.
  expect(text).toContain("/catalog/");
  expect(text).toContain("/blog/");
});

test("robots.txt references llms.txt", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Llms-txt: /llms.txt");
});
import { test, expect } from "@playwright/test";

test("icon panels contain their headings at every screen size and text scale", async ({
  page,
}) => {
  for (const route of ["/", "/catalog/zhk-traditsiya"]) {
    await page.goto(route);
    for (const width of [360, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const scale of ["100%", "200%"]) {
        await page.evaluate(
          (value) => (document.documentElement.style.fontSize = value),
          scale,
        );
        for (const heading of await page
          .locator(".lead-form-heading, .mortgage-heading")
          .all()) {
          const icon = (await heading.locator(":scope > span").boundingBox())!;
          const text = (await heading.locator(":scope > div").boundingBox())!;
          expect(text.y).toBeGreaterThanOrEqual(icon.y - 1);
          expect(text.y + text.height).toBeLessThanOrEqual(
            icon.y + icon.height + 1,
          );
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    }
  }
});

import { test, expect } from "@playwright/test";

test("hero, collection heading and footer form a compact layout", async ({
  page,
}) => {
  for (const width of [360, 768, 960, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".hero h1 em")).toHaveText("В своей квартире");
    await expect(page.locator(".footer-navigation a")).toHaveCount(2);
    await expect(page.locator(".footer-destinations a").last()).toContainText(
      "ИНТЕРЕСНОЕ",
    );
    await expect(page.locator(".footer-destinations a").last()).toHaveAttribute(
      "href",
      "/blog",
    );
    await expect(page.locator(".footer-secondary")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const titleLines = await page
      .locator(".hero h1 .type-upright")
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
    expect(titleLines).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width >= 960) {
      const rightEdgeDelta = await page
        .locator(".collection-heading")
        .evaluate((element) => {
          const heading = element.getBoundingClientRect();
          const link = element.children[1].getBoundingClientRect();
          return Math.abs(heading.right - link.right);
        });
      expect(rightEdgeDelta).toBeLessThanOrEqual(1);

      const collectionPaddingTop = await page
        .locator(".collection-section")
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingTop),
        );
      expect(collectionPaddingTop).toBe(48);
    }
    if (width === 960) {
      await page
        .locator(".hero-copy")
        .screenshot({ path: "test-results/hero-review.png" });
      await page
        .locator(".collection-heading")
        .screenshot({ path: "test-results/collection-review.png" });
      await page
        .locator(".site-footer")
        .screenshot({ path: "test-results/footer-review.png" });
    }
  }
});

import { test, expect } from "@playwright/test";

test("contact card is responsive and comment grows without manual resizing", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.locator(".lead-form");
  const comment = form.locator("textarea");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await comment.fill("");
    const initial = await comment.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    await comment.fill(
      Array(18)
        .fill("Квартира в Калининграде, три комнаты и просторная кухня.")
        .join("\n"),
    );
    await expect
      .poll(() => comment.evaluate((el) => el.getBoundingClientRect().height))
      .toBeGreaterThan(initial);
    expect(await comment.evaluate((el) => getComputedStyle(el).resize)).toBe(
      "none",
    );
    const innerWidth = await form.evaluate(
      (el) =>
        el.clientWidth -
        parseFloat(getComputedStyle(el).paddingLeft) -
        parseFloat(getComputedStyle(el).paddingRight),
    );
    expect(
      Math.abs((await comment.boundingBox())!.width - innerWidth),
    ).toBeLessThan(2);
    const button = form.locator('button[type="submit"]');
    const buttonBox = (await button.boundingBox())!;
    const textBox = (await button.locator("span").boundingBox())!;
    expect(Math.abs(buttonBox.width - innerWidth)).toBeLessThan(2);
    expect(
      Math.abs(
        textBox.x + textBox.width / 2 - buttonBox.x - buttonBox.width / 2,
      ),
    ).toBeLessThan(2);
    expect(
      await comment.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    ).toBeTruthy();
    await comment.fill("");
    await expect
      .poll(() => comment.evaluate((el) => el.getBoundingClientRect().height))
      .toBe(initial);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/contact-${width}.png` });
  }
  const consent = form.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  expect(await consent.evaluate((el) => getComputedStyle(el).appearance)).toBe(
    "none",
  );
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await page.keyboard.press("Space");
  await expect(consent).not.toBeChecked();
});

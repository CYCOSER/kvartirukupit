import { test, expect } from "@playwright/test";

test("privacy policy version endpoint is publicly accessible", async ({ request }) => {
  const response = await request.get("/api/privacy-policy");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty("version");
  expect(body).toHaveProperty("effectiveAt");
});

test("admin can update privacy policy version", async ({ request }) => {
  const login = await request.post("/api/admin/login", {
    data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  const put = await request.put("/api/admin/privacy-policy", {
    data: { version: "test-version-123", summary: "Test update" },
  });
  expect(put.ok()).toBe(true);
  const body = await put.json();
  expect(body.version).toBe("test-version-123");
  expect(body.summary).toBe("Test update");

  // Verify public endpoint reflects the change
  const publicResponse = await request.get("/api/privacy-policy");
  const publicBody = await publicResponse.json();
  expect(publicBody.version).toBe("test-version-123");

  // Restore original version
  await request.put("/api/admin/privacy-policy", {
    data: { version: "2026-11-17" },
  });
});

test("privacy policy admin page is protected", async ({ page, request }) => {
  const response = await request.get("/admin-console-9Xk6uiIs/privacy-policy");
  expect(response.status()).toBe(302);
});
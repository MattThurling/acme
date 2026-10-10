// Browser tests for the store: signed-in and guest Get Finance flows,
// accessibility-tree hygiene the agents rely on, validation and errors.
// Runs against the dev server with MEDIFINANCE_MOCK=1 (no real applications).
import { test, expect } from "@playwright/test";

const CHAIR = "ErgoDent Signature Surgery Package";

test.describe("accessibility hygiene", () => {
  test("closed finance dialog is absent from the accessibility tree", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: CHAIR })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm application" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Application sent" })).toHaveCount(0);
    await expect(page.getByText("Application sent")).toBeHidden();
    const snapshot = await page.locator("body").ariaSnapshot();
    expect(snapshot).not.toContain("Apply for finance");
  });

  test("every finance and buy button has a unique accessible name", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: `Get finance for ${CHAIR} (£32,750)` })).toHaveCount(1);
    await expect(page.getByRole("button", { name: `Buy ${CHAIR} now (£32,750)` })).toHaveCount(1);
    const names = await page.getByRole("button", { name: /^Get finance for / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(new Set(names).size).toBe(6);
  });

  test("Buy Now shows an inline message instead of a native alert", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; d.dismiss(); });
    await page.goto("/");
    await page.getByRole("button", { name: `Buy ${CHAIR} now (£32,750)` }).click();
    await expect(page.getByRole("status")).toContainText("would go to checkout");
    expect(dialogs).toBe(0);
  });
});

test.describe("signed-in flow", () => {
  test("Jack confirms with one click and sees the reference", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Jack Jones")).toBeVisible();
    await page.getByRole("button", { name: `Get finance for ${CHAIR} (£32,750)` }).click();
    const dialog = page.getByRole("dialog", { name: "Apply for finance" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${CHAIR} — £32,750`);
    await expect(dialog).toContainText("jack@jjdental.com");
    await expect(dialog.getByRole("button", { name: "Confirm application" })).toBeFocused();
    await dialog.getByRole("button", { name: "Confirm application" }).click();
    // On success the dialog is relabelled by its new heading.
    const done = page.getByRole("dialog", { name: "Application sent" });
    await expect(done.getByRole("heading", { name: "Application sent" })).toBeVisible();
    await expect(done).toContainText(/MF-MOCK-[A-F0-9]+/);
    await expect(done).toContainText("secure link");
    await expect(done.getByRole("button", { name: "Done" })).toBeFocused();
    await done.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("guest flow", () => {
  test("?guest=1 shows inputs, validates, then submits", async ({ page }) => {
    await page.goto("/?guest=1");
    await expect(page.getByRole("link", { name: /Sign in as Jack/ })).toBeVisible();
    await page.getByRole("button", { name: `Get finance for ${CHAIR} (£32,750)` }).click();
    const dialog = page.getByRole("dialog", { name: "Apply for finance" });
    await expect(dialog).toContainText(`${CHAIR} — £32,750`);
    await expect(dialog.getByLabel("First name")).toBeFocused();

    // Native validation blocks an empty submit…
    await dialog.getByRole("button", { name: "Confirm application" }).click();
    await expect(dialog.getByLabel("First name")).toBeFocused();
    expect(await dialog.getByLabel("First name").evaluate((el) => el.validity.valueMissing)).toBe(true);

    // …and a bad email gets inline error text.
    await dialog.getByLabel("First name").fill("Priya");
    await dialog.getByLabel("Last name").fill("Patel");
    await dialog.getByLabel("Email").fill("priya@example");
    await dialog.getByLabel("Company type").selectOption("sole_trader");
    await dialog.getByRole("button", { name: "Confirm application" }).click();
    await expect(dialog.getByText(/valid email/)).toBeVisible();

    await dialog.getByLabel("Email").fill("priya@example-dental.co.uk");
    await dialog.getByRole("button", { name: "Confirm application" }).click();
    const done = page.getByRole("dialog", { name: "Application sent" });
    await expect(done.getByRole("heading", { name: "Application sent" })).toBeVisible();
    await expect(done).toContainText("priya@example-dental.co.uk");
    await expect(done).toContainText(/MF-MOCK-/);
  });

  test("server-side validation errors are shown per field", async ({ page }) => {
    await page.goto("/?guest=1");
    await page.getByRole("button", { name: `Get finance for ${CHAIR} (£32,750)` }).click();
    const dialog = page.getByRole("dialog");
    // Bypass native validation to hit the server's checks.
    await dialog.locator("form").evaluate((f) => f.setAttribute("novalidate", ""));
    await dialog.getByLabel("First name").fill("Priya");
    await dialog.getByLabel("Last name").fill("Patel");
    await dialog.getByLabel("Email").fill("priya@example-dental.co.uk");
    await dialog.getByRole("button", { name: "Confirm application" }).click();
    await expect(dialog.getByText(/Choose a company type/)).toBeVisible();
    await expect(dialog.getByLabel("Company type")).toHaveAttribute("aria-invalid", "true");
  });

  test("sign out / sign in toggle persists", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Sign out/ }).click();
    await expect(page.getByRole("link", { name: /Sign in as Jack/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: /Sign in as Jack/ })).toBeVisible();
    await page.getByRole("link", { name: /Sign in as Jack/ }).click();
    await expect(page.getByText("Jack Jones")).toBeVisible();
  });
});

test("/api/finance returns structured errors", async ({ request }) => {
  const r = await request.post("/api/finance", { data: { source: "guest", product_id: "nope", email: "x" } });
  expect(r.status()).toBe(400);
  const body = await r.json();
  expect(body.ok).toBe(false);
  const fields = body.errors.map((e) => e.field);
  expect(fields).toEqual(expect.arrayContaining(["product_id", "first_name", "last_name", "email", "company_type"]));
});

import type { Page } from "@playwright/test";

export async function inspectorApiHeaders(page: Page, origin: string): Promise<{ Origin: string; Cookie: string }> {
  const cookies = await page.context().cookies(`${origin}/api/health`);
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  if (cookie.length === 0) throw new Error("Inspector session cookie was not established");
  return { Origin: origin, Cookie: cookie };
}

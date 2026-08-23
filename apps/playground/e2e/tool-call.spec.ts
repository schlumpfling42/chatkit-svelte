import { test, expect } from '@playwright/test';

test('plugin-tool-render renders the generic collapsible fallback for tool calls with no custom renderer', async ({ page }) => {
  await page.goto('/?fixture=tool-call');

  const card = page.locator('.ck-tool-call');
  await expect(card.locator('.ck-tool-call__name')).toHaveText('search_flights');
  await expect(card).toContainText('complete');

  await card.locator('summary').click();
  await expect(card.locator('.ck-tool-call__args')).toContainText('"origin": "SFO"');
  await expect(page.getByTestId('tool-call-result')).toContainText('"flights": 3');
});

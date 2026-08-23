import { test, expect } from '@playwright/test';

test('devtools plugin logs every wire event and can export a fixture', async ({ page }) => {
  await page.goto('/?fixture=text-streaming');

  await expect(page.getByTestId('devtools-event')).toHaveCount(7);
  await expect(page.locator('.ck-devtools__count')).toContainText('7 events');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('devtools-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('chatkit-fixture.json');

  await page.getByText('Clear', { exact: true }).click();
  await expect(page.getByTestId('devtools-event')).toHaveCount(0);
});

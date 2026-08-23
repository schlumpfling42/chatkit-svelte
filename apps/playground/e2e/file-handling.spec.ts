import { test, expect } from '@playwright/test';

test('file-handling plugin renders image and file content parts', async ({ page }) => {
  await page.goto('/?fixture=file-handling');

  const message = page.getByTestId('message').first();
  await expect(message.locator('img')).toHaveAttribute('alt', 'Sample image');
  await expect(message).toContainText('report.pdf');
});

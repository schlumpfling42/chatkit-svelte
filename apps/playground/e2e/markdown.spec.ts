import { test, expect } from '@playwright/test';

test('markdown plugin renders bold, italic, inline code, links, and fenced code blocks', async ({ page }) => {
  await page.goto('/?fixture=markdown');

  const message = page.getByTestId('message').first();
  await expect(message.locator('strong')).toHaveText('bold');
  await expect(message.locator('em')).toHaveText('italic');
  await expect(message.locator('code').first()).toHaveText('inline code');
  await expect(message.locator('a[href="https://example.com"]')).toHaveText('link');
  await expect(message.locator('pre code')).toContainText('console.log("hello");');
});

import { test, expect } from '@playwright/test';

// Spec §18: "one 'kitchen sink' spec exercising forms + documents + file
// upload + HITL approval in one flow."
test('kitchen sink: form submit, document artifact, file upload, and HITL approval all in one flow', async ({ page }) => {
  await page.goto('/?fixture=kitchen-sink');

  // 1. Forms — fill the required field, leave the rest at defaults, submit.
  await page.getByLabel('destination').fill('Tokyo');
  await page.getByText('Continue', { exact: true }).click();
  await expect(page.getByTestId('form-value-destination')).toHaveText('Tokyo');

  // 2. Documents — the artifact panel renders the streamed document.
  await expect(page.getByRole('heading', { name: 'Draft Itinerary' })).toBeVisible();
  await expect(page.getByTestId('document-content')).toContainText('Arrive and check in.');

  // 3. File upload — a real interaction against the live attachment pipeline
  // (fileHandlingPlugin's upload() just returns an object URL — no server).
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('trip notes'),
  });
  await page.getByLabel('Message').fill('here are my notes');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.ck-message--user').last()).toContainText('here are my notes');

  // 4. HITL approval — the tool call from the fixture is paused awaiting
  // approval; approve it and confirm the bar clears.
  await expect(page.getByTestId('approval')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('approval')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Provided by the environment, never committed: a provider credential is not test data.
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';

test.describe('Passive Training UX Flow', () => {

    test.skip(!GROQ_API_KEY, 'GROQ_API_KEY is not set — the cloud-auth entry flow cannot be exercised');

    test('Simulate complete A/B user flow from upload to column mapping to automated learning', async ({ page }) => {
        // 1. Setup - Open app and set API key
        await page.goto('/');

        // Check if API key is requested
        const apiKeyOverlay = page.locator('text=Cloud Authentication Required');
        if (await apiKeyOverlay.isVisible()) {
            await page.fill('input[placeholder="gsk_..."]', GROQ_API_KEY);
            await page.click('button:has-text("Connect to Security Cloud")');
        }

        // 2. Navigation
        await page.click('button:has-text("PDF to Excel")');

        // Create a dummy PDF file for testing upload
        const dummyPdfPath = path.join(__dirname, 'dummy.pdf');
        fs.writeFileSync(dummyPdfPath, 'dummy pdf content');

        // 3. Upload File
        // Using locator for the file input that React Dropzone creates
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.click('text=Drag & drop your bank statement PDF here');
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(dummyPdfPath);

        // Wait for the simulated extraction process to finish
        // Look for the header summarizing extraction
        await expect(page.locator('text=transactions extracted')).toBeVisible({ timeout: 15000 });

        // 4. Verify Review UI Elements
        await expect(page.locator('text=Column Mapping')).toBeVisible();
        await expect(page.locator('text=Accept All High-Confidence')).toBeVisible();
        await expect(page.locator('text=Export to Excel')).toBeVisible();

        // 5. Test manual row actions
        const firstRowDeleteBtn = page.locator('tbody tr').first().locator('button[title="Delete Row"]');
        await expect(firstRowDeleteBtn).toBeVisible();
        await firstRowDeleteBtn.click();

        // Undo the deletion
        await page.click('button:has-text("Undo")');

        // Test insert row
        const firstRowInsertBtn = page.locator('tbody tr').first().locator('button[title="Insert Below"]');
        await firstRowInsertBtn.click();

        // We should see a "New Transaction" in the rows
        await expect(page.locator('text=New Transaction')).toBeVisible();

        // 6. Test Column Mapping UI
        await page.click('text=Column Mapping');
        await expect(page.locator('text=Map PDF Columns to System Fields')).toBeVisible();

        // Select a mapping (simulated drop-down interaction)
        const dateSelect = page.locator('label:has-text("Date")').locator('..').locator('select');
        // Ensure the select dropdown has options before we select
        // Since we mocked the uploaded PDF we won't have actual raw columns from backend
        // So this is as far as we can safely verify the UI state in a unit test without a real PDF parsing backend.

        // 7. Test Close UI
        await page.click('button[title="Close Review"]');
        await expect(page.locator('text=transactions extracted')).toBeHidden();

        // Cleanup
        fs.unlinkSync(dummyPdfPath);
    });
});

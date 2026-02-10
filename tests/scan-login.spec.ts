import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

test('Test login form filling and button clickability', async ({ page }) => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error('BASE_URL not found in .env');
  }

  // Navigate to the base URL
  await page.goto(baseUrl);

  // Wait for the page to redirect to login (assuming it's a SPA)
  await page.waitForURL('**/login');

  // Wait a bit for the form to load
  await page.waitForTimeout(2000);

  // Populate the select field with option containing "10700"
  const selectLocator = page.locator('select');
  const option = await selectLocator.locator('option').filter({ hasText: '10700' }).first();
  const value = await option.getAttribute('value');
  await selectLocator.selectOption(value!);
  // Fill username field with "00138888"
  // Assuming the first text input is username
  const usernameInput = page.locator('input[type="text"]').first();
  await usernameInput.fill('00138888');

  // Fill password field with "samplepassword123"
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.fill('samplepassword123');

  // Check if login button is clickable
  const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
  const isClickable = await loginButton.isEnabled();

  // Assert that all fields are filled and button is enabled
  await expect(usernameInput).toHaveValue('00138888');
  await expect(passwordInput).toHaveValue('samplepassword123');
  // For select, check if an option is selected
  const selectedValue = await selectLocator.inputValue();
  expect(selectedValue).not.toBe('');
  expect(isClickable).toBe(true);
});
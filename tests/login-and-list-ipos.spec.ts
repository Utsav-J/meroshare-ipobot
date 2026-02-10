import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

test('Login with Dad credentials and list IPOs in My ASBA', async ({ page }) => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error('BASE_URL not found in .env');
  }

  // Load credentials
  const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf-8'));
  const dadCred = credentials.Dad;
  console.log('Using Dad credentials:', dadCred);

  // Navigate to the base URL
  console.log('Navigating to base URL:', baseUrl);
  await page.goto(baseUrl);

  // Wait for the page to redirect to login
  console.log('Waiting for redirect to login page');
  await page.waitForURL('**/login');

  // Wait a bit for the form to load
  await page.waitForTimeout(2000);

  // Debug: Log all input fields on the page
  console.log('\n=== DEBUGGING LOGIN FORM ===');
  const allInputs = await page.locator('input').all();
  console.log(`\nFound ${allInputs.length} input fields on the page:`);
  for (let i = 0; i < allInputs.length; i++) {
    const type = await allInputs[i].getAttribute('type') || 'text';
    const name = await allInputs[i].getAttribute('name') || 'no-name';
    const id = await allInputs[i].getAttribute('id') || 'no-id';
    const placeholder = await allInputs[i].getAttribute('placeholder') || 'no-placeholder';
    const formcontrolname = await allInputs[i].getAttribute('formcontrolname') || 'no-formcontrolname';
    console.log(`  Input ${i}: type="${type}", name="${name}", id="${id}", placeholder="${placeholder}", formcontrolname="${formcontrolname}"`);
  }
  console.log('=== END FORM DEBUG ===\n');

  // Populate the select field with "LAXMI SUNRISE CAPITAL LIMITED (10700)"
  console.log('Selecting DP: LAXMI SUNRISE CAPITAL LIMITED (10700)');
  const selectLocator = page.locator('select');
  
  // Wait for select to be visible
  await selectLocator.waitFor({ state: 'visible' });
  console.log('Select field is visible');
  
  // Debug: Log all options
  const options = await selectLocator.locator('option').all();
  console.log(`Found ${options.length} select options:`);
  for (let i = 0; i < options.length; i++) {
    const text = await options[i].textContent();
    const value = await options[i].getAttribute('value');
    console.log(` [${i}] Text: "${text?.trim()}", Value: "${value}"`);
  }
  
  // Try different selection strategies
  try {
    console.log('Attempting selection with regex...');
    await selectLocator.selectOption({ label: /LAXMI SUNRISE CAPITAL LIMITED \(10700\)/ });
    console.log('Selection successful with regex');
  } catch (e) {
    console.log('Regex selection failed, trying exact text...');
    await selectLocator.selectOption({ label: 'LAXMI SUNRISE CAPITAL LIMITED (10700)' });
    console.log('Selection successful with exact text');
  }
  
  // Verify selection
  const selectedValue = await selectLocator.inputValue();
  console.log('Selected value:', selectedValue);
  
  // Wait 500ms after select
  console.log('Waiting 500ms after select...');
  await page.waitForTimeout(500);
  
  // Fill username field
  console.log('Filling username:', dadCred.username);
  const usernameInput = page.locator('input[type="text"]').first();
  await usernameInput.waitFor({ state: 'visible' });
  
  // Try clicking the field first to trigger any events
  await usernameInput.click();
  await page.waitForTimeout(200);
  
  // Clear any existing value and type slowly
  await usernameInput.clear();
  await usernameInput.type(dadCred.username, { delay: 100 });
  const usernameValue = await usernameInput.inputValue();
  console.log('Username filled. Current value:', usernameValue);
  
  // Wait 500ms after username and check if new fields appeared
  console.log('Waiting 500ms after username...');
  await page.waitForTimeout(500);
  
  // Check if any new fields appeared
  const allInputsAfterUsername = await page.locator('input').all();
  console.log(`Input fields after username: ${allInputsAfterUsername.length}`);
  if (allInputsAfterUsername.length > 2) {
    console.log('NEW FIELDS APPEARED! Listing all fields:');
    for (let i = 0; i < allInputsAfterUsername.length; i++) {
      const type = await allInputsAfterUsername[i].getAttribute('type') || 'text';
      const name = await allInputsAfterUsername[i].getAttribute('name') || 'no-name';
      const id = await allInputsAfterUsername[i].getAttribute('id') || 'no-id';
      const placeholder = await allInputsAfterUsername[i].getAttribute('placeholder') || 'no-placeholder';
      const isVisible = await allInputsAfterUsername[i].isVisible();
      console.log(`  Input ${i}: type="${type}", name="${name}", id="${id}", placeholder="${placeholder}", visible="${isVisible}"`);
    }
  }

  // Fill password field
  console.log('Filling password:', dadCred.password);
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible' });
  
  // Click the field first to trigger any events
  await passwordInput.click();
  await page.waitForTimeout(200);
  
  // Clear and type slowly
  await passwordInput.clear();
  await passwordInput.type(dadCred.password, { delay: 100 });
  const passwordFilled = (await passwordInput.inputValue()).length > 0;
  console.log('Password filled:', passwordFilled);
  console.log('Password length:', (await passwordInput.inputValue()).length);
  
  // Wait 3 seconds after password
  console.log('Waiting 3 seconds before login...');
  await page.waitForTimeout(3000);

  // Debug: Check for any error messages already visible
  console.log('\n=== Checking for existing errors before login ===');
  const errorElements = await page.locator('.error, .alert, .alert-danger, [class*="error"], [class*="invalid"]').all();
  if (errorElements.length > 0) {
    console.log(`Found ${errorElements.length} potential error elements:`);
    for (let i = 0; i < errorElements.length; i++) {
      const text = await errorElements[i].textContent();
      const isVisible = await errorElements[i].isVisible();
      if (isVisible) {
        console.log(`  Error ${i} (visible): ${text?.trim()}`);
      }
    }
  } else {
    console.log('No error elements found before login');
  }
  console.log('=== End error check ===\n');

  // Click login button
  console.log('Searching for login button...');
  const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
  await loginButton.waitFor({ state: 'visible' });
  const buttonText = await loginButton.textContent();
  console.log('Login button found:', buttonText?.trim());
  const isEnabled = await loginButton.isEnabled();
  console.log('Login button enabled:', isEnabled);
  await loginButton.click();
  console.log('Login button clicked');

  // Wait and check for error messages after login attempt
  console.log('\n=== Waiting for login response ===');
  await page.waitForTimeout(2000);
  
  const loginErrors = await page.locator('.error, .alert, .alert-danger, [class*="error"], [class*="invalid"], .text-danger').all();
  console.log(`Found ${loginErrors.length} potential error elements after login:`);
  for (let i = 0; i < loginErrors.length; i++) {
    const text = await loginErrors[i].textContent();
    const isVisible = await loginErrors[i].isVisible();
    if (isVisible && text && text.trim().length > 0) {
      console.log(`  ERROR VISIBLE: "${text?.trim()}"`);
    }
  }
  
  // Also check if we're still on login page
  const currentUrl = page.url();
  console.log('Current URL after login attempt:', currentUrl);
  if (currentUrl.includes('/login')) {
    console.log('⚠️  Still on login page - login failed!');
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'login-failed.png', fullPage: true });
    console.log('Screenshot saved to login-failed.png');
    
    // Log final field values
    console.log('\n=== Final field values ===');
    console.log('Selected DP:', await selectLocator.inputValue());
    console.log('Username:', await usernameInput.inputValue());
    console.log('Password filled:', (await passwordInput.inputValue()).length > 0);
  }
  console.log('=== End login response ===\n');

  // Wait for dashboard to load
  console.log('Waiting for dashboard to load');
  try {
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('Dashboard loaded. Current URL:', page.url());
  } catch (e) {
    console.log('Dashboard timeout. Current URL:', page.url());
  }
  await page.waitForTimeout(3000); // Wait for page to fully load

  // Click on My ASBA tab
  console.log('Searching for My ASBA link...');
  const asbaLink = page.locator('a[href="#/asba"]');
  await asbaLink.waitFor({ state: 'visible' });
  const asbaText = await asbaLink.textContent();
  console.log('ASBA link found:', asbaText?.trim());
  await asbaLink.click();
  console.log('ASBA link clicked');

  // Wait for ASBA page to load
  console.log('Waiting for ASBA page to load');
  try {
    await page.waitForURL('**/asba', { timeout: 10000 });
    console.log('ASBA page loaded. Current URL:', page.url());
  } catch (e) {
    console.log('ASBA timeout. Current URL:', page.url());
  }
  await page.waitForTimeout(3000);

  // Ensure Apply for Issue tab is active (it should be by default)
  console.log('Checking Apply for Issue tab');
  const applyForIssueTab = page.locator('a.nav-link').filter({ hasText: 'Apply for Issue' });
  const isActive = await applyForIssueTab.isVisible();
  console.log('Apply for Issue tab visible:', isActive);
  
  if (isActive) {
    const tabClass = await applyForIssueTab.getAttribute('class');
    console.log('Tab classes:', tabClass);
  }

  // List all IPOs
  console.log('\n=== Listing all IPOs in Apply for Issue ===');
  const companyLists = page.locator('.company-list');
  const companyCount = await companyLists.count();
  console.log(`Found ${companyCount} companies\n`);

  if (companyCount === 0) {
    console.log('No companies found. Checking page content...');
    const pageContent = await page.content();
    console.log('Page contains "company-list":', pageContent.includes('company-list'));
    console.log('Page contains "Apply for Issue":', pageContent.includes('Apply for Issue'));
  }

  for (let i = 0; i < companyCount; i++) {
    const company = companyLists.nth(i);
    
    // Get company name
    const companyNameElement = company.locator('.company-name');
    const companyNameFull = await companyNameElement.textContent();
    
    // Try to get share type and ISIN
    const shareType = await company.locator('.share-of-type').textContent().catch(() => 'N/A');
    const isin = await company.locator('.isin').textContent().catch(() => 'N/A');
    
    console.log(`\nIPO ${i + 1}:`);
    console.log(`  Company: ${companyNameFull?.trim()}`);
    console.log(`  Share Type: ${shareType?.trim()}`);
    console.log(`  ISIN: ${isin?.trim()}`);
  }
  
  console.log('\n=== Test completed successfully ===');
});
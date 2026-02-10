import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// ── Types ────────────────────────────────────────────────────────────────────

interface Credential {
  username: string;
  password: string;
  CRN: string;
}

interface DPInfo {
  id: number;
  code: string;
  name: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadCredentials(): Record<string, Credential> {
  const filePath = path.resolve('credentials.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Capture the DP list from the Meroshare API and return a map of code → id.
 * The Angular app loads DPs via GET; we listen for that response.
 */
async function captureDPList(page: import('@playwright/test').Page): Promise<DPInfo[]> {
  const dpList: DPInfo[] = [];

  const handler = async (resp: import('@playwright/test').Response) => {
    if (resp.url().includes('/api/') && resp.request().method() === 'GET') {
      try {
        const body = await resp.json();
        if (Array.isArray(body) && body.length > 5 && body[0]?.name && body[0]?.code) {
          for (const item of body) {
            dpList.push({ id: item.id, code: String(item.code), name: item.name });
          }
        }
      } catch { /* not JSON, skip */ }
    }
  };

  page.on('response', handler);
  await page.reload();
  await page.waitForURL('**/login', { timeout: 15000 });
  await page.waitForTimeout(2000);
  page.off('response', handler);

  return dpList;
}

/** Select the DP option in the <select> dropdown by matching text */
async function selectDPInDropdown(page: import('@playwright/test').Page, searchText: string) {
  const dpSelect = page.locator('select');
  await dpSelect.waitFor({ state: 'visible', timeout: 10000 });

  const dpOption = dpSelect.locator('option').filter({ hasText: searchText }).first();
  const dpValue = await dpOption.getAttribute('value');
  if (!dpValue) throw new Error(`DP option containing "${searchText}" not found in dropdown`);

  await dpSelect.selectOption(dpValue);
  await page.waitForTimeout(300);
  return dpOption;
}

/** Fill an input field using keyboard typing (triggers Angular change detection) */
async function typeIntoField(
  input: import('@playwright/test').Locator,
  value: string,
  delay = 50,
) {
  await input.waitFor({ state: 'visible' });
  await input.click();
  await input.clear();
  await input.type(value, { delay });
}

// ── Constants ────────────────────────────────────────────────────────────────

const DP_CODE = '10700'; // LAXMI SUNRISE CAPITAL LIMITED

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Meroshare Login', () => {
  const baseUrl = process.env.BASE_URL;

  test.beforeEach(async () => {
    if (!baseUrl) {
      throw new Error('BASE_URL is not set in .env file');
    }
  });

  test('should autofill login form fields correctly', async ({ page }) => {
    const credentials = loadCredentials();
    const cred = credentials.Dad;

    // Navigate to Meroshare login page
    await page.goto(baseUrl!);
    await page.waitForURL('**/login', { timeout: 15000 });

    // ── 1. Select Depository Participant ──────────────────────────────────
    const dpOption = await selectDPInDropdown(page, DP_CODE);
    const dpText = await dpOption.textContent();
    console.log(`[OK] DP selected: "${dpText?.trim()}"`);

    // ── 2. Fill Username (DMAT number) ───────────────────────────────────
    const usernameInput = page.locator('input[type="text"]').first();
    await typeIntoField(usernameInput, cred.username);
    await expect(usernameInput).toHaveValue(cred.username);
    console.log(`[OK] Username filled: ${cred.username}`);

    // ── 3. Fill Password ─────────────────────────────────────────────────
    const passwordInput = page.locator('input[type="password"]');
    await typeIntoField(passwordInput, cred.password);
    const passwordLength = (await passwordInput.inputValue()).length;
    expect(passwordLength).toBeGreaterThan(0);
    console.log(`[OK] Password filled: ${passwordLength} characters`);

    // ── 4. Verify Login button is enabled ────────────────────────────────
    const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
    await expect(loginButton).toBeEnabled();
    console.log('[OK] Login button is enabled');

    // Screenshot of the filled form
    await page.screenshot({ path: 'test-results/login-form-filled.png', fullPage: true });
    console.log('[OK] Screenshot: test-results/login-form-filled.png');
  });

  test('should login successfully with Dad credentials', async ({ page }) => {
    const credentials = loadCredentials();
    const cred = credentials.Dad;

    // Navigate to Meroshare login page
    await page.goto(baseUrl!);
    await page.waitForURL('**/login', { timeout: 15000 });

    // ── Resolve the correct DP clientId from the API ─────────────────────
    // Angular's select binding doesn't propagate to the model via Playwright's
    // selectOption, so we intercept the login POST and inject the correct clientId.
    const dpList = await captureDPList(page);
    const targetDP = dpList.find((dp) => dp.code === DP_CODE);
    if (!targetDP) {
      throw new Error(`DP with code ${DP_CODE} not found in API. Available: ${dpList.length} DPs`);
    }
    console.log(`[DP] Resolved: id=${targetDP.id}, code=${targetDP.code}, name="${targetDP.name}"`);

    // Intercept the login POST and fix clientId (Angular select doesn't bind
    // properly via Playwright's selectOption, sending clientId=0 instead)
    await page.route('**/api/meroShare/auth/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const payload = req.postDataJSON();
        if (payload.clientId === 0) {
          payload.clientId = targetDP.id;
        }
        await route.continue({ postData: JSON.stringify(payload) });
      } else {
        await route.continue();
      }
    });

    // ── Fill the login form ──────────────────────────────────────────────
    console.log(`Logging in as "${cred.username}" with DP "${targetDP.name}" ...`);

    await selectDPInDropdown(page, DP_CODE);

    const usernameInput = page.locator('input[type="text"]').first();
    await typeIntoField(usernameInput, cred.username);

    const passwordInput = page.locator('input[type="password"]');
    await typeIntoField(passwordInput, cred.password);
    await page.waitForTimeout(500);

    // Screenshot before submitting
    await page.screenshot({ path: 'test-results/login-before-submit.png', fullPage: true });

    // ── Click Login ──────────────────────────────────────────────────────
    const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
    await expect(loginButton).toBeEnabled();

    // Listen for the login API response
    const loginResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/meroShare/auth') && resp.request().method() === 'POST',
      { timeout: 20000 },
    );

    await loginButton.click();
    console.log('Login button clicked');

    const loginResponse = await loginResponsePromise;
    const status = loginResponse.status();
    console.log(`Login API: HTTP ${status}`);

    if (status !== 200) {
      const body = await loginResponse.text().catch(() => '(unreadable)');
      console.log(`API error: ${body}`);
      await page.screenshot({ path: 'test-results/login-failed.png', fullPage: true });
      throw new Error(`Login failed with HTTP ${status}: ${body}`);
    }

    // ── Verify successful login ──────────────────────────────────────────
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');
    console.log('[OK] Navigated to dashboard');

    // Verify dashboard content loaded (sidebar navigation items)
    const sidebarNav = page.locator('.sidebar-nav');
    await expect(sidebarNav).toBeVisible({ timeout: 10000 });
    console.log('[OK] Dashboard sidebar loaded');

    // Take success screenshot
    await page.screenshot({ path: 'test-results/login-success.png', fullPage: true });
    console.log('[OK] Login successful!');
  });
});

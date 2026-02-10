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

/**
 * Full login flow: navigate to Meroshare, resolve DP, fill form, intercept
 * the login POST with the correct clientId, click Login, wait for dashboard.
 */
async function loginToMeroshare(
  page: import('@playwright/test').Page,
  baseUrl: string,
  cred: Credential,
  dpCode: string,
) {
  // Navigate to login page
  await page.goto(baseUrl);
  await page.waitForURL('**/login', { timeout: 15000 });

  // Resolve the correct DP clientId from the API
  const dpList = await captureDPList(page);
  const targetDP = dpList.find((dp) => dp.code === dpCode);
  if (!targetDP) {
    throw new Error(`DP with code ${dpCode} not found. Available: ${dpList.length} DPs`);
  }
  console.log(`[DP] Resolved: id=${targetDP.id}, code=${targetDP.code}, name="${targetDP.name}"`);

  // Intercept the login POST and fix clientId
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

  // Fill the login form
  console.log(`Logging in as "${cred.username}" with DP "${targetDP.name}" ...`);

  await selectDPInDropdown(page, dpCode);

  const usernameInput = page.locator('input[type="text"]').first();
  await typeIntoField(usernameInput, cred.username);

  const passwordInput = page.locator('input[type="password"]');
  await typeIntoField(passwordInput, cred.password);
  await page.waitForTimeout(500);

  // Click Login and wait for API response
  const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
  await expect(loginButton).toBeEnabled();

  const loginResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/meroShare/auth') && resp.request().method() === 'POST',
    { timeout: 20000 },
  );

  await loginButton.click();

  const loginResponse = await loginResponsePromise;
  const status = loginResponse.status();
  if (status !== 200) {
    const body = await loginResponse.text().catch(() => '(unreadable)');
    throw new Error(`Login failed with HTTP ${status}: ${body}`);
  }

  // Wait for dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  console.log('[OK] Logged in and on dashboard');
}

// ── Constants ────────────────────────────────────────────────────────────────

const DP_CODE = '10700'; // LAXMI SUNRISE CAPITAL LIMITED
const MAX_REPORTS_TO_PROCESS = 5; // Number of application reports to open and inspect

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

    await page.goto(baseUrl!);
    await page.waitForURL('**/login', { timeout: 15000 });

    // 1. Select Depository Participant
    const dpOption = await selectDPInDropdown(page, DP_CODE);
    const dpText = await dpOption.textContent();
    console.log(`[OK] DP selected: "${dpText?.trim()}"`);

    // 2. Fill Username
    const usernameInput = page.locator('input[type="text"]').first();
    await typeIntoField(usernameInput, cred.username);
    await expect(usernameInput).toHaveValue(cred.username);
    console.log(`[OK] Username filled: ${cred.username}`);

    // 3. Fill Password
    const passwordInput = page.locator('input[type="password"]');
    await typeIntoField(passwordInput, cred.password);
    const passwordLength = (await passwordInput.inputValue()).length;
    expect(passwordLength).toBeGreaterThan(0);
    console.log(`[OK] Password filled: ${passwordLength} characters`);

    // 4. Verify Login button is enabled
    const loginButton = page.locator('button').filter({ hasText: /login/i }).first();
    await expect(loginButton).toBeEnabled();
    console.log('[OK] Login button is enabled');

    await page.screenshot({ path: 'test-results/login-form-filled.png', fullPage: true });
  });

  test('should login successfully with Dad credentials', async ({ page }) => {
    const credentials = loadCredentials();
    await loginToMeroshare(page, baseUrl!, credentials.Dad, DP_CODE);

    // Verify dashboard
    expect(page.url()).toContain('/dashboard');
    const sidebarNav = page.locator('.sidebar-nav');
    await expect(sidebarNav).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: 'test-results/login-success.png', fullPage: true });
    console.log('[OK] Login successful!');
  });

  test('should navigate to My ASBA and log content', async ({ page, }, testInfo) => {
    // This test iterates through many application report records
    testInfo.setTimeout(5 * 60 * 1000); // 5 minutes
    const credentials = loadCredentials();
    await loginToMeroshare(page, baseUrl!, credentials.Dad, DP_CODE);

    // ── Navigate to My ASBA via sidebar ──────────────────────────────────
    const asbaLink = page.locator('a[href="#/asba"]');
    await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
    await asbaLink.click();
    console.log('[NAV] Clicked "My ASBA" in sidebar');

    await page.waitForURL('**/asba', { timeout: 15000 });
    console.log(`[NAV] URL: ${page.url()}`);

    // Wait for the ASBA page content to load
    await page.waitForTimeout(3000);

    // ── Log the tabs ─────────────────────────────────────────────────────
    const tabs = page.locator('.page-title-action-tab .nav-item');
    const tabCount = await tabs.count();
    console.log(`\n=== MY ASBA PAGE ===`);
    console.log(`Tabs found: ${tabCount}`);
    for (let i = 0; i < tabCount; i++) {
      const tabText = await tabs.nth(i).textContent();
      const isActive = (await tabs.nth(i).locator('a').getAttribute('class'))?.includes('active');
      console.log(`  [${isActive ? 'ACTIVE' : '      '}] ${tabText?.trim()}`);
    }

    // ── Log "Apply for Issue" content (default active tab) ───────────────
    console.log(`\n--- Apply for Issue ---`);
    const companyItems = page.locator('.company-list');
    const itemCount = await companyItems.count();
    console.log(`Companies listed: ${itemCount}`);

    if (itemCount === 0) {
      console.log('(no companies available for application)');
      console.log('[NAV] Switching to "Application Report" tab ...');

      // ── Click "Application Report" tab ───────────────────────────────────
      const appReportTab = page.locator('.page-title-action-tab .nav-item a')
        .filter({ hasText: 'Application Report' }).first();
      await appReportTab.click();
      // Wait for company-list items to appear
      await page.locator('.company-list').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/my-asba-app-report.png', fullPage: true });

      // ── Collect all application report items ─────────────────────────────
      const reportItems = page.locator('.company-list');
      const reportCount = await reportItems.count();
      console.log(`\n--- Application Report ---`);
      const processCount = Math.min(reportCount, MAX_REPORTS_TO_PROCESS);
      console.log(`Records found: ${reportCount} (processing first ${processCount})\n`);

      // First pass: collect company names + share types from the list
      const records: { name: string; subGroup: string; shareType: string }[] = [];
      for (let i = 0; i < processCount; i++) {
        const item = reportItems.nth(i);
        const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
        const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const subGroupEl = item.locator('.company-name span[tooltip="Sub Group"]');
        const subGroup = (await subGroupEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareTypeEl = item.locator('.share-of-type');
        const shareType = (await shareTypeEl.textContent().catch(() => ''))?.trim() || 'N/A';
        records.push({ name: companyName, subGroup, shareType });
      }

      // Second pass: click each record, extract Status + Remarks, navigate back
      for (let i = 0; i < processCount; i++) {
        const { name, subGroup, shareType } = records[i];

        // Re-query the list item (DOM may have been refreshed after navigation)
        const currentItems = page.locator('.company-list');
        const currentItem = currentItems.nth(i);

        // Scroll the item into view and click the action button (or the row itself)
        await currentItem.scrollIntoViewIfNeeded();
        const viewBtn = currentItem.locator('.action-buttons button:visible, .action-buttons i:visible').first();
        const hasBtnCount = await viewBtn.count();
        if (hasBtnCount > 0) {
          await viewBtn.click();
        } else {
          await currentItem.click();
        }

        // Wait for the detail page to load (URL or content change)
        await page.waitForTimeout(1500);

        // Extract Status and Remarks from the detail page
        const mainContent = page.locator('main#main');
        const detailText = await mainContent.innerText();
        const lines = detailText.split('\n').map((l) => l.trim()).filter(Boolean);

        let status = 'N/A';
        let remarks = 'N/A';

        for (let l = 0; l < lines.length; l++) {
          if (lines[l].toLowerCase() === 'status' && l + 1 < lines.length) {
            status = lines[l + 1];
          }
          if (lines[l].toLowerCase() === 'remarks' && l + 1 < lines.length) {
            remarks = lines[l + 1];
          }
        }

        console.log(`  [${i + 1}/${reportCount}] ${name} (${shareType})`);
        console.log(`    Status:  ${status}`);
        console.log(`    Remarks: ${remarks}`);

        // Navigate back
        await page.goBack();
        await page.waitForTimeout(1000);

        // We're back on the ASBA page — ensure the Application Report tab is active
        const tabsContainer = page.locator('.page-title-action-tab');
        await tabsContainer.waitFor({ state: 'visible', timeout: 10000 });

        const activeTab = page.locator('.page-title-action-tab .nav-item a.active');
        const activeTabText = (await activeTab.textContent().catch(() => ''))?.trim();
        if (!activeTabText?.includes('Application Report')) {
          const tab = page.locator('.page-title-action-tab .nav-item a')
            .filter({ hasText: 'Application Report' }).first();
          await tab.click();
          await page.waitForTimeout(1500);
        }
      }
    } else {
      // Log the Apply for Issue items
      for (let i = 0; i < itemCount; i++) {
        const item = companyItems.nth(i);
        const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
        const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareTypeEl = item.locator('.share-of-type');
        const shareType = (await shareTypeEl.textContent().catch(() => ''))?.trim() || 'N/A';
        console.log(`  [${i + 1}] ${companyName} | ${shareType}`);
      }
    }

    console.log(`\n=== END MY ASBA ===`);

    await page.screenshot({ path: 'test-results/my-asba.png', fullPage: true });
    console.log('[OK] Screenshot: test-results/my-asba.png');
  });
});

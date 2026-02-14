import { chromium, type Page, type Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Credential {
  DP_CODE: string;
  username: string;
  password: string;
  CRN: string;
  TPIN?: string;
}

interface DPInfo {
  id: number;
  code: string;
  name: string;
}

export type AccountStatusType = 'pending' | 'running' | 'already_applied' | 'success' | 'error' | 'login_failed';

export interface AccountStatus {
  account: string;
  status: AccountStatusType;
  message: string;
}

export type AutomationEvent =
  | { type: 'log'; message: string }
  | { type: 'issue'; data: { name: string; subGroup: string; shareType: string; shareGroup: string } }
  | { type: 'report'; data: { index: number; total: number; name: string; shareType: string; status: string; remarks: string } }
  | { type: 'apply_success'; message: string }
  | { type: 'account_status'; data: AccountStatus }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://meroshare.cdsc.com.np/';

// ── Credential Loader ────────────────────────────────────────────────────────

export function loadAllCredentials(): Record<string, Credential> {
  const allCredsPath = path.resolve(__dirname, '..', 'all_credentials.json');
  if (fs.existsSync(allCredsPath)) {
    return JSON.parse(fs.readFileSync(allCredsPath, 'utf-8'));
  }
  // Fallback to credentials.json
  const credsPath = path.resolve(__dirname, '..', 'credentials.json');
  return JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
}

// ── Playwright Helpers (extracted from tests/login.spec.ts) ──────────────────

async function captureDPList(page: Page): Promise<DPInfo[]> {
  const dpList: DPInfo[] = [];

  const handler = async (resp: any) => {
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

async function selectDPInDropdown(page: Page, searchText: string) {
  const dpSelect = page.locator('select');
  await dpSelect.waitFor({ state: 'visible', timeout: 10000 });

  const dpOption = dpSelect.locator('option').filter({ hasText: searchText }).first();
  const dpValue = await dpOption.getAttribute('value');
  if (!dpValue) throw new Error(`DP option containing "${searchText}" not found in dropdown`);

  await dpSelect.selectOption(dpValue);
  await page.waitForTimeout(300);
}

async function typeIntoField(input: any, value: string, delay = 50) {
  await input.waitFor({ state: 'visible' });
  await input.click();
  await input.clear();
  await input.type(value, { delay });
}

async function loginToMeroshare(page: Page, cred: Credential, dpCode: string, emit: (e: AutomationEvent) => void) {
  // Navigate to login page
  await page.goto(BASE_URL);
  await page.waitForURL('**/login', { timeout: 15000 });
  emit({ type: 'log', message: 'On login page' });

  // Resolve the correct DP from the API using the account's DP code
  const dpList = await captureDPList(page);
  emit({ type: 'log', message: `Captured ${dpList.length} DPs from API. Looking for code ${dpCode}...` });

  const targetDP = dpList.find((dp) => dp.code === dpCode);
  if (!targetDP) {
    // Log available codes to aid debugging
    const availableCodes = dpList.slice(0, 10).map((dp) => `${dp.code} (${dp.name})`).join(', ');
    throw new Error(`DP with code ${dpCode} not found. Available (first 10): ${availableCodes}...`);
  }
  emit({ type: 'log', message: `DP resolved: ${targetDP.name} (code=${targetDP.code}, id=${targetDP.id})` });

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

  emit({ type: 'log', message: `Logging in as "${cred.username}" with DP "${targetDP.name}" ...` });

  // Select the DP in the dropdown using the resolved name (not the code)
  await selectDPInDropdown(page, targetDP.name);

  const usernameInput = page.locator('input[type="text"]').first();
  await typeIntoField(usernameInput, cred.username);

  const passwordInput = page.locator('input[type="password"]');
  await typeIntoField(passwordInput, cred.password);
  await page.waitForTimeout(500);

  // Click Login and wait for API response
  const loginButton = page.locator('button').filter({ hasText: /login/i }).first();

  const loginResponsePromise = page.waitForResponse(
    (resp: any) => resp.url().includes('/api/meroShare/auth') && resp.request().method() === 'POST',
    { timeout: 20000 },
  );

  await loginButton.click();

  const loginResponse = await loginResponsePromise;
  const status = loginResponse.status();
  if (status !== 200) {
    const body = await loginResponse.text().catch(() => '(unreadable)');
    throw new Error(`Login failed with HTTP ${status}: ${body}`);
  }

  await page.waitForURL('**/dashboard', { timeout: 15000 });
  emit({ type: 'log', message: 'Logged in successfully — on dashboard' });
}

// ── Main Automation Function ─────────────────────────────────────────────────

export async function runMeroshareAutomation(
  accountName: string,
  cred: Credential,
  maxReports: number,
  onEvent: (event: AutomationEvent) => void,
): Promise<void> {
  let browser: Browser | null = null;

  try {
    onEvent({ type: 'log', message: `Starting automation for "${accountName}" ...` });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // ── Login ────────────────────────────────────────────────────────────
    await loginToMeroshare(page, cred, cred.DP_CODE, onEvent);

    // ── Navigate to My ASBA ──────────────────────────────────────────────
    const asbaLink = page.locator('a[href="#/asba"]');
    await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
    await asbaLink.click();
    await page.waitForURL('**/asba', { timeout: 15000 });
    onEvent({ type: 'log', message: 'Navigated to My ASBA' });

    await page.waitForTimeout(3000);

    // ── Check "Apply for Issue" tab ──────────────────────────────────────
    const companyItems = page.locator('.company-list');
    const itemCount = await companyItems.count();

    if (itemCount > 0) {
      onEvent({ type: 'log', message: `Found ${itemCount} open issues in "Apply for Issue"` });
      for (let i = 0; i < itemCount; i++) {
        const item = companyItems.nth(i);
        const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
        const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const subGroupEl = item.locator('.company-name span[tooltip="Sub Group"]');
        const subGroup = (await subGroupEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareTypeEl = item.locator('.share-of-type');
        const shareType = (await shareTypeEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareGroupEl = item.locator('.isin');
        const shareGroup = (await shareGroupEl.textContent().catch(() => ''))?.trim() || 'N/A';
        onEvent({ type: 'issue', data: { name: companyName, subGroup, shareType, shareGroup } });
      }
    } else {
      onEvent({ type: 'log', message: 'No open issues — switching to Application Report tab' });
    }

    // ── Switch to "Application Report" tab ───────────────────────────────
    const appReportTab = page.locator('.page-title-action-tab .nav-item a')
      .filter({ hasText: 'Application Report' }).first();
    await appReportTab.click();
    await page.locator('.company-list').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    const reportItems = page.locator('.company-list');
    const reportCount = await reportItems.count();
    const processCount = Math.min(reportCount, maxReports);
    onEvent({ type: 'log', message: `Application Report: ${reportCount} records (processing ${processCount})` });

    // First pass: collect names
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
      const { name, shareType } = records[i];

      const currentItems = page.locator('.company-list');
      const currentItem = currentItems.nth(i);

      await currentItem.scrollIntoViewIfNeeded();
      const viewBtn = currentItem.locator('.action-buttons button:visible, .action-buttons i:visible').first();
      const hasBtnCount = await viewBtn.count();
      if (hasBtnCount > 0) {
        await viewBtn.click();
      } else {
        await currentItem.click();
      }

      await page.waitForTimeout(1500);

      // Extract Status and Remarks
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

      onEvent({
        type: 'report',
        data: { index: i + 1, total: reportCount, name, shareType, status, remarks },
      });

      // Navigate back
      await page.goBack();
      await page.waitForTimeout(1000);

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

    onEvent({ type: 'done' });
  } catch (err: any) {
    onEvent({ type: 'error', message: err.message || String(err) });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ── Scan-Only Function ──────────────────────────────────────────────────────

export async function scanForIssues(
  accountName: string,
  cred: Credential,
  onEvent: (event: AutomationEvent) => void,
): Promise<void> {
  let browser: Browser | null = null;

  try {
    onEvent({ type: 'log', message: `Scanning for open issues using "${accountName}" ...` });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginToMeroshare(page, cred, cred.DP_CODE, onEvent);

    // Navigate to My ASBA
    const asbaLink = page.locator('a[href="#/asba"]');
    await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
    await asbaLink.click();
    await page.waitForURL('**/asba', { timeout: 15000 });
    onEvent({ type: 'log', message: 'Navigated to My ASBA' });
    await page.waitForTimeout(3000);

    // Scrape the "Apply for Issue" tab (default active tab)
    const companyItems = page.locator('.company-list');
    const itemCount = await companyItems.count();

    if (itemCount > 0) {
      onEvent({ type: 'log', message: `Found ${itemCount} open issue(s)` });
      for (let i = 0; i < itemCount; i++) {
        const item = companyItems.nth(i);
        const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
        const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const subGroupEl = item.locator('.company-name span[tooltip="Sub Group"]');
        const subGroup = (await subGroupEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareTypeEl = item.locator('.share-of-type');
        const shareType = (await shareTypeEl.textContent().catch(() => ''))?.trim() || 'N/A';
        const shareGroupEl = item.locator('.isin');
        const shareGroup = (await shareGroupEl.textContent().catch(() => ''))?.trim() || 'N/A';
        onEvent({ type: 'issue', data: { name: companyName, subGroup, shareType, shareGroup } });
      }
    } else {
      onEvent({ type: 'log', message: 'No open issues found' });
    }

    onEvent({ type: 'done' });
  } catch (err: any) {
    onEvent({ type: 'error', message: err.message || String(err) });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ── IPO Application Function ────────────────────────────────────────────────

/**
 * Select the first non-placeholder option in a <select>.
 * Meroshare uses "Please choose one" as placeholder text.
 */
async function selectFirstRealOption(selectLocator: any, fieldName: string): Promise<string> {
  await selectLocator.waitFor({ state: 'visible', timeout: 10000 });

  const options = selectLocator.locator('option');
  const optionCount = await options.count();

  for (let i = 0; i < optionCount; i++) {
    const text = ((await options.nth(i).textContent()) || '').trim();
    const value = (await options.nth(i).getAttribute('value')) || '';
    if (
      text !== '' &&
      !text.toLowerCase().includes('please choose') &&
      !text.toLowerCase().includes('select') &&
      value !== '' &&
      value !== 'null' &&
      value !== 'undefined'
    ) {
      await selectLocator.selectOption({ index: i });
      await selectLocator.dispatchEvent('change');
      return text;
    }
  }

  throw new Error(`[${fieldName}] No valid (non-placeholder) option found`);
}

export async function applyForIPO(
  accountName: string,
  cred: Credential,
  companyIndex: number,
  appliedKitta: string,
  transactionPIN: string,
  onEvent: (event: AutomationEvent) => void,
): Promise<void> {
  let browser: Browser | null = null;

  try {
    onEvent({ type: 'log', message: `Starting IPO application for "${accountName}" ...` });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // ── Login ────────────────────────────────────────────────────────────
    await loginToMeroshare(page, cred, cred.DP_CODE, onEvent);

    // ── Navigate to My ASBA ──────────────────────────────────────────────
    const asbaLink = page.locator('a[href="#/asba"]');
    await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
    await asbaLink.click();
    await page.waitForURL('**/asba', { timeout: 15000 });
    onEvent({ type: 'log', message: 'Navigated to My ASBA' });
    await page.waitForTimeout(3000);

    // ── Find and click Apply on the target IPO ───────────────────────────
    const companyItems = page.locator('.company-list');
    const itemCount = await companyItems.count();

    if (itemCount === 0) {
      throw new Error('No open issues found in "Apply for Issue" tab');
    }
    if (companyIndex < 0 || companyIndex >= itemCount) {
      throw new Error(`Invalid company index ${companyIndex}. Found ${itemCount} issues.`);
    }

    const targetItem = companyItems.nth(companyIndex);
    const nameEl = targetItem.locator('.company-name span[tooltip="Company Name"]');
    const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'Unknown';
    onEvent({ type: 'log', message: `Applying for: ${companyName}` });

    // Click the Apply button
    const applyBtn = targetItem.locator('button').filter({ hasText: /apply/i }).first();
    const applyBtnCount = await applyBtn.count();
    if (applyBtnCount > 0) {
      await applyBtn.click();
    } else {
      const actionBtn = targetItem.locator('.action-buttons button:visible').first();
      const actionBtnCount = await actionBtn.count();
      if (actionBtnCount > 0) {
        await actionBtn.click();
      } else {
        await targetItem.click();
      }
    }

    await page.waitForTimeout(3000);
    onEvent({ type: 'log', message: 'Apply form loaded' });

    // ── Fill Bank ────────────────────────────────────────────────────────
    const bankSelect = page.locator('select#selectBank');
    const bankValue = await selectFirstRealOption(bankSelect, 'Bank');
    onEvent({ type: 'log', message: `Bank selected: ${bankValue}` });
    await page.waitForTimeout(2000);

    // ── Fill Account Number (appears after bank selection) ───────────────
    const accountSelect = page.locator('main#main select').nth(1);
    const accountValue = await selectFirstRealOption(accountSelect, 'Account Number');
    onEvent({ type: 'log', message: `Account Number selected: ${accountValue}` });
    await page.waitForTimeout(2000);

    // ── Branch auto-populates — just log it ──────────────────────────────
    const branchInput = page.locator('input#selectBranch');
    const branchCount = await branchInput.count();
    if (branchCount > 0) {
      const branchValue = await branchInput.inputValue();
      onEvent({ type: 'log', message: `Branch: ${branchValue || '(auto-populated)'}` });
    }

    // ── Fill Applied Kitta ───────────────────────────────────────────────
    const kittaInput = page.locator('input#appliedKitta');
    await typeIntoField(kittaInput, appliedKitta);
    await kittaInput.dispatchEvent('input');
    await kittaInput.dispatchEvent('change');
    await kittaInput.press('Tab');
    onEvent({ type: 'log', message: `Applied Kitta: ${appliedKitta}` });
    await page.waitForTimeout(1500);

    // ── Check Amount (auto-populated) ────────────────────────────────────
    const amountInput = page.locator('input#amount');
    const amountCount = await amountInput.count();
    if (amountCount > 0) {
      const amountValue = await amountInput.inputValue();
      onEvent({ type: 'log', message: `Amount: ${amountValue || '(auto-calculated)'}` });
    }

    // ── Fill CRN ─────────────────────────────────────────────────────────
    const crnInput = page.locator('input#crnNumber');
    await typeIntoField(crnInput, cred.CRN);
    onEvent({ type: 'log', message: `CRN filled: ${cred.CRN}` });
    await page.waitForTimeout(500);

    // ── Check declaration checkbox ───────────────────────────────────────
    const disclaimer = page.locator('input#disclaimer');
    const isChecked = await disclaimer.isChecked();
    if (!isChecked) {
      await disclaimer.click({ force: true });
    }
    onEvent({ type: 'log', message: 'Declaration checkbox checked' });

    // ── Click Proceed ────────────────────────────────────────────────────
    const proceedBtn = page.locator('button').filter({ hasText: /proceed/i }).first();
    await proceedBtn.click();
    onEvent({ type: 'log', message: 'Clicked Proceed' });
    await page.waitForTimeout(3000);

    // ── Transaction PIN page ─────────────────────────────────────────────
    const pinInput = page.locator('input#transactionPIN');
    await pinInput.waitFor({ state: 'visible', timeout: 10000 });
    await typeIntoField(pinInput, transactionPIN);
    onEvent({ type: 'log', message: 'Transaction PIN entered' });
    await page.waitForTimeout(500);

    // Click the Apply button on the PIN page
    const finalApplyBtn = page.locator('button').filter({ hasText: /apply/i }).first();
    await finalApplyBtn.waitFor({ state: 'visible', timeout: 5000 });
    await finalApplyBtn.click();
    onEvent({ type: 'log', message: 'Clicked Apply — submitting application...' });
    await page.waitForTimeout(5000);

    // Check for success or error messages on the page
    const pageText = await page.locator('body').innerText();
    if (pageText.toLowerCase().includes('success') || pageText.toLowerCase().includes('applied')) {
      onEvent({ type: 'apply_success', message: `Successfully applied for ${companyName}` });
    } else {
      onEvent({ type: 'log', message: `Application submitted for ${companyName}. Check Meroshare for status.` });
    }

    onEvent({ type: 'done' });
  } catch (err: any) {
    onEvent({ type: 'error', message: err.message || String(err) });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ── Bulk Apply Function ─────────────────────────────────────────────────────

/**
 * Apply for a specific IPO across multiple accounts sequentially.
 * For each account: login → ASBA → find IPO by name → check Apply vs Edit → apply.
 */
export async function bulkApplyForIPO(
  accountEntries: { name: string; cred: Credential }[],
  targetCompanyName: string,
  appliedKitta: string,
  defaultPIN: string,
  accountPINs: Record<string, string>,
  onEvent: (event: AutomationEvent) => void,
): Promise<void> {
  onEvent({ type: 'log', message: `Bulk apply starting for "${targetCompanyName}" across ${accountEntries.length} account(s)` });

  for (const entry of accountEntries) {
    const { name: accountName, cred } = entry;
    let browser: Browser | null = null;

    onEvent({
      type: 'account_status',
      data: { account: accountName, status: 'running', message: 'Logging in...' },
    });

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      // ── Login ──────────────────────────────────────────────────────────
      try {
        await loginToMeroshare(page, cred, cred.DP_CODE, onEvent);
      } catch (loginErr: any) {
        onEvent({
          type: 'account_status',
          data: {
            account: accountName,
            status: 'login_failed',
            message: `Login failed: ${loginErr.message || String(loginErr)}`,
          },
        });
        continue; // skip to next account
      }

      // ── Navigate to My ASBA ────────────────────────────────────────────
      const asbaLink = page.locator('a[href="#/asba"]');
      await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
      await asbaLink.click();
      await page.waitForURL('**/asba', { timeout: 15000 });
      await page.waitForTimeout(3000);

      // ── Find the target company by name ────────────────────────────────
      const companyItems = page.locator('.company-list');
      const itemCount = await companyItems.count();

      if (itemCount === 0) {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'error', message: 'No open issues found on this account' },
        });
        continue;
      }

      let targetIndex = -1;
      for (let i = 0; i < itemCount; i++) {
        const item = companyItems.nth(i);
        const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
        const name = (await nameEl.textContent().catch(() => ''))?.trim() || '';
        if (name.toLowerCase() === targetCompanyName.toLowerCase()) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'error', message: `IPO "${targetCompanyName}" not found in this account's issue list` },
        });
        continue;
      }

      const targetItem = companyItems.nth(targetIndex);

      // ── Detect Apply vs Edit button ────────────────────────────────────
      // Check all visible buttons in this IPO item to detect Apply vs Edit
      const buttons = targetItem.locator('button');
      const btnCount = await buttons.count();
      let applyBtn: any = null;
      let hasEdit = false;

      for (let b = 0; b < btnCount; b++) {
        const btn = buttons.nth(b);
        const visible = await btn.isVisible().catch(() => false);
        if (!visible) continue;
        const btnText = ((await btn.textContent()) || '').trim().toLowerCase();
        if (btnText === 'edit') {
          hasEdit = true;
        } else if (btnText === 'apply') {
          applyBtn = btn;
        }
      }

      if (hasEdit && !applyBtn) {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'already_applied', message: 'Already applied (Edit button found)' },
        });
        continue;
      }

      if (!applyBtn) {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'error', message: 'No Apply button found for this IPO' },
        });
        continue;
      }

      // ── Click Apply and fill the form ──────────────────────────────────
      onEvent({
        type: 'account_status',
        data: { account: accountName, status: 'running', message: 'Filling application form...' },
      });

      await applyBtn.click();
      await page.waitForTimeout(3000);

      // Fill Bank
      const bankSelect = page.locator('select#selectBank');
      await selectFirstRealOption(bankSelect, 'Bank');
      await page.waitForTimeout(2000);

      // Fill Account Number (appears dynamically after bank)
      const accountSelect = page.locator('main#main select').nth(1);
      await selectFirstRealOption(accountSelect, 'Account Number');
      await page.waitForTimeout(2000);

      // Fill Applied Kitta
      const kittaInput = page.locator('input#appliedKitta');
      await typeIntoField(kittaInput, appliedKitta);
      await kittaInput.dispatchEvent('input');
      await kittaInput.dispatchEvent('change');
      await kittaInput.press('Tab');
      await page.waitForTimeout(1500);

      // Fill CRN
      const crnInput = page.locator('input#crnNumber');
      await typeIntoField(crnInput, cred.CRN);
      await page.waitForTimeout(500);

      // Check declaration checkbox
      const disclaimer = page.locator('input#disclaimer');
      const isChecked = await disclaimer.isChecked();
      if (!isChecked) {
        await disclaimer.click({ force: true });
      }

      // Click Proceed
      const proceedBtn = page.locator('button').filter({ hasText: /proceed/i }).first();
      await proceedBtn.click();
      await page.waitForTimeout(3000);

      // Enter Transaction PIN (per-account override or default)
      const pin = accountPINs[accountName] || defaultPIN;
      const pinInput = page.locator('input#transactionPIN');
      await pinInput.waitFor({ state: 'visible', timeout: 10000 });
      await typeIntoField(pinInput, pin);
      await page.waitForTimeout(500);

      // Click final Apply button
      const finalBtn = page.locator('button').filter({ hasText: /apply/i }).first();
      await finalBtn.waitFor({ state: 'visible', timeout: 5000 });
      await finalBtn.click();
      await page.waitForTimeout(5000);

      // Check result
      const bodyText = await page.locator('body').innerText();
      if (bodyText.toLowerCase().includes('success') || bodyText.toLowerCase().includes('applied')) {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'success', message: 'Application submitted successfully' },
        });
      } else {
        onEvent({
          type: 'account_status',
          data: { account: accountName, status: 'success', message: 'Application submitted. Check Meroshare for confirmation.' },
        });
      }
    } catch (err: any) {
      onEvent({
        type: 'account_status',
        data: { account: accountName, status: 'error', message: err.message || String(err) },
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  onEvent({ type: 'done' });
}

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

async function loginToMeroshare(
  page: import('@playwright/test').Page,
  baseUrl: string,
  cred: Credential,
  dpCode: string,
) {
  await page.goto(baseUrl);
  await page.waitForURL('**/login', { timeout: 15000 });

  const dpList = await captureDPList(page);
  const targetDP = dpList.find((dp) => dp.code === dpCode);
  if (!targetDP) {
    throw new Error(`DP with code ${dpCode} not found. Available: ${dpList.length} DPs`);
  }
  console.log(`[DP] Resolved: id=${targetDP.id}, code=${targetDP.code}, name="${targetDP.name}"`);

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

  console.log(`Logging in as "${cred.username}" with DP "${targetDP.name}" ...`);

  await selectDPInDropdown(page, dpCode);

  const usernameInput = page.locator('input[type="text"]').first();
  await typeIntoField(usernameInput, cred.username);

  const passwordInput = page.locator('input[type="password"]');
  await typeIntoField(passwordInput, cred.password);
  await page.waitForTimeout(500);

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

  await page.waitForURL('**/dashboard', { timeout: 15000 });
  console.log('[OK] Logged in and on dashboard');
}

/**
 * Helper: select the first non-placeholder option in a <select> element.
 * Meroshare uses "Please choose one" as the placeholder option.
 */
async function selectFirstRealOption(
  selectLocator: import('@playwright/test').Locator,
  fieldName: string,
) {
  await selectLocator.waitFor({ state: 'visible', timeout: 10000 });

  // Log all options for debugging
  const options = selectLocator.locator('option');
  const optionCount = await options.count();
  console.log(`[${fieldName}] Found ${optionCount} options:`);
  for (let i = 0; i < optionCount; i++) {
    const text = (await options.nth(i).textContent())?.trim() || '';
    const value = await options.nth(i).getAttribute('value') || '';
    console.log(`  [${i}] "${text}" (value="${value}")`);
  }

  // Find the first option that is NOT the placeholder
  for (let i = 0; i < optionCount; i++) {
    const text = ((await options.nth(i).textContent()) || '').trim().toLowerCase();
    const value = (await options.nth(i).getAttribute('value')) || '';
    if (
      text !== '' &&
      !text.includes('please choose') &&
      !text.includes('select') &&
      value !== '' &&
      value !== 'null' &&
      value !== 'undefined'
    ) {
      console.log(`[${fieldName}] Selecting option ${i}: "${text}"`);
      await selectLocator.selectOption({ index: i });
      await selectLocator.dispatchEvent('change');
      return text;
    }
  }

  throw new Error(`[${fieldName}] No valid (non-placeholder) option found`);
}

// ── Constants ────────────────────────────────────────────────────────────────

const DP_CODE = '10700';
const TEST_KITTA = '10';
const TEST_PIN = '1234'; // placeholder PIN for testing

// ── Test ─────────────────────────────────────────────────────────────────────

test.describe('IPO Application Flow', () => {
  const baseUrl = process.env.BASE_URL;

  test.beforeEach(async () => {
    if (!baseUrl) {
      throw new Error('BASE_URL is not set in .env file');
    }
  });

  test('should apply for an IPO end-to-end', async ({ page }, testInfo) => {
    // Give this test plenty of time — it's a multi-step E2E flow
    testInfo.setTimeout(5 * 60 * 1000); // 5 minutes

    const credentials = loadCredentials();
    const cred = credentials.Dad;
    if (!cred) throw new Error('"Dad" account not found in credentials.json');

    // ── Step 1: Login ────────────────────────────────────────────────────
    console.log('\n=== STEP 1: LOGIN ===');
    await loginToMeroshare(page, baseUrl!, cred, DP_CODE);
    await page.screenshot({ path: 'test-results/apply-01-dashboard.png', fullPage: true });

    // ── Step 2: Navigate to My ASBA ──────────────────────────────────────
    console.log('\n=== STEP 2: NAVIGATE TO MY ASBA ===');
    const asbaLink = page.locator('a[href="#/asba"]');
    await asbaLink.waitFor({ state: 'visible', timeout: 10000 });
    await asbaLink.click();
    await page.waitForURL('**/asba', { timeout: 15000 });
    console.log(`[NAV] On ASBA page: ${page.url()}`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/apply-02-asba-page.png', fullPage: true });

    // ── Step 3: List IPOs in "Apply for Issue" tab ───────────────────────
    console.log('\n=== STEP 3: LIST IPOs IN APPLY FOR ISSUE ===');
    const companyItems = page.locator('.company-list');
    const itemCount = await companyItems.count();
    console.log(`Found ${itemCount} open issues`);

    if (itemCount === 0) {
      console.log('No IPOs available to apply for. Test cannot proceed.');
      test.skip();
      return;
    }

    // Log all IPOs
    for (let i = 0; i < itemCount; i++) {
      const item = companyItems.nth(i);
      const nameEl = item.locator('.company-name span[tooltip="Company Name"]');
      const companyName = (await nameEl.textContent().catch(() => ''))?.trim() || 'N/A';
      const shareTypeEl = item.locator('.share-of-type');
      const shareType = (await shareTypeEl.textContent().catch(() => ''))?.trim() || 'N/A';
      console.log(`  [${i + 1}] ${companyName} | ${shareType}`);
    }

    // ── Step 4: Click "Apply" on the first IPO ──────────────────────────
    console.log('\n=== STEP 4: CLICK APPLY ON FIRST IPO ===');
    const firstIPO = companyItems.first();
    const ipoName = (await firstIPO.locator('.company-name span[tooltip="Company Name"]').textContent().catch(() => ''))?.trim() || 'Unknown';
    console.log(`Applying for: ${ipoName}`);

    // Look for an Apply button within the IPO item
    const applyBtn = firstIPO.locator('button').filter({ hasText: /apply/i }).first();
    const applyBtnCount = await applyBtn.count();

    if (applyBtnCount > 0) {
      console.log('Found "Apply" button, clicking...');
      await applyBtn.click();
    } else {
      // Fallback: try clicking any action button or the item itself
      const actionBtn = firstIPO.locator('.action-buttons button:visible, .action-buttons i:visible').first();
      const actionBtnCount = await actionBtn.count();
      if (actionBtnCount > 0) {
        console.log('Found action button, clicking...');
        await actionBtn.click();
      } else {
        console.log('No button found, clicking the item directly...');
        await firstIPO.click();
      }
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/apply-03-apply-form.png', fullPage: true });

    // ── Step 5: Debug — inspect the form page structure ──────────────────
    console.log('\n=== STEP 5: INSPECT FORM STRUCTURE ===');
    const mainContent = page.locator('main#main');
    const formText = await mainContent.innerText();
    console.log('--- Form page text content ---');
    console.log(formText);
    console.log('--- End form page text ---');

    // Log all select elements
    const allSelects = page.locator('main#main select');
    const selectCount = await allSelects.count();
    console.log(`\nFound ${selectCount} <select> elements in the form:`);
    for (let i = 0; i < selectCount; i++) {
      const sel = allSelects.nth(i);
      const id = await sel.getAttribute('id') || 'no-id';
      const name = await sel.getAttribute('name') || 'no-name';
      const formControlName = await sel.getAttribute('formcontrolname') || 'no-fcn';
      const optCount = await sel.locator('option').count();
      console.log(`  Select ${i}: id="${id}", name="${name}", formcontrolname="${formControlName}", options=${optCount}`);
    }

    // Log all input elements
    const allInputs = page.locator('main#main input');
    const inputCount = await allInputs.count();
    console.log(`\nFound ${inputCount} <input> elements in the form:`);
    for (let i = 0; i < inputCount; i++) {
      const inp = allInputs.nth(i);
      const type = await inp.getAttribute('type') || 'text';
      const id = await inp.getAttribute('id') || 'no-id';
      const name = await inp.getAttribute('name') || 'no-name';
      const formControlName = await inp.getAttribute('formcontrolname') || 'no-fcn';
      const placeholder = await inp.getAttribute('placeholder') || '';
      const isVisible = await inp.isVisible();
      console.log(`  Input ${i}: type="${type}", id="${id}", name="${name}", formcontrolname="${formControlName}", placeholder="${placeholder}", visible=${isVisible}`);
    }

    // Log all checkboxes
    const allCheckboxes = page.locator('main#main input[type="checkbox"]');
    const checkboxCount = await allCheckboxes.count();
    console.log(`\nFound ${checkboxCount} checkboxes in the form`);

    // Log all buttons
    const allButtons = page.locator('main#main button');
    const buttonCount = await allButtons.count();
    console.log(`\nFound ${buttonCount} buttons in the form:`);
    for (let i = 0; i < buttonCount; i++) {
      const btn = allButtons.nth(i);
      const btnText = (await btn.textContent())?.trim() || '';
      const isVisible = await btn.isVisible();
      console.log(`  Button ${i}: "${btnText}", visible=${isVisible}`);
    }

    // ── Step 6: Fill the Bank select ─────────────────────────────────────
    console.log('\n=== STEP 6: FILL BANK ===');

    // Try to find the Bank select — it may be the first <select> in the form,
    // or we can search by nearby label text
    let bankSelect = page.locator('main#main select').first();
    // Alternatively, look for select near "Bank" label
    const bankLabel = page.locator('label').filter({ hasText: /^Bank$/i }).first();
    const bankLabelCount = await bankLabel.count();
    if (bankLabelCount > 0) {
      const bankLabelFor = await bankLabel.getAttribute('for');
      if (bankLabelFor) {
        bankSelect = page.locator(`#${bankLabelFor}`);
      } else {
        // Try the select that follows the label in the same container
        bankSelect = bankLabel.locator('..').locator('select').first();
      }
    }

    const bankValue = await selectFirstRealOption(bankSelect, 'Bank');
    console.log(`[OK] Bank selected: "${bankValue}"`);
    await page.waitForTimeout(2000); // Wait for Account Number options to load
    await page.screenshot({ path: 'test-results/apply-04-bank-selected.png', fullPage: true });

    // ── Step 7: Fill Account Number select ───────────────────────────────
    console.log('\n=== STEP 7: FILL ACCOUNT NUMBER ===');

    // The Account Number select should be the second <select> or near "Account Number" label
    let accountSelect = page.locator('main#main select').nth(1);
    const accountLabel = page.locator('label').filter({ hasText: /account/i }).first();
    const accountLabelCount = await accountLabel.count();
    if (accountLabelCount > 0) {
      const accountLabelFor = await accountLabel.getAttribute('for');
      if (accountLabelFor) {
        accountSelect = page.locator(`#${accountLabelFor}`);
      } else {
        accountSelect = accountLabel.locator('..').locator('select').first();
      }
    }

    const accountValue = await selectFirstRealOption(accountSelect, 'Account Number');
    console.log(`[OK] Account Number selected: "${accountValue}"`);
    await page.waitForTimeout(2000); // Wait for Branch to auto-populate
    await page.screenshot({ path: 'test-results/apply-05-account-selected.png', fullPage: true });

    // ── Step 8: Check Branch field ───────────────────────────────────────
    console.log('\n=== STEP 8: CHECK BRANCH ===');

    // Branch should be auto-populated — look for it as a label or readonly input
    const branchInput = page.locator('main#main input').filter({ hasText: /branch/i }).first();
    const branchInputCount = await branchInput.count();
    if (branchInputCount > 0) {
      const branchValue = await branchInput.inputValue();
      console.log(`[OK] Branch auto-populated: "${branchValue}"`);
    } else {
      // Check for any element near "Branch" label
      const branchLabel = page.locator('label').filter({ hasText: /branch/i }).first();
      const branchLabelCount = await branchLabel.count();
      if (branchLabelCount > 0) {
        const branchParent = branchLabel.locator('..');
        const branchText = (await branchParent.innerText())?.trim();
        console.log(`[OK] Branch area content: "${branchText}"`);
      } else {
        console.log('[WARN] Could not locate Branch field — it may auto-populate elsewhere');
      }
    }

    // ── Step 9: Fill Applied Kitta ───────────────────────────────────────
    console.log('\n=== STEP 9: FILL APPLIED KITTA ===');

    // Look for the kitta input by formcontrolname, placeholder, or nearby label
    let kittaInput = page.locator('main#main input[formcontrolname="appliedKitta"]').first();
    let kittaCount = await kittaInput.count();
    if (kittaCount === 0) {
      // Try by label
      const kittaLabel = page.locator('label').filter({ hasText: /kitta/i }).first();
      const kittaLabelCount = await kittaLabel.count();
      if (kittaLabelCount > 0) {
        const kittaLabelFor = await kittaLabel.getAttribute('for');
        if (kittaLabelFor) {
          kittaInput = page.locator(`#${kittaLabelFor}`);
        } else {
          kittaInput = kittaLabel.locator('..').locator('input').first();
        }
        kittaCount = await kittaInput.count();
      }
    }
    if (kittaCount === 0) {
      // Try by placeholder
      kittaInput = page.locator('main#main input[placeholder*="kitta" i]').first();
      kittaCount = await kittaInput.count();
    }
    if (kittaCount === 0) {
      // Last resort: look for a number input that isn't CRN
      console.log('[WARN] Could not find kitta input by name/label/placeholder, trying number inputs...');
      const numberInputs = page.locator('main#main input[type="number"]');
      const numCount = await numberInputs.count();
      if (numCount > 0) {
        kittaInput = numberInputs.first();
        kittaCount = 1;
      }
    }

    if (kittaCount > 0) {
      await typeIntoField(kittaInput, TEST_KITTA);
      // Trigger blur/change for Angular
      await kittaInput.dispatchEvent('input');
      await kittaInput.dispatchEvent('change');
      await kittaInput.press('Tab');
      console.log(`[OK] Applied Kitta filled: ${TEST_KITTA}`);
    } else {
      console.log('[ERROR] Could not find Applied Kitta input field');
    }

    await page.waitForTimeout(2000); // Wait for Amount to auto-populate
    await page.screenshot({ path: 'test-results/apply-06-kitta-filled.png', fullPage: true });

    // ── Step 10: Check Amount ────────────────────────────────────────────
    console.log('\n=== STEP 10: CHECK AMOUNT ===');

    // Amount should auto-populate after kitta is filled
    const amountLabel = page.locator('label').filter({ hasText: /amount/i }).first();
    const amountLabelCount = await amountLabel.count();
    if (amountLabelCount > 0) {
      const amountParent = amountLabel.locator('..');
      const amountText = (await amountParent.innerText())?.trim();
      console.log(`[OK] Amount area content: "${amountText}"`);
    }

    // Also try finding an input for amount
    const amountInput = page.locator('main#main input[formcontrolname="amount"]').first();
    const amountInputCount = await amountInput.count();
    if (amountInputCount > 0) {
      const amountValue = await amountInput.inputValue();
      console.log(`[OK] Amount field value: "${amountValue}"`);
    }

    // ── Step 11: Fill CRN ────────────────────────────────────────────────
    console.log('\n=== STEP 11: FILL CRN ===');

    let crnInput = page.locator('main#main input[formcontrolname="crnNumber"]').first();
    let crnCount = await crnInput.count();
    if (crnCount === 0) {
      const crnLabel = page.locator('label').filter({ hasText: /CRN/i }).first();
      const crnLabelCount = await crnLabel.count();
      if (crnLabelCount > 0) {
        const crnLabelFor = await crnLabel.getAttribute('for');
        if (crnLabelFor) {
          crnInput = page.locator(`#${crnLabelFor}`);
        } else {
          crnInput = crnLabel.locator('..').locator('input').first();
        }
        crnCount = await crnInput.count();
      }
    }
    if (crnCount === 0) {
      crnInput = page.locator('main#main input[placeholder*="CRN" i]').first();
      crnCount = await crnInput.count();
    }

    if (crnCount > 0) {
      await typeIntoField(crnInput, cred.CRN);
      console.log(`[OK] CRN filled: ${cred.CRN}`);
    } else {
      console.log('[ERROR] Could not find CRN input field');
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/apply-07-crn-filled.png', fullPage: true });

    // ── Step 12: Check declaration checkbox ──────────────────────────────
    console.log('\n=== STEP 12: CHECK DECLARATION CHECKBOX ===');

    // Look for the "I hereby declare" checkbox
    let declarationCheckbox = page.locator('main#main input[type="checkbox"]').first();
    const declCount = await declarationCheckbox.count();
    if (declCount > 0) {
      const isChecked = await declarationCheckbox.isChecked();
      if (!isChecked) {
        await declarationCheckbox.click({ force: true });
        console.log('[OK] Declaration checkbox checked');
      } else {
        console.log('[OK] Declaration checkbox was already checked');
      }
    } else {
      // Try label-based click
      const declarationLabel = page.locator('label').filter({ hasText: /hereby declare/i }).first();
      const declLabelCount = await declarationLabel.count();
      if (declLabelCount > 0) {
        await declarationLabel.click();
        console.log('[OK] Declaration label clicked');
      } else {
        console.log('[WARN] Could not find declaration checkbox');
      }
    }

    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/apply-08-declaration.png', fullPage: true });

    // ── Step 13: Click Proceed button ────────────────────────────────────
    console.log('\n=== STEP 13: CLICK PROCEED ===');

    const proceedBtn = page.locator('button').filter({ hasText: /proceed/i }).first();
    const proceedBtnCount = await proceedBtn.count();
    if (proceedBtnCount > 0) {
      const isEnabled = await proceedBtn.isEnabled();
      console.log(`Proceed button found, enabled=${isEnabled}`);
      if (isEnabled) {
        await proceedBtn.click();
        console.log('[OK] Proceed button clicked');
      } else {
        console.log('[WARN] Proceed button is disabled — form may be incomplete');
        // Take a screenshot to see what's wrong
        await page.screenshot({ path: 'test-results/apply-09-proceed-disabled.png', fullPage: true });

        // Dump current form state for debugging
        const formState = await mainContent.innerText();
        console.log('--- Current form state ---');
        console.log(formState);
        console.log('--- End form state ---');
      }
    } else {
      // Try submit button
      const submitBtn = page.locator('button[type="submit"]').first();
      const submitCount = await submitBtn.count();
      if (submitCount > 0) {
        await submitBtn.click();
        console.log('[OK] Submit button clicked');
      } else {
        console.log('[ERROR] Could not find Proceed/Submit button');
      }
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/apply-09-after-proceed.png', fullPage: true });

    // ── Step 14: Transaction PIN page ────────────────────────────────────
    console.log('\n=== STEP 14: TRANSACTION PIN PAGE ===');

    // Check for the PIN prompt text
    const pageText = await page.locator('body').innerText();
    console.log('--- Page text after Proceed ---');
    // Just log the relevant portion
    if (pageText.toLowerCase().includes('transaction pin')) {
      console.log('[OK] Transaction PIN page detected');
    } else {
      console.log('[WARN] "transaction pin" text not found on page');
    }
    if (pageText.toLowerCase().includes('4 digits')) {
      console.log('[OK] "4 digits" prompt detected');
    }

    // Log the page text for debugging
    const mainTextAfterProceed = await mainContent.innerText();
    console.log(mainTextAfterProceed);

    // Look for the PIN input field
    let pinInput = page.locator('main#main input[type="password"]').first();
    let pinInputCount = await pinInput.count();
    if (pinInputCount === 0) {
      pinInput = page.locator('main#main input[type="text"]').first();
      pinInputCount = await pinInput.count();
    }
    if (pinInputCount === 0) {
      pinInput = page.locator('main#main input').first();
      pinInputCount = await pinInput.count();
    }

    if (pinInputCount > 0) {
      await typeIntoField(pinInput, TEST_PIN);
      console.log(`[OK] Transaction PIN entered: ${'*'.repeat(TEST_PIN.length)}`);
    } else {
      console.log('[ERROR] Could not find PIN input field');
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/apply-10-pin-entered.png', fullPage: true });

    // Look for a final submit/confirm button
    const confirmBtn = page.locator('button').filter({ hasText: /proceed|submit|confirm|apply/i }).first();
    const confirmBtnCount = await confirmBtn.count();
    if (confirmBtnCount > 0) {
      const btnText = (await confirmBtn.textContent())?.trim();
      console.log(`[OK] Final confirm button found: "${btnText}"`);
      // NOTE: We do NOT click it in the test to avoid actually submitting the application
      // Uncomment the next line to actually submit:
      // await confirmBtn.click();
      console.log('[INFO] NOT clicking final submit to avoid actual application submission');
    } else {
      console.log('[WARN] No final confirm button found');
    }

    await page.screenshot({ path: 'test-results/apply-11-final.png', fullPage: true });
    console.log('\n=== IPO APPLICATION TEST COMPLETE ===');
  });
});

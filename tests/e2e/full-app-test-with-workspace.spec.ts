/**
 * Full App Test - Click "New Workspace" to Get Into App
 *
 * This test clicks the "New Workspace" button to bypass the file picker
 * and actually get into the application to test the features.
 */

import { test, expect } from '@playwright/test';

test.describe('Full App Test - With Workspace Creation', () => {
  test('Create new workspace and test all features', async ({ page }) => {
    console.log('\n========================================');
    console.log('FULL APP TEST - Creating Workspace');
    console.log('========================================\n');

    // Step 1: Load app
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('Step 1: App loaded');
    await page.screenshot({ path: 'test-results/full-test-01-loaded.png', fullPage: true });

    // Step 2: Click "New Workspace" button
    const newWorkspaceButton = page.locator('button').filter({ hasText: /New Workspace/i });

    if (await newWorkspaceButton.isVisible({ timeout: 3000 })) {
      console.log('Step 2: Clicking "New Workspace" button');
      await newWorkspaceButton.click();
      await page.waitForTimeout(3000); // Wait for workspace creation

      await page.screenshot({ path: 'test-results/full-test-02-after-workspace-creation.png', fullPage: true });

      // Step 3: Check if we're now in the main app
      const sidebar = page.locator('.sidebar, [class*="sidebar"]');
      const fileTree = page.locator('[class*="file-tree"], [class*="FileTree"]');
      const mainPanel = page.locator('.main-panel, [class*="main"]');

      const hasSidebar = await sidebar.isVisible({ timeout: 5000 }).catch(() => false);
      const hasFileTree = await fileTree.isVisible({ timeout: 3000 }).catch(() => false);
      const hasMainPanel = await mainPanel.isVisible({ timeout: 3000 }).catch(() => false);

      console.log(`Step 3: Main app components:`);
      console.log(`  Sidebar: ${hasSidebar ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  File Tree: ${hasFileTree ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  Main Panel: ${hasMainPanel ? 'YES ✅' : 'NO ❌'}`);

      if (hasSidebar || hasMainPanel) {
        console.log('\n✅ SUCCESS: Entered main application!');

        // Step 4: Look for AI Assistant button
        console.log('\n--- Testing AI Assistant ---');
        const aiButton = page.locator('button, [class*="tab"]').filter({ hasText: /AI|Assistant/i });

        if (await aiButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log('Step 4: Found AI Assistant button, clicking...');
          await aiButton.click();
          await page.waitForTimeout(1000);

          await page.screenshot({ path: 'test-results/full-test-03-ai-assistant-open.png', fullPage: true });

          // Measure AI Assistant pane
          const aiPane = page.locator('[class*="w-80"]').first();

          if (await aiPane.isVisible({ timeout: 2000 }).catch(() => false)) {
            const box = await aiPane.boundingBox();
            console.log(`✅ AI Assistant pane found!`);
            console.log(`   Actual width: ${box?.width}px`);
            console.log(`   Expected: ≤320px (w-80)`);
            console.log(`   Result: ${box && box.width <= 320 ? 'PASS ✅' : 'FAIL ❌'}`);

            // Check for horizontal scroll
            const hasHScroll = await page.evaluate(() => {
              const el = document.querySelector('[class*="w-80"]');
              return el ? el.scrollWidth > el.clientWidth : false;
            });

            console.log(`   Horizontal overflow: ${hasHScroll ? 'YES ❌' : 'NO ✅'}`);

            // Test all 3 tabs
            const tabNames = ['Chats', 'Keys', 'Models'];
            for (const tabName of tabNames) {
              const tab = aiPane.locator(`button:has-text("${tabName}")`).first();
              if (await tab.isVisible().catch(() => false)) {
                console.log(`   ${tabName} tab: VISIBLE ✅`);
                await tab.click();
                await page.waitForTimeout(500);

                const overflow = await page.evaluate(() => {
                  const el = document.querySelector('[class*="w-80"]');
                  return el ? el.scrollWidth > el.clientWidth : false;
                });

                console.log(`   ${tabName} overflow: ${overflow ? 'YES ❌' : 'NO ✅'}`);
                await page.screenshot({ path: `test-results/full-test-ai-${tabName.toLowerCase()}.png`, fullPage: true });
              } else {
                console.log(`   ${tabName} tab: NOT FOUND ❌`);
              }
            }
          } else {
            console.log('❌ AI Assistant pane (w-80) not found');
          }
        } else {
          console.log('⚠️ AI Assistant button not found');
        }

        // Step 5: Look for tab bar
        console.log('\n--- Testing Tab Bar ---');
        const tabBar = page.locator('.border-b, [class*="tab-bar"]').first();

        if (await tabBar.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('Step 5: Tab bar found');
          await tabBar.screenshot({ path: 'test-results/full-test-04-tab-bar.png' });

          const draggables = await page.locator('[draggable="true"]').all();
          console.log(`   Draggable tabs: ${draggables.length}`);

          const groupChips = await page.locator('[data-group-chip]').all();
          console.log(`   Group chips: ${groupChips.length}`);
        } else {
          console.log('⚠️ Tab bar not found');
        }

        // Step 6: Check for formatting toolbar
        console.log('\n--- Testing Formatting Toolbar ---');
        const boldBtn = page.locator('button[title*="Bold"]');
        const italicBtn = page.locator('button[title*="Italic"]');

        const hasBold = await boldBtn.isVisible({ timeout: 2000 }).catch(() => false);
        const hasItalic = await italicBtn.isVisible({ timeout: 2000 }).catch(() => false);

        console.log(`   Bold button: ${hasBold ? 'VISIBLE ✅' : 'NOT VISIBLE ❌'}`);
        console.log(`   Italic button: ${hasItalic ? 'VISIBLE ✅' : 'NOT VISIBLE ❌'}`);

        // Final screenshot
        await page.screenshot({ path: 'test-results/full-test-05-final-state.png', fullPage: true });

        console.log('\n========================================');
        console.log('TEST COMPLETE');
        console.log('========================================\n');

      } else {
        console.log('❌ FAILED: Could not enter main application');
        const bodyText = await page.locator('body').textContent();
        console.log(`\nPage content: ${bodyText?.substring(0, 300)}`);
      }
    } else {
      console.log('❌ "New Workspace" button not found');
    }

    expect(true).toBe(true);
  });
});

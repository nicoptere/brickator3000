// ==UserScript==
// @name         BrickLink Wanted List XML Auto-Fill
// @namespace    https://brickator3000.local/
// @version      1.1
// @description  Automatically selects XML tab, pastes XML, and clicks verify items on BrickLink Wanted List upload page
// @author       Brickator3000
// @match        https://www.bricklink.com/v2/wanted/upload.page*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Only trigger if URL hash contains #xml or query param contains auto=xml
  const shouldAutoFill = window.location.hash.includes('xml') || window.location.search.includes('xml');
  if (!shouldAutoFill) return;

  function log(...args) {
    console.log('[BrickLink Auto-Fill]', ...args);
  }

  function tryAutoFill() {
    // 1. Locate and click the "Upload BrickLink XML format" tab
    const tabs = Array.from(document.querySelectorAll('a, button, li, span, div, label'));
    const xmlTab = tabs.find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt.includes('upload bricklink xml format') || txt === 'upload xml' || txt.includes('xml format');
    });

    if (xmlTab) {
      log('Clicking XML tab:', xmlTab);
      xmlTab.click();
    }

    // 2. Poll for textarea and populate from clipboard
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const textarea = document.querySelector('textarea');
      if (textarea) {
        clearInterval(interval);
        log('Found textarea, reading clipboard...');

        try {
          const text = await navigator.clipboard.readText();
          if (text && text.includes('<INVENTORY>') && text.includes('</INVENTORY>')) {
            textarea.value = text;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            log('Pasted XML successfully into textarea');

            // 3. Find and click "Proceed to verify items" button
            setTimeout(() => {
              const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'));
              const verifyBtn = buttons.find(b => {
                const val = (b.value || b.textContent || '').trim().toLowerCase();
                return val.includes('proceed to verify') || val.includes('verify items');
              });

              if (verifyBtn && !verifyBtn.disabled) {
                log('Clicking Proceed button:', verifyBtn);
                verifyBtn.click();
              }
            }, 300);
          } else {
            log('Clipboard does not contain valid INVENTORY XML tags yet.');
          }
        } catch (err) {
          log('Clipboard read note (requires permission or user gesture):', err.message);
        }
      }

      if (attempts > 30) {
        clearInterval(interval);
      }
    }, 200);
  }

  // Run when ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(tryAutoFill, 300);
  } else {
    window.addEventListener('load', () => setTimeout(tryAutoFill, 300));
  }
})();

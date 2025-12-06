(() => {
  'use strict';

  const SELECTORS = {
    root: '[data-cart-root]',
    count: '[data-cart-count]',
    lineKey: '[data-line-key]',
    discountContainer: '[data-cart-discount-container]',
    discountPill: '[data-cart-discount-pill]',
    discountPillText: '[data-cart-discount-pill-text]',
    discountInput: '[data-cart-discount-input]',
    feedback: '[data-cart-discount-feedback]',
    applyBtn: '[data-cart-apply]',
    removeBtn: '[data-cart-remove-discount]'
  };

  const q = (sel, root = document) => root.querySelector(sel);

  const getSectionId = (root) => root.getAttribute('data-section-id') || 'cart-drawer';

  const updateBadge = (count) => {
    document.querySelectorAll(SELECTORS.count).forEach(el => {
      el.textContent = count || 0;
      el.classList.toggle('hidden', count <= 0);
    });
  };

  const dispatchCartEvents = () => {
    try { window.dispatchEvent(new CustomEvent('cart:updated')); } catch (err) { }
    try { window.dispatchEvent(new CustomEvent('cart:refresh')); } catch (err) { }
  };

  const refreshCartCount = () =>
    fetch('/cart.js')
      .then(r => r.json())
      .then(d => {
        updateBadge(d.item_count);
        return d;
      })
      .catch(() => { });

  const getRootUrl = () => {
    if (window.routes && typeof window.routes.root_url === 'string') return window.routes.root_url || '';
    if (window.Shopify && window.Shopify.routes && typeof window.Shopify.routes.root_url === 'string') return window.Shopify.routes.root_url || '';
    return '';
  };

  const buildSectionsUrl = (sectionId) => {
    const rootUrl = getRootUrl();
    const hasQuery = rootUrl.includes('?');
    const prefix = rootUrl || '';
    const joiner = hasQuery ? '&' : '?';
    return `${prefix}${joiner}sections=${encodeURIComponent(sectionId)}`;
  };

  const refreshCartDrawer = () => {
    const root = document.querySelector(SELECTORS.root);
    if (!root) return Promise.resolve();
    const sectionId = getSectionId(root);
    const sectionsUrl = buildSectionsUrl(sectionId);

    return fetch(sectionsUrl)
      .then(r => r.json())
      .then(data => {
        const html = data && data[sectionId];
        if (!html) return;
        renderSection(root, html);
        // root listeners persist, but we ensure they are bound if not already
        bindEvents(root);
      })
      .catch(err => {
        console.error('Cart drawer refresh failed', err);
      });
  };

  const refreshCartUI = () => Promise.all([refreshCartDrawer(), refreshCartCount()]);

  const handleCartResponse = (response) => {
    if (!response.ok) {
      return response.json()
        .then(err => {
          const message = err && (err.description || err.message);
          throw new Error(message || 'Request failed');
        });
    }
    return response.json();
  };

  const setFeedback = (root, message, type) => {
    const feedback = q(SELECTORS.feedback, root);
    if (!feedback) return;

    if (message) {
      feedback.textContent = message;
      feedback.classList.remove('hidden');
      if (type === 'error') {
        feedback.classList.remove('text-[#71cd13]');
        feedback.classList.add('text-rose-600');
      } else if (type === 'success') {
        feedback.classList.remove('text-rose-600');
        feedback.classList.add('text-[#71cd13]');
      } else {
        // Loading state
        feedback.classList.remove('text-rose-600', 'text-[#71cd13]');
        feedback.classList.add('text-gray-500');
      }
    } else {
      feedback.classList.add('hidden');
    }
  };

  const renderSection = (root, html) => {
    if (!html) return;
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(html, 'text/html');
    const newContent = q(SELECTORS.root, newDoc);
    if (!newContent) return;

    // Surgical Update Strategy: Only update items and footer if structure matches
    const oldForm = root.querySelector('#CartDrawer-Form'); // Use ID for specificity
    const newForm = newContent.querySelector('#CartDrawer-Form');
    const oldFooter = root.querySelector('[data-cart-footer]');
    const newFooter = newContent.querySelector('[data-cart-footer]');

    if (oldForm && newForm && oldFooter && newFooter) {
      oldForm.replaceWith(newForm);
      oldFooter.replaceWith(newFooter);
      // Upsells are UNTOUCHED, so no flicker/refresh.
    } else {
      // Fallback: Structure mismatch (e.g. Empty Cart), full replace
      root.innerHTML = newContent.innerHTML;
      initContent(root);
    }
  };

  const applyDiscount = (root, code) => {
    if (!code) return;
    const sectionId = getSectionId(root);

    // 1. Show loading
    setFeedback(root, 'Checking...', 'loading');

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ discount: code, sections: sectionId })
    })
      .then(r => r.json())
      .then(data => {
        // 2. Render the new HTML from server
        if (data.sections) renderSection(root, data.sections[sectionId]);

        // 3. CHECK THE DOM: Did the server render a discount title?
        // This is the source of truth. If Liquid rendered it, it's valid.
        const pillText = q(SELECTORS.discountPillText, root);
        const isSuccess = pillText && pillText.textContent.trim().length > 0;

        if (isSuccess) {
          setFeedback(root, 'Discount Applied!', 'success');
          // Clear input only on success
          const input = q(SELECTORS.discountInput, root);
          if (input) input.value = '';
        } else {
          setFeedback(root, `Code "${code}" is invalid.`, 'error');
        }

        updateBadge(data.item_count);
      })
      .catch(err => {
        console.error(err);
        setFeedback(root, "Network error", 'error');
      });
  };

  const removeDiscount = (root) => {
    const sectionId = getSectionId(root);

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ discount: '', sections: sectionId })
    })
      .then(r => r.json())
      .then(data => {
        if (data.sections) renderSection(root, data.sections[sectionId]);
        setFeedback(root, '', ''); // Clear messages
        updateBadge(data.item_count);
      });
  };

  const setLineLoading = (root, key, isLoading) => {
    const line = root.querySelector(`[data-line-key="${key}"]`);
    if (!line) return;
    const priceEl = line.querySelector('[data-cart-line-price]');
    if (!priceEl) return;

    if (isLoading) {
      if (!priceEl.getAttribute('data-original-price')) {
        priceEl.setAttribute('data-original-price', priceEl.innerHTML);
      }
      priceEl.innerHTML = `
        <div class="flex justify-end">
          <svg class="animate-spin h-4 w-4 text-[#71cd13]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      `;
    } else {
      const original = priceEl.getAttribute('data-original-price');
      if (original) priceEl.innerHTML = original;
    }
  };

  const changeLine = (root, lineKey, qty) => {
    if (root._cartBusy) return;
    root._cartBusy = true;
    const sectionId = getSectionId(root);

    setLineLoading(root, lineKey, true);

    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: lineKey, quantity: qty, sections: sectionId })
    })
      .then(r => r.json())
      .then(data => {
        if (data.sections) renderSection(root, data.sections[sectionId]);
        // We don't change feedback here, just keep whatever state is there
        updateBadge(data.item_count);
      })
      .finally(() => root._cartBusy = false);
  };

  const bindEvents = root => {
    if (!root || root.__enhanced) return;
    root.__enhanced = true;
    root._cartBusy = false;
    root._qtyTimeout = null;

    root.addEventListener('click', e => {
      const target = e.target;

      // Quantity & Remove
      const lineEl = target.closest(SELECTORS.lineKey);
      if (lineEl) {
        const key = lineEl.getAttribute('data-line-key');
        const input = lineEl.querySelector('input[type="number"]');

        if (target.closest('.qty-plus')) changeLine(root, key, Number(input.value || 0) + 1);
        else if (target.closest('.qty-minus')) changeLine(root, key, Number(input.value || 0) - 1);
        else if (target.closest('[data-cart-remove]')) changeLine(root, key, 0);
        return;
      }

      // Discount Actions
      if (target.closest(SELECTORS.applyBtn)) {
        const input = q(SELECTORS.discountInput, root);
        if (input) applyDiscount(root, input.value.trim());
      }
      else if (target.closest(SELECTORS.removeBtn)) {
        removeDiscount(root);
      }

      // Upsell Add
      const addBtn = target.closest('[data-cart-add]');
      if (addBtn) {
        const id = addBtn.getAttribute('data-cart-add');
        const card = addBtn.closest('.group'); // The upsell card container

        if (id) {
          // Visual Feedback
          const originalContent = addBtn.innerHTML;
          addBtn.disabled = true;
          addBtn.innerHTML = `
            <svg class="animate-spin h-4 w-4 text-[#71cd13]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          `;

          ShopCart.add({ items: [{ id: id, quantity: 1 }] })
            .then(() => {
              // Optimistic Removal on Success
              if (card) {
                card.style.transition = 'opacity 0.3s, max-height 0.3s margin 0.3s';
                card.style.opacity = '0';
                card.style.maxHeight = '0';
                card.style.margin = '0';
                setTimeout(() => card.remove(), 300);
              }
            })
            .catch(() => {
              // Reset on Failure
              addBtn.disabled = false;
              addBtn.innerHTML = originalContent;
            });
        }
      }
    });

    // Debounce Input
    root.addEventListener('input', e => {
      if (e.target.matches('input[type="number"]') && e.target.closest(SELECTORS.lineKey)) {
        clearTimeout(root._qtyTimeout);
        const input = e.target;
        const key = input.closest(SELECTORS.lineKey).getAttribute('data-line-key');
        const val = Math.max(0, Number(input.value) || 0);
        root._qtyTimeout = setTimeout(() => changeLine(root, key, val), 350);
      }
    });

    // Variant Change (Upsells & Cart Items)
    root.addEventListener('change', e => {
      // 1. Upsell Selectors
      if (e.target.matches('select') && e.target.closest('#CartDrawer-Upsells')) {
        const select = e.target;
        const group = select.closest('.group');
        const btn = group ? group.querySelector('[data-cart-add]') : null;
        if (btn) btn.setAttribute('data-cart-add', select.value);
      }

      // 2. Cart Item Variant Change
      if (e.target.matches('.variant-change-input')) {
        const select = e.target;
        const lineItem = select.closest('[data-line-key]');
        const oldStartKey = select.getAttribute('data-line-key');
        const qtyInput = lineItem ? lineItem.querySelector('input[type="number"]') : null;

        // Robustness: If input is empty/invalid, fallback to default quantity instead of 0 (delete)
        let quantity = qtyInput ? Number(qtyInput.value) : Number(select.getAttribute('data-quantity'));
        if (isNaN(quantity) || quantity <= 0) quantity = 1;

        // Use string ID for safety, though Number is usually fine for 64-bit envs, strings are safer for IDs
        const newVariantId = select.value;

        if (!oldStartKey || !newVariantId) return;

        setFeedback(root, 'Updating availability...', 'loading');
        setLineLoading(root, oldStartKey, true);
        root._cartBusy = true;

        // Strategy: Add New -> Remove Old (via update.js) -> Render Final State
        // We use update.js for removal as it handles 'updates' map reliably with keys
        fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ items: [{ id: newVariantId, quantity: quantity }] })
        })
          .then(response => {
            if (!response.ok) throw new Error('Failed to add new variant');

            // Remove the old item using proper key string
            const updates = {};
            updates[oldStartKey] = 0;

            return fetch('/cart/update.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ updates: updates, sections: getSectionId(root) })
            });
          })
          .then(response => response.json())
          .then(data => {
            const sectionId = getSectionId(root);
            // Logic to handle section response (which might be the parent section like 'header')
            if (data.sections && data.sections[sectionId]) {
              renderSection(root, data.sections[sectionId]);
            } else if (data.sections) {
              // Fallback: If sectionId not strict match (e.g. 'header' vs 'cart-drawer'), try first key
              const keys = Object.keys(data.sections);
              if (keys.length > 0) renderSection(root, data.sections[keys[0]]);
            }

            updateBadge(data.item_count);
            setFeedback(root, '', '');
          })
          .catch(err => {
            console.error('Variant change failed:', err);
            setFeedback(root, 'Update failed. Refreshing...', 'error');
            refreshCartUI();
          })
          .finally(() => root._cartBusy = false);
      }
    });

    // Enter key on discount
    root.addEventListener('keydown', e => {
      if (e.target.matches(SELECTORS.discountInput) && e.key === 'Enter') {
        e.preventDefault();
        applyDiscount(root, e.target.value.trim());
      }
    });
  };

  const bindGlobalEvents = () => {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-quick-add]');
      if (!btn) return;

      e.preventDefault();
      const variantId = btn.getAttribute('data-variant-id');
      if (!variantId) return;

      // Visual Feedback
      const originalContent = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="animate-spin h-4 w-4 text-[#71cd13]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      `;

      ShopCart.add({ items: [{ id: Number(variantId), quantity: 1 }] })
        .then(() => {
          // Open Drawer
          window.dispatchEvent(new CustomEvent('cart-open'));
        })
        .finally(() => {
          // Reset Button
          btn.disabled = false;
          btn.innerHTML = originalContent;
        });
    });
  };

  const initContent = (root) => {
    initUpsells(root);
  };

  const initUpsells = (root) => {
    const container = root.querySelector('#CartDrawer-Upsells');
    if (!container || !container.dataset.url) return;

    // Robust caching using data-fetched
    // If preserved surgically, this will be true.
    // If replaced from server, this will be missing/undefined.
    if (container.dataset.fetched === 'true') return;

    fetch(container.dataset.url)
      .then(r => r.text())
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newContainer = doc.querySelector('#CartDrawer-Upsells');
        if (newContainer && newContainer.innerHTML.trim().length > 0) {
          container.innerHTML = newContainer.innerHTML;
          container.classList.remove('hidden');
        }
      })
      .catch(e => console.error('Upsell fetch error:', e))
      .finally(() => {
        // Mark as fetched so we don't retry unless replaced
        container.dataset.fetched = 'true';
      });
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindGlobalEvents();
    const roots = document.querySelectorAll(SELECTORS.root);
    roots.forEach(root => {
      bindEvents(root);
      initContent(root);
    });
    refreshCartCount();
  });

  const ShopCartAPI = {
    add(payload) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload || {})
      })
        .then(handleCartResponse)
        .then(data => {
          refreshCartUI().finally(dispatchCartEvents);
          return data;
        });
    },
    clear() {
      return fetch('/cart/clear.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      })
        .then(handleCartResponse)
        .then(data => {
          refreshCartUI().finally(dispatchCartEvents);
          return data;
        });
    }
  };

  window.ShopCart = Object.assign({}, window.ShopCart, ShopCartAPI);
})();
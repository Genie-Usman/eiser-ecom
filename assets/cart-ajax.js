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
    try { window.dispatchEvent(new CustomEvent('cart:updated')); } catch(err) {}
    try { window.dispatchEvent(new CustomEvent('cart:refresh')); } catch(err) {}
  };

  const refreshCartCount = () =>
    fetch('/cart.js')
      .then(r => r.json())
      .then(d => {
        updateBadge(d.item_count);
        return d;
      })
      .catch(() => {});

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
        root.__enhanced = false;
        enhanceCartRoot(root);
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
    if (newContent) root.innerHTML = newContent.innerHTML;
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

  const changeLine = (root, lineKey, qty) => {
    if (root._cartBusy) return;
    root._cartBusy = true;
    const sectionId = getSectionId(root);

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

  const enhanceCartRoot = root => {
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
        if(input) applyDiscount(root, input.value.trim());
      }
      else if (target.closest(SELECTORS.removeBtn)) {
        removeDiscount(root);
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
    
    // Enter key on discount
    root.addEventListener('keydown', e => {
        if(e.target.matches(SELECTORS.discountInput) && e.key === 'Enter') {
            e.preventDefault();
            applyDiscount(root, e.target.value.trim());
        }
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const roots = document.querySelectorAll(SELECTORS.root);
    roots.forEach(enhanceCartRoot);
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
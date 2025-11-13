(() => {
  'use strict';

  let cartBusy = false;
  let qtyChangeTimeout = null;

  const dispatch = (name, detail) => {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {
      // noop for old browsers that may not support CustomEvent constructor
    }
  };

  const jsonRequest = async (url, options = {}) => {
    options.headers = Object.assign({ Accept: 'application/json' }, options.headers || {});

    if (options.body && typeof options.body !== 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      // try to read JSON payload; if that fails, throw generic error
      try {
        const payload = await response.json();
        const err = new Error(payload?.description ?? 'Request failed');
        err.payload = payload;
        throw err;
      } catch {
        throw new Error('Request failed');
      }
    }

    return response.json();
  };

  const updateCountDisplay = (count) => {
    const badge = document.querySelector('[data-cart-count]');
    if (!badge) return;
    const value = Number(count) || 0;
    if (value <= 0) {
      badge.textContent = '0';
      badge.classList.add('hidden');
    } else {
      badge.textContent = `${value}`;
      badge.classList.remove('hidden');
    }
  };

  const getCart = () => jsonRequest('/cart.js');

  const refreshCount = async () => {
    try {
      const cart = await getCart();
      updateCountDisplay(cart.item_count);
      return cart.item_count;
    } catch {
      // ignore errors
    }
  };

  const add = async (payload = {}) => {
    if (!payload.id) return Promise.reject(new Error('Variant id is required.'));

    dispatch('cart:request', { action: 'add', payload });

    await jsonRequest('/cart/add.js', {
      method: 'POST',
      body: {
        id: payload.id,
        quantity: payload.quantity ?? 1,
        properties: payload.properties ?? undefined
      }
    });

    const cart = await getCart();
    updateCountDisplay(cart.item_count);
    dispatch('cart:updated', { action: 'add', cart, payload });
    return cart;
  };

  const change = async (payload = {}) => {
    if (typeof payload.id === 'undefined') {
      return Promise.reject(new Error('Line item key is required.'));
    }

    dispatch('cart:request', { action: 'change', payload });

    const cart = await jsonRequest('/cart/change.js', {
      method: 'POST',
      body: {
        id: payload.id,
        quantity: typeof payload.quantity === 'number' ? payload.quantity : payload.quantity || 0
      }
    });

    updateCountDisplay(cart.item_count);
    dispatch('cart:updated', { action: 'change', cart, payload });
    return cart;
  };

  const updateCart = async (updates = {}) => {
    dispatch('cart:request', { action: 'update', payload: updates });

    const cart = await jsonRequest('/cart/update.js', {
      method: 'POST',
      body: { updates }
    });

    updateCountDisplay(cart.item_count);
    dispatch('cart:updated', { action: 'update', cart, payload: updates });
    return cart;
  };

  const clearCart = async () => {
    dispatch('cart:request', { action: 'clear' });

    const cart = await jsonRequest('/cart/clear.js', { method: 'POST' });

    updateCountDisplay(0);
    dispatch('cart:updated', { action: 'clear', cart });
    return cart;
  };

  const fetchSections = async (sectionIds, url) => {
    if (!sectionIds || !sectionIds.length) return {};
    const target = `${url ?? window.location.pathname}?sections=${sectionIds.join(',')}`;
    const response = await fetch(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) throw new Error('Section request failed');
    return response.json();
  };

  const renderSection = async (sectionId, url) => {
    const target = `${url ?? window.location.pathname}?section_id=${sectionId}`;
    const response = await fetch(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) throw new Error('Section render failed');
    return response.text();
  };

  const getCartRoot = () => document.querySelector('[data-cart-root]');

  const toggleCartLoading = (state) => {
    const root = getCartRoot();
    if (!root) return;
    root.classList.toggle('is-loading', state);
  };

  const syncLineInputs = (lineKey, quantity) => {
    const root = getCartRoot();
    if (!root) return;
    const qty = Math.max(0, Number(quantity) || 0);

    root.querySelectorAll('[data-cart-qty-input]').forEach((input) => {
      if (input.getAttribute('data-line-key') === lineKey) input.value = qty;
    });

    root.querySelectorAll('[data-cart-qty-hidden]').forEach((input) => {
      if (input.getAttribute('data-line-key') === lineKey) input.value = qty;
    });
  };

  const getLineQuantity = (lineKey) => {
    const root = getCartRoot();
    if (!root) return 0;
    const inputs = root.querySelectorAll('[data-cart-qty-input]');
    const input = Array.from(inputs).find((el) => el.getAttribute('data-line-key') === lineKey);
    return input ? (Number(input.value) || 0) : 0;
  };

  const refreshCartSection = async () => {
    const root = getCartRoot();
    if (!root) return;
    const sectionId = root.getAttribute('data-section-id');
    if (!sectionId) return;

    try {
      const html = await renderSection(sectionId, window.location.pathname);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const fresh = doc.querySelector('[data-cart-root]');
      if (!fresh) throw new Error('Missing cart root in rendered section');
      root.replaceWith(fresh);
    } catch (error) {
      console.error(error);
      window.location.reload();
    }
  };

  const updateLineQuantity = (lineKey, quantity) => {
    quantity = Math.max(0, Number(quantity) || 0);
    if (cartBusy) return Promise.resolve();
    syncLineInputs(lineKey, quantity);
    cartBusy = true;
    toggleCartLoading(true);

    return change({ id: lineKey, quantity })
      .then(refreshCartSection)
      .catch((error) => {
        console.error(error);
        window.location.reload();
      })
      .finally(() => {
        cartBusy = false;
        toggleCartLoading(false);
      });
  };

  const handleCartClick = (event) => {
    const root = getCartRoot();
    if (!root || !root.contains(event.target)) return;

    const changeBtn = event.target.closest('[data-cart-qty-change]');
    if (changeBtn) {
      event.preventDefault();
      const row = changeBtn.closest('[data-line-key]');
      if (!row) return;
      const lineKey = row.getAttribute('data-line-key');
      const delta = changeBtn.getAttribute('data-change') === 'minus' ? -1 : 1;
      const newQty = getLineQuantity(lineKey) + delta;
      return updateLineQuantity(lineKey, newQty);
    }

    const removeBtn = event.target.closest('[data-cart-remove]');
    if (removeBtn) {
      event.preventDefault();
      let key = removeBtn.getAttribute('data-line-key');
      if (!key) {
        const parentRow = removeBtn.closest('[data-line-key]');
        if (parentRow) key = parentRow.getAttribute('data-line-key');
      }
      if (!key) return;
      return updateLineQuantity(key, 0);
    }
  };

  const handleCartInput = (event) => {
    const input = event.target.closest('[data-cart-qty-input]');
    if (!input) return;
    const root = getCartRoot();
    if (!root || !root.contains(input)) return;
    const lineKey = input.getAttribute('data-line-key');
    if (!lineKey) return;

    let value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    syncLineInputs(lineKey, value);

    clearTimeout(qtyChangeTimeout);
    qtyChangeTimeout = setTimeout(() => {
      updateLineQuantity(lineKey, value);
    }, 300);
  };

  const handleCartSubmit = (event) => {
    const form = event.target.closest('[data-cart-form]');
    if (!form) return;

    let submitter = null;
    if (event.submitter && event.submitter.form === form) {
      submitter = event.submitter;
    } else if (document.activeElement && document.activeElement.form === form) {
      submitter = document.activeElement;
    }
    const bypassAjax = submitter && (
      submitter.getAttribute('name') === 'checkout' ||
      submitter.hasAttribute('data-cart-bypass')
    );
    if (bypassAjax) return;

    event.preventDefault();
    if (cartBusy) return;

    const updates = {};
    form.querySelectorAll('[data-cart-qty-input]').forEach((input) => {
      const key = input.getAttribute('data-line-key');
      if (!key || typeof updates[key] !== 'undefined') return;
      const value = Math.max(0, Number(input.value) || 0);
      updates[key] = value;
    });

    cartBusy = true;
    toggleCartLoading(true);

    updateCart(updates)
      .then(refreshCartSection)
      .catch((error) => {
        console.error(error);
        window.location.reload();
      })
      .finally(() => {
        cartBusy = false;
        toggleCartLoading(false);
      });
  };

  const initCartDelegates = () => {
    document.addEventListener('click', handleCartClick);
    document.addEventListener('change', handleCartInput);
    document.addEventListener('submit', handleCartSubmit);
  };

  document.addEventListener('DOMContentLoaded', () => {
    refreshCount();
    initCartDelegates();
  });

  // Public API
  window.ShopCart = {
    add,
    change,
    remove: (id) => change({ id, quantity: 0 }),
    clear: clearCart,
    update: updateCart,
    getCart,
    refreshCount,
    fetchSections,
    renderSection
  };
})();

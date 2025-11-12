(function () {
  'use strict';

  var cartBusy = false;

  function dispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (err) {
      /* noop */
    }
  }

  function jsonRequest(url, options) {
    options = options || {};
    options.headers = Object.assign({ 'Accept': 'application/json' }, options.headers || {});

    if (options.body && typeof options.body !== 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    return fetch(url, options).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () {
          throw new Error('Request failed');
        }).then(function (payload) {
          var err = new Error(payload && payload.description ? payload.description : 'Request failed');
          err.payload = payload;
          throw err;
        });
      }
      return response.json();
    });
  }

  function updateCountDisplay(count) {
    var badge = document.querySelector('[data-cart-count]');
    if (!badge) return;
    var value = Number(count) || 0;
    if (value <= 0) {
      badge.textContent = '0';
      badge.classList.add('hidden');
    } else {
      badge.textContent = value;
      badge.classList.remove('hidden');
    }
  }

  function getCart() {
    return jsonRequest('/cart.js');
  }

  function refreshCount() {
    return getCart()
      .then(function (cart) {
        updateCountDisplay(cart.item_count);
        return cart.item_count;
      })
      .catch(function () {
        /* ignore */
      });
  }

  function add(payload) {
    payload = payload || {};
    if (!payload.id) return Promise.reject(new Error('Variant id is required.'));

    dispatch('cart:request', { action: 'add', payload: payload });

    return jsonRequest('/cart/add.js', {
      method: 'POST',
      body: {
        id: payload.id,
        quantity: payload.quantity || 1,
        properties: payload.properties || undefined
      }
    }).then(function () {
      return getCart();
    }).then(function (cart) {
      updateCountDisplay(cart.item_count);
      dispatch('cart:updated', { action: 'add', cart: cart, payload: payload });
      return cart;
    });
  }

  function change(payload) {
    payload = payload || {};
    if (typeof payload.id === 'undefined') {
      return Promise.reject(new Error('Line item key is required.'));
    }

    dispatch('cart:request', { action: 'change', payload: payload });

    return jsonRequest('/cart/change.js', {
      method: 'POST',
      body: {
        id: payload.id,
        quantity: typeof payload.quantity === 'number' ? payload.quantity : payload.quantity || 0
      }
    }).then(function (cart) {
      updateCountDisplay(cart.item_count);
      dispatch('cart:updated', { action: 'change', cart: cart, payload: payload });
      return cart;
    });
  }

  function updateCart(updates) {
    updates = updates || {};
    dispatch('cart:request', { action: 'update', payload: updates });
    return jsonRequest('/cart/update.js', {
      method: 'POST',
      body: { updates: updates }
    }).then(function (cart) {
      updateCountDisplay(cart.item_count);
      dispatch('cart:updated', { action: 'update', cart: cart, payload: updates });
      return cart;
    });
  }

  function clearCart() {
    dispatch('cart:request', { action: 'clear' });
    return jsonRequest('/cart/clear.js', { method: 'POST' }).then(function (cart) {
      updateCountDisplay(0);
      dispatch('cart:updated', { action: 'clear', cart: cart });
      return cart;
    });
  }

  function fetchSections(sectionIds, url) {
    if (!sectionIds || !sectionIds.length) return Promise.resolve({});
    var target = (url || window.location.pathname) + '?sections=' + sectionIds.join(',');
    return fetch(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Section request failed');
        return response.json();
      });
  }

  function renderSection(sectionId, url) {
    var target = (url || window.location.pathname) + '?section_id=' + sectionId;
    return fetch(target, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Section render failed');
        return response.text();
      });
  }

  function getCartRoot() {
    return document.querySelector('[data-cart-root]');
  }

  function toggleCartLoading(state) {
    var root = getCartRoot();
    if (!root) return;
    root.classList.toggle('is-loading', state);
  }

  function syncLineInputs(lineKey, quantity) {
    var root = getCartRoot();
    if (!root) return;
    var qty = Math.max(0, Number(quantity) || 0);
    root.querySelectorAll('[data-cart-qty-input]').forEach(function (input) {
      if (input.getAttribute('data-line-key') === lineKey) {
        input.value = qty;
      }
    });
    root.querySelectorAll('[data-cart-qty-hidden]').forEach(function (input) {
      if (input.getAttribute('data-line-key') === lineKey) {
        input.value = qty;
      }
    });
  }

  function getLineQuantity(lineKey) {
    var root = getCartRoot();
    if (!root) return 0;
    var input = Array.prototype.find.call(root.querySelectorAll('[data-cart-qty-input]'), function (el) {
      return el.getAttribute('data-line-key') === lineKey;
    });
    return input ? (Number(input.value) || 0) : 0;
  }

  function refreshCartSection() {
    var root = getCartRoot();
    if (!root) return Promise.resolve();
    var sectionId = root.getAttribute('data-section-id');
    if (!sectionId) return Promise.resolve();

    return renderSection(sectionId, window.location.pathname)
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var fresh = doc.querySelector('[data-cart-root]');
        if (!fresh) throw new Error('Missing cart root in rendered section');
        root.replaceWith(fresh);
      })
      .catch(function (error) {
        console.error(error);
        window.location.reload();
      });
  }

  function updateLineQuantity(lineKey, quantity) {
    quantity = Math.max(0, Number(quantity) || 0);
    if (cartBusy) return Promise.resolve();
    syncLineInputs(lineKey, quantity);
    cartBusy = true;
    toggleCartLoading(true);
    return change({ id: lineKey, quantity: quantity })
      .then(function () {
        return refreshCartSection();
      })
      .catch(function (error) {
        console.error(error);
        window.location.reload();
      })
      .finally(function () {
        cartBusy = false;
        toggleCartLoading(false);
      });
  }

  function handleCartClick(event) {
    var root = getCartRoot();
    if (!root || !root.contains(event.target)) return;

    var changeBtn = event.target.closest('[data-cart-qty-change]');
    if (changeBtn) {
      event.preventDefault();
      var row = changeBtn.closest('[data-line-key]');
      if (!row) return;
      var lineKey = row.getAttribute('data-line-key');
      var delta = changeBtn.getAttribute('data-change') === 'minus' ? -1 : 1;
      var newQty = getLineQuantity(lineKey) + delta;
      return updateLineQuantity(lineKey, newQty);
    }

    var removeBtn = event.target.closest('[data-cart-remove]');
    if (removeBtn) {
      event.preventDefault();
      var key = removeBtn.getAttribute('data-line-key');
      if (!key) {
        var parentRow = removeBtn.closest('[data-line-key]');
        if (parentRow) key = parentRow.getAttribute('data-line-key');
      }
      if (!key) return;
      return updateLineQuantity(key, 0);
    }
  }

  var qtyChangeTimeout;

  function handleCartInput(event) {
    var input = event.target.closest('[data-cart-qty-input]');
    if (!input) return;
    var root = getCartRoot();
    if (!root || !root.contains(input)) return;
    var lineKey = input.getAttribute('data-line-key');
    if (!lineKey) return;
    var value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    syncLineInputs(lineKey, value);

    clearTimeout(qtyChangeTimeout);
    qtyChangeTimeout = setTimeout(function () {
      updateLineQuantity(lineKey, value);
    }, 300);
  }

  function handleCartSubmit(event) {
    var form = event.target.closest('[data-cart-form]');
    if (!form) return;
    event.preventDefault();
    if (cartBusy) return;

    var updates = {};
    form.querySelectorAll('[data-cart-qty-input]').forEach(function (input) {
      var key = input.getAttribute('data-line-key');
      if (!key || typeof updates[key] !== 'undefined') return;
      var value = Math.max(0, Number(input.value) || 0);
      updates[key] = value;
    });

    cartBusy = true;
    toggleCartLoading(true);

    updateCart(updates)
      .then(function () {
        return refreshCartSection();
      })
      .catch(function (error) {
        console.error(error);
        window.location.reload();
      })
      .finally(function () {
        cartBusy = false;
        toggleCartLoading(false);
      });
  }

  function initCartDelegates() {
    document.addEventListener('click', handleCartClick);
    document.addEventListener('change', handleCartInput);
    document.addEventListener('submit', handleCartSubmit);
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshCount();
    initCartDelegates();
  });

  window.ShopCart = {
    add: add,
    change: change,
    remove: function (id) {
      return change({ id: id, quantity: 0 });
    },
    clear: clearCart,
    update: updateCart,
    getCart: getCart,
    refreshCount: refreshCount,
    fetchSections: fetchSections,
    renderSection: renderSection
  };
})();

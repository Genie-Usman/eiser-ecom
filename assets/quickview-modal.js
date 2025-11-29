
document.addEventListener('DOMContentLoaded', () => {
  // 1. Create Global Wrapper
  if (!document.getElementById('qv-global-wrapper')) {
    const div = document.createElement('div');
    div.id = 'qv-global-wrapper';
    div.style.position = 'fixed'; div.style.top = '0'; div.style.left = '0';
    div.style.width = '100%'; div.style.height = '100%';
    div.style.zIndex = '99999'; div.style.background = 'rgba(0,0,0,0.5)';
    div.style.backdropFilter = 'blur(4px)'; div.style.display = 'none';
    div.style.alignItems = 'center'; div.style.justifyContent = 'center';
    
    // Close on background click
    div.addEventListener('click', (e) => { if(e.target === div) closeQuickView(); });
    document.body.appendChild(div);
  }

  // 2. Button Listener
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quickview]');
    if(btn) {
      e.preventDefault();
      const handle = btn.getAttribute('data-product-handle');
      if(handle) openQuickView(handle);
    }
  });
});

function openQuickView(handle) {
  const wrapper = document.getElementById('qv-global-wrapper');
  
  // FETCH SECTION API
  fetch(`/products/${handle}?section_id=quickview`)
    .then(res => res.text())
    .then(html => {
      wrapper.innerHTML = html;
      
      // Execute Scripts
      wrapper.querySelectorAll('script').forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });

      wrapper.style.display = 'flex';
    })
    .catch(e => console.error('Quickview Error:', e));
}

function closeQuickView() {
  const wrapper = document.getElementById('qv-global-wrapper');
  wrapper.style.display = 'none';
  wrapper.innerHTML = '';
}

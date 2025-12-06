class VariantSelector extends HTMLElement {
    constructor() {
        super();
        this.addEventListener('change', this.onVariantChange.bind(this));
    }

    onVariantChange() {
        this.updateOptions();
        this.updateMasterId();
        this.updateMedia();
        this.updateURL();
        this.updateSection();
    }

    updateOptions() {
        this.options = Array.from(this.querySelectorAll('fieldset'), (fieldset) => {
            const checked = Array.from(fieldset.querySelectorAll('input')).find((radio) => radio.checked);
            return checked ? checked.value : null;
        });
    }

    updateMasterId() {
        const masterSelect = this.querySelector('#MasterVariantSelect');
        if (!masterSelect) return;

        const matchingOption = Array.from(masterSelect.options).find((option) => {
            return this.options.every((value, index) => {
                const optionValue = option.getAttribute(`data-option-${index}`);
                return optionValue === value;
            });
        });

        if (matchingOption) {
            masterSelect.value = matchingOption.value;
            this.currentVariant = matchingOption;
        }
    }

    updateMedia() {
        if (!this.currentVariant) return;

        const colorFieldset = this.querySelector('fieldset[data-option-name="Color"]');
        if (colorFieldset) {
            const checkedInput = colorFieldset.querySelector('input:checked');
            if (checkedInput) {
                const colorValue = checkedInput.value;
                document.dispatchEvent(new CustomEvent('variant:change', {
                    detail: {
                        variant: this.currentVariant,
                        color: colorValue
                    }
                }));
            }
        }
    }

    updateURL() {
        if (!this.currentVariant) return;
        if (this.dataset.url) {
            window.history.replaceState({}, '', `${this.dataset.url}?variant=${this.currentVariant.value}`);
        }
    }

    updateSection() {
        if (!this.currentVariant || !this.dataset.section) return;

        const sectionId = this.dataset.section;
        const url = `${this.dataset.url}?variant=${this.currentVariant.value}&section_id=${sectionId}`;

        fetch(url)
            .then(response => response.text())
            .then(responseText => {
                const html = new DOMParser().parseFromString(responseText, 'text/html');
                this.renderProductInfo(html, sectionId);
            })
            .catch(e => {
                console.error(e);
            });
    }

    renderProductInfo(html, sectionId) {
        const destination = document.getElementById(`price-${sectionId}`);
        const source = html.getElementById(`price-${sectionId}`);

        if (source && destination) destination.innerHTML = source.innerHTML;

        const availabilityDest = document.getElementById(`availability-${sectionId}`);
        const availabilitySource = html.getElementById(`availability-${sectionId}`);
        if (availabilitySource && availabilityDest) availabilityDest.innerHTML = availabilitySource.innerHTML;

        // Update Add to Cart Button
        const productForm = this.closest('form') || document.querySelector(`form[id^="product-form-${sectionId}"]`);
        if (productForm) {
            const addButton = productForm.querySelector('[data-add-to-cart]');
            const sourceButton = html.querySelector('[data-add-to-cart]');

            if (addButton && sourceButton) {
                addButton.disabled = sourceButton.disabled;
                addButton.innerHTML = sourceButton.innerHTML;
            }
        }
    }
}

customElements.define('variant-selector', VariantSelector);

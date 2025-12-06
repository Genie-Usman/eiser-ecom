/**
 * COMPONENT: Variant Selector
 * COMPONENT: Media Gallery
 * Best Practice: Self-contained logic. Listens for window/document events 
 * or specific parent events to update itself.
 */
class MediaGallery extends HTMLElement {
    constructor() {
        super();
        this.mainSwiper = null;
        this.thumbSwiper = null;
        this.mediaDataScript = this.querySelector('#ProductMediaJSON');
        this.mediaData = this.mediaDataScript ? JSON.parse(this.mediaDataScript.textContent) : [];
    }

    connectedCallback() {
        // Initialize with default state
        // Try to find the currently checked color input
        const checkedInput = document.querySelector('input[name="Color"]:checked');
        const defaultColor = checkedInput ? checkedInput.value : null;

        if (defaultColor) {
            this.renderGallery(defaultColor);
        } else {
            // Render all if no color selected
            this.renderGallery(null);
        }

        // Listen for changes from the sibling component
        document.addEventListener('variant:change', (e) => {
            this.renderGallery(e.detail.color);
        });
    }

    getFilteredMedia(color) {
        if (!color) return this.mediaData;

        // Strict Alt Text Matching with robust normalization
        const normalizedColor = color.toLowerCase().trim();

        const filtered = this.mediaData.filter(media =>
            media.alt && media.alt.toLowerCase().trim() === normalizedColor
        );

        // Fallback: If no matches, show everything (Best Practice: Avoid empty states)
        return filtered.length > 0 ? filtered : this.mediaData;
    }

    renderGallery(color) {
        const mediaList = this.getFilteredMedia(color);
        const mainWrapper = this.querySelector('#main-slider-wrapper');
        const thumbWrapper = this.querySelector('#thumb-slider-wrapper');

        if (!mainWrapper || !thumbWrapper) return;

        // Cleanup existing swipers
        if (this.mainSwiper) this.mainSwiper.destroy(true, true);
        if (this.thumbSwiper) this.thumbSwiper.destroy(true, true);

        // Rebuild DOM
        mainWrapper.innerHTML = mediaList.map(media => this.buildSlide(media)).join('');
        thumbWrapper.innerHTML = mediaList.map(media => this.buildThumb(media)).join('');

        // Re-init Swiper
        // Small delay to ensure DOM is ready
        requestAnimationFrame(() => {
            this.initSwiper();
        });
    }

    buildSlide(media) {
        if (media.media_type === 'video' || media.media_type === 'external_video') {
            return `
                <div class="swiper-slide">
                    <div class="w-full h-full flex items-center justify-center bg-black">
                         ${media.media_type === 'external_video'
                    ? `<iframe src="${media.src}" class="w-full h-full" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
                    : `<video controls class="w-full h-full object-contain"><source src="${media.src}" type="video/mp4"></video>`
                }
                    </div>
                </div>`;
        }
        return `<div class="swiper-slide"><img src="${media.src}" alt="${media.alt}" class="w-full h-full object-contain"></div>`;
    }

    buildThumb(media) {
        // Thumbnails should always be images, or a placeholder for video
        let content = `<img src="${media.preview_image || media.src}" alt="${media.alt}" class="w-full h-full object-cover rounded-md">`;

        if (media.media_type === 'video' || media.media_type === 'external_video') {
            content = `
                <div class="relative w-full h-full">
                    <img src="${media.preview_image || media.src}" alt="${media.alt}" class="w-full h-full object-cover rounded-md opacity-70">
                    <div class="absolute inset-0 flex items-center justify-center text-white font-bold text-[10px] bg-black/30 rounded-md">
                        PLAY
                    </div>
                </div>
             `;
        }

        return `<div class="swiper-slide cursor-pointer border-2 border-transparent hover:border-gray-300 rounded-md overflow-hidden transition-all">${content}</div>`;
    }

    initSwiper() {
        this.thumbSwiper = new Swiper(this.querySelector(".gallery-thumbs"), {
            spaceBetween: 10,
            slidesPerView: 'auto',
            freeMode: true,
            watchSlidesProgress: true,
            direction: 'horizontal',
        });

        this.mainSwiper = new Swiper(this.querySelector(".gallery-main"), {
            spaceBetween: 10,
            thumbs: {
                swiper: this.thumbSwiper,
            },
            on: {
                slideChange: () => this.checkActiveSlide(),
                init: () => this.checkActiveSlide(),
            }
        });
    }

    checkActiveSlide() {
        if (!this.mainSwiper) return;
        const activeIndex = this.mainSwiper.activeIndex;
        const activeSlide = this.mainSwiper.slides[activeIndex];

        // Check if the active slide contains a video or iframe
        const isVideo = activeSlide.querySelector('video, iframe') !== null;

        if (isVideo) {
            this.classList.add('video-active');
        } else {
            this.classList.remove('video-active');
        }
    }
}
customElements.define('media-gallery', MediaGallery);

/**
 * Click-to-enlarge lightbox for CHM Help images.
 * Attaches to all img.doc-screenshot and img.doc-diagram elements.
 */
(function () {
    // Build the overlay once
    var overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';

    var wrapper = document.createElement('div');
    wrapper.id = 'lightbox-wrapper';

    var bigImg = document.createElement('img');
    bigImg.id = 'lightbox-img';

    var caption = document.createElement('div');
    caption.id = 'lightbox-caption';

    var hint = document.createElement('div');
    hint.id = 'lightbox-hint';
    hint.innerHTML = 'Click anywhere or press Esc to close';

    wrapper.appendChild(bigImg);
    wrapper.appendChild(caption);
    wrapper.appendChild(hint);
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    // Close handler
    function closeLightbox() {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    overlay.onclick = function (e) {
        // Close when clicking the overlay (but not the image for drag-scrolling)
        closeLightbox();
    };

    document.onkeydown = function (e) {
        if (e.keyCode === 27 && overlay.style.display === 'flex') {
            closeLightbox();
        }
    };

    // Attach click handlers to all doc images
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img.className.indexOf('doc-screenshot') !== -1 ||
            img.className.indexOf('doc-diagram') !== -1) {
            (function (el) {
                el.style.cursor = 'pointer';
                el.title = 'Click to enlarge';
                el.onclick = function () {
                    bigImg.src = el.src;
                    caption.innerHTML = el.alt || '';
                    overlay.style.display = 'flex';
                    document.body.style.overflow = 'hidden';
                };
            })(img);
        }
    }
})();

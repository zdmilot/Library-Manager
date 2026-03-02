/**
 * Click-to-enlarge lightbox for CHM Help images.
 * IE-compatible: no flex, no fixed, no rgba, no transitions.
 * Click image once to enlarge; click enlarged image to toggle
 * between fit-to-window and full-size (native resolution).
 */
(function () {
    var isOpen = false;
    var isZoomed = false;

    // Dark semi-transparent backdrop (separate element so opacity filter
    // does not affect children)
    var overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';

    // Content layer (full opacity, sits on top of backdrop)
    var content = document.createElement('div');
    content.id = 'lightbox-content';

    var bigImg = document.createElement('img');
    bigImg.id = 'lightbox-img';

    var caption = document.createElement('div');
    caption.id = 'lightbox-caption';

    var hint = document.createElement('div');
    hint.id = 'lightbox-hint';

    content.appendChild(bigImg);
    content.appendChild(caption);
    content.appendChild(hint);

    document.body.appendChild(overlay);
    document.body.appendChild(content);

    var HINT_FIT  = 'Click image for full size &nbsp;|&nbsp; Click outside or press <b>Esc</b> to close';
    var HINT_ZOOM = 'Click image to fit window &nbsp;|&nbsp; Click outside or press <b>Esc</b> to close';

    function getPageHeight() {
        var b = document.body;
        var d = document.documentElement;
        return Math.max(
            b.scrollHeight || 0, d.scrollHeight || 0,
            b.offsetHeight || 0, d.offsetHeight || 0,
            b.clientHeight || 0, d.clientHeight || 0
        );
    }

    function getScrollTop() {
        return document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function setFitMode() {
        isZoomed = false;
        bigImg.style.maxWidth = '90%';
        bigImg.style.cursor = 'pointer';
        bigImg.title = 'Click for full size';
        content.style.overflow = 'hidden';
        hint.innerHTML = HINT_FIT;
    }

    function setZoomMode() {
        isZoomed = true;
        bigImg.style.maxWidth = 'none';
        bigImg.style.cursor = 'pointer';
        bigImg.title = 'Click to fit window';
        content.style.overflow = 'auto';
        hint.innerHTML = HINT_ZOOM;
    }

    function openLightbox(src, alt) {
        var h = getPageHeight();
        var st = getScrollTop();

        // Size and show backdrop
        overlay.style.height = h + 'px';
        overlay.style.filter = 'alpha(opacity=80)';
        overlay.style.display = 'block';

        // Position content near current scroll position
        content.style.top = st + 'px';
        content.style.height = (document.documentElement.clientHeight || document.body.clientHeight) + 'px';
        content.style.display = 'block';

        bigImg.src = src;
        bigImg.alt = alt || '';
        caption.innerHTML = alt || '';
        setFitMode();
        isOpen = true;
    }

    function closeLightbox() {
        overlay.style.display = 'none';
        content.style.display = 'none';
        content.style.overflow = 'hidden';
        bigImg.src = '';
        isOpen = false;
        isZoomed = false;
    }

    // Close on backdrop click
    overlay.onclick = function () { closeLightbox(); };
    // Close on content area click (but not on the image itself)
    content.onclick = function () { closeLightbox(); };

    // Toggle zoom on image click
    bigImg.onclick = function () {
        if (window.event) { window.event.cancelBubble = true; }
        if (isZoomed) {
            setFitMode();
        } else {
            setZoomMode();
        }
        return false;
    };

    // Close on Esc
    document.onkeydown = function () {
        var e = window.event || arguments[0];
        if (isOpen && (e.keyCode === 27)) {
            closeLightbox();
        }
    };

    // Attach click handlers to all doc images
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img.className && (img.className.indexOf('doc-screenshot') !== -1 ||
            img.className.indexOf('doc-diagram') !== -1)) {
            (function (el) {
                el.style.cursor = 'pointer';
                el.title = 'Click to enlarge';
                el.onclick = function () {
                    openLightbox(el.src, el.alt);
                    if (window.event) { window.event.cancelBubble = true; }
                    return false;
                };
            })(img);
        }
    }
})();

// ==========================================================================
// ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ (UI-12)
// Замена системным alert()/confirm(): одинаково выглядят на всех платформах,
// не блокируют страницу и не сбрасывают прогресс диалога.
//   showToast('Текст', { type: 'error' | 'info' | 'success', timeout: 5000 })
// timeout: 0 — висит, пока пользователь не закроет.
// ==========================================================================
(function () {
    const DEFAULT_TIMEOUT = 5000;

    function getToastLayer() {
        let layer = document.getElementById('toast-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'toast-layer';
            layer.className = 'toast-layer';
            layer.setAttribute('aria-live', 'polite');
            layer.setAttribute('aria-atomic', 'false');
            document.body.appendChild(layer);
        }
        return layer;
    }

    function removeToast(toast) {
        if (!toast || toast.dataset.leaving === 'true') return;
        toast.dataset.leaving = 'true';
        toast.classList.remove('is-visible');
        const cleanup = () => { if (toast.parentNode) toast.parentNode.removeChild(toast); };
        toast.addEventListener('transitionend', cleanup, { once: true });
        // Страховка, если transitionend не придёт (reduced-motion, скрытая вкладка)
        setTimeout(cleanup, 400);
    }

    /**
     * Показать уведомление.
     * @param {string} message
     * @param {{type?: string, timeout?: number}} [options]
     * @returns {HTMLElement|null}
     */
    function showToast(message, options) {
        if (!document.body) return null;

        const opts = options || {};
        const type = opts.type || 'error';
        const timeout = opts.timeout === undefined ? DEFAULT_TIMEOUT : opts.timeout;

        const layer = getToastLayer();
        const toast = document.createElement('div');
        toast.className = 'toast toast--' + type;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = document.createElement('span');
        icon.className = 'toast__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = type === 'success' ? '✓' : (type === 'info' ? 'ℹ' : '!');

        const text = document.createElement('span');
        text.className = 'toast__text';
        text.textContent = message;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast__close';
        close.setAttribute('aria-label', 'Закрыть уведомление');
        close.textContent = '×';
        close.addEventListener('click', () => removeToast(toast));

        toast.appendChild(icon);
        toast.appendChild(text);
        toast.appendChild(close);
        layer.appendChild(toast);

        // Появление — на следующем кадре, чтобы сработал переход
        requestAnimationFrame(() => toast.classList.add('is-visible'));

        if (timeout > 0) {
            let timer = setTimeout(() => removeToast(toast), timeout);

            // Не закрывать, пока пользователь держит курсор над уведомлением
            toast.addEventListener('mouseenter', () => {
                clearTimeout(timer);
                timer = null;
            });
            toast.addEventListener('mouseleave', () => {
                if (!timer) timer = setTimeout(() => removeToast(toast), 2000);
            });
        }

        return toast;
    }

    window.showToast = showToast;
})();

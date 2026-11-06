// /utils/textfit.js

(() => {

    function fit(el) {

        const min = Number(el.dataset.minSize || 11);
        const max = Number(el.dataset.maxSize || 120);
        const padding = Number(el.dataset.padding || 0);
        const fill = Number(el.dataset.fill || 1);

        el.style.paddingLeft = padding + "px";
        el.style.paddingRight = padding + "px";
        el.style.whiteSpace = "nowrap";

        const available =
            (el.parentElement.clientWidth - padding * 2) * fill;

        if (available <= 0)
            return;

        //--------------------------------------------------
        // измеритель
        //--------------------------------------------------

        const probe = document.createElement("span");

        const css = getComputedStyle(el);

        probe.textContent = el.textContent;

        probe.style.position = "absolute";
        probe.style.left = "-99999px";
        probe.style.top = "-99999px";
        probe.style.visibility = "hidden";
        probe.style.whiteSpace = "nowrap";

        probe.style.fontFamily = css.fontFamily;
        probe.style.fontWeight = css.fontWeight;
        probe.style.fontStyle = css.fontStyle;
        probe.style.fontStretch = css.fontStretch;
        probe.style.fontVariant = css.fontVariant;
        probe.style.letterSpacing = css.letterSpacing;
        probe.style.wordSpacing = css.wordSpacing;
        probe.style.textTransform = css.textTransform;

        document.body.appendChild(probe);

        //--------------------------------------------------
        // бинарный поиск
        //--------------------------------------------------

        let low = min;
        let high = max;
        let best = min;

        while (low <= high) {

            const mid = Math.floor((low + high) / 2);

            probe.style.fontSize = mid + "px";

            if (probe.offsetWidth <= available) {

                best = mid;
                low = mid + 1;

            } else {

                high = mid - 1;

            }

        }

        document.body.removeChild(probe);

        el.style.fontSize = best + "px";

    }

    //--------------------------------------------------

    function fitAll() {

        document
            .querySelectorAll("[data-textfit]")
            .forEach(fit);

    }

    //--------------------------------------------------

    document.addEventListener("DOMContentLoaded", () => {

        fitAll();

        if (document.fonts)
            document.fonts.ready.then(fitAll);

        let timer;

        window.addEventListener("resize", () => {

            clearTimeout(timer);

            timer = setTimeout(fitAll, 100);

        });

    });

})();
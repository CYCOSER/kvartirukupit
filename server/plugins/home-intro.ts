// Inline HTML/CSS and SVG paint before Vue; the title uses a fallback until Manrope loads.
// Outside Vue's root so hydration cannot restart the opening animation.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html, { event }) => {
    if (getRequestURL(event).pathname !== "/") return;
    // Reloading always starts at the hero; intentional incoming section links work.
    html.head.push(
      `<script>(function(){var navigation=performance.getEntriesByType('navigation')[0];var reloading=navigation&&navigation.type==='reload';if(location.hash&&location.hash!=='#collection'&&!reloading)return;if(location.hash)history.replaceState(history.state,'',location.pathname+location.search);var restoration=history.scrollRestoration;history.scrollRestoration='manual';window.scrollTo({top:0,left:0,behavior:'instant'});window.addEventListener('pageshow',function(){window.scrollTo({top:0,left:0,behavior:'instant'});history.scrollRestoration=restoration;},{once:true});})();</script>`,
    );
    html.bodyPrepend.unshift(`<style>
.home-intro{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;isolation:isolate;overflow:hidden;color:#f2f6fb;pointer-events:none;animation:home-intro-finish 1ms 2.1s forwards}
.home-intro::before,.home-intro::after{content:'';position:absolute;inset:0 auto 0 0;width:50.1%;z-index:-1;background:#102f50;--exit:-101%;animation:home-intro-open .75s 1.35s cubic-bezier(.76,0,.24,1) forwards}
.home-intro::after{left:auto;right:0;--exit:101%}
.home-intro-content{display:grid;justify-items:center;gap:24px;max-width:calc(100% - 40px);text-align:center;animation:home-intro-arrive .65s .05s backwards,home-intro-fade .2s 1.2s forwards}
.home-intro-symbol{width:clamp(68px,9vw,104px);height:auto;fill:none;stroke:#b8d4f4;stroke-width:3;stroke-linejoin:miter}
.home-intro-title{display:flex;align-items:baseline;justify-content:center;margin:0;font:500 clamp(25px,5.4vw,60px)/1.25 'Manrope Variable',Arial,sans-serif;letter-spacing:-.045em;white-space:nowrap}
.home-intro-reveal{display:grid;grid-template-columns:0fr;animation:home-intro-expand .65s .3s cubic-bezier(.22,1,.36,1) forwards}
.home-intro-clip{min-width:0;clip-path:inset(-1em -100vw -1em 0)}
.home-intro-tail{display:block;width:max-content;animation:home-intro-slide .65s .3s cubic-bezier(.22,1,.36,1) both}
.home-intro-dash{color:#b8d4f4;letter-spacing:0}
.home-intro-rule{width:48px;height:1px;background:#b8d4f46b}
.home-intro-caption,.home-intro-location{margin:0;font:500 10px/1.6 'Manrope Variable',Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase}
.home-intro-caption{color:#b8d4f4;font-size:12px;letter-spacing:.06em;text-transform:none}
.home-intro-location{position:absolute;bottom:clamp(24px,5vh,52px);left:20px;right:20px;text-align:center;color:#c5d7ec;animation:home-intro-fade .2s 1.2s forwards}
@keyframes home-intro-arrive{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes home-intro-expand{to{grid-template-columns:1fr}}
@keyframes home-intro-slide{from{transform:translateX(-100%)}to{transform:translateX(0)}}
@keyframes home-intro-fade{to{opacity:0}}
@keyframes home-intro-open{to{transform:translateX(var(--exit))}}
@keyframes home-intro-finish{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce){.home-intro{display:none}.home-intro,.home-intro *,.home-intro::before,.home-intro::after{animation:none}}
</style><div class="home-intro" aria-hidden="true" inert><div class="home-intro-content"><svg class="home-intro-symbol" viewBox="0 0 48 48" width="104" height="104"><path stroke-width="2.7" d="M9 41V21h10V7h12v22h8v12M19 21v20M31 29v12"/><path d="M5 41h38M24 14h2M24 21h2M24 28h2"/></svg><p class="home-intro-title"><span>Квартиру</span><span class="home-intro-reveal"><span class="home-intro-clip"><span class="home-intro-tail"><span class="home-intro-dash">купить</span></span></span></span></p><span class="home-intro-rule"></span><p class="home-intro-caption">Новостройки · Калининград</p></div><p class="home-intro-location">Калининград · В ритме Балтики</p></div>`);
  });
});

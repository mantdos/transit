/**
 * 全站「温馨提示」弹窗：在 DOMContentLoaded 时按需注入样式与 DOM，并执行展示逻辑。
 */
(function () {
  var MODAL_VERSION = "v2";
  var LS_VERSION_KEY = "transit_notice_modal_version";
  var LS_SNOOZE_UNTIL_KEY = "transit_notice_modal_snooze_until";
  var SS_SESSION_KEY = "transit_notice_modal_session_dismissed";

  function readLsVersion() {
    try {
      return localStorage.getItem(LS_VERSION_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function readSnoozeUntil() {
    try {
      var raw = localStorage.getItem(LS_SNOOZE_UNTIL_KEY);
      var n = raw ? parseInt(raw, 10) : 0;
      return isNaN(n) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  function sessionDismissed() {
    try {
      return sessionStorage.getItem(SS_SESSION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function shouldShowModal() {
    var storedVer = readLsVersion();
    if (storedVer !== MODAL_VERSION) return true;
    if (sessionDismissed()) return false;
    if (Date.now() < readSnoozeUntil()) return false;
    return true;
  }

  function persistAfterDismiss(snooze24h) {
    try {
      localStorage.setItem(LS_VERSION_KEY, MODAL_VERSION);
      if (snooze24h) {
        localStorage.setItem(LS_SNOOZE_UNTIL_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
      } else {
        localStorage.removeItem(LS_SNOOZE_UNTIL_KEY);
      }
      sessionStorage.setItem(SS_SESSION_KEY, "1");
    } catch (e) {}
  }

  var CSS =
    ".site-notice-modal-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,6,23,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .32s ease,visibility .32s ease}" +
    ".site-notice-modal-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto}" +
    ".site-notice-modal-overlay.is-leaving{opacity:0;visibility:visible;pointer-events:none}" +
    ".site-notice-modal-card{width:100%;max-width:32rem;max-height:min(88vh,40rem);overflow:hidden;display:flex;flex-direction:column;border-radius:1.25rem;border:1px solid rgba(148,163,184,.35);background:linear-gradient(165deg,rgba(15,23,42,.98) 0%,rgba(15,23,42,.94) 100%);box-shadow:0 25px 50px -12px rgba(0,0,0,.55),0 0 0 1px rgba(234,76,137,.12);transform:scale(.94) translateY(.5rem);opacity:0;transition:transform .35s cubic-bezier(.34,1.2,.64,1),opacity .3s ease}" +
    ".site-notice-modal-overlay.is-open .site-notice-modal-card{transform:scale(1) translateY(0);opacity:1}" +
    ".site-notice-modal-overlay.is-leaving .site-notice-modal-card{transform:scale(.96) translateY(.25rem);opacity:0;transition:transform .28s ease,opacity .28s ease}" +
    ".site-notice-modal-body{overflow-y:auto;padding:1.25rem 1.25rem 1rem;text-align:justify}" +
    ".site-notice-highlight{font-weight:700;color:#7dd3fc;background:rgba(34,211,238,.12);padding:.1em .35em;border-radius:.35rem}" +
    ".site-notice-warn{font-weight:700;color:#fecaca;background:rgba(239,68,68,.18);padding:.1em .35em;border-radius:.35rem}" +
    ".site-notice-subtip{font-size:.9em;color:rgb(148 163 184);line-height:1.55;margin:0 0 1rem;text-align:justify}" +
    ".site-notice-subtip strong{color:rgb(100 116 139);font-weight:600}" +
    ".site-notice-link{display:inline-flex;align-items:center;gap:.35rem;margin-top:.5rem;font-weight:600;color:#a5b4fc;text-decoration:underline;text-underline-offset:3px;transition:color .15s ease}" +
    ".site-notice-link:hover{color:#c4b5fd}" +
    ".site-notice-btn-primary{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:.8rem 1.25rem;border-radius:.75rem;font-weight:700;font-size:1rem;color:#fff;border:none;cursor:pointer;background:linear-gradient(90deg,#00a6ff 0%,#c369ff 52.4%,#ff4590 100%);box-shadow:0 4px 14px rgba(234,76,137,.35);transition:opacity .15s ease,transform .15s ease}" +
    ".site-notice-btn-primary:hover{opacity:.95;transform:translateY(-1px)}" +
    ".site-notice-btn-snooze{font-size:.8125rem;font-weight:500;color:rgb(148 163 184);background:transparent;border:1px solid rgba(148,163,184,.35);border-radius:.65rem;padding:.5rem .85rem;cursor:pointer;transition:color .15s ease,border-color .15s ease,background .15s ease}" +
    ".site-notice-btn-snooze:hover{color:rgb(226 232 240);border-color:rgba(148,163,184,.55);background:rgba(255,255,255,.06)}" +
    ".site-notice-footer-actions{display:flex;flex-direction:column;gap:.75rem;border-top:1px solid rgba(71,85,105,.6);background:rgba(2,6,23,.4);padding:1rem 1rem 1.1rem}";

  var MODAL_HTML =
    '<div id="site-notice-modal" class="site-notice-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="site-notice-title" aria-hidden="true" hidden>' +
    '<div class="site-notice-modal-card" id="site-notice-card">' +
    '<div class="relative flex shrink-0 flex-col gap-2 border-b border-slate-600/60 px-4 pb-3 pt-4">' +
    '<h2 id="site-notice-title" class="text-lg font-extrabold tracking-tight text-white md:text-xl"><span class="gradient-text">系统公告</span></h2>' +
    "</div>" +
    '<div class="site-notice-modal-body text-sm leading-relaxed text-slate-200">' +
    '<p class="mb-4 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2.5">' +
    "🎉 <span class=\"site-notice-highlight\">gpt-5.5</span> 与 <span class=\"site-notice-highlight\">claude-opus-4-7-max</span> 现已上线，欢迎根据需求酌情尝试！" +
    "</p>" +
    "<p class=\"mb-0\">" +
    "🚫 <span class=\"site-notice-warn\">温馨提示</span>：<span class=\"site-notice-highlight\">claude-opus</span> 是 claude 系列最顶级的模型，专用于极强逻辑推理任务。请根据任务的繁琐程度灵活选择模型，日常编码/轻量任务建议切换至 " +
    '<span class="site-notice-highlight">Sonnet</span> 或 <span class="site-notice-highlight">Haiku</span>，<span class=\"site-notice-warn\">拒绝大炮打蚊子</span>。（也不要用 Opus 模型来阅读文件哦！）' +
    "</p>" +
    '<p class="site-notice-subtip">💡 操作提示： Claude Code 下，可直接输入 <strong>/model</strong> 快捷切换模型。</p>' +
    '<p class="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-slate-200">' +
    '🛡️ 本站为<strong class="text-emerald-200">纯净中转</strong>，缓存创建均同步官方，模型皆为<strong class="text-emerald-200">正版</strong>，未做任何更改！除特殊标注外，计费均按官方 Token <span class="site-notice-highlight">1:1</span> 扣除。' +
    "</p>" +
    '<p class="mb-1">' +
    "📚 " +
    '<a class="site-notice-link" href="https://ucngkdwd50uz.feishu.cn/wiki/WoRwwaz8kiCihfkrPchcwHvenAd" target="_blank" rel="noopener noreferrer">👉 点击查看：Token 节省与使用技巧指南</a>' +
    "</p>" +
    "</div>" +
    '<div class="site-notice-footer-actions">' +
    '<label class="site-notice-btn-snooze flex w-full cursor-pointer select-none items-center gap-2.5">' +
    '<input type="checkbox" id="site-notice-snooze-check" class="h-4 w-4 shrink-0 rounded border-slate-500 bg-slate-900 accent-pink-500" />' +
    "<span>24 小时内不再弹出</span>" +
    "</label>" +
    '<button type="button" id="site-notice-ok" class="site-notice-btn-primary">我知道了 / 关闭</button>' +
    "</div>" +
    "</div>" +
    "</div>";

  function injectStyles() {
    if (document.getElementById("transit-global-notice-styles")) return;
    var style = document.createElement("style");
    style.id = "transit-global-notice-styles";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function setOpen(rootEl, open) {
    if (open) {
      rootEl.hidden = false;
      rootEl.removeAttribute("hidden");
      rootEl.setAttribute("aria-hidden", "false");
      requestAnimationFrame(function () {
        rootEl.classList.add("is-open");
      });
    } else {
      rootEl.classList.remove("is-open");
      rootEl.classList.add("is-leaving");
      var done = function () {
        rootEl.classList.remove("is-leaving");
        rootEl.hidden = true;
        rootEl.setAttribute("aria-hidden", "true");
        rootEl.removeEventListener("transitionend", onEnd);
      };
      var onEnd = function (ev) {
        if (ev.target === rootEl && ev.propertyName === "opacity") done();
      };
      rootEl.addEventListener("transitionend", onEnd);
      window.setTimeout(done, 400);
    }
  }

  function run() {
    if (!shouldShowModal()) return;
    if (document.getElementById("site-notice-modal")) return;

    injectStyles();
    document.body.insertAdjacentHTML("beforeend", MODAL_HTML);

    var rootEl = document.getElementById("site-notice-modal");
    if (!rootEl) return;

    function closeModal(snooze24h) {
      persistAfterDismiss(!!snooze24h);
      setOpen(rootEl, false);
    }

    var btnOk = document.getElementById("site-notice-ok");
    var chkSnooze = document.getElementById("site-notice-snooze-check");
    var card = document.getElementById("site-notice-card");

    function snoozeOn() {
      return chkSnooze && chkSnooze.checked;
    }

    setOpen(rootEl, true);

    if (btnOk) {
      btnOk.addEventListener("click", function () {
        closeModal(snoozeOn());
      });
    }
    rootEl.addEventListener("click", function (ev) {
      if (ev.target === rootEl) {
        closeModal(snoozeOn());
      }
    });
    if (card) {
      card.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
    }
  }

  function onReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  onReady();
})();

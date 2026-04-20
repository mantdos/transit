/**
 * 定价/标签接口：同一页面生命周期内仅发起一次 /api/pricing 请求，并缓存为 model_name -> tags[]。
 */
(function (global) {
  var pricingPromise = null;

  function parseTags(str) {
    if (!str || typeof str !== "string") return [];
    return str
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function buildTagMapFromPayload(payload) {
    var map = Object.create(null);
    var list = payload && Array.isArray(payload.data) ? payload.data : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || typeof row.model_name !== "string") continue;
      var tags = parseTags(row.tags);
      if (tags.length) map[row.model_name] = tags;
    }
    return map;
  }

  /**
   * @returns {Promise<Record<string, string[]>>}
   */
  global.transitGetPricingTagMapOnce = function () {
    if (!pricingPromise) {
      pricingPromise = fetch("/api/pricing", { method: "GET", credentials: "same-origin" })
        .then(function (r) {
          return r.ok ? r.json() : {};
        })
        .then(function (j) {
          return buildTagMapFromPayload(j && typeof j === "object" ? j : {});
        })
        .catch(function () {
          return {};
        });
    }
    return pricingPromise;
  };

  /**
   * 在容器内渲染模型名（可选中复制）+ 标签（不可选中、不拦截点击）。
   */
  global.transitRenderModelLabel = function (container, modelId, tagMap) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    var name = document.createElement("span");
    name.className = "min-w-0 break-all font-mono";
    name.textContent = modelId;
    container.appendChild(name);
    var tags = tagMap && tagMap[modelId] ? tagMap[modelId] : [];
    for (var t = 0; t < tags.length; t++) {
      var b = document.createElement("span");
      b.className =
        "model-tag-badge inline-flex shrink-0 items-center rounded-md border border-fuchsia-500/35 bg-fuchsia-500/15 px-1.5 py-0.5 text-[11px] font-medium leading-none text-fuchsia-100";
      b.textContent = tags[t];
      b.setAttribute("aria-hidden", "true");
      b.style.userSelect = "none";
      b.style.pointerEvents = "none";
      container.appendChild(b);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   MAIN-world hook. Injected as a <script> tag so it runs in the
   page's own realm (works on Chrome, Edge and Firefox alike —
   no reliance on MV3 `world:"MAIN"`, which older Firefox lacks).

   LeetCode submits, then polls
     /submissions/detail/<id>/check/
   until the JSON says state:"SUCCESS". We watch those responses
   and shout when one comes back Accepted.
   ============================================================ */
(function () {
  if (window.__nexusHooked) return;
  window.__nexusHooked = true;

  var TAG = "NEXUS_LEETHUB_ACCEPTED";
  var isCheck = function (u) { return /\/submissions\/detail\/\d+\/check\/?/.test(String(u || "")); };

  function announce(data) {
    if (!data || data.state !== "SUCCESS") return;
    if (String(data.status_msg || "").toLowerCase() !== "accepted") return;
    window.postMessage({
      source: TAG,
      payload: {
        questionId: data.question_id,
        lang: data.pretty_lang || data.lang,
        runtime: data.status_runtime || "",
        memory: data.status_memory || "",
        runtimePercentile: data.runtime_percentile,
        memoryPercentile: data.memory_percentile,
        totalCorrect: data.total_correct,
        totalTestcases: data.total_testcases,
        submissionId: data.submission_id
      }
    }, "*");
  }

  /* ---- fetch ---- */
  var _fetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = args[0] && args[0].url ? args[0].url : args[0];
    var p = _fetch.apply(this, args);
    if (isCheck(url)) {
      p.then(function (res) {
        try { res.clone().json().then(announce).catch(function () {}); } catch (e) {}
        return res;
      }).catch(function () {});
    }
    return p;
  };

  /* ---- XMLHttpRequest ---- */
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__nexusUrl = url;
    return _open.apply(this, arguments);
  };
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (isCheck(xhr.__nexusUrl)) {
      xhr.addEventListener("load", function () {
        try { announce(JSON.parse(xhr.responseText)); } catch (e) {}
      });
    }
    return _send.apply(this, arguments);
  };

  /* ---- liveness ping, so the content script can tell whether this
         script was allowed to run at all (Brave Shields, strict CSP) ---- */
  window.addEventListener("message", function (ev) {
    if (ev.source !== window || !ev.data || ev.data.source !== "NEXUS_LEETHUB_PING") return;
    window.postMessage({ source: "NEXUS_LEETHUB_PONG" }, "*");
  });

  /* ---- code reader, called on demand from the content script ---- */
  window.addEventListener("message", function (ev) {
    if (ev.source !== window || !ev.data || ev.data.source !== "NEXUS_LEETHUB_GET_CODE") return;
    var out = { source: "NEXUS_LEETHUB_CODE", code: "", lang: "" };
    try {
      var ms = (window.monaco && window.monaco.editor.getModels()) || [], best = null;
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i], l = m.getLanguageId();
        if (l === "plaintext" || l === "markdown") continue;
        if (!best || m.getValue().length > best.getValue().length) best = m;
      }
      if (best) { out.code = best.getValue(); out.lang = best.getLanguageId(); }
    } catch (e) {}
    window.postMessage(out, "*");
  });
})();

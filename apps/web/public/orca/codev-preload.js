(function () {
  var current;
  Object.defineProperty(window, "api", {
    configurable: true,
    get: function () {
      return current;
    },
    set: function (value) {
      current = value;
      try {
        if (value && value.starNag) {
          value.starNag.onShow = function () {
            return function () {};
          };
          value.starNag.onHide = function () {
            return function () {};
          };
        }
      } catch (_error) {
        // Branding is best-effort and must never block the IDE from booting.
      }
    },
  });

  try {
    var key = "orca.web.settings.v1";
    var mobileMarker = "codevMobileDefaultApplied";
    var chatMarker = "codevNativeChatDefaultApplied";
    var chatRevertMarker = "codevNativeChatDefaultReverted";
    var raw = window.localStorage.getItem(key);
    var settings = raw ? JSON.parse(raw) : {};
    var changed = false;
    if (settings && typeof settings === "object") {
      if (!settings[mobileMarker]) {
        settings.showMobileButton = false;
        settings[mobileMarker] = true;
        changed = true;
      }
      // Previously defaulted Orca's experimental Chat UI on for agent
      // panes, but its transcript rendering doesn't reliably work for
      // Codex (upstream only guards this for the grok agent) — a message
      // sends fine but the response never appears, even though the
      // underlying terminal session is working correctly. Revert once for
      // anyone who already got the broken default; never re-seed it.
      if (settings[chatMarker] && !settings[chatRevertMarker]) {
        delete settings.experimentalNativeChat;
        delete settings.openAgentTabsInChatByDefault;
        settings[chatRevertMarker] = true;
        changed = true;
      }
      if (changed) {
        window.localStorage.setItem(key, JSON.stringify(settings));
      }
    }
  } catch (_error) {
    // Browser-local preference seeding is best-effort.
  }
})();

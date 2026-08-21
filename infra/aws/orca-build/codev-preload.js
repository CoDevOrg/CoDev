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
    var chatMarker = "codevNativeChatDefaultV2Applied";
    var raw = window.localStorage.getItem(key);
    var settings = raw ? JSON.parse(raw) : {};
    var changed = false;
    if (settings && typeof settings === "object") {
      if (!settings[mobileMarker]) {
        settings.showMobileButton = false;
        settings[mobileMarker] = true;
        changed = true;
      }
      // Keep CoDev in the IDE and render agent tabs launched from + with the
      // native Codex/Claude chat surface. The versioned marker migrates users
      // who received the earlier rollback without overriding later choices.
      if (!settings[chatMarker]) {
        settings.experimentalNativeChat = true;
        settings.openAgentTabsInChatByDefault = true;
        settings[chatMarker] = true;
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

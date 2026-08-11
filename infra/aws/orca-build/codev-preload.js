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
    var marker = "codevMobileDefaultApplied";
    var raw = window.localStorage.getItem(key);
    var settings = raw ? JSON.parse(raw) : {};
    if (settings && typeof settings === "object" && !settings[marker]) {
      settings.showMobileButton = false;
      settings[marker] = true;
      window.localStorage.setItem(key, JSON.stringify(settings));
    }
  } catch (_error) {
    // Browser-local preference seeding is best-effort.
  }
})();

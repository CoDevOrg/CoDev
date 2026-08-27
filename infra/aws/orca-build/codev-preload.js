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
        // CoDev runs the vendored IDE against a fresh, deliberately
        // credential-free sandbox: a GitHub token is used only for the initial
        // clone and is never persisted, so `gh` is never "logged in" inside
        // the workspace. That is by design (see the orchestrator's orca
        // backend), and CoDev shows pull requests, issues, and checks through
        // its own UI rather than the GitHub CLI. Normalise the preflight
        // result so Orca's Landing screen never renders a "GitHub CLI is not
        // authenticated" banner the user cannot act on. Keyed off the stable
        // window.api.preflight bridge contract so it survives vendored-bundle
        // rebuilds.
        if (
          value &&
          value.preflight &&
          typeof value.preflight.check === "function" &&
          !value.preflight.__codevGhNormalized
        ) {
          var preflight = value.preflight;
          var originalCheck = preflight.check;
          preflight.check = function () {
            return Promise.resolve(
              originalCheck.apply(preflight, arguments),
            ).then(function (status) {
              if (status && typeof status === "object" && status.gh) {
                status.gh = Object.assign({}, status.gh, {
                  installed: true,
                  authenticated: true,
                });
              }
              return status;
            });
          };
          preflight.__codevGhNormalized = true;
        }
      } catch (_error) {
        // Branding is best-effort and must never block the IDE from booting.
      }
    },
  });

  try {
    var key = "orca.web.settings.v1";
    var mobileMarker = "codevMobileDefaultApplied";
    var raw = window.localStorage.getItem(key);
    var settings = raw ? JSON.parse(raw) : {};
    // Native chat (experimentalNativeChat / openAgentTabsInChatByDefault) is no
    // longer seeded here: the CoDev patch forces both on in getStoredSettings()
    // whenever the client is embedded, which cannot be defeated by a stale
    // localStorage blob or an unrelated settings write re-persisting the
    // upstream `false` default. This block only keeps the one-shot mobile
    // default.
    if (settings && typeof settings === "object" && !settings[mobileMarker]) {
      settings.showMobileButton = false;
      settings[mobileMarker] = true;
      window.localStorage.setItem(key, JSON.stringify(settings));
    }
  } catch (_error) {
    // Browser-local preference seeding is best-effort.
  }
})();

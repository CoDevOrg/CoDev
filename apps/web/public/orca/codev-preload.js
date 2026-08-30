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

        // One-time feature education — the "Tip" cards (e.g. the Cmd-J
        // worktree-jump palette) and the contextual tour overlays — is meant
        // to be shown once and then never again. Upstream Orca keeps the
        // "already seen" ids in UI state, but every CoDev workspace is a
        // separate `orca serve` runtime: on entry the client hydrates its UI
        // state from that workspace's own (usually empty) host store, and
        // hydratePersistedUI() *replaces* featureTipsSeenIds /
        // contextualToursSeenIds with whatever the host carried. A tip the
        // member dismissed in one workspace therefore reappears in the next,
        // and again on every re-entry. Keep a browser-global, authoritative
        // record of what this member has already dismissed and force it back
        // onto every ui.get() / ui.onStateChanged() payload (and capture new
        // dismissals from ui.set()), so each card is seen exactly once per
        // browser for good. Keyed off the stable window.api.ui bridge so it
        // survives vendored-bundle rebuilds.
        if (value && value.ui && !value.ui.__codevFeatureEducationPatched) {
          var uiBridge = value.ui;
          var seenKey = "codev.featureEducationSeen.v1";
          var seenFields = ["featureTipsSeenIds", "contextualToursSeenIds"];

          var loadSeen = function () {
            try {
              var parsed = JSON.parse(
                window.localStorage.getItem(seenKey) || "{}",
              );
              return parsed && typeof parsed === "object" ? parsed : {};
            } catch (_e) {
              return {};
            }
          };
          var rememberIds = function (field, ids) {
            if (!Array.isArray(ids) || ids.length === 0) {
              return;
            }
            var seen = loadSeen();
            var set = {};
            (seen[field] || []).forEach(function (id) {
              set[id] = true;
            });
            var changed = false;
            ids.forEach(function (id) {
              if (typeof id === "string" && !set[id]) {
                set[id] = true;
                changed = true;
              }
            });
            if (!changed) {
              return;
            }
            seen[field] = Object.keys(set);
            try {
              window.localStorage.setItem(seenKey, JSON.stringify(seen));
            } catch (_e) {
              // Browser-local preference seeding is best-effort.
            }
          };
          var applySeen = function (state) {
            if (!state || typeof state !== "object") {
              return state;
            }
            seenFields.forEach(function (field) {
              var incoming = Array.isArray(state[field]) ? state[field] : [];
              // Learn anything the host already knew, then union it back in.
              rememberIds(field, incoming);
              var merged = {};
              (loadSeen()[field] || []).concat(incoming).forEach(function (id) {
                if (typeof id === "string") {
                  merged[id] = true;
                }
              });
              state[field] = Object.keys(merged);
            });
            return state;
          };

          var originalUiGet = uiBridge.get;
          if (typeof originalUiGet === "function") {
            uiBridge.get = function () {
              return Promise.resolve(
                originalUiGet.apply(uiBridge, arguments),
              ).then(applySeen);
            };
          }

          var originalUiSet = uiBridge.set;
          if (typeof originalUiSet === "function") {
            uiBridge.set = function (patch) {
              if (patch && typeof patch === "object") {
                seenFields.forEach(function (field) {
                  rememberIds(field, patch[field]);
                });
              }
              return originalUiSet.apply(uiBridge, arguments);
            };
          }

          var originalUiOnStateChanged = uiBridge.onStateChanged;
          if (typeof originalUiOnStateChanged === "function") {
            uiBridge.onStateChanged = function (listener) {
              if (typeof listener !== "function") {
                return originalUiOnStateChanged.apply(uiBridge, arguments);
              }
              return originalUiOnStateChanged.call(uiBridge, function (state) {
                return listener(applySeen(state));
              });
            };
          }

          uiBridge.__codevFeatureEducationPatched = true;
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

    // Land members on the live-agents panel the first time, so the state of
    // the workspace is visible without opening anything. Marker-guarded and
    // one-shot: whatever they pick afterwards is theirs and is never
    // overwritten.
    var uiKey = "orca.web.ui.v1";
    var agentsMarker = "codevLiveAgentsDefaultApplied";
    var uiRaw = window.localStorage.getItem(uiKey);
    var ui = uiRaw ? JSON.parse(uiRaw) : {};
    if (ui && typeof ui === "object" && !ui[agentsMarker]) {
      ui.rightSidebarTab = "codev-agents";
      ui.rightSidebarOpen = true;
      ui[agentsMarker] = true;
      window.localStorage.setItem(uiKey, JSON.stringify(ui));
    }
  } catch (_error) {
    // Browser-local preference seeding is best-effort.
  }
})();

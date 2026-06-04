(function () {
  const STYLE_ID = "child-design-fix-style";
  const ACCOUNT_KEY = "ince_parent_account";
  const CHILD_SESSION_KEY = "ince_child_session";
  const BALANCE_CARD_BG_KEY_PREFIX = "ince_child_balance_card_bg:";
  const PULL_REFRESH_THRESHOLD = 76;
  const PULL_REFRESH_MAX_DISTANCE = 112;
  let pullRefreshStartY = 0;
  let pullRefreshDistance = 0;
  let isPullRefreshTracking = false;
  let isPullRefreshing = false;

  ensureStyles();
  scheduleUpgrade();
  watchAppRender();
  bindDelegatedActions();
  bindHomeBackgroundActions();
  bindPullToRefresh();
  bindLoginRedirectGuard();

  window.addEventListener("hashchange", scheduleUpgrade);
  window.addEventListener("ince:child-rendered", scheduleUpgrade);

  function bindDelegatedActions() {
    document.addEventListener("click", (event) => {
      const parentSwitchButton = event.target.closest("#child-parent-switch-trigger");
      if (parentSwitchButton) {
        if (typeof toggleChildParentSwitchMenu === "function") {
          toggleChildParentSwitchMenu();
        }
        return;
      }

      const parentSwitchAction = event.target.closest("#child-parent-switch-action");
      if (parentSwitchAction) {
        if (typeof closeChildParentSwitchMenu === "function") {
          closeChildParentSwitchMenu();
        }
        if (typeof showParentSwitchPasswordModal === "function") {
          showParentSwitchPasswordModal();
        }
        return;
      }

      const logoutButton = event.target.closest("#child-logout-button");
      if (logoutButton) {
        window.localStorage?.removeItem(CHILD_SESSION_KEY);
        location.hash = "/child/login";
        return;
      }

      const routeButton = event.target.closest("[data-route]");
      if (!routeButton) {
        return;
      }

      scheduleUpgrade();
      const route = routeButton.dataset.route;
      const childHistoryFilter = routeButton.dataset.childHistoryFilterTarget;
      if (childHistoryFilter && typeof state !== "undefined") {
        state.childHistoryFilter = childHistoryFilter;
      }
      if (route && location.hash !== `#${route}`) {
        goToRoute(route);
      }
    });
  }

  function bindHomeBackgroundActions() {
    document.addEventListener("click", (event) => {
      const backgroundButton = event.target.closest("[data-child-balance-bg-button]");
      if (backgroundButton) {
        event.stopPropagation();
        toggleBalanceBackgroundMenu();
        return;
      }

      const menuAction = event.target.closest("[data-child-balance-bg-action]");
      if (menuAction) {
        event.stopPropagation();
        const action = menuAction.dataset.childBalanceBgAction;
        handleBalanceBackgroundAction(action);
        return;
      }

      if (!event.target.closest(".child-card-bg-controls")) {
        closeBalanceBackgroundMenu();
      }
    });

    document.addEventListener("change", (event) => {
      const input = event.target.closest?.("[data-child-balance-bg-input]");
      if (!input) {
        return;
      }

      const file = input.files?.[0];
      if (!file) {
        return;
      }

      saveBalanceCardBackground(file);
    });
  }

  function bindPullToRefresh() {
    document.addEventListener(
      "touchstart",
      (event) => {
        const screen = event.target.closest?.(".child-design-home");
        if (!screen || location.hash.replace("#", "") !== "/child" || isPullRefreshing) {
          return;
        }

        if (screen.scrollTop > 0 || event.touches.length !== 1) {
          return;
        }

        pullRefreshStartY = event.touches[0].clientY;
        pullRefreshDistance = 0;
        isPullRefreshTracking = true;
      },
      { passive: true },
    );

    document.addEventListener(
      "touchmove",
      (event) => {
        if (!isPullRefreshTracking || isPullRefreshing || event.touches.length !== 1) {
          return;
        }

        const screen = document.querySelector(".child-design-home");
        if (!screen || screen.scrollTop > 0) {
          resetPullRefresh(screen);
          return;
        }

        const distance = Math.max(0, event.touches[0].clientY - pullRefreshStartY);
        if (distance <= 0) {
          return;
        }

        event.preventDefault();
        pullRefreshDistance = Math.min(PULL_REFRESH_MAX_DISTANCE, distance * 0.55);
        updatePullRefreshIndicator(screen, pullRefreshDistance);
      },
      { passive: false },
    );

    document.addEventListener(
      "touchend",
      () => {
        if (!isPullRefreshTracking) {
          return;
        }

        const screen = document.querySelector(".child-design-home");
        isPullRefreshTracking = false;
        if (!screen || pullRefreshDistance < PULL_REFRESH_THRESHOLD) {
          resetPullRefresh(screen);
          return;
        }

        runPullRefresh(screen);
      },
      { passive: true },
    );

    document.addEventListener(
      "touchcancel",
      () => {
        isPullRefreshTracking = false;
        resetPullRefresh(document.querySelector(".child-design-home"));
      },
      { passive: true },
    );
  }

  function updatePullRefreshIndicator(screen, distance) {
    if (!screen) {
      return;
    }

    const indicator = screen.querySelector("[data-child-pull-refresh]");
    const label = indicator?.querySelector("[data-child-pull-refresh-label]");
    const ready = distance >= PULL_REFRESH_THRESHOLD;
    screen.classList.add("is-pulling-refresh");
    screen.classList.toggle("is-pull-refresh-ready", ready);
    if (indicator) {
      indicator.style.height = `${Math.round(distance)}px`;
    }
    if (label) {
      label.textContent = ready ? "離して更新" : "下に引っ張って更新";
    }
  }

  function resetPullRefresh(screen) {
    pullRefreshDistance = 0;
    if (!screen) {
      return;
    }

    screen.classList.remove("is-pulling-refresh", "is-pull-refresh-ready", "is-refreshing");
    const indicator = screen.querySelector("[data-child-pull-refresh]");
    if (indicator) {
      indicator.style.removeProperty("height");
    }
    const label = screen.querySelector("[data-child-pull-refresh-label]");
    if (label) {
      label.textContent = "下に引っ張って更新";
    }
  }

  function runPullRefresh(screen) {
    if (!screen || isPullRefreshing) {
      return;
    }

    isPullRefreshing = true;
    screen.classList.add("is-pulling-refresh", "is-refreshing");
    screen.classList.remove("is-pull-refresh-ready");
    const indicator = screen.querySelector("[data-child-pull-refresh]");
    if (indicator) {
      indicator.style.height = "72px";
    }
    const label = screen.querySelector("[data-child-pull-refresh-label]");
    if (label) {
      label.textContent = "更新中";
    }

    const refreshPromise =
      typeof refreshChildAccountFromCloud === "function"
        ? refreshChildAccountFromCloud("/child")
        : Promise.resolve(false);

    Promise.resolve(refreshPromise)
      .finally(() => {
        isPullRefreshing = false;
        resetPullRefresh(document.querySelector(".child-design-home"));
        scheduleUpgrade();
      });
  }

  function toggleBalanceBackgroundMenu() {
    const menu = document.querySelector("[data-child-balance-bg-menu]");
    if (!menu) {
      return;
    }

    menu.hidden = !menu.hidden;
  }

  function closeBalanceBackgroundMenu() {
    const menu = document.querySelector("[data-child-balance-bg-menu]");
    if (menu) {
      menu.hidden = true;
    }
  }

  function handleBalanceBackgroundAction(action) {
    if (action === "reset") {
      resetBalanceCardBackground();
      closeBalanceBackgroundMenu();
      return;
    }

    const input = document.querySelector(`[data-child-balance-bg-input="${action}"]`);
    if (!input) {
      return;
    }

    input.value = "";
    closeBalanceBackgroundMenu();
    window.setTimeout(() => {
      input.click();
    }, 0);
  }

  function goToRoute(route) {
    if (typeof navigate === "function") {
      navigate(route);
    } else {
      location.hash = route;
    }

    window.setTimeout(() => ensureRouteRendered(route), 80);
  }

  function ensureRouteRendered(route) {
    const currentRoute = location.hash.replace("#", "") || "/";
    if (currentRoute !== route || !route.startsWith("/child/apply")) {
      return;
    }

    if (document.querySelector("#application-form")) {
      scheduleUpgrade();
      return;
    }

    if (typeof state !== "undefined" && typeof render === "function") {
      state.route = currentRoute;
      render();
      scheduleUpgrade();
    }
  }

  function bindLoginRedirectGuard() {
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-route="/demo-child-login"]')) {
        scheduleLoginRedirectGuard();
      }
    });

    document.addEventListener(
      "submit",
      (event) => {
        if (event.target?.id === "child-login-form") {
          scheduleLoginRedirectGuard();
        }
      },
      true,
    );
  }

  function scheduleLoginRedirectGuard() {
    window.setTimeout(reloadIfChildLoginIsStuck, 600);
    window.setTimeout(reloadIfChildLoginIsStuck, 1400);
  }

  function reloadIfChildLoginIsStuck() {
    const route = location.hash.replace("#", "") || "/";
    if (route === "/child" && document.querySelector("#child-login-form")) {
      location.reload();
    }
  }

  function scheduleUpgrade() {
    window.setTimeout(upgradeChildScreen, 0);
    window.setTimeout(upgradeChildScreen, 300);
    window.setTimeout(upgradeChildScreen, 900);
    window.setTimeout(upgradeChildScreen, 1600);
  }

  function watchAppRender() {
    const app = document.querySelector("#app");
    if (!app) {
      window.setTimeout(watchAppRender, 100);
      return;
    }

    new MutationObserver(() => {
      scheduleUpgrade();
    }).observe(app, { childList: true });
  }

  function upgradeChildScreen() {
    const route = location.hash.replace("#", "") || "/";
    if (!route.startsWith("/child") || route === "/child/login") {
      return;
    }

    const screen = document.querySelector("#app .screen");
    if (!screen) {
      return;
    }

    screen.classList.add("child-theme");

    if (route === "/child" || route === "/child/") {
      renderDesignedHome(screen);
      return;
    }

    if (route === "/child/apply" || route.startsWith("/child/apply/") || route.startsWith("/child/reapply/")) {
      upgradeApplyScreen(screen);
      return;
    }

    upgradeSubScreen(screen, route);
  }

  function renderDesignedHome(screen) {
    const child = getCurrentChildData();
    if (!child) {
      return;
    }

    const isBalanceBackgroundMenuOpen = screen.querySelector("[data-child-balance-bg-menu]")?.hidden === false;
    const applications = getApplications(child);
    const availablePoints = getAvailablePoints(child);
    const maxPointsPreview = isMaxPointsPreview();
    const displayedAvailablePoints = maxPointsPreview
      ? 999999
      : Math.min(999999, Math.max(0, Number(availablePoints) || 0));
    const isAvailablePointsCapped = maxPointsPreview || Number(availablePoints || 0) >= 999999;
    const monthlyEarned = getMonthlyEarned(child);
    const balanceBackground = getBalanceCardBackground(child);
    const balanceBackgroundStyle = balanceBackground
      ? ` style="--child-balance-bg-image: url('${escapeStyleUrl(balanceBackground)}')"`
      : "";
    const pendingApprovalPoints = applications
      .filter((application) => application.status === "pending")
      .reduce((total, application) => total + getApplicationPoints(application), 0);

    screen.className = "screen home-screen child-theme child-design-home";
    screen.innerHTML = `
      <header class="child-design-topbar">
        <div class="child-design-logo" aria-label="INCE">
          <img class="child-design-logo-image" src="./logo.svg?v=phase201" alt="INCE" />
        </div>
        <div class="child-design-profile-wrap">
          <button class="child-design-profile" type="button" id="child-parent-switch-trigger" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeText(child.nickname || "タロー")}">
            ${childDesignProfileAvatar(child)}
            <strong>${escapeText(child.nickname || "タロー")}</strong>
          </button>
          <div class="child-parent-switch-menu" id="child-parent-switch-menu" role="menu" hidden>
            <button type="button" role="menuitem" id="child-parent-switch-action">保護者アカウントに切り替える</button>
          </div>
        </div>
      </header>
      <div class="child-pull-refresh" data-child-pull-refresh aria-hidden="true">
        <span class="child-pull-refresh-icon" aria-hidden="true">${lucideIcon("refresh-cw", "child-pull-refresh-svg")}</span>
        <strong data-child-pull-refresh-label>下に引っ張って更新</strong>
      </div>

      <section class="child-balance-card ${balanceBackground ? "has-custom-bg" : ""}"${balanceBackgroundStyle}>
        <div class="child-balance-copy">
          <span>${escapeText(child.nickname || "タロー")}のポイント</span>
          <strong><span class="child-balance-number ${isAvailablePointsCapped ? "is-capped" : ""}">${displayedAvailablePoints.toLocaleString()}</span><small>ポイント</small></strong>
        </div>
        <button class="child-exchange-button" type="button" data-route="/child/redeem">交換する</button>
        <div class="child-balance-metrics">
          <div>
            <span>今月の獲得</span>
            <strong>${monthlyEarned.toLocaleString()} <small>ポイント</small></strong>
          </div>
          <button class="child-balance-metric-button" type="button" data-route="/child/history" data-child-history-filter-target="pending">
            <span>承認待ち</span>
            <strong>${pendingApprovalPoints.toLocaleString()} <small>ポイント</small></strong>
          </button>
        </div>
      </section>
      <div class="child-card-bg-controls">
        <button class="child-card-bg-text-button" type="button" data-child-balance-bg-button>カードの背景を変更する</button>
        <div class="child-card-bg-menu" data-child-balance-bg-menu ${isBalanceBackgroundMenuOpen ? "" : "hidden"}>
          <button type="button" data-child-balance-bg-action="camera">写真を撮る</button>
          <button type="button" data-child-balance-bg-action="library">写真から選択</button>
          <button type="button" data-child-balance-bg-action="reset">デフォルトに戻す</button>
        </div>
      </div>
      <input class="child-card-bg-input" type="file" accept="image/*" capture="environment" data-child-balance-bg-input="camera" aria-hidden="true" tabindex="-1" />
      <input class="child-card-bg-input" type="file" accept="image/*" data-child-balance-bg-input="library" aria-hidden="true" tabindex="-1" />

      <section class="child-home-points-section">
        <div class="child-section-heading">
          <h2>ポイント履歴</h2>
        </div>
        ${homePointHistoryList(child)}
      </section>

      ${bottomNav("home")}
    `;
  }

  function upgradeSubScreen(screen, route) {
    upgradeHeader(screen);
    upgradeBottomNav(screen, route);
    screen.querySelector(".page-heading")?.classList.add("child-page-heading");
    screen.querySelectorAll(".application-card").forEach((card) => card.classList.add("child-history-card"));
  }

  function upgradeApplyScreen(screen) {
    const route = location.hash.replace("#", "") || "/";
    const title = route.startsWith("/child/reapply/")
      ? "再申請"
      : route.startsWith("/child/apply/")
        ? "編集"
        : "新規登録";
    screen.classList.add("child-apply-design");
    upgradeHeader(screen);
    removeBottomNav(screen);

    const pageHeading = screen.querySelector(".page-heading");
    if (pageHeading && !screen.querySelector(".child-apply-hero")) {
      pageHeading.classList.add("child-apply-hero");
      pageHeading.innerHTML = `
        <button class="child-back-button" type="button" data-route="/child" aria-label="ホームへ戻る">${lucideIcon("chevron-left", "child-back-icon")}</button>
        <div>
          <h1>${title}</h1>
        </div>
      `;
    }

    const heroTitle = pageHeading?.querySelector("h1");
    if (heroTitle) {
      heroTitle.textContent = title;
    }

    const form = screen.querySelector("#application-form");
    if (!form) {
      return;
    }

    form.classList.add("child-apply-card");
    form.querySelector(".child-form-intro")?.remove();
    decorateCategoryField(form);
    decorateFullScoreField(form);
    decoratePhotoField(form);
    decorateSubmitArea(form);

    const subjectLabel = form.querySelector('label[for="application-subject"]');
    if (subjectLabel) {
      subjectLabel.textContent = "教科";
    }

    const fullScoreLabel = form.querySelector('label[for="test-full-score"]');
    if (fullScoreLabel) {
      fullScoreLabel.textContent = "テストの満点";
    }

    const commentLabel = form.querySelector('label[for="child-comment"]');
    if (commentLabel) {
      commentLabel.textContent = "アピールポイント";
    }

    const comment = form.querySelector("#child-comment");
    if (comment) {
      comment.placeholder = "がんばったところ、見てほしいところを書いてね";
    }

  }

  function decorateCategoryField(form) {
    const categoryField = form.querySelector("#application-category")?.closest(".field");
    if (!categoryField) {
      return;
    }

    const categoryLabel = categoryField.querySelector('label[for="application-category"]');
    if (categoryLabel) {
      categoryLabel.textContent = "カテゴリー";
    }

    if (categoryField.querySelector(".child-category-options")) {
      return;
    }

    categoryField.classList.add("child-category-field");
    const select = categoryField.querySelector("#application-category");
    const options = [
      ["test", "テスト"],
      ["grade", "成績表"],
      ["other", "その他"],
    ];
    const optionWrap = document.createElement("div");
    optionWrap.className = "child-category-options";
    optionWrap.innerHTML = options
      .map(
        ([value, label]) => `
          <button class="child-category-option ${select.value === value ? "active" : ""}" type="button" data-category-value="${value}">
            <span>${escapeText(label)}</span>
          </button>
        `,
      )
      .join("");
    categoryField.appendChild(optionWrap);

    optionWrap.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category-value]");
      if (!button) {
        return;
      }

      select.value = button.dataset.categoryValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      optionWrap.querySelectorAll(".child-category-option").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  }

  function decorateFullScoreField(form) {
    const scoreField = form.querySelector("#test-full-score")?.closest(".field");
    if (!scoreField) {
      return;
    }

    const scoreLabel = scoreField.querySelector('label[for="test-full-score"]');
    if (scoreLabel) {
      scoreLabel.textContent = "テストの満点";
    }

    if (scoreField.querySelector(".child-score-options")) {
      return;
    }

    scoreField.classList.add("child-score-field");
    const select = scoreField.querySelector("#test-full-score");
    const options = [
      ["100", "100点満点"],
      ["50", "50点満点"],
    ];
    const optionWrap = document.createElement("div");
    optionWrap.className = "child-score-options";
    optionWrap.innerHTML = options
      .map(
        ([value, label]) => `
          <button class="child-category-option ${select.value === value ? "active" : ""}" type="button" data-score-value="${value}">
            <span>${escapeText(label)}</span>
          </button>
        `,
      )
      .join("");
    scoreField.appendChild(optionWrap);

    optionWrap.addEventListener("click", (event) => {
      const button = event.target.closest("[data-score-value]");
      if (!button) {
        return;
      }

      select.value = button.dataset.scoreValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      optionWrap.querySelectorAll(".child-category-option").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  }

  function decoratePhotoField(form) {
    const photoInput = form.querySelector("#application-photos");
    const photoField = photoInput?.closest(".field");
    if (!photoField) {
      return;
    }

    photoField.querySelector("#photo-help")?.remove();
    if (photoField.querySelector(".child-photo-drop")) {
      return;
    }

    photoField.classList.add("child-photo-field");
    photoInput.classList.add("child-photo-hidden-input");
    photoInput.dataset.childPhotoInput = "library";
    photoInput.setAttribute("accept", "image/*");
    photoInput.setAttribute("multiple", "");

    const cameraInput = document.createElement("input");
    cameraInput.className = "child-photo-hidden-input";
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.dataset.childPhotoInput = "camera";
    cameraInput.setAttribute("aria-hidden", "true");
    cameraInput.tabIndex = -1;

    const drop = document.createElement("button");
    drop.className = "child-photo-drop";
    drop.type = "button";
    drop.setAttribute("aria-label", "写真を選択");
    drop.innerHTML = `
      <span class="child-photo-lucide-icon" aria-hidden="true">${lucideIcon("camera", "child-photo-svg")}</span>
    `;
    photoInput.insertAdjacentElement("afterend", drop);

    const feedback = document.createElement("span");
    feedback.className = "child-photo-feedback";
    feedback.setAttribute("aria-live", "polite");
    drop.insertAdjacentElement("afterend", feedback);

    const preview = document.createElement("div");
    preview.className = "child-photo-preview";
    preview.setAttribute("aria-label", "選択した写真");
    feedback.insertAdjacentElement("afterend", preview);

    const menu = document.createElement("div");
    menu.className = "child-photo-menu";
    menu.setAttribute("data-child-photo-menu", "");
    menu.hidden = true;
    menu.innerHTML = `
      <label class="child-photo-menu-action" data-child-photo-action="camera">
        <span>写真を撮る</span>
      </label>
      <label class="child-photo-menu-action" data-child-photo-action="library">
        <span>写真から選択</span>
      </label>
    `;
    preview.insertAdjacentElement("afterend", menu);
    menu.querySelector('[data-child-photo-action="camera"]')?.appendChild(cameraInput);
    menu.querySelector('[data-child-photo-action="library"]')?.appendChild(photoInput);

    const routeApplication = getRouteApplication();
    window.__studyPayExistingPhotos = [...(routeApplication?.photos || [])];
    window.__studyPayExistingPhotoNames = [...(routeApplication?.photoNames || [])];
    window.__studyPaySelectedPhotoFiles = [];
    photoInput._studyPayExistingPhotos = window.__studyPayExistingPhotos;
    photoInput._studyPayExistingPhotoNames = window.__studyPayExistingPhotoNames;
    photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;
    renderPhotoPreviewState(preview, feedback, photoInput, drop);

    const togglePhotoMenu = () => {
      menu.hidden = !menu.hidden;
    };
    const closePhotoMenu = () => {
      menu.hidden = true;
    };
    const closePhotoMenuAfterPickerOpen = () => {
      window.setTimeout(closePhotoMenu, 300);
    };
    const handleInputChange = async (input) => {
      const incomingFiles = Array.from(input.files || []);
      if (!incomingFiles.length) {
        await renderPhotoPreviewState(preview, feedback, photoInput, drop);
        return;
      }

      const existingCount = getExistingPhotos().length;
      window.__studyPaySelectedPhotoFiles = [...(window.__studyPaySelectedPhotoFiles || []), ...incomingFiles].slice(
        0,
        Math.max(0, 3 - existingCount),
      );
      photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;
      input.value = "";
      closePhotoMenu();
      await renderPhotoPreviewState(preview, feedback, photoInput, drop);
    };

    drop.addEventListener("click", (event) => {
      event.preventDefault();
      togglePhotoMenu();
    });

    document.addEventListener("click", (event) => {
      if (!photoField.contains(event.target)) {
        closePhotoMenu();
      }
    });

    photoInput.addEventListener("change", () => handleInputChange(photoInput));
    cameraInput.addEventListener("change", () => handleInputChange(cameraInput));
    photoInput.addEventListener("click", closePhotoMenuAfterPickerOpen);
    cameraInput.addEventListener("click", closePhotoMenuAfterPickerOpen);

    preview.addEventListener("click", async (event) => {
      const openButton = event.target.closest("[data-child-photo-open]");
      if (openButton) {
        event.preventDefault();
        togglePhotoMenu();
        return;
      }

      const button = event.target.closest(".child-photo-remove-button");
      if (!button) {
        return;
      }

      const index = Number(button.dataset.photoIndex);
      if (button.dataset.photoType === "existing") {
        window.__studyPayExistingPhotos = (window.__studyPayExistingPhotos || []).filter((_, itemIndex) => itemIndex !== index);
        window.__studyPayExistingPhotoNames = (window.__studyPayExistingPhotoNames || []).filter((_, itemIndex) => itemIndex !== index);
        photoInput._studyPayExistingPhotos = window.__studyPayExistingPhotos;
        photoInput._studyPayExistingPhotoNames = window.__studyPayExistingPhotoNames;
      } else {
        window.__studyPaySelectedPhotoFiles = (window.__studyPaySelectedPhotoFiles || []).filter((_, itemIndex) => itemIndex !== index);
        photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;
      }

      await renderPhotoPreviewState(preview, feedback, photoInput, drop);
    });
  }

  async function renderPhotoPreviewState(preview, feedback, photoInput, drop) {
    const existingPhotos = getExistingPhotos().map((photo, index) => ({ ...photo, photoType: "existing", sourceIndex: index }));
    const selectedPhotos = await readPreviewFiles(window.__studyPaySelectedPhotoFiles || photoInput._studyPayFiles || []);
    const photos = [...existingPhotos, ...selectedPhotos].slice(0, 3);
    const totalCount = photos.length;
    feedback.textContent = "";
    renderPhotoPreview(preview, photos, totalCount < 3, photoInput, drop);
  }

  function getExistingPhotos() {
    return Array.isArray(window.__studyPayExistingPhotos) ? window.__studyPayExistingPhotos : getRouteApplication()?.photos || [];
  }

  function getRouteApplication() {
    const route = location.hash.replace("#", "") || "/";
    const isEditRoute = route.startsWith("/child/apply/") || route.startsWith("/child/reapply/");
    if (!isEditRoute) {
      return null;
    }

    const applicationId = route.split("/").at(-1);
    const child = getCurrentChildData();
    return (child?.applications || []).find((application) => application.id === applicationId) || null;
  }

  function readPreviewFiles(fileList) {
    return Promise.all(
      Array.from(fileList)
        .slice(0, 3)
        .map(
          (file) =>
            new Promise((resolve) => {
              if (typeof window.studyPayCreateApplicationPhotoFromFile === "function") {
                window.studyPayCreateApplicationPhotoFromFile(file).then(resolve).catch(() => resolve(null));
                return;
              }

              const reader = new FileReader();
              reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result || "") });
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(file);
            }),
        ),
    ).then((photos) => photos.filter(Boolean).map((photo, index) => ({ ...photo, photoType: "selected", sourceIndex: index })));
  }

  function renderPhotoPreview(preview, photos, canAddMore = false, photoInput = null, drop = null) {
    preview.innerHTML = photos
      .slice(0, 3)
      .map(
        (photo) => `
          <span class="child-photo-preview-item">
            <img src="${escapeText(photo.dataUrl)}" alt="${escapeText(photo.name || "選択した写真")}" />
            <button class="child-photo-remove-button" type="button" data-photo-type="${escapeText(photo.photoType || "selected")}" data-photo-index="${Number(photo.sourceIndex || 0)}" aria-label="写真を削除">×</button>
          </span>
        `,
      )
      .join("");

    drop?.classList.toggle("is-hidden", photos.length > 0);

    if (canAddMore && photos.length > 0) {
      preview.insertAdjacentHTML(
        "beforeend",
        `
          <button class="child-photo-preview-add" type="button" data-child-photo-open aria-label="写真を追加">
            ${lucideIcon("camera", "child-photo-preview-add-icon")}
          </button>
        `,
      );
    }
  }

  function decorateSubmitArea(form) {
    const submit = form.querySelector('button[type="submit"]');
    const cancel = Array.from(form.querySelectorAll("button")).find((button) => button.textContent.includes("キャンセル"));
    const deleteButton = form.querySelector("#delete-application-from-edit");
    if (!submit) {
      return;
    }

    const route = location.hash.replace("#", "") || "/";
    submit.textContent = route.startsWith("/child/apply/") ? "変更を保存" : "送信";
    if (form.querySelector(".child-submit-note")) {
      return;
    }

    submit.classList.add("child-submit-button");
    cancel?.classList.add("child-cancel-button");
    deleteButton?.classList.add("child-delete-button");
  }

  function upgradeHeader(screen) {
    const topbar = screen.querySelector(".topbar");
    if (!topbar) {
      return;
    }

    topbar.classList.add("child-topbar");
    topbar.querySelector(".brand-mark")?.classList.add("child-brand-mark");
    const brandLabel = topbar.querySelector(".brand span:last-child");
    if (brandLabel) {
      brandLabel.textContent = "INCE";
    }
  }

  function upgradeBottomNav(screen, route) {
    const nav = screen.querySelector('nav[aria-label="こどもメニュー"], .bottom-nav');
    if (!nav) {
      return;
    }

    nav.outerHTML = bottomNav(route === "/child/history" ? "history" : route === "/child/apply" ? "apply" : "settings");
  }

  function removeBottomNav(screen) {
    screen.querySelector('nav[aria-label="こどもメニュー"], .bottom-nav')?.remove();
  }

  function bottomNav(active) {
    const items = [
      ["home", "credit-card", "ホーム", "/child"],
      ["apply", "plus", "", "/child/apply"],
      ["history", "history", "りれき", "/child/history"],
    ];

    return `
      <nav class="child-design-nav" aria-label="こどもメニュー">
        ${items
          .map(
            ([key, icon, label, path]) => `
              <button class="child-design-nav-item ${key === "apply" ? "primary" : ""} ${active === key ? "active" : ""}" type="button" data-route="${path}" aria-label="${label || "申請"}">
                ${lucideIcon(icon, "nav-symbol")}
              </button>
            `,
          )
          .join("")}
      </nav>
    `;
  }

  function recentCard(application) {
    const pointStatus = applicationPointStatus(application.status);
    const scoreLabel = applicationScoreLabel(application);
    const canEdit = !isApprovedApplicationStatus(application.status);
    return `
      <div class="card application-card child-history-card child-home-history-card">
        <div class="child-history-content">
          ${homeApplicationMediaPreview(application)}
          <div class="child-history-main">
            <h2>${escapeText(applicationTitle(application))}</h2>
            <span class="child-history-date">${escapeText(formatActivityTime(application.submittedAt))}</span>
            <div class="child-activity-meta">
              ${applicationCategoryChip(application)}
            </div>
            ${application.parentComment ? `<p class="child-parent-comment ${isRedoApplicationStatus(application.status) ? "is-redo" : ""}">${escapeText(application.parentComment)}</p>` : ""}
          </div>
          <div class="child-history-side">
            <strong class="child-history-points ${pointStatus.className}">
              ${lucideIcon(pointStatus.icon, "child-history-point-icon")}
              <span>${applicationPointLabel(application)}</span>
            </strong>
            ${scoreLabel ? `<span class="child-history-score">${scoreLabel}</span>` : ""}
            ${
              canEdit
                ? `<button class="child-history-edit-button" type="button" data-route="/child/apply/${escapeText(application.id)}" aria-label="申請を編集">${lucideIcon("square-pen", "child-history-edit-icon")}</button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  function emptyRecentCard() {
    return `
      <button class="child-recent-card" type="button" data-route="/child/apply">
        <span class="child-thumb thumb-0" aria-hidden="true"></span>
        <span class="child-recent-main">
          <strong>最初の申請をしよう</strong>
          <span><em>その他</em> 今日</span>
        </span>
        <span class="child-recent-side">
          <span class="child-status pending">確認中</span>
          <strong>+0 pts</strong>
        </span>
      </button>
    `;
  }

  function homePointHistoryList(child) {
    const transactions = getPointTransactions(child).slice(0, 5);
    return `
      <div class="application-list section-tight child-home-point-history-list">
        ${
          transactions.length
            ? transactions.map(homePointHistoryCard).join("")
            : `<div class="card empty-state"><strong>ポイント履歴はまだありません</strong><p>申請が承認されるとここに表示されます。</p></div>`
        }
      </div>
    `;
  }

  function homePointHistoryCard(transaction) {
    const points = Number(transaction.points || 0);
    const positive = points >= 0;
    const tone = pointTransactionTone(transaction);
    return `
      <div class="card application-card point-history-card child-home-point-history-card">
        <div class="child-home-point-history-main">
          <h3 class="child-home-point-history-title">${escapeText(transaction.note || "ポイント履歴")}</h3>
          <time class="child-home-point-history-date">${escapeText(formatDateTime(transaction.createdAt))}</time>
        </div>
        <strong class="child-home-point-history-points ${tone}">${positive ? "+" : ""}${points.toLocaleString()}pt</strong>
        <span class="status-pill child-home-point-history-tag ${tone}">${escapeText(pointTransactionLabel(transaction.type))}</span>
      </div>
    `;
  }

  function getPointTransactions(child) {
    return [...(child.pointTransactions || [])].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
  }

  function pointTransactionLabel(type) {
    const labels = {
      grant: "ポイント付与",
      redemption: "おこづかい支給",
      cancel_redemption: "支給取消",
      cancel_grant: "承認取消",
      adjustment: "調整",
      monthly_bonus: "ボーナス",
      cancel_monthly_bonus: "ボーナス取消",
    };
    return labels[type] || "ポイント";
  }

  function pointTransactionTone(transaction) {
    if (transaction.status === "pending" || transaction.type === "pending") {
      return "is-pending";
    }

    if (transaction.type === "redemption" || Number(transaction.points || 0) < 0) {
      return "is-redemption";
    }

    return "is-grant";
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hours}時${minutes}分`;
  }

  function getCurrentChildData() {
    try {
      const account = JSON.parse(window.localStorage?.getItem(ACCOUNT_KEY) || "null");
      const session = getChildSessionData();
      const child = (account?.children || []).find((item) => item.id === session?.childId && item.status !== "deleted") || null;
      if (!isChildSessionDataValid(child, session)) {
        window.localStorage?.removeItem(CHILD_SESSION_KEY);
        return null;
      }
      return child;
    } catch {
      return null;
    }
  }

  function getChildSessionData() {
    const rawSession = window.localStorage?.getItem(CHILD_SESSION_KEY);
    if (!rawSession) {
      return null;
    }

    try {
      const session = JSON.parse(rawSession);
      if (session && typeof session === "object" && session.childId) {
        return {
          childId: session.childId,
          passwordUpdatedAt: session.passwordUpdatedAt || null,
          legacy: false,
        };
      }
    } catch {
      // 旧形式はこどもIDだけを保存していたため、そのまま互換対応する。
    }

    return {
      childId: rawSession,
      passwordUpdatedAt: null,
      legacy: true,
    };
  }

  function isChildSessionDataValid(child, session) {
    if (!child || !session) {
      return false;
    }

    const passwordUpdatedAt = child.passwordUpdatedAt || null;
    if (session.legacy) {
      return !passwordUpdatedAt;
    }

    return session.passwordUpdatedAt === passwordUpdatedAt;
  }

  function getApplications(child) {
    return [...(child.applications || [])]
      .filter((application) => application.status !== "deleted")
      .sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());
  }

  function getAvailablePoints(child) {
    const pendingRedemptions = (child.redemptions || [])
      .filter((redemption) => redemption.status === "pending")
      .reduce((total, redemption) => total + Number(redemption.points || 0), 0);
    return Math.max(0, Number(child.currentPoints || 0) - pendingRedemptions);
  }

  function getMonthlyEarned(child) {
    const now = new Date();
    return (child.pointTransactions || [])
      .filter((transaction) => {
        const date = new Date(transaction.createdAt || 0);
        return (
          Number(transaction.points || 0) > 0 &&
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth()
        );
      })
      .reduce((total, transaction) => total + Number(transaction.points || 0), 0);
  }

  function getApplicationPoints(application) {
    return Number(application.fixedPoints ?? application.suggestedPoints ?? application.requestedPoints ?? 0);
  }

  function isMaxPointsPreview() {
    return new URLSearchParams(location.search).get("previewMaxPoints") === "1";
  }

  function saveBalanceCardBackground(file) {
    if (!file.type.startsWith("image/")) {
      alert("画像ファイルを選択してください。");
      return;
    }

    resizeBackgroundImage(file)
      .then((dataUrl) => {
        const child = getCurrentChildData();
        if (!child) {
          return;
        }

        setBalanceCardBackground(child, dataUrl);
        scheduleUpgrade();
      })
      .catch(() => {
        alert("画像を読み込めませんでした。別の画像を選択してください。");
      });
  }

  function resizeBackgroundImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const maxWidth = 1200;
          const maxHeight = 800;
          const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.84));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function getBalanceCardBackground(child) {
    const key = getBalanceCardBackgroundKey(child);
    return window.localStorage?.getItem(key) || getBalanceCardBackgroundStore()[key] || "";
  }

  function getBalanceCardBackgroundKey(child) {
    return `${BALANCE_CARD_BG_KEY_PREFIX}${child.id || child.loginId || "default"}`;
  }

  function setBalanceCardBackground(child, dataUrl) {
    const key = getBalanceCardBackgroundKey(child);
    getBalanceCardBackgroundStore()[key] = dataUrl;
    try {
      window.localStorage?.setItem(key, dataUrl);
    } catch (error) {
      // 画像が大きい端末でも、少なくとも現在の画面では反映できるようにする。
    }
  }

  function resetBalanceCardBackground() {
    const child = getCurrentChildData();
    if (!child) {
      return;
    }

    const key = getBalanceCardBackgroundKey(child);
    delete getBalanceCardBackgroundStore()[key];
    try {
      window.localStorage?.removeItem(key);
    } catch (error) {
      // 保存領域に触れない環境でも、画面上の背景だけは戻せるようにする。
    }
    scheduleUpgrade();
  }

  function getBalanceCardBackgroundStore() {
    window.__studyPayBalanceCardBackgrounds = window.__studyPayBalanceCardBackgrounds || {};
    return window.__studyPayBalanceCardBackgrounds;
  }

  function applicationPointLabel(application) {
    const points = application.fixedPoints ?? application.suggestedPoints;
    return points == null ? "おまかせ" : `${Number(points).toLocaleString()}pt`;
  }

  function applicationPointStatus(status) {
    if (status === "approved" || status === "approval_canceled") {
      return { className: "is-approved", icon: "circle-check" };
    }

    if (isRedoApplicationStatus(status)) {
      return { className: "is-redo", icon: "circle-alert" };
    }

    return { className: "is-pending", icon: "clock" };
  }

  function isRedoApplicationStatus(status) {
    return ["returned", "rejected", "canceled"].includes(status);
  }

  function isApprovedApplicationStatus(status) {
    return status === "approved";
  }

  function applicationScoreLabel(application) {
    if (application.category !== "test" || application.score == null || application.score === "") {
      return "";
    }

    const fullScore = Number(application.testFullScore) === 50 ? 50 : 100;
    return `${Number(application.score).toLocaleString()} / ${fullScore}`;
  }

  function homeApplicationMediaPreview(application) {
    const firstPhoto = application.photos?.[0];
    if (firstPhoto?.dataUrl) {
      return `<span class="child-activity-thumb"><img src="${escapeText(firstPhoto.dataUrl)}" alt="${escapeText(firstPhoto.name || "申請写真")}" /></span>`;
    }

    return `<div class="child-activity-thumb child-activity-placeholder" aria-hidden="true">${categoryIcon(application.category)}</div>`;
  }

  function applicationCategoryChip(application) {
    return `<span class="category-chip ${escapeText(application.category)}">${escapeText(categoryLabel(application.category))}</span>`;
  }

  function categoryIcon(category) {
    if (category === "test") {
      return "T";
    }

    if (category === "grade") {
      return "G";
    }

    return "O";
  }

  function applicationTitle(application) {
    if (application.category === "test") {
      return `${application.subjectName || "算数"}のテスト`;
    }

    if (application.category === "grade") {
      return `${application.subjectName || "1学期"}のあゆみ`;
    }

    return application.otherContent || "部屋のそうじ";
  }

  function categoryLabel(category) {
    const labels = {
      test: "テスト",
      grade: "成績表",
      other: "その他",
    };
    return labels[category] || "その他";
  }

  function statusInfo(status) {
    const labels = {
      pending: { label: "確認中", className: "pending", icon: "" },
      approved: { label: "完了", className: "done", icon: "○ " },
      returned: { label: "やり直し", className: "redo", icon: "ⓘ " },
      rejected: { label: "やり直し", className: "redo", icon: "ⓘ " },
      canceled: { label: "やり直し", className: "redo", icon: "ⓘ " },
    };
    return labels[status] || labels.pending;
  }

  function formatActivityTime(value) {
    if (!value) {
      return "今日";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "今日";
    }

    const now = new Date();
    const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) {
      return `今日 ${time}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `昨日 ${time}`;
    }

    return `${date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} ${time}`;
  }

  function escapeText(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeStyleUrl(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function childDesignProfileAvatar(child) {
    const photo = child?.profilePhoto?.dataUrl;
    return `
      <span class="child-design-profile-avatar ${photo ? "has-photo" : ""}">
        ${
          photo
            ? `<img src="${escapeText(photo)}" alt="${escapeText(child?.profilePhoto?.name || `${child?.nickname || "こども"}のプロフィール写真`)}" />`
            : lucideIcon("circle-user-round", "child-profile-icon")
        }
      </span>
    `;
  }

  function lucideIcon(name, className = "") {
    return window.INCEIcons?.icon(name, className) || "";
  }

  function ensureStyles() {
    if (document.querySelector(`#${STYLE_ID}`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html,
      body {
        background: #fff;
      }

      .phone-shell,
      .app {
        background: #fffbf7;
      }

      .child-design-home {
        min-height: 100dvh;
        padding: 0 20px 118px;
        background: linear-gradient(180deg, #fff 0, #fff calc(72px + env(safe-area-inset-top)), #fff8f1 calc(72px + env(safe-area-inset-top)), #fffaf6 100%);
        color: #16120e;
      }

      .child-design-topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: calc(72px + env(safe-area-inset-top));
        margin: 0 -20px 26px;
        border-bottom: 1px solid #f1e5dc;
        background: #fff;
        padding: env(safe-area-inset-top) 22px 0;
        box-shadow: 0 8px 18px rgba(60, 42, 24, 0.04);
      }

      .child-design-logo,
      .child-design-profile {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border: 0;
        background: transparent;
        color: #111;
        padding: 0;
        font-size: 20px;
        font-weight: 900;
        letter-spacing: 0;
      }

      .child-design-logo > span:last-child span {
        color: #ff8200;
      }

      .child-pull-refresh {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 0;
        margin: -18px 0 18px;
        overflow: hidden;
        color: #9a6500;
        font-size: 13px;
        font-weight: 900;
        opacity: 0;
        transform: translateY(-8px);
        transition:
          height 0.18s ease,
          opacity 0.18s ease,
          transform 0.18s ease;
      }

      .child-design-home.is-pulling-refresh .child-pull-refresh {
        opacity: 1;
        transform: translateY(0);
      }

      .child-design-home.is-pull-refresh-ready .child-pull-refresh {
        color: #ff8200;
      }

      .child-pull-refresh-icon {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: #fff4e6;
      }

      .child-pull-refresh-svg {
        width: 16px;
        height: 16px;
      }

      .child-design-home.is-refreshing .child-pull-refresh-svg {
        animation: child-refresh-spin 0.8s linear infinite;
      }

      @keyframes child-refresh-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .child-design-profile-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      .child-design-profile-avatar {
        display: grid;
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
        place-items: center;
        border-radius: 50%;
        color: #9a5b00;
        overflow: hidden;
      }

      .child-design-profile-avatar img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .child-design-logo-image {
        display: block;
        width: auto;
        height: 48px;
        object-fit: contain;
      }

      .child-design-logo-icon {
        position: relative;
        width: 31px;
        height: 25px;
        border-radius: 5px 5px 3px 3px;
        background: linear-gradient(90deg, #ff7b00 0 48%, #ffd0a4 48% 52%, #ffab56 52%);
      }

      .child-design-logo-icon::before,
      .child-design-logo-icon::after {
        content: "";
        position: absolute;
        background: #ff7b00;
      }

      .child-design-logo-icon::before {
        top: -7px;
        left: 6px;
        width: 3px;
        height: 6px;
        border-radius: 99px;
        box-shadow: 8px -3px 0 #ff7b00, 17px 0 0 #ff7b00;
      }

      .child-design-logo-icon::after {
        right: -4px;
        bottom: 4px;
        width: 10px;
        height: 13px;
        border-radius: 0 10px 10px 0;
        background: #ff7b00;
      }

      .child-profile-icon {
        width: 30px;
        height: 30px;
        color: #9a5b00;
        stroke-width: 2.4;
      }

      .child-balance-card {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px 14px;
        margin-bottom: 36px;
        border-radius: 24px;
        background: #ff920d;
        color: #fff;
        overflow: hidden;
        padding: 28px 24px 24px;
        box-shadow: 0 12px 22px rgba(255, 130, 0, 0.16);
      }

      .child-balance-card::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #ff8200 0%, #ffb344 100%);
      }

      .child-balance-card.has-custom-bg::before {
        background:
          linear-gradient(rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.28)),
          var(--child-balance-bg-image) center / cover no-repeat;
      }

      .child-balance-card > * {
        position: relative;
        z-index: 1;
      }

      .child-balance-copy {
        display: grid;
        gap: 12px;
        min-width: 0;
      }

      .child-balance-copy > span {
        font-size: 18px;
        font-weight: 800;
      }

      .child-balance-copy strong {
        display: flex;
        align-items: baseline;
        flex-wrap: nowrap;
        gap: 6px;
        font-size: 42px;
        line-height: 1;
        letter-spacing: 0;
        white-space: nowrap;
      }

      .child-balance-number {
        position: relative;
        display: inline-block;
      }

      .child-balance-number.is-capped::after {
        content: "+";
        position: absolute;
        top: -9px;
        right: -15px;
        font-size: 18px;
        font-weight: 900;
        line-height: 1;
      }

      .child-balance-copy small {
        font-size: 14px;
        font-weight: 800;
      }

      .child-exchange-button {
        align-self: center;
        min-height: 54px;
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
        padding: 0 24px;
        font-size: 18px;
        font-weight: 900;
      }

      .child-card-bg-text-button {
        display: block;
        width: fit-content;
        min-height: 30px;
        border: 0;
        background: transparent;
        color: #9b7a5e;
        padding: 0;
        font-size: 11px;
        font-weight: 600;
      }

      .child-card-bg-controls {
        position: relative;
        display: grid;
        justify-items: end;
        margin: -24px 0 30px;
      }

      .child-card-bg-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 5;
        display: grid;
        min-width: 190px;
        overflow: hidden;
        border: 1px solid #f1e0cf;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 14px 30px rgba(92, 62, 26, 0.14);
      }

      .child-card-bg-menu[hidden] {
        display: none;
      }

      .child-card-bg-menu button {
        min-height: 46px;
        border: 0;
        border-bottom: 1px solid #f6eadf;
        background: #fff;
        color: #3c2b1e;
        padding: 0 16px;
        text-align: left;
        font-size: 14px;
        font-weight: 700;
      }

      .child-card-bg-menu button:last-child {
        border-bottom: 0;
        color: #8a4c00;
      }

      .child-card-bg-input {
        display: none;
      }

      .child-balance-metrics {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .child-balance-metrics div,
      .child-balance-metric-button {
        display: grid;
        gap: 7px;
        min-height: 72px;
        border: 0;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 13px 16px;
        text-align: left;
      }

      .child-balance-metric-button {
        cursor: pointer;
      }

      .child-balance-metrics span {
        font-size: 13px;
        font-weight: 900;
        opacity: 0.84;
      }

      .child-balance-metrics strong {
        font-size: 22px;
        line-height: 1.15;
      }

      .child-balance-metrics small {
        font-size: 13px;
        font-weight: 800;
      }

      .child-recent-section {
        margin-bottom: 34px;
      }

      .child-home-points-section {
        margin-bottom: 34px;
      }

      .child-home-point-history-list {
        gap: 12px;
      }

      .child-home-point-history-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px 14px;
        align-items: start;
        border: 0;
        border-radius: 24px;
        box-shadow: 0 10px 28px rgba(119, 85, 40, 0.06);
      }

      .child-home-point-history-main {
        min-width: 0;
      }

      .child-home-point-history-title {
        margin: 0 0 7px;
        color: var(--ink);
        font-size: 15px;
        font-weight: 800;
        line-height: 1.35;
      }

      .child-home-point-history-date {
        display: block;
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
      }

      .child-home-point-history-points {
        grid-column: 2;
        grid-row: 1;
        justify-self: end;
        color: #16a34a;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
      }

      .child-home-point-history-points.is-redemption {
        color: #dc2626;
      }

      .child-home-point-history-points.is-pending {
        color: #d97706;
      }

      .child-home-point-history-tag {
        grid-column: 1 / -1;
        justify-self: start;
        margin-top: 2px;
        border: 0;
        background: #16a34a;
        color: #ffffff;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
      }

      .child-home-point-history-tag.is-redemption {
        background: #dc2626;
      }

      .child-home-point-history-tag.is-pending {
        background: #d97706;
      }

      .child-section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }

      .child-section-heading h2 {
        margin: 0;
        font-size: 22px;
        line-height: 1.25;
      }

      .child-link-button {
        min-height: 44px;
        color: #8a4c00;
        padding: 0;
        font-size: 18px;
        font-weight: 900;
        white-space: nowrap;
      }

      .child-recent-list {
        display: grid;
        gap: 16px;
      }

      .child-home-history-card {
        margin: 0;
      }

      .child-recent-card {
        display: grid;
        grid-template-columns: 82px minmax(0, 1fr) auto;
        gap: 16px;
        align-items: center;
        width: 100%;
        min-height: 116px;
        border: 0;
        border-radius: 24px;
        background: #fff;
        padding: 14px 20px;
        color: #17110b;
        text-align: left;
        box-shadow: 0 10px 28px rgba(119, 85, 40, 0.06);
      }

      .child-thumb {
        display: block;
        width: 82px;
        height: 82px;
        border-radius: 14px;
        background-color: #d9c7ad;
        background-size: cover;
        box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.18);
      }

      .thumb-0 {
        background-image:
          linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.08)),
          repeating-linear-gradient(8deg, transparent 0 11px, rgba(80, 70, 50, 0.16) 12px 13px),
          linear-gradient(135deg, #f7f3ea, #a99b85);
      }

      .thumb-1 {
        background-image:
          linear-gradient(90deg, rgba(26, 17, 9, 0.7), transparent 45%, rgba(20, 12, 5, 0.55)),
          repeating-linear-gradient(95deg, #2c211b 0 7px, #f0d0a5 8px 11px, #7f5230 12px 15px),
          linear-gradient(#c08d4b, #51311d);
      }

      .thumb-2 {
        background-image:
          radial-gradient(ellipse at 55% 62%, rgba(255,255,255,0.55), transparent 0 18%, transparent 19%),
          linear-gradient(15deg, transparent 45%, rgba(255, 246, 210, 0.85) 46% 54%, transparent 55%),
          linear-gradient(145deg, #20150f, #b3844a 48%, #0f0c0a);
      }

      .child-recent-main {
        display: grid;
        gap: 12px;
        min-width: 0;
      }

      .child-recent-main strong {
        overflow: hidden;
        font-size: 20px;
        line-height: 1.28;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .child-recent-main span {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        color: #2d2119;
        font-size: 20px;
        line-height: 1.2;
      }

      .child-recent-main em {
        flex: 0 0 auto;
        border-radius: 999px;
        background: #ffe1ce;
        color: #23170f;
        padding: 5px 12px;
        font-size: 13px;
        font-style: normal;
        font-weight: 900;
      }

      .child-recent-side {
        display: grid;
        justify-items: end;
        gap: 15px;
        white-space: nowrap;
      }

      .child-recent-side > strong {
        color: #9a5b00;
        font-size: 20px;
        line-height: 1.1;
      }

      .child-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        border-radius: 999px;
        padding: 3px 12px;
        color: #1e1712;
        font-size: 13px;
        font-weight: 900;
      }

      .child-status.pending {
        background: #e7e4e2;
      }

      .child-status.done {
        background: #e9fff1;
        color: #008d4d;
      }

      .child-status.redo {
        background: transparent;
        padding-inline: 0;
        color: #1e1712;
      }

      .child-hint-card {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 22px;
        align-items: start;
        margin-bottom: 70px;
        border: 1px solid #f2dfcb;
        border-radius: 28px;
        background: #fff7ee;
        padding: 32px 28px;
      }

      .child-hint-icon {
        position: relative;
        display: block;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: #fff;
      }

      .child-hint-icon::before {
        content: "";
        position: absolute;
        left: 22px;
        top: 17px;
        width: 21px;
        height: 24px;
        border-radius: 50% 50% 42% 42%;
        background: #9a6500;
      }

      .child-hint-icon::after {
        content: "";
        position: absolute;
        left: 26px;
        top: 39px;
        width: 13px;
        height: 10px;
        border-radius: 0 0 4px 4px;
        background: #9a6500;
      }

      .child-hint-card h2 {
        margin: 0 0 12px;
        color: #8a4c00;
        font-size: 22px;
        line-height: 1.35;
      }

      .child-hint-card p {
        margin: 0;
        color: #21170f;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.78;
      }

      .child-design-nav {
        position: fixed;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 20;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        max-width: 440px;
        min-height: 86px;
        margin: 0 auto;
        border-radius: 0;
        background: rgba(255, 255, 255, 0.96);
        padding: 10px 22px max(12px, env(safe-area-inset-bottom));
        box-shadow: 0 -10px 28px rgba(80, 55, 28, 0.08);
      }

      .child-design-nav-item {
        display: grid;
        place-items: center;
        gap: 4px;
        min-width: 0;
        min-height: 58px;
        border: 0;
        background: transparent;
        color: #8f8378;
        font-size: 14px;
        font-weight: 900;
      }

      .child-design-nav-item.active {
        color: #ff8200;
      }

      .child-design-nav-item.primary {
        width: 72px;
        height: 72px;
        min-height: 72px;
        margin: -40px auto 0;
        border-radius: 50%;
        background: #ff8200;
        color: #fff;
        box-shadow: 0 12px 22px rgba(255, 130, 0, 0.26);
      }

      .nav-symbol {
        display: block;
        width: 30px;
        height: 30px;
      }

      .lucide-icon {
        flex: 0 0 auto;
      }

      .child-design-nav-item.primary .nav-symbol {
        width: 36px;
        height: 36px;
        stroke-width: 3;
      }

      .nav-symbol.home::before {
        content: "";
        position: absolute;
        left: 4px;
        top: 12px;
        width: 22px;
        height: 16px;
        border-radius: 3px;
        background: currentColor;
      }

      .nav-symbol.home::after {
        content: "";
        position: absolute;
        left: 5px;
        top: 3px;
        width: 20px;
        height: 20px;
        background: currentColor;
        transform: rotate(45deg);
        clip-path: polygon(0 0, 100% 0, 100% 100%);
      }

      .nav-symbol.history::before {
        content: "↺";
        position: absolute;
        inset: -3px 0 0;
        font-size: 32px;
        line-height: 1;
      }

      .nav-symbol.plus::before,
      .nav-symbol.plus::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 34px;
        height: 5px;
        border-radius: 99px;
        background: currentColor;
        transform: translate(-50%, -50%);
      }

      .nav-symbol.plus::after {
        transform: translate(-50%, -50%) rotate(90deg);
      }

      .nav-symbol.settings::before {
        content: "⚙";
        position: absolute;
        inset: -2px 0 0;
        font-size: 30px;
        line-height: 1;
      }

      .child-apply-design {
        min-height: 100dvh;
        padding: 0 20px 32px;
        background: #fffaf6;
      }

      .child-apply-design .child-topbar {
        display: none;
      }

      .child-apply-hero {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) 36px;
        gap: 0;
        align-items: center;
        margin: 0 -20px 0;
        border-bottom: 1px solid #f1e5dc;
        background: #fff;
        padding: 12px 20px;
      }

      .child-apply-hero > div {
        min-width: 0;
        text-align: center;
      }

      .child-back-button {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: #111;
        font-size: 34px;
        line-height: 1;
        font-weight: 800;
      }

      .child-back-icon {
        width: 24px;
        height: 24px;
        stroke-width: 2.8;
      }

      .child-apply-hero span {
        color: #ff8200;
        font-size: 13px;
        font-weight: 900;
      }

      .child-apply-hero h1 {
        margin: 0;
        font-size: 22px;
        line-height: 1.25;
        letter-spacing: 0;
      }

      .child-apply-hero p {
        margin: 0;
        color: #6f6258;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.55;
      }

      .child-apply-card {
        display: grid;
        gap: 18px;
        margin-top: 18px;
        border: 0;
        border-radius: 28px;
        background: #fff;
        padding: 22px;
        box-shadow: 0 12px 28px rgba(119, 85, 40, 0.08);
      }

      .child-apply-card .field {
        display: grid;
        gap: 9px;
      }

      .child-apply-card label {
        color: #1d1712;
        font-size: 15px;
        font-weight: 900;
      }

      .child-apply-card input,
      .child-apply-card select,
      .child-apply-card textarea {
        width: 100%;
        min-height: 54px;
        border: 1px solid #f0dfcf;
        border-radius: 18px;
        background: #fffaf5;
        color: #1d1712;
        padding: 13px 15px;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0;
      }

      .child-apply-card #application-subject {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%232a1c12' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-position: right 18px center;
        background-repeat: no-repeat;
        background-size: 18px 18px;
        padding-right: 48px;
      }

      .child-apply-card textarea {
        min-height: 112px;
        resize: vertical;
        line-height: 1.65;
      }

      .child-category-field > select,
      .child-score-field > select {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
      }

      .child-category-options {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .child-score-options {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .child-category-option {
        display: grid;
        place-items: center;
        min-height: 58px;
        border: 1px solid #f0dfcf;
        border-radius: 20px;
        background: #fffaf5;
        color: #8d837a;
        padding: 12px 8px;
        text-align: center;
      }

      .child-category-option span {
        font-size: 15px;
        font-weight: 900;
      }

      .child-category-option small {
        color: #7a6a5f;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.35;
      }

      .child-category-option.active {
        border-color: #ff8200;
        background: #ff8a12;
        color: #fff;
        box-shadow: 0 10px 20px rgba(255, 130, 0, 0.18);
      }

      .child-category-option.active small {
        color: rgba(255, 255, 255, 0.86);
      }

      .child-photo-field input[type="file"] {
        position: absolute;
        inset: 0;
        z-index: 2;
        width: 100%;
        height: 100%;
        overflow: hidden;
        opacity: 0;
        cursor: pointer;
      }

      .child-photo-field input[type="file"].child-photo-hidden-input {
        position: fixed;
        inset: auto;
        left: -9999px;
        top: 0;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .child-photo-lucide-icon {
        display: grid;
        width: 40px;
        height: 40px;
        place-items: center;
        color: #ff8200;
        pointer-events: none;
      }

      .child-photo-svg {
        width: 30px;
        height: 30px;
        stroke-width: 2.2;
      }

      .child-photo-drop {
        position: relative;
        display: grid;
        place-items: center;
        justify-self: start;
        width: calc((100% - 20px) / 3);
        aspect-ratio: 1 / 1;
        min-height: 0;
        border: 2px dashed #f0c79c;
        border-radius: 16px;
        background: #fff8ef;
        color: #ff8200;
        text-align: center;
        overflow: hidden;
        cursor: pointer;
      }

      .child-photo-field .child-photo-drop,
      .child-photo-field .child-photo-preview-add {
        color: #ff8200;
      }

      .child-photo-menu {
        display: grid;
        gap: 8px;
        width: min(100%, 220px);
        margin-top: -2px;
        padding: 8px;
        border: 1px solid #f0dfcf;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 24px rgba(72, 49, 30, 0.12);
      }

      .child-photo-menu[hidden] {
        display: none;
      }

      .child-photo-menu-action {
        position: relative;
        display: grid;
        place-items: center;
        min-height: 42px;
        border: 0;
        border-radius: 10px;
        background: #fff8ef;
        color: #7a3d00;
        font-size: 14px;
        font-weight: 900;
        text-align: center;
        cursor: pointer;
        overflow: hidden;
      }

      .child-photo-menu-action span {
        pointer-events: none;
      }

      .child-photo-menu input[type="file"].child-photo-hidden-input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        pointer-events: auto;
        cursor: pointer;
      }

      .child-photo-drop.is-hidden {
        display: none;
      }

      .child-photo-icon {
        position: relative;
        width: 54px;
        height: 42px;
        border-radius: 12px;
        background: #ff8200;
      }

      .child-photo-icon::before {
        content: "";
        position: absolute;
        left: 9px;
        top: -8px;
        width: 20px;
        height: 10px;
        border-radius: 8px 8px 0 0;
        background: #ff8200;
      }

      .child-photo-icon::after {
        content: "";
        position: absolute;
        left: 19px;
        top: 12px;
        width: 17px;
        height: 17px;
        border: 4px solid #fff;
        border-radius: 50%;
      }

      .child-photo-drop strong {
        font-size: 18px;
      }

      .child-photo-drop small,
      .child-apply-card .field-help,
      .child-photo-feedback,
      .child-submit-note {
        color: #7a6a5f;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.55;
      }

      .child-photo-feedback {
        display: none;
      }

      .child-photo-preview {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        min-height: 0;
      }

      .child-photo-preview:empty {
        display: none;
      }

      .child-photo-preview-item {
        position: relative;
        display: block;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        border: 1px solid #f0dfcf;
        border-radius: 16px;
        background: #fff8ef;
      }

      .child-photo-preview-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .child-photo-remove-button {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 3;
        display: grid;
        width: 26px;
        height: 26px;
        place-items: center;
        border: 0;
        border-radius: 50%;
        background: rgba(29, 23, 18, 0.72);
        color: #fff;
        font-size: 18px;
        font-weight: 900;
        line-height: 1;
      }

      .child-photo-preview-add {
        position: relative;
        display: grid;
        aspect-ratio: 1 / 1;
        place-items: center;
        border: 2px dashed #f0c79c;
        border-radius: 16px;
        background: #fff8ef;
        color: #ff8200;
        cursor: pointer;
      }

      .child-photo-preview-add-icon {
        width: 30px;
        height: 30px;
        stroke-width: 2.2;
      }

      .child-submit-note {
        margin: 4px 0 -4px;
        text-align: center;
      }

      .child-submit-button {
        min-height: 58px;
        border: 0;
        border-radius: 999px;
        background: #ff8200;
        color: #fff;
        font-size: 18px;
        font-weight: 900;
        box-shadow: 0 12px 22px rgba(255, 130, 0, 0.24);
      }

      .child-cancel-button {
        min-height: 52px;
        border: 1px solid #e8e2dc;
        border-radius: 999px;
        background: #fff;
        color: #8f8378;
        font-size: 16px;
        font-weight: 900;
      }

      .child-delete-button {
        min-height: 52px;
        border: 1px solid rgba(199, 55, 47, 0.24);
        border-radius: 999px;
        background: #fff5f4;
        color: #c7372f;
        font-size: 16px;
        font-weight: 900;
      }

      .child-delete-modal {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        background: rgba(29, 23, 18, 0.48);
        padding: 22px;
      }

      .child-delete-modal-panel {
        display: grid;
        gap: 14px;
        width: min(100%, 340px);
        border-radius: 24px;
        background: #fff;
        padding: 22px;
        box-shadow: 0 18px 44px rgba(29, 23, 18, 0.18);
      }

      .child-delete-modal-panel strong {
        color: #1d1712;
        font-size: 19px;
        font-weight: 900;
        line-height: 1.35;
      }

      .child-delete-modal-panel p {
        margin: 0;
        color: #7a6a5f;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.6;
      }

      .child-delete-modal-actions {
        display: grid;
        gap: 10px;
      }

      .child-delete-modal-confirm,
      .child-delete-modal-cancel {
        min-height: 50px;
        border-radius: 999px;
        font-size: 16px;
        font-weight: 900;
      }

      .child-delete-modal-confirm {
        border: 1px solid rgba(199, 55, 47, 0.24);
        background: #fff5f4;
        color: #c7372f;
      }

      .child-delete-modal-cancel {
        border: 1px solid #e8e2dc;
        background: #fff;
        color: #8f8378;
      }

      .child-complete-modal {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        background: rgba(29, 23, 18, 0.38);
        padding: 22px;
      }

      .child-complete-modal-panel {
        display: grid;
        gap: 12px;
        width: min(100%, 340px);
        border-radius: 24px;
        background: #fff;
        padding: 26px 22px 22px;
        text-align: center;
        box-shadow: 0 18px 44px rgba(29, 23, 18, 0.18);
      }

      .child-complete-modal-panel strong {
        color: #1d1712;
        font-size: 22px;
        font-weight: 900;
        line-height: 1.35;
      }

      .child-complete-modal-panel p {
        margin: 0 0 8px;
        color: #7a6a5f;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.6;
      }

      .child-complete-modal-button {
        width: 100%;
        min-height: 50px;
        border-radius: 999px;
      }

      .child-apply-card .error {
        color: #c7372f;
        font-weight: 900;
      }

      .child-apply-card .field-error {
        min-height: 18px;
        color: #c7372f;
        font-size: 12px;
        font-weight: 900;
        line-height: 1.5;
      }

      .child-apply-card input.input-error {
        border-color: #c7372f;
        box-shadow: 0 0 0 3px rgba(199, 55, 47, 0.12);
      }

      @media (max-width: 380px) {
        .child-design-home {
          padding-inline: 16px;
        }

        .child-design-topbar {
          margin-inline: -16px;
          padding-inline: 18px;
        }

        .child-balance-card {
          padding: 24px 20px 22px;
        }

        .child-balance-copy strong {
          font-size: 38px;
        }

        .child-recent-card {
          grid-template-columns: 70px minmax(0, 1fr);
        }

        .child-recent-side {
          grid-column: 2;
          grid-row: 1;
          align-self: end;
        }

        .child-thumb {
          width: 70px;
          height: 70px;
        }

        .child-hint-card {
          grid-template-columns: 1fr;
        }

        .child-apply-design {
          padding-inline: 16px;
        }

        .child-apply-hero {
          margin-inline: -16px;
          padding-inline: 16px;
        }

        .child-apply-card {
          padding: 18px;
        }

        .child-category-options {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();

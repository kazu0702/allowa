(function () {
  const hasBuiltInChildDesign =
    typeof childHomeView === "function" &&
    childHomeView.toString().includes("child-points-card");

  ensureChildDesignStyles();

  if (hasBuiltInChildDesign) {
    return;
  }

  const baseChildApplyView = typeof childApplyView === "function" ? childApplyView : null;

  childHomeView = function childHomeViewWithDesign(child) {
    const applications = getChildApplications(child);
    const pendingCount = applications.filter((application) => application.status === "pending").length;
    const pendingRedemptionCount = getChildRedemptions(child).filter((redemption) => redemption.status === "pending").length;
    const pendingRedemptionPoints = getPendingRedemptionPoints(child);
    const availablePoints = getAvailablePoints(child);
    const monthlyEarnedPoints = getMonthlyEarnedPointsForChild(child);
    const receivedAllowanceTotal = getMonthlyReceivedAllowanceTotal(child);
    const unreadCount = getUnreadNotifications(child).length;
    const recentApplications = applications.slice(0, 3);

    return `
      <section class="screen home-screen child-theme">
        ${childHeader("ホーム")}

        <div class="child-points-card">
          <div class="child-points-main">
            <span>現在のポイント</span>
            <strong>${availablePoints.toLocaleString()}<small>pt</small></strong>
            <p>確定 ${child.currentPoints.toLocaleString()}pt / おこづかい申請中 ${pendingRedemptionPoints.toLocaleString()}pt</p>
          </div>
          <button class="child-exchange-button" type="button" data-route="/child/redeem">申請する</button>
          <div class="child-points-metrics">
            <div>
              <span>今月の獲得</span>
              <strong>+${monthlyEarnedPoints.toLocaleString()}pt</strong>
            </div>
          <div>
            <span>確認待ち</span>
            <strong>${pendingCount}件</strong>
          </div>
        </div>
      </div>

        <section class="child-section">
          <div class="child-section-heading">
            <h2>最近のやったこと</h2>
            <button class="text-button child-link-button" type="button" data-route="/child/history">すべて見る</button>
          </div>
          <div class="child-activity-list">
            ${
              recentApplications.length
                ? recentApplications.map(childRecentActivityCard).join("")
                : `<div class="card empty-state"><strong>まだ申請がありません</strong><p>最初のがんばりを申請してみましょう。</p></div>`
            }
          </div>
        </section>

        <div class="child-quick-grid">
          <button class="card child-quick-card" type="button" data-route="/child/apply">
            <span>＋</span>
            <strong>申請する</strong>
            <small>写真と内容を送る</small>
          </button>
          <button class="card child-quick-card" type="button" data-route="/child/notifications">
            <span>○</span>
            <strong>通知</strong>
            <small>${unreadCount}件の未読</small>
          </button>
        </div>

        <div class="child-tip-card">
          <span>!</span>
          <div>
            <strong>やる気が出るヒント</strong>
            <p>お手伝いや学習の写真を残しておくと、あとから申請しやすくなります。</p>
          </div>
        </div>

        <p class="child-home-note">今月もらったおこづかい ${receivedAllowanceTotal.toLocaleString()}円 / おこづかい確認待ち ${pendingRedemptionCount}件</p>

        ${childBottomNav("home")}
      </section>
    `;
  };

  if (baseChildApplyView) {
    childApplyView = function childApplyViewWithDesign(child, editingApplication = null) {
      return baseChildApplyView(child, editingApplication)
        .replace('<div class="page-heading">', '<div class="page-heading child-page-heading">')
        .replace(
          '<form class="card form form-card" id="application-form">',
          `<form class="card form form-card child-form-card" id="application-form">
        <div class="child-form-intro">
          <span>新規作成</span>
          <strong>今日のがんばりを記録</strong>
        </div>`,
        );
    };
  }

  childHistoryView = function childHistoryViewWithDesign(child) {
    const applications = getChildApplications(child);
    const activeFilter = state.childHistoryFilter || "all";
    const filteredApplications = filterChildHistoryApplications(applications, activeFilter);
    return `
      <section class="screen home-screen child-theme">
        <div class="topbar child-topbar child-history-topbar">
          <h1>履歴</h1>
        </div>
        ${childHistoryFilterRow(activeFilter)}
        <div class="application-list">
          ${
            applications.length === 0
              ? `<div class="card empty-state"><strong>まだ申請がありません</strong><p>最初のがんばりを申請してみましょう。</p></div>`
              : filteredApplications.length === 0
                ? `<div class="card empty-state"><strong>この状態の履歴はありません</strong><p>別の状態を選んで確認できます。</p></div>`
                : filteredApplications.map(applicationCard).join("")
          }
        </div>

        ${childBottomNav("history")}
      </section>
    `;
  };

  function childHistoryFilterRow(activeFilter) {
    return `
      <div class="child-filter-row" aria-label="申請状態">
        ${childHistoryFilterButton("all", "すべて", activeFilter)}
        ${childHistoryFilterButton("approved", "承認済み", activeFilter)}
        ${childHistoryFilterButton("pending", "確認中", activeFilter)}
        ${childHistoryFilterButton("redo", "やり直し", activeFilter)}
      </div>
    `;
  }

  function childHistoryFilterButton(value, label, activeFilter) {
    const isActive = value === activeFilter;
    return `
      <button class="filter-${value} ${isActive ? "active" : ""}" type="button" data-child-history-filter="${value}" aria-pressed="${isActive ? "true" : "false"}">
        ${label}
      </button>
    `;
  }

  function filterChildHistoryApplications(applications, filter) {
    if (filter === "approved") {
      return applications.filter((application) => ["approved", "approval_canceled"].includes(application.status));
    }

    if (filter === "pending") {
      return applications.filter((application) => application.status === "pending");
    }

    if (filter === "redo") {
      return applications.filter((application) => ["returned", "rejected", "canceled"].includes(application.status));
    }

    return applications;
  }

  applicationCard = function applicationCardWithDesign(application) {
    const pointStatus = childApplicationPointStatus(application.status);
    const scoreLabel = childApplicationScoreLabel(application);
    const canEdit = !childIsApprovedApplicationStatus(application.status);
    return `
      <div class="card application-card child-history-card">
        <div class="child-history-content">
          ${applicationMediaPreview(application)}
          <div class="child-history-main">
            <h2>${applicationTitle(application)}</h2>
            <span class="child-history-date">${formatActivityTime(application.submittedAt)}</span>
            <div class="child-activity-meta">
              ${applicationCategoryChip(application)}
            </div>
            ${application.parentComment ? `<p class="child-parent-comment ${childIsRedoApplicationStatus(application.status) ? "is-redo" : ""}">${escapeHtml(application.parentComment)}</p>` : ""}
          </div>
          <div class="child-history-side">
            <strong class="child-history-points ${pointStatus.className}">
              ${childDesignIcon(pointStatus.icon, "child-history-point-icon")}
              <span>${applicationPointLabel(application)}</span>
            </strong>
            ${scoreLabel ? `<span class="child-history-score">${scoreLabel}</span>` : ""}
            ${
              canEdit
                ? `<button class="child-history-edit-button" type="button" data-route="/child/apply/${application.id}" aria-label="申請を編集">${childDesignIcon("square-pen", "child-history-edit-icon")}</button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
  };

  function childApplicationScoreLabel(application) {
    if (application.category !== "test" || application.score == null || application.score === "") {
      return "";
    }

    const fullScore = Number(application.testFullScore) === 50 ? 50 : 100;
    return `${Number(application.score).toLocaleString()} / ${fullScore}`;
  }

  function childApplicationPointStatus(status) {
    if (status === "approved" || status === "approval_canceled") {
      return { className: "is-approved", icon: "circle-check" };
    }

    if (status === "returned" || status === "rejected" || status === "canceled") {
      return { className: "is-redo", icon: "circle-alert" };
    }

    return { className: "is-pending", icon: "clock" };
  }

  function childIsRedoApplicationStatus(status) {
    return ["returned", "rejected", "canceled"].includes(status);
  }

  function childIsApprovedApplicationStatus(status) {
    return status === "approved";
  }

  childHeader = function childHeaderWithDesign(label) {
    const child = typeof getCurrentChild === "function" ? getCurrentChild() : state.child;
    return `
      <div class="topbar child-topbar">
        <div class="brand">
          <img class="header-logo-image child-header-logo-image" src="./logo.svg?v=phase322" alt="allowa" />
        </div>
        <div class="child-profile-pill">
          ${typeof childAvatar === "function" ? childAvatar(child, "child-account-avatar") : ""}
          <span>${escapeHtml(child?.nickname || label)}</span>
          <button class="text-button" type="button" id="child-logout-button">ログアウト</button>
        </div>
      </div>
    `;
  };

  childBottomNav = function childBottomNavWithDesign(active) {
    const items = [
      ["home", "⌂", "ホーム", "/child"],
      ["history", "□", "履歴", "/child/history"],
      ["apply", "+", "申請", "/child/apply"],
      ["redeem", "¥", "おこづかい申請", "/child/redeem"],
      ["points", "pt", "ポイント", "/child/points"],
    ];

    return `
      <nav class="bottom-nav child-bottom-nav" aria-label="こどもメニュー">
        ${items
          .map(
            ([key, icon, label, path]) => `
              <button class="nav-item ${key === "apply" ? "nav-item-primary" : ""} ${active === key ? "active" : ""}" type="button" data-route="${path}" aria-current="${active === key ? "page" : "false"}">
                <span class="nav-icon">${icon}</span>
                <span>${label}</span>
              </button>
            `,
          )
          .join("")}
      </nav>
    `;
  };

  function getMonthlyEarnedPointsForChild(child) {
    return getPointTransactions(child)
      .filter((transaction) => Number(transaction.points || 0) > 0 && isThisMonth(transaction.createdAt))
      .reduce((total, transaction) => total + Number(transaction.points || 0), 0);
  }

  function childRecentActivityCard(application) {
    return `
      <button class="card child-activity-card" type="button" data-route="/child/history">
        ${applicationMediaPreview(application, false)}
        <div class="child-activity-main">
          <h3>${applicationTitle(application)}</h3>
          <div class="child-activity-meta">
            ${applicationCategoryChip(application)}
            <span>${formatActivityTime(application.submittedAt)}</span>
          </div>
        </div>
        <div class="child-activity-side">
          <span class="status-pill ${application.status}">${statusLabel(application.status)}</span>
          <strong>${applicationPointLabel(application)}</strong>
        </div>
      </button>
    `;
  }

  function applicationTitle(application) {
    if (application.category === "test") {
      return `${escapeHtml(application.subjectName || "テスト")}のテスト`;
    }

    if (application.category === "grade") {
      return `${escapeHtml(application.subjectName || "成績")}の成績`;
    }

    return escapeHtml(application.otherContent || "その他の申請");
  }

  function applicationMediaPreview(application, interactive = true) {
    const firstPhoto = application.photos?.[0];
    if (firstPhoto) {
      const image = `<img src="${escapeHtml(firstPhoto.dataUrl)}" alt="${escapeHtml(firstPhoto.name || "申請写真")}" />`;
      return interactive
        ? `
          <button class="thumbnail-button child-activity-thumb" type="button" data-photo-src="${escapeHtml(firstPhoto.dataUrl)}" data-photo-name="${escapeHtml(firstPhoto.name)}" aria-label="申請写真を見る">
            ${image}
          </button>
        `
        : `<span class="child-activity-thumb">${image}</span>`;
    }

    return `<div class="child-activity-thumb child-activity-placeholder" aria-hidden="true">${categoryIcon(application.category)}</div>`;
  }

  function applicationCategoryChip(application) {
    return `<span class="category-chip ${application.category}">${categoryLabel(application.category)}</span>`;
  }

  function childDesignIcon(name, className = "") {
    if (window.INCEIcons?.icon) {
      return window.INCEIcons.icon(name, className);
    }

    const fallbackIcons = {
      "circle-alert": `
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" x2="12" y1="8" y2="12"/>
        <line x1="12" x2="12.01" y1="16" y2="16"/>
      `,
      "circle-check": `
        <circle cx="12" cy="12" r="10"/>
        <path d="m9 12 2 2 4-4"/>
      `,
      clock: `
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      `,
      "square-pen": `
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
      `,
    };
    if (fallbackIcons[name]) {
      return `
        <svg class="lucide-icon ${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${fallbackIcons[name]}
        </svg>
      `;
    }

    if (name === "square-pen") {
      return `
        <svg class="lucide-icon ${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
        </svg>
      `;
    }

    return "";
  }

  function categoryIcon(category) {
    if (category === "test") {
      return "T";
    }

    if (category === "grade") {
      return "A";
    }

    return "!";
  }

  function formatActivityTime(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
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

  function scheduleRenderedChildUpgrade() {
    window.setTimeout(upgradeRenderedChildDom, 0);
    window.setTimeout(upgradeRenderedChildDom, 250);
  }

  function upgradeRenderedChildDom() {
    const route = location.hash.replace("#", "") || "/";
    if (!route.startsWith("/child") || route === "/child/login") {
      return;
    }

    const screen = document.querySelector("#app .screen");
    if (!screen) {
      return;
    }

    screen.classList.add("child-theme");
    upgradeChildHeaderDom(screen);
    upgradeChildBottomNavDom(screen);

    if (route === "/child" || route === "/child/") {
      upgradeChildHomeDom(screen);
    }

    if (route === "/child/history") {
      upgradeChildHistoryDom(screen);
    }

    if (route === "/child/apply" || route.startsWith("/child/apply/") || route.startsWith("/child/reapply/")) {
      upgradeChildApplyDom(screen);
    }
  }

  function upgradeChildHeaderDom(screen) {
    const topbar = screen.querySelector(".topbar");
    if (!topbar) {
      return;
    }

    topbar.classList.add("child-topbar");
    topbar.querySelector(".brand-mark")?.classList.add("child-brand-mark");

    const brandLabel = topbar.querySelector(".brand span:last-child");
    if (brandLabel) {
      brandLabel.textContent = "allowa";
    }
  }

  function upgradeChildBottomNavDom(screen) {
    const nav = screen.querySelector('nav[aria-label="こどもメニュー"], .bottom-nav');
    if (!nav) {
      return;
    }

    nav.classList.add("child-bottom-nav");
    nav.querySelector('[data-route="/child/apply"]')?.classList.add("nav-item-primary");
  }

  function escapeChildDesignText(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function upgradeChildHomeDom(screen) {
    const summaryCards = Array.from(screen.querySelectorAll(".summary-card"));
    const pointsCard = summaryCards.find((card) => card.textContent.includes("現在ポイント") || card.textContent.includes("現在のポイント"));
    if (pointsCard && !pointsCard.classList.contains("child-points-card")) {
      const pointValue = pointsCard.querySelector(".summary-number")?.textContent.trim() || "0pt";
      const finePrint = pointsCard.querySelector(".fine-print")?.textContent.trim() || "";
      pointsCard.className = "child-points-card";
      pointsCard.innerHTML = `
        <div class="child-points-main">
          <span>現在のポイント</span>
          <strong>${escapeChildDesignText(pointValue).replace("pt", "<small>pt</small>")}</strong>
          ${finePrint ? `<p>${escapeChildDesignText(finePrint)}</p>` : ""}
        </div>
        <button class="child-exchange-button" type="button" data-route="/child/redeem">申請する</button>
        <div class="child-points-metrics">
          <div>
            <span>今日の入口</span>
            <strong>申請</strong>
          </div>
          <div>
            <span>確認待ち</span>
            <strong>${escapeChildDesignText(getPendingSummaryText(screen))}</strong>
          </div>
        </div>
      `;
    }

    const allowanceCard = summaryCards.find((card) => card.textContent.includes("今月もらったおこづかい"));
    if (allowanceCard) {
      const amount = allowanceCard.querySelector(".summary-number")?.textContent.trim() || "";
      const note = document.createElement("p");
      note.className = "child-home-note";
      note.textContent = amount ? `今月もらったおこづかい ${amount}` : "今月もらったおこづかいを確認できます";
      allowanceCard.replaceWith(note);
    }

    const heading = screen.querySelector(".home-heading");
    heading?.classList.add("child-centered-heading");

    insertRecentActivitySection(screen);

    const homeGrid = screen.querySelector(".home-grid");
    if (homeGrid) {
      homeGrid.classList.add("child-quick-grid");
      homeGrid.querySelectorAll(".task-card").forEach((card) => {
        card.classList.add("child-quick-card");
      });
    }
  }

  function getPendingSummaryText(screen) {
    const pendingCard = Array.from(screen.querySelectorAll(".task-card")).find((card) => card.textContent.includes("申請中"));
    const pendingText = pendingCard?.querySelector("p")?.textContent || "";
    return pendingText.match(/\d+\s*件/)?.[0] || "0件";
  }

  function insertRecentActivitySection(screen) {
    if (screen.querySelector(".child-section")) {
      return;
    }

    const pointsCard = screen.querySelector(".child-points-card");
    if (!pointsCard) {
      return;
    }

    const section = document.createElement("section");
    section.className = "child-section";
    section.innerHTML = `
      <div class="child-section-heading">
        <h2>最近のやったこと</h2>
        <button class="text-button child-link-button" type="button" data-route="/child/history">すべて見る</button>
      </div>
      <div class="child-activity-list">
        <button class="card child-activity-card" type="button" data-route="/child/history">
          <div class="child-activity-thumb child-activity-placeholder" aria-hidden="true">S</div>
          <div class="child-activity-main">
            <h3>申請の確認状況</h3>
            <div class="child-activity-meta">
              <span class="category-chip other">家庭内ルール</span>
              <span>${escapeChildDesignText(getPendingSummaryText(screen))}</span>
            </div>
          </div>
          <div class="child-activity-side">
            <span class="status-pill pending">確認待ち</span>
          </div>
        </button>
      </div>
    `;
    pointsCard.insertAdjacentElement("afterend", section);
  }

  function upgradeChildHistoryDom(screen) {
    const topbar = screen.querySelector(".topbar");
    if (topbar && !topbar.querySelector(".child-history-title")) {
      topbar.classList.add("child-history-topbar");
      topbar.innerHTML = `<h1 class="child-history-title">履歴</h1>`;
    }

    screen.querySelector(".child-centered-heading")?.remove();

    screen.querySelectorAll(".application-card").forEach((card) => {
      card.classList.add("child-history-card");
    });
  }

  function upgradeChildApplyDom(screen) {
    screen.querySelector(".page-heading")?.classList.add("child-page-heading");
    const form = screen.querySelector("#application-form");
    if (!form || form.querySelector(".child-form-intro")) {
      return;
    }

    form.classList.add("child-form-card");
    form.insertAdjacentHTML(
      "afterbegin",
      `
        <div class="child-form-intro">
          <span>新規作成</span>
          <strong>今日のがんばりを記録</strong>
        </div>
      `,
    );
  }

  function ensureChildDesignStyles() {
    if (document.querySelector("#child-design-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "child-design-style";
    style.textContent = `
      :root {
        --bg: #fff8f1;
        --surface-soft: #fff4e6;
        --line: #f0d8c8;
        --text: #1f1c18;
        --muted: #6f6258;
        --primary: #ff8000;
        --primary-dark: #964900;
        --shadow: 0 4px 20px rgba(255, 128, 0, 0.08);
      }

      body,
      .phone-shell,
      .app {
        background: var(--bg);
      }

      .card {
        border-radius: 24px;
        box-shadow: var(--shadow);
      }

      .primary-button,
      .secondary-button,
      .danger-button {
        min-height: 56px;
        border-radius: 999px;
      }

      .secondary-button {
        border-color: var(--primary);
        color: var(--primary-dark);
      }

      .field input,
      .field select,
      .field textarea {
        border-radius: 12px;
      }

      .child-theme {
        padding-inline: 20px;
        background: linear-gradient(180deg, #fffdf9 0, #fff8f1 170px, #fff8f1 100%);
      }

      .child-topbar {
        position: fixed;
        top: 0;
        left: 50%;
        z-index: 30;
        width: min(100%, 440px);
        margin: 0;
        transform: translateX(-50%);
        min-height: 64px;
        padding: calc(env(safe-area-inset-top, 0px) + 10px) 18px 10px;
        border-bottom: 1px solid rgba(240, 216, 200, 0.72);
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(255, 128, 0, 0.06);
      }

      .child-brand-mark {
        border-radius: 12px;
        background: linear-gradient(135deg, #ff8000, #ffb347);
      }

      .header-logo-image {
        display: block;
        width: auto;
        height: 28px;
        object-fit: contain;
      }

      .child-header-logo-image {
        height: 28px;
      }

      .child-profile-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: var(--text);
        font-size: 13px;
        font-weight: 900;
      }

      .child-profile-pill > span {
        overflow: hidden;
        max-width: 96px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .child-history-topbar {
        display: grid;
        place-items: center;
        justify-content: initial;
      }

      .child-history-topbar h1 {
        margin: 0;
        color: var(--text);
        font-size: 22px;
        font-weight: 900;
        line-height: 1.25;
        letter-spacing: 0;
      }

      .child-profile-pill .text-button {
        padding: 8px 0;
        font-size: 12px;
      }

      .child-points-card {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px 12px;
        overflow: hidden;
        margin: 8px 0 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, #ff8000 0%, #ffb347 100%);
        color: #fff;
        padding: 24px;
        box-shadow: 0 14px 34px rgba(255, 128, 0, 0.2);
      }

      .child-points-card::before,
      .child-points-card::after {
        content: "";
        position: absolute;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        filter: blur(2px);
      }

      .child-points-card::before {
        top: -44px;
        right: -36px;
        width: 128px;
        height: 128px;
      }

      .child-points-card::after {
        left: -28px;
        bottom: -42px;
        width: 104px;
        height: 104px;
      }

      .child-points-main,
      .child-points-metrics,
      .child-exchange-button {
        position: relative;
        z-index: 1;
      }

      .child-points-main {
        display: grid;
        gap: 8px;
        min-width: 0;
      }

      .child-points-main span,
      .child-points-metrics span {
        font-size: 13px;
        font-weight: 900;
        opacity: 0.86;
      }

      .child-points-main strong {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
        overflow-wrap: anywhere;
        font-size: 52px;
        line-height: 0.95;
        letter-spacing: 0;
      }

      .child-points-main small {
        font-size: 20px;
      }

      .child-points-main p {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        opacity: 0.86;
      }

      .child-exchange-button {
        align-self: center;
        min-height: 48px;
        border: 1px solid rgba(255, 255, 255, 0.48);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: 900;
      }

      .child-points-metrics {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .child-points-metrics div {
        display: grid;
        gap: 6px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.2);
        padding: 12px;
        backdrop-filter: blur(8px);
      }

      .child-points-metrics strong {
        font-size: 18px;
        line-height: 1.2;
      }

      .child-section {
        margin-bottom: 24px;
      }

      .child-section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .child-section-heading h2,
      .child-centered-heading h1 {
        margin: 0;
        color: var(--text);
        font-size: 24px;
        line-height: 1.25;
      }

      .child-link-button {
        padding-inline: 0;
        white-space: nowrap;
      }

      .child-activity-list {
        display: grid;
        gap: 12px;
      }

      .child-activity-card {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        width: 100%;
        border: 0;
        border-radius: 24px;
        padding: 14px;
        color: var(--text);
        text-align: left;
      }

      .child-activity-thumb {
        display: grid;
        width: 74px;
        height: 74px;
        place-items: center;
        overflow: hidden;
        border: 0;
        border-radius: 18px;
        background: #fff4e6;
        color: var(--primary-dark);
        padding: 0;
        font-weight: 900;
      }

      .child-activity-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .child-activity-main,
      .child-history-main {
        min-width: 0;
      }

      .child-activity-main h3 {
        overflow: hidden;
        margin: 0 0 8px;
        font-size: 18px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .child-activity-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
      }

      .category-chip {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 900;
      }

      .category-chip.test {
        background: #e7f1ff;
        color: #1961a8;
      }

      .category-chip.grade {
        background: #f5e8ff;
        color: #7c3ca3;
      }

      .category-chip.other {
        background: #e8f7ef;
        color: var(--green);
      }

      .child-activity-side {
        display: grid;
        justify-items: end;
        gap: 8px;
        white-space: nowrap;
      }

      .child-activity-side strong,
      .child-history-points {
        color: var(--primary-dark);
        font-size: 18px;
      }

      .child-quick-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 20px;
      }

      .child-quick-card {
        display: grid;
        gap: 6px;
        min-width: 0;
        border: 0;
        border-radius: 24px;
        padding: 16px;
        color: var(--text);
        text-align: left;
      }

      .child-quick-card span {
        display: grid;
        width: 36px;
        height: 36px;
        place-items: center;
        border-radius: 50%;
        background: var(--surface-soft);
        color: var(--primary-dark);
        font-size: 20px;
        font-weight: 900;
      }

      .child-quick-card strong {
        font-size: 16px;
      }

      .child-quick-card small {
        overflow-wrap: anywhere;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .child-tip-card {
        display: grid;
        grid-template-columns: 48px 1fr;
        gap: 14px;
        align-items: start;
        margin-bottom: 14px;
        border: 1px solid #ffd9b5;
        border-radius: 24px;
        background: rgba(255, 244, 230, 0.72);
        padding: 18px;
      }

      .child-tip-card > span {
        display: grid;
        width: 48px;
        height: 48px;
        place-items: center;
        border-radius: 18px;
        background: #fff;
        color: var(--primary-dark);
        font-weight: 900;
      }

      .child-tip-card strong {
        color: var(--primary-dark);
      }

      .child-tip-card p,
      .child-home-note {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
      }

      .child-home-note {
        margin-bottom: 8px;
        text-align: center;
      }

      .child-centered-heading {
        margin: 4px 0 18px;
        text-align: center;
      }

      .child-filter-row {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        margin: 0 -20px 18px;
        padding: 0 20px 4px;
      }

      .child-filter-row button {
        flex: 0 0 auto;
        min-height: 46px;
        border: 0;
        border-radius: 999px;
        background: var(--filter-bg, #ece8e4);
        color: var(--filter-color, #574235);
        padding: 12px 20px;
        font: inherit;
        font-weight: 900;
        white-space: nowrap;
      }

      .child-filter-row .filter-approved {
        --filter-bg: #e9fff1;
        --filter-color: #008d4d;
        --filter-active: #008d4d;
      }

      .child-filter-row .filter-pending {
        --filter-bg: #fff6dc;
        --filter-color: #b77900;
        --filter-active: #b77900;
      }

      .child-filter-row .filter-redo {
        --filter-bg: #fff0ee;
        --filter-color: #c7372f;
        --filter-active: #c7372f;
      }

      .child-filter-row button.active {
        background: var(--filter-active, var(--primary-dark));
        color: #fff;
      }

      .child-page-heading {
        margin-top: 8px;
      }

      .child-page-heading h1 {
        font-size: 24px;
      }

      .child-form-card {
        gap: 18px;
        border: 0;
        border-radius: 24px;
        padding: 22px;
      }

      .child-form-intro {
        display: grid;
        gap: 4px;
        padding-bottom: 4px;
      }

      .child-form-intro span {
        color: var(--primary-dark);
        font-size: 12px;
        font-weight: 900;
      }

      .child-form-intro strong {
        font-size: 20px;
        line-height: 1.35;
      }

      .child-history-card {
        position: relative;
        border: 0;
        border-radius: 24px;
        padding: 18px;
      }

      .child-history-content {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: start;
      }

      .child-history-side {
        display: grid;
        justify-items: end;
        gap: 10px;
        white-space: nowrap;
      }

      .child-history-points {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .child-history-points.is-approved {
        color: #008d4d;
      }

      .child-history-points.is-pending {
        color: #b77900;
      }

      .child-history-points.is-redo {
        color: #c7372f;
      }

      .child-history-score {
        color: var(--muted);
        font-size: 13px;
        font-weight: 900;
        line-height: 1.1;
      }

      .child-history-point-icon {
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
      }

      .child-history-edit-button {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border: 1px solid #f0dfcf;
        border-radius: 14px;
        background: #fffaf5;
        color: var(--primary-dark);
      }

      .child-history-edit-icon {
        width: 20px;
        height: 20px;
      }

      .child-history-main h2 {
        margin: 6px 0 8px;
        font-size: 19px;
        line-height: 1.35;
      }

      .child-history-date {
        color: var(--muted);
        font-size: 13px;
        font-weight: 500;
      }

      .child-history-card .child-parent-comment {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .child-history-card .child-parent-comment.is-redo {
        color: #c7372f;
      }

      .child-bottom-nav {
        grid-template-columns: repeat(5, 1fr);
        align-items: end;
        padding: 10px 12px max(10px, env(safe-area-inset-bottom));
        border-top: 0;
        border-radius: 0;
        box-shadow: 0 -4px 20px rgba(255, 128, 0, 0.08);
      }

      .child-bottom-nav .nav-item {
        min-height: 58px;
        border-radius: 16px;
      }

      .child-bottom-nav .nav-item.active {
        background: transparent;
        color: var(--primary);
      }

      .child-bottom-nav .nav-item-primary {
        align-self: start;
        width: 68px;
        height: 68px;
        margin: -34px auto 0;
        border-radius: 50%;
        background: var(--primary);
        color: #fff;
        box-shadow: 0 12px 24px rgba(255, 128, 0, 0.28);
      }

      .child-bottom-nav .nav-item-primary.active {
        background: var(--primary);
        color: #fff;
      }

      .child-bottom-nav .nav-item-primary .nav-icon {
        font-size: 32px;
      }

      .child-bottom-nav .nav-item-primary span:last-child {
        display: none;
      }

      .child-theme .home-heading.child-centered-heading {
        margin: 4px 0 18px;
        text-align: left;
      }

      .child-theme .home-heading.child-centered-heading h1 {
        margin-bottom: 4px;
        font-size: 24px;
        line-height: 1.3;
      }

      .child-theme .home-heading.child-centered-heading p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
        font-weight: 800;
      }

      .child-theme .home-grid.child-quick-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .child-theme .task-card.child-quick-card {
        display: grid;
        gap: 10px;
        min-width: 0;
        border: 0;
        border-radius: 24px;
        padding: 16px;
        color: var(--text);
      }

      .child-theme .task-card.child-quick-card h2 {
        margin: 0;
        font-size: 17px;
        line-height: 1.35;
      }

      .child-theme .task-card.child-quick-card p {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .child-theme .task-card.child-quick-card .compact-button {
        min-height: 44px;
        margin-top: 2px;
        padding-inline: 12px;
        font-size: 13px;
      }
    `;
    document.head.appendChild(style);
  }

  try {
    if (typeof render === "function") {
      render();
    }
  } catch {
    // The public build keeps some app functions private; DOM upgrade below still applies the UI polish.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRenderedChildUpgrade);
  } else {
    scheduleRenderedChildUpgrade();
  }
  window.addEventListener("hashchange", scheduleRenderedChildUpgrade);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-route]")) {
      scheduleRenderedChildUpgrade();
    }
  });
})();

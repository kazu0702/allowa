(function () {
  const STYLE_ID = "child-design-fix-style";
  const ACCOUNT_KEY = "studypay_parent_account";
  const CHILD_SESSION_KEY = "studypay_child_session";

  ensureStyles();
  scheduleUpgrade();
  bindDelegatedActions();
  bindLoginRedirectGuard();

  window.addEventListener("hashchange", scheduleUpgrade);

  function bindDelegatedActions() {
    document.addEventListener("click", (event) => {
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
      if (route && location.hash !== `#${route}`) {
        location.hash = route;
      }
    });
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

    upgradeSubScreen(screen, route);
  }

  function renderDesignedHome(screen) {
    const child = getCurrentChildData();
    if (!child) {
      return;
    }

    const applications = getApplications(child);
    const availablePoints = getAvailablePoints(child);
    const monthlyEarned = getMonthlyEarned(child);
    const pendingApprovalPoints = applications
      .filter((application) => application.status === "pending")
      .reduce((total, application) => total + getApplicationPoints(application), 0);

    screen.className = "screen home-screen child-theme child-design-home";
    screen.innerHTML = `
      <header class="child-design-topbar">
        <div class="child-design-logo" aria-label="スタディペイ">
          <span class="child-design-logo-icon" aria-hidden="true"></span>
          <span>スタディ<span>ペイ</span></span>
        </div>
        <button class="child-design-profile" id="child-logout-button" type="button" aria-label="ログアウト">
          <span aria-hidden="true"></span>
          <strong>${escapeText(child.nickname || "タロー")}</strong>
        </button>
      </header>

      <section class="child-balance-card">
        <div class="child-balance-copy">
          <span>現在の総保有ポイント</span>
          <strong>${availablePoints.toLocaleString()}<small>pts</small></strong>
        </div>
        <button class="child-exchange-button" type="button" data-route="/child/redeem">交換する</button>
        <div class="child-balance-metrics">
          <div>
            <span>今月の獲得</span>
            <strong>+${monthlyEarned.toLocaleString()} pts</strong>
          </div>
          <div>
            <span>承認待ち</span>
            <strong>${pendingApprovalPoints.toLocaleString()} pts</strong>
          </div>
        </div>
      </section>

      <section class="child-recent-section">
        <div class="child-section-heading">
          <h2>最近のやったこと</h2>
          <button class="text-button child-link-button" type="button" data-route="/child/history">すべて見る</button>
        </div>
        <div class="child-recent-list">
          ${applications.slice(0, 3).map((application, index) => recentCard(application, index)).join("") || emptyRecentCard()}
        </div>
      </section>

      <section class="child-hint-card">
        <span class="child-hint-icon" aria-hidden="true"></span>
        <div>
          <h2>やる気が出るヒント！</h2>
          <p>「お手伝い」を自分から見つけてやってみよう！写真をとるのをわすれずにね。ポイントアップ中だよ！</p>
        </div>
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

  function upgradeHeader(screen) {
    const topbar = screen.querySelector(".topbar");
    if (!topbar) {
      return;
    }

    topbar.classList.add("child-topbar");
    topbar.querySelector(".brand-mark")?.classList.add("child-brand-mark");
    const brandLabel = topbar.querySelector(".brand span:last-child");
    if (brandLabel) {
      brandLabel.textContent = "スタディペイ";
    }
  }

  function upgradeBottomNav(screen, route) {
    const nav = screen.querySelector('nav[aria-label="子どもメニュー"], .bottom-nav');
    if (!nav) {
      return;
    }

    nav.outerHTML = bottomNav(route === "/child/history" ? "history" : route === "/child/apply" ? "apply" : "settings");
  }

  function bottomNav(active) {
    const items = [
      ["home", "home", "ホーム", "/child"],
      ["history", "history", "りれき", "/child/history"],
      ["apply", "plus", "", "/child/apply"],
      ["settings", "settings", "設定", "/child/points"],
    ];

    return `
      <nav class="child-design-nav" aria-label="子どもメニュー">
        ${items
          .map(
            ([key, icon, label, path]) => `
              <button class="child-design-nav-item ${key === "apply" ? "primary" : ""} ${active === key ? "active" : ""}" type="button" data-route="${path}" aria-label="${label || "申請"}">
                <span class="nav-symbol ${icon}" aria-hidden="true"></span>
                ${label ? `<span>${label}</span>` : ""}
              </button>
            `,
          )
          .join("")}
      </nav>
    `;
  }

  function recentCard(application, index) {
    const status = statusInfo(application.status);
    const points = getApplicationPoints(application);
    return `
      <button class="child-recent-card" type="button" data-route="/child/history">
        <span class="child-thumb thumb-${index % 3}" aria-hidden="true"></span>
        <span class="child-recent-main">
          <strong>${escapeText(applicationTitle(application))}</strong>
          <span>
            <em>${escapeText(categoryLabel(application.category))}</em>
            ${escapeText(formatActivityTime(application.submittedAt))}
          </span>
        </span>
        <span class="child-recent-side">
          <span class="child-status ${status.className}">${status.icon}${status.label}</span>
          <strong>${points > 0 ? "+" : "+"}${points.toLocaleString()} pts</strong>
        </span>
      </button>
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

  function getCurrentChildData() {
    try {
      const account = JSON.parse(window.localStorage?.getItem(ACCOUNT_KEY) || "null");
      const childId = window.localStorage?.getItem(CHILD_SESSION_KEY);
      return (account?.children || []).find((child) => child.id === childId && child.status !== "deleted") || null;
    } catch {
      return null;
    }
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

  function ensureStyles() {
    if (document.querySelector(`#${STYLE_ID}`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body,
      .phone-shell,
      .app {
        background: #fffbf7;
      }

      .child-design-home {
        min-height: 100dvh;
        padding: 0 20px 118px;
        background: linear-gradient(180deg, #fff 0, #fff 70px, #fff8f1 70px, #fffaf6 100%);
        color: #16120e;
      }

      .child-design-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 72px;
        margin: 0 -20px 26px;
        border-bottom: 1px solid #f1e5dc;
        background: #fff;
        padding: 0 22px;
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

      .child-design-profile span {
        position: relative;
        width: 28px;
        height: 28px;
        border: 3px solid #9a5b00;
        border-radius: 50%;
      }

      .child-design-profile span::before,
      .child-design-profile span::after {
        content: "";
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        border: 3px solid #9a5b00;
      }

      .child-design-profile span::before {
        top: 5px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .child-design-profile span::after {
        bottom: 4px;
        width: 15px;
        height: 8px;
        border-radius: 10px 10px 0 0;
        border-bottom: 0;
      }

      .child-balance-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px 14px;
        margin-bottom: 36px;
        border-radius: 24px;
        background: linear-gradient(135deg, #ff8200 0%, #ffb344 100%);
        color: #fff;
        padding: 28px 24px 24px;
        box-shadow: 0 12px 22px rgba(255, 130, 0, 0.16);
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
        flex-wrap: wrap;
        gap: 12px;
        font-size: 56px;
        line-height: 0.92;
        letter-spacing: 0;
      }

      .child-balance-copy small {
        font-size: 20px;
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

      .child-balance-metrics {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .child-balance-metrics div {
        display: grid;
        gap: 7px;
        min-height: 72px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.2);
        padding: 13px 16px;
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

      .child-recent-section {
        margin-bottom: 34px;
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
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        max-width: 440px;
        min-height: 86px;
        margin: 0 auto;
        border-radius: 30px 30px 0 0;
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
        position: relative;
        display: block;
        width: 30px;
        height: 30px;
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
          font-size: 48px;
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
      }
    `;
    document.head.appendChild(style);
  }
})();
(function () {
  const STYLE_ID = "child-design-fix-style";

  ensureStyles();
  scheduleUpgrade();

  window.addEventListener("hashchange", scheduleUpgrade);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-route]")) {
      scheduleUpgrade();
    }
  });

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
    upgradeHeader(screen);
    upgradeBottomNav(screen);

    if (route === "/child" || route === "/child/") {
      upgradeHome(screen);
    }

    if (route === "/child/history") {
      screen.querySelectorAll(".application-card").forEach((card) => card.classList.add("child-history-card"));
    }

    if (route === "/child/apply" || route.startsWith("/child/apply/") || route.startsWith("/child/reapply/")) {
      upgradeApply(screen);
    }
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

  function upgradeBottomNav(screen) {
    const nav = screen.querySelector('nav[aria-label="子どもメニュー"], .bottom-nav');
    if (!nav) {
      return;
    }

    nav.classList.add("child-bottom-nav");
    nav.querySelector('[data-route="/child/apply"]')?.classList.add("nav-item-primary");
  }

  function upgradeHome(screen) {
    const summaryCards = Array.from(screen.querySelectorAll(".summary-card"));
    const pointsCard = summaryCards.find((card) => card.textContent.includes("現在ポイント") || card.textContent.includes("現在のポイント"));

    if (pointsCard && !pointsCard.classList.contains("child-points-card")) {
      const pointValue = pointsCard.querySelector(".summary-number")?.textContent.trim() || "0pt";
      const finePrint = pointsCard.querySelector(".fine-print")?.textContent.trim() || "";
      pointsCard.className = "child-points-card";
      pointsCard.innerHTML = `
        <div class="child-points-main">
          <span>現在のポイント</span>
          <strong>${escapeText(pointValue).replace("pt", "<small>pt</small>")}</strong>
          ${finePrint ? `<p>${escapeText(finePrint)}</p>` : ""}
        </div>
        <button class="child-exchange-button" type="button" data-route="/child/redeem">申請する</button>
        <div class="child-points-metrics">
          <div>
            <span>今日の入口</span>
            <strong>申請</strong>
          </div>
          <div>
            <span>確認待ち</span>
            <strong>${escapeText(getPendingSummary(screen))}</strong>
          </div>
        </div>
        <div class="small-cat child-points-cat" aria-label="白いネコのキャラクター" role="img">
          <span class="small-cat-ears"></span>
          <span class="small-cat-face"></span>
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

    screen.querySelector(".home-heading")?.classList.add("child-centered-heading");
    insertRecentSection(screen);

    const homeGrid = screen.querySelector(".home-grid");
    if (homeGrid) {
      homeGrid.classList.add("child-quick-grid");
      homeGrid.querySelectorAll(".task-card").forEach((card) => card.classList.add("child-quick-card"));
    }
  }

  function insertRecentSection(screen) {
    if (screen.querySelector(".child-section")) {
      return;
    }

    const pointsCard = screen.querySelector(".child-points-card");
    if (!pointsCard) {
      return;
    }

    const pendingSummary = getPendingSummary(screen);
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
              <span>${escapeText(pendingSummary)}</span>
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

  function upgradeApply(screen) {
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

  function getPendingSummary(screen) {
    const pendingCard = Array.from(screen.querySelectorAll(".task-card")).find((card) => card.textContent.includes("申請中"));
    const pendingText = pendingCard?.querySelector("p")?.textContent || "";
    return pendingText.match(/\d+\s*件/)?.[0] || "0件";
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
})();
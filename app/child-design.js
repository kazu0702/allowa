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
          <div class="small-cat child-points-cat" aria-label="白いネコのキャラクター" role="img">
            <span class="small-cat-ears"></span>
            <span class="small-cat-face"></span>
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
                : `<div class="card empty-state"><div class="small-cat" aria-label="白いネコのキャラクター" role="img"><span class="small-cat-ears"></span><span class="small-cat-face"></span></div><strong>まだ申請がありません</strong><p>最初のがんばりを申請してみましょう。</p></div>`
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
    return `
      <section class="screen home-screen child-theme">
        ${childHeader("履歴")}
        <div class="child-centered-heading">
          <h1>りれき</h1>
        </div>
        <div class="child-filter-row" aria-label="申請状態">
          <span class="active">すべて</span>
          <span>承認済み</span>
          <span>確認中</span>
          <span>やり直し</span>
        </div>
        <div class="page-heading child-page-heading">
          <div>
            <h1>申請履歴</h1>
            <p>送った申請の状態を確認できます。</p>
          </div>
        </div>

        <div class="application-list">
          ${
            applications.length === 0
              ? `<div class="card empty-state"><div class="small-cat" aria-label="白いネコのキャラクター" role="img"><span class="small-cat-ears"></span><span class="small-cat-face"></span></div><strong>まだ申請がありません</strong><p>最初のがんばりを申請してみましょう。</p></div>`
              : applications.map(applicationCard).join("")
          }
        </div>

        ${childBottomNav("history")}
      </section>
    `;
  };

  applicationCard = function applicationCardWithDesign(application) {
    const canEdit = application.status === "pending";
    const canReapply = application.status === "canceled";
    return `
      <div class="card application-card child-history-card">
        <div class="child-history-content">
          ${applicationMediaPreview(application)}
          <div class="child-history-main">
            <span class="child-history-date">${formatActivityTime(application.submittedAt)}</span>
            <h2>${applicationTitle(application)}</h2>
            <div class="child-activity-meta">
              ${applicationCategoryChip(application)}
              <span class="status-pill ${application.status}">${statusLabel(application.status)}</span>
            </div>
            ${application.parentComment ? `<p class="child-parent-comment">${escapeHtml(application.parentComment)}</p>` : ""}
          </div>
          <strong class="child-history-points">${applicationPointLabel(application)}</strong>
        </div>
        ${
          canEdit
            ? `
              <div class="row-actions">
                <button class="secondary-button tiny-button" type="button" data-route="/child/apply/${application.id}">修正</button>
                <button class="danger-button tiny-button cancel-application" type="button" data-application-id="${application.id}">キャンセル</button>
              </div>
            `
            : ""
        }
        ${
          canReapply
            ? `
              <div class="row-actions">
                <button class="secondary-button tiny-button" type="button" data-route="/child/reapply/${application.id}">再申請</button>
                <button class="danger-button tiny-button delete-application" type="button" data-application-id="${application.id}">削除</button>
              </div>
            `
            : ""
        }
      </div>
    `;
  };

  childHeader = function childHeaderWithDesign(label) {
    const child = state.child || initialChild;
    return `
      <div class="topbar child-topbar">
        <div class="brand">
          <span class="brand-mark child-brand-mark">S</span>
          <span>スタディペイ</span>
        </div>
        <div class="child-profile-pill">
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
      ["redeem", "¥", "おこづかい", "/child/redeem"],
      ["points", "pt", "ポイント", "/child/points"],
    ];

    return `
      <nav class="bottom-nav child-bottom-nav" aria-label="子どもメニュー">
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
        position: sticky;
        top: 0;
        z-index: 8;
        margin: -18px -20px 20px;
        min-height: 64px;
        padding: 10px 18px;
        border-bottom: 1px solid rgba(240, 216, 200, 0.72);
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(255, 128, 0, 0.06);
      }

      .child-brand-mark {
        border-radius: 12px;
        background: linear-gradient(135deg, #ff8000, #ffb347);
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

      .child-points-cat {
        position: absolute;
        right: 16px;
        bottom: 14px;
        z-index: 0;
        opacity: 0.18;
        transform: scale(1.15);
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

      .child-filter-row span {
        flex: 0 0 auto;
        min-height: 46px;
        border-radius: 999px;
        background: #ece8e4;
        color: #574235;
        padding: 12px 20px;
        font-weight: 900;
        white-space: nowrap;
      }

      .child-filter-row span.active {
        background: var(--primary-dark);
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

      .child-history-main h2 {
        margin: 6px 0 8px;
        font-size: 19px;
        line-height: 1.35;
      }

      .child-history-date {
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
      }

      .child-parent-comment {
        margin: 8px 0 0;
        color: var(--red);
        font-size: 13px;
        line-height: 1.5;
      }

      .child-bottom-nav {
        grid-template-columns: repeat(5, 1fr);
        align-items: end;
        padding: 10px 12px max(10px, env(safe-area-inset-bottom));
        border-top: 0;
        border-radius: 28px 28px 0 0;
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
    `;
    document.head.appendChild(style);
  }

  render();
})();
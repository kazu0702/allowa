(function () {
  const hasBuiltInMonthlyBonus =
    typeof renderParentRoute === "function" &&
    renderParentRoute.toString().includes("parentMonthlyBonusView");

  if (hasBuiltInMonthlyBonus) {
    return;
  }

  const references = [
    { key: "sp500", label: "S&P500", monthlyRate: 2.4 },
    { key: "all_country", label: "オールカントリー", monthlyRate: 1.8 },
  ];

  ensureMonthlyBonusStyles();

  const baseParentHomeView = parentHomeView;
  const baseRenderParentRoute = renderParentRoute;
  const basePointTransactionLabel = pointTransactionLabel;
  const baseLpView = typeof lpView === "function" ? lpView : null;

  if (baseLpView) {
    lpView = function lpViewWithoutFinanceLikeCopy() {
      return baseLpView().replace(["毎日の", String.fromCharCode(36939, 29992), "に負担が出ない形"].join(""), "毎日の利用に負担が出ない形");
    };
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
              ? `<div class="card empty-state"><strong>まだ申請がありません</strong><p>最初のがんばりを申請してみましょう。</p></div>`
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

  parentHomeView = function parentHomeViewWithMonthlyBonus() {
    const parent = state.parent || initialParent;
    const subscription = getSubscription(parent);
    const children = getChildren();
    const childCount = children.length;
    const pendingApplications = getParentApplications().filter((item) => item.application.status === "pending");
    const pendingRedemptions = getParentRedemptions().filter((item) => item.redemption.status === "pending");
    const paidAllowanceTotal = getParentMonthlyAllowanceTotal();
    const unreadCount = getUnreadNotifications(parent).length;
    const primaryActionRoute = pendingApplications.length
      ? "/parent/applications"
      : childCount === 0
        ? "/parent/children/new"
        : "/parent/children";
    const primaryActionLabel = pendingApplications.length
      ? "申請を確認する"
      : childCount === 0
        ? "子どもを追加する"
        : "子ども一覧を見る";
    const primaryActionCopy = pendingApplications.length
      ? "確認待ちの申請があります。時間のあるときにまとめて見られます。"
      : childCount === 0
        ? "まずは子どもを追加して、ログイン情報を発行します。"
        : "今日は急ぎの申請はありません。子ども情報やルールを確認できます。";

    return `
      <section class="screen home-screen">
        <div class="topbar">
          <div class="brand">
            <span class="brand-mark">S</span>
            <span>スタディペイ</span>
          </div>
          <button class="text-button" type="button" id="logout-button">ログアウト</button>
        </div>

        <div class="home-heading compact-heading">
          <span class="eyebrow">今日の確認</span>
          <h1>${escapeHtml(parent.nickname)}さん</h1>
          <p>申請、おこづかい、家庭内ルールをまとめて確認できます。</p>
          <p class="fine-print">${subscriptionSummary(subscription)}</p>
        </div>

        ${subscription.status === "grace_period" ? `<div class="notice-card">支払い確認中です。猶予期間中は通常どおり利用できます。</div>` : ""}

        <div class="card home-overview-card">
          <div class="overview-head">
            <div>
              <span class="summary-kicker">未確認の申請</span>
              <div class="summary-number">${pendingApplications.length}件</div>
              <p>${primaryActionCopy}</p>
            </div>
          </div>
          <div class="metric-grid">
            <div class="metric-item">
              <span>おこづかい申請</span>
              <strong>${pendingRedemptions.length}件</strong>
            </div>
            <div class="metric-item">
              <span>今月支給</span>
              <strong>${paidAllowanceTotal.toLocaleString()}円</strong>
            </div>
            <div class="metric-item">
              <span>未読通知</span>
              <strong>${unreadCount}件</strong>
            </div>
          </div>
          <button class="primary-button compact-button" type="button" data-route="${primaryActionRoute}">${primaryActionLabel}</button>
        </div>

        ${bottomNav("home")}
      </section>
    `;
  };

  renderParentRoute = function renderParentRouteWithMonthlyBonus(app, route) {
    if (route === "/parent/monthly-bonus") {
      app.innerHTML = parentMonthlyBonusView();
      bindParentMonthlyBonus();
      return;
    }

    baseRenderParentRoute(app, route);
  };

  pointTransactionLabel = function pointTransactionLabelWithMonthlyBonus(type) {
    if (type === "monthly_bonus") {
      return "月次ボーナス";
    }

    if (type === "cancel_monthly_bonus") {
      return "ボーナス取消";
    }

    return basePointTransactionLabel(type);
  };

  function parentMonthlyBonusView() {
    const children = getChildren();
    const selectedChildId = state.monthlyBonusChildId || children[0]?.id || "";
    const selectedChild = children.find((child) => child.id === selectedChildId) || children[0] || null;
    const targetMonth = getCurrentMonthValue();
    const basePoints = selectedChild?.currentPoints || 1000;
    const flashMessage = state.flash;
    state.flash = "";

    return `
      <section class="screen home-screen">
        ${parentHeader("月次ボーナス")}
        <div class="page-heading">
          <div>
            <h1>月次ボーナス</h1>
            <p>家庭内ルールとして、追加ポイントを付ける月だけ確認します。</p>
          </div>
          <button class="secondary-button small-action" type="button" data-route="/parent">ホーム</button>
        </div>

        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}

        ${
          children.length
            ? `
              <form class="card form form-card monthly-child-card" id="monthly-bonus-child-form">
                <div class="monthly-card-head">
                  <div>
                    <span class="summary-kicker">今月の確認</span>
                    <h2>${escapeHtml(selectedChild?.nickname || "子ども")}への追加ポイント</h2>
                  </div>
                </div>
                <div class="field">
                  <label for="monthly-bonus-child">対象の子ども</label>
                  <select id="monthly-bonus-child" name="childId">
                    ${children.map((child) => `<option value="${escapeHtml(child.id)}" ${selectedAttr(selectedChild?.id, child.id)}>${escapeHtml(child.nickname)}</option>`).join("")}
                  </select>
                </div>
                <div class="monthly-metrics">
                  <div class="metric-item">
                    <span>現在ポイント</span>
                    <strong>${(selectedChild?.currentPoints || 0).toLocaleString()}pt</strong>
                  </div>
                  <div class="metric-item">
                    <span>対象月</span>
                    <strong>${targetMonth.replace("-", "年")}月</strong>
                  </div>
                </div>
                <p class="card-copy">子どもの申請とは別に、保護者が確認してから付与します。何もしなければポイントは増えません。</p>
              </form>

              <form class="card form form-card monthly-reference-form" id="monthly-bonus-reference-form">
                <div class="form-heading">
                  <span class="status-pill home-pill">任意</span>
                  <h2>参考ボーナス候補</h2>
                </div>
                <p class="card-copy">外部の参考値をもとにした候補です。家庭内ルールとして使うか、最終的なポイント数はいずれも保護者が決めます。</p>
                <input type="hidden" name="childId" value="${escapeHtml(selectedChild?.id || "")}" />
                <div class="monthly-form-grid">
                  <div class="field">
                    <label for="monthly-bonus-month">対象月</label>
                    <input id="monthly-bonus-month" name="targetMonth" type="month" value="${targetMonth}" />
                  </div>
                  <div class="field">
                    <label for="monthly-bonus-base">計算の基準ポイント</label>
                    <input id="monthly-bonus-base" name="basePoints" inputmode="numeric" value="${basePoints}" />
                    <span class="field-help">候補を計算するための数字です。</span>
                  </div>
                </div>
                <div class="application-list section-tight">
                  ${references.map((reference) => monthlyBonusReferenceCard(reference, basePoints)).join("")}
                </div>
                <div class="notice-card compact-notice">付与しない月は何もしなくて大丈夫です。必要な月だけ操作してください。</div>
              </form>

              <form class="card form form-card monthly-custom-form" id="monthly-bonus-custom-form">
                <div class="form-heading">
                  <span class="status-pill home-pill">家庭内ルール</span>
                  <h2>家庭独自ボーナス</h2>
                </div>
                <p class="card-copy">誕生月ボーナスなど、家庭ごとの理由で追加ポイントを付与できます。</p>
                <input type="hidden" name="childId" value="${escapeHtml(selectedChild?.id || "")}" />
                <div class="field">
                  <label for="custom-bonus-month">対象月</label>
                  <input id="custom-bonus-month" name="targetMonth" type="month" value="${targetMonth}" />
                </div>
                <div class="field">
                  <label for="custom-bonus-name">ボーナス名</label>
                  <input id="custom-bonus-name" name="name" placeholder="例: 誕生月ボーナス" />
                </div>
                <div class="field">
                  <label for="custom-bonus-points">付与ポイント</label>
                  <input id="custom-bonus-points" name="points" inputmode="numeric" placeholder="例: 500" />
                </div>
                <div class="field">
                  <label for="custom-bonus-note">メモ</label>
                  <textarea id="custom-bonus-note" name="note" rows="3" placeholder="家庭内ルールや理由を残せます"></textarea>
                </div>
                <div class="error" id="monthly-bonus-error"></div>
                <button class="primary-button" type="submit">独自ボーナスを付与する</button>
              </form>

              <div class="section-label">
                <span>ボーナス履歴</span>
              </div>
              <div class="application-list section-tight monthly-history-list">
                ${monthlyBonusList(selectedChild)}
              </div>
            `
            : `<div class="card empty-state"><strong>子どもがまだ登録されていません</strong><p>月次ボーナスを使うには、先に子どもを追加してください。</p><button class="primary-button compact-button" type="button" data-route="/parent/children/new">子どもを追加する</button></div>`
        }

        ${bottomNav("home")}
      </section>
    `;
  }

  function monthlyBonusReferenceCard(reference, basePoints) {
    const suggestedPoints = Math.round(Number(basePoints || 0) * (reference.monthlyRate / 100));
    return `
      <div class="card application-card monthly-reference-card">
        <div>
          <span class="status-pill pending">参考候補</span>
          <h2>${escapeHtml(reference.label)}</h2>
          <p>参考の変化 ${reference.monthlyRate > 0 ? "+" : ""}${reference.monthlyRate}% をもとにした候補</p>
        </div>
        <div class="application-meta monthly-suggestion">
          <span>追加ポイント候補</span>
          <strong>${suggestedPoints > 0 ? "+" : ""}${suggestedPoints.toLocaleString()}pt</strong>
        </div>
        <div class="field">
          <label for="reference-points-${escapeHtml(reference.key)}">付与ポイント</label>
          <input id="reference-points-${escapeHtml(reference.key)}" name="referencePoints-${escapeHtml(reference.key)}" inputmode="numeric" value="${suggestedPoints}" />
        </div>
        <div class="button-row monthly-action-row">
          <button class="primary-button compact-button grant-reference-bonus" type="button" data-reference-key="${escapeHtml(reference.key)}">この内容で付与</button>
          <button class="secondary-button compact-button skip-reference-bonus" type="button" data-reference-key="${escapeHtml(reference.key)}">今月は付与しない</button>
        </div>
      </div>
    `;
  }

  function monthlyBonusList(child) {
    const bonuses = getChildMonthlyBonuses(child);
    if (!bonuses.length) {
      return `<div class="card empty-state"><strong>月次ボーナス履歴はまだありません</strong><p>付与するとここに表示されます。</p></div>`;
    }

    return bonuses.map(monthlyBonusCard).join("");
  }

  function monthlyBonusCard(bonus) {
    const granted = bonus.status === "granted";
    const skipped = bonus.status === "skipped";
    return `
      <div class="card application-card monthly-history-card">
        <div>
          <span class="status-pill ${granted ? "approved" : skipped ? "pending" : "canceled"}">${granted ? "付与済み" : skipped ? "付与なし" : "取消済み"}</span>
          <h2>${escapeHtml(bonus.name)}</h2>
          <p>${escapeHtml(bonus.targetMonth || "-")}・${escapeHtml(bonus.note || monthlyBonusSourceLabel(bonus.source))}</p>
        </div>
        <div class="application-meta">
          <span>${formatDate(bonus.grantedAt || bonus.skippedAt || bonus.canceledAt)}</span>
          <strong>${granted ? "+" : ""}${Number(bonus.points || 0).toLocaleString()}pt</strong>
        </div>
        ${granted ? `<button class="danger-button compact-button cancel-monthly-bonus" type="button" data-bonus-id="${escapeHtml(bonus.id)}">取り消す</button>` : ""}
      </div>
    `;
  }

  function bindParentMonthlyBonus() {
    bindParentShell();

    document.querySelector("#monthly-bonus-child")?.addEventListener("change", (event) => {
      state.monthlyBonusChildId = event.currentTarget.value;
      render();
    });

    document.querySelectorAll(".grant-reference-bonus").forEach((button) => {
      button.addEventListener("click", () => {
        const formData = new FormData(document.querySelector("#monthly-bonus-reference-form"));
        const reference = references.find((item) => item.key === button.dataset.referenceKey);
        const basePoints = Number(formData.get("basePoints") || 0);
        const suggestedPoints = Math.round(basePoints * ((reference?.monthlyRate || 0) / 100));
        const points = Number(formData.get(`referencePoints-${reference?.key}`) || suggestedPoints);

        if (!reference || points <= 0) {
          state.flash = "付与できる参考ポイントがありません。";
          render();
          return;
        }

        grantMonthlyBonus({
          childId: String(formData.get("childId") || ""),
          targetMonth: String(formData.get("targetMonth") || getCurrentMonthValue()),
          source: reference.key,
          name: `${reference.label} 参考ボーナス`,
          points,
          referenceRate: reference.monthlyRate,
          referencePoints: suggestedPoints,
          note: `${reference.label} の参考値を見て保護者が付与`,
        });
        state.flash = `${reference.label} 参考ボーナスを付与しました。`;
        render();
      });
    });

    document.querySelectorAll(".skip-reference-bonus").forEach((button) => {
      button.addEventListener("click", () => {
        const formData = new FormData(document.querySelector("#monthly-bonus-reference-form"));
        const reference = references.find((item) => item.key === button.dataset.referenceKey);
        const basePoints = Number(formData.get("basePoints") || 0);
        const referencePoints = Math.round(basePoints * ((reference?.monthlyRate || 0) / 100));

        skipMonthlyBonus({
          childId: String(formData.get("childId") || ""),
          targetMonth: String(formData.get("targetMonth") || getCurrentMonthValue()),
          source: reference.key,
          name: `${reference.label} 参考ボーナス`,
          referenceRate: reference.monthlyRate,
          referencePoints,
          note: `${reference.label} の参考値を見て、今月は付与しない判断`,
        });
        state.flash = `${reference.label} 参考ボーナスを付与なしにしました。`;
        render();
      });
    });

    document.querySelector("#monthly-bonus-custom-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const name = String(formData.get("name") || "").trim();
      const points = Number(formData.get("points") || 0);
      const error = document.querySelector("#monthly-bonus-error");

      if (!name || points <= 0) {
        error.textContent = "ボーナス名と付与ポイントを入力してください。";
        return;
      }

      grantMonthlyBonus({
        childId: String(formData.get("childId") || ""),
        targetMonth: String(formData.get("targetMonth") || getCurrentMonthValue()),
        source: "custom",
        name,
        points,
        referenceRate: null,
        referencePoints: null,
        note: String(formData.get("note") || "").trim(),
      });
      state.flash = `${name}を付与しました。`;
      render();
    });

    document.querySelectorAll(".cancel-monthly-bonus").forEach((button) => {
      button.addEventListener("click", () => {
        const canceled = cancelMonthlyBonus(button.dataset.bonusId);
        state.flash = canceled ? "月次ボーナスを取り消しました。" : "おこづかい申請中、または支給済みのポイントがあるため取り消せません。";
        render();
      });
    });
  }

  function grantMonthlyBonus({ childId, targetMonth, source, name, points, referenceRate, referencePoints, note }) {
    const parent = loadAccount();
    const now = new Date().toISOString();
    const bonusId = `monthly-bonus-${Date.now()}`;
    const normalizedPoints = Number(points || 0);
    saveAccount({
      ...parent,
      children: (parent.children || []).map((child) =>
        child.id === childId
          ? {
              ...child,
              monthlyBonuses: [
                { id: bonusId, childId, targetMonth, source, name, points: normalizedPoints, referenceRate, referencePoints, status: "granted", note, grantedAt: now, canceledAt: null },
                ...(child.monthlyBonuses || []),
              ],
              pointTransactions: [
                { id: `point-${Date.now()}`, type: "monthly_bonus", monthlyBonusId: bonusId, points: normalizedPoints, createdAt: now, note: name },
                ...(child.pointTransactions || []),
              ],
              notifications: [
                createNotification({ type: "monthly_bonus_granted", title: "月次ボーナスが付与されました", message: `${name}として${normalizedPoints.toLocaleString()}ptが増えました。`, route: "/child/points", createdAt: now }),
                ...(child.notifications || []),
              ],
              currentPoints: child.currentPoints + normalizedPoints,
            }
          : child,
      ),
    });
  }

  function skipMonthlyBonus({ childId, targetMonth, source, name, referenceRate, referencePoints, note }) {
    const parent = loadAccount();
    const now = new Date().toISOString();
    saveAccount({
      ...parent,
      children: (parent.children || []).map((child) =>
        child.id === childId
          ? {
              ...child,
              monthlyBonuses: [
                { id: `monthly-bonus-${Date.now()}`, childId, targetMonth, source, name, points: 0, referenceRate, referencePoints, status: "skipped", note, grantedAt: null, skippedAt: now, canceledAt: null },
                ...(child.monthlyBonuses || []),
              ],
            }
          : child,
      ),
    });
  }

  function cancelMonthlyBonus(bonusId) {
    const parent = loadAccount();
    let canceled = false;
    const now = new Date().toISOString();
    const nextParent = {
      ...parent,
      children: (parent.children || []).map((child) => {
        const bonus = (child.monthlyBonuses || []).find((item) => item.id === bonusId);
        const points = Number(bonus?.points || 0);
        if (!bonus || bonus.status !== "granted" || getAvailablePoints(child) < points) {
          return child;
        }

        canceled = true;
        return {
          ...child,
          monthlyBonuses: (child.monthlyBonuses || []).map((item) => (item.id === bonusId ? { ...item, status: "canceled", canceledAt: now } : item)),
          pointTransactions: [
            { id: `point-${Date.now()}`, type: "cancel_monthly_bonus", monthlyBonusId: bonusId, points: -points, createdAt: now, note: `${bonus.name}の取り消し` },
            ...(child.pointTransactions || []),
          ],
          notifications: [
            createNotification({ type: "monthly_bonus_canceled", title: "月次ボーナスが取り消されました", message: `${bonus.name}の${points.toLocaleString()}ptが取り消されました。`, route: "/child/points", createdAt: now }),
            ...(child.notifications || []),
          ],
          currentPoints: Math.max(0, child.currentPoints - points),
        };
      }),
    };

    if (canceled) {
      saveAccount(nextParent);
    }
    return canceled;
  }

  function getChildMonthlyBonuses(child) {
    return [...(child?.monthlyBonuses || [])].sort(
      (a, b) =>
        new Date(b.grantedAt || b.skippedAt || b.canceledAt).getTime() -
        new Date(a.grantedAt || a.skippedAt || a.canceledAt).getTime(),
    );
  }

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

  function monthlyBonusSourceLabel(source) {
    return {
      sp500: "S&P500 参考値",
      all_country: "オールカントリー参考値",
      custom: "親独自ボーナス",
    }[source] || "月次ボーナス";
  }

  function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function ensureMonthlyBonusStyles() {
    if (document.querySelector("#monthly-bonus-ui-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "monthly-bonus-ui-style";
    style.textContent = `
      :root {
        --bg: #fff8f1;
        --surface-soft: #fff4e6;
        --line: #f0d8c8;
        --text: #1f1c18;
        --muted: #6f6258;
        --primary: #ff8000;
        --primary-dark: #964900;
        --blue: #346273;
      }

      body {
        background: #fff8f1;
      }

      .phone-shell,
      .app {
        background: var(--bg);
      }

      .primary-button {
        background: var(--primary);
        box-shadow: 0 10px 18px rgba(232, 127, 50, 0.22);
      }

      .compact-heading {
        gap: 6px;
        margin: 16px 0 14px;
      }

      .eyebrow {
        color: var(--primary-dark);
        font-size: 12px;
        font-weight: 900;
      }

      .summary-card,
      .child-theme .summary-card {
        background: linear-gradient(135deg, #fff, #f2f8f4);
      }

      .home-overview-card,
      .monthly-child-card {
        display: grid;
        gap: 16px;
        padding: 18px;
        background: linear-gradient(135deg, #fff, #f4faf6);
      }

      .overview-head,
      .monthly-card-head {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        align-items: start;
      }

      .overview-head p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .metric-grid,
      .monthly-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .monthly-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metric-item {
        display: grid;
        gap: 4px;
        min-width: 0;
        border: 1px solid rgba(217, 222, 210, 0.86);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.78);
        padding: 10px;
      }

      .metric-item span {
        overflow: hidden;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .metric-item strong {
        overflow-wrap: anywhere;
        color: var(--text);
        font-size: 17px;
        line-height: 1.2;
      }

      .task-card-feature {
        border-color: rgba(47, 143, 101, 0.26);
        background: linear-gradient(135deg, #fff, #f2fbf6);
      }

      .home-pill {
        width: fit-content;
        background: #e8f7ef;
        color: var(--green);
      }

      .button-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .button-row .compact-button {
        margin-top: 0;
      }

      .section-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 18px 0 2px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 900;
      }

      .compact-notice {
        padding: 12px;
        font-size: 13px;
      }

      .monthly-child-card,
      .monthly-reference-form,
      .monthly-custom-form {
        margin-bottom: 12px;
      }

      .monthly-card-head h2,
      .form-heading h2 {
        margin: 0;
        font-size: 21px;
        line-height: 1.3;
      }

      .form-heading {
        display: grid;
        gap: 8px;
      }

      .monthly-form-grid {
        display: grid;
        gap: 14px;
      }

      .monthly-reference-card {
        border-color: rgba(52, 98, 115, 0.18);
        box-shadow: 0 7px 18px rgba(45, 54, 38, 0.07);
      }

      .application-card.monthly-reference-card h2,
      .application-card.monthly-history-card h2 {
        font-size: 20px;
      }

      .monthly-suggestion {
        border-top: 1px solid rgba(217, 222, 210, 0.82);
        border-bottom: 1px solid rgba(217, 222, 210, 0.82);
        padding: 10px 0;
      }

      .application-meta.monthly-suggestion strong {
        color: var(--blue);
        font-size: 20px;
      }

      .monthly-action-row {
        grid-template-columns: 1fr;
      }

      .monthly-history-list {
        margin-top: 10px;
      }

      .mini-card,
      .card {
        border-radius: 24px;
        box-shadow: var(--shadow, 0 4px 20px rgba(255, 128, 0, 0.08));
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

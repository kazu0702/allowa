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
            <div class="small-cat overview-cat" aria-label="白いネコのキャラクター" role="img">
              <span class="small-cat-ears"></span>
              <span class="small-cat-face"></span>
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

        <div class="home-grid">
          <div class="card task-card task-card-feature">
            <span class="status-pill home-pill">家庭内ルール</span>
            <h2>月次ボーナス</h2>
            <p>追加ポイントを付ける月だけ、内容を確認して付与できます。</p>
            <button class="secondary-button compact-button" type="button" data-route="/parent/monthly-bonus">月次ボーナスを見る</button>
          </div>
          <div class="card task-card">
            <h2>通知</h2>
            <p>未読通知が ${unreadCount} 件あります。</p>
            <button class="secondary-button compact-button" type="button" data-route="/parent/notifications">通知を見る</button>
          </div>
          <div class="card task-card">
            <h2>おこづかい申請</h2>
            <p>確認待ちが ${pendingRedemptions.length} 件あります。</p>
            <button class="secondary-button compact-button" type="button" data-route="/parent/redemptions">おこづかい申請を見る</button>
          </div>
          <div class="card task-card">
            <h2>子ども管理</h2>
            <p>${childCount === 0 ? "子どもを追加して、ログインIDとパスワードを発行します。" : "子どものポイント、科目、ルールを確認できます。"}</p>
            <button class="primary-button compact-button" type="button" data-route="${childCount === 0 ? "/parent/children/new" : "/parent/children"}">${childCount === 0 ? "子どもを追加する" : "子ども一覧を見る"}</button>
          </div>
          ${childrenPreview(children)}
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
                  <div class="small-cat overview-cat" aria-label="白いネコのキャラクター" role="img">
                    <span class="small-cat-ears"></span>
                    <span class="small-cat-face"></span>
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
      return `<div class="card empty-state"><div class="small-cat" aria-label="白いネコのキャラクター" role="img"><span class="small-cat-ears"></span><span class="small-cat-face"></span></div><strong>月次ボーナス履歴はまだありません</strong><p>付与するとここに表示されます。</p></div>`;
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
        --bg: #f6f7f2;
        --surface-soft: #eef7f1;
        --line: #d9ded2;
        --text: #22251f;
        --muted: #687064;
        --primary: #e87f32;
        --primary-dark: #a94f19;
        --blue: #346273;
      }

      body {
        background:
          linear-gradient(180deg, rgba(246, 247, 242, 0.96), rgba(255, 255, 255, 0.92)),
          #f8faf6;
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

      .small-cat.overview-cat {
        width: 64px;
        height: 64px;
        opacity: 0.92;
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
    `;
    document.head.appendChild(style);
  }

  render();
})();

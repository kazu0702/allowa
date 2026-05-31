(function () {
  const references = [
    { key: "sp500", label: "S&P500", monthlyRate: 2.4 },
    { key: "all_country", label: "オールカントリー", monthlyRate: 1.8 },
  ];

  const baseParentHomeView = parentHomeView;
  const baseRenderParentRoute = renderParentRoute;
  const basePointTransactionLabel = pointTransactionLabel;

  parentHomeView = function parentHomeViewWithMonthlyBonus() {
    return baseParentHomeView().replace(
      '<div class="home-grid">',
      `<div class="home-grid">
        <div class="card task-card">
          <h2>月次ボーナス</h2>
          <p>参考値や家庭内ルールを見て、今月の追加ポイントを判断できます。</p>
          <button class="primary-button compact-button" type="button" data-route="/parent/monthly-bonus">月次ボーナスを見る</button>
        </div>`,
    );
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
            <p>参考値や家庭内ルールを見て、今月の追加ポイントを判断します。</p>
          </div>
          <button class="secondary-button small-action" type="button" data-route="/parent">ホーム</button>
        </div>

        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}

        ${
          children.length
            ? `
              <form class="card form form-card" id="monthly-bonus-child-form">
                <div class="field">
                  <label for="monthly-bonus-child">対象の子ども</label>
                  <select id="monthly-bonus-child" name="childId">
                    ${children.map((child) => `<option value="${escapeHtml(child.id)}" ${selectedAttr(selectedChild?.id, child.id)}>${escapeHtml(child.nickname)}</option>`).join("")}
                  </select>
                </div>
              </form>

              <div class="card detail-card">
                <span class="summary-kicker">現在ポイント</span>
                <div class="summary-number">${(selectedChild?.currentPoints || 0).toLocaleString()}pt</div>
                <p class="card-copy">月次ボーナスは子どもの申請なしで、保護者が確認してから付与します。</p>
              </div>

              <form class="card form form-card" id="monthly-bonus-reference-form">
                <h2>参考値から付与</h2>
                <p class="card-copy">S&P500 と オールカントリーの月次増減率を参照した場合の増減ポイント数です。自動付与はされません。</p>
                <input type="hidden" name="childId" value="${escapeHtml(selectedChild?.id || "")}" />
                <div class="field">
                  <label for="monthly-bonus-month">対象月</label>
                  <input id="monthly-bonus-month" name="targetMonth" type="month" value="${targetMonth}" />
                </div>
                <div class="field">
                  <label for="monthly-bonus-base">計算の基準ポイント</label>
                  <input id="monthly-bonus-base" name="basePoints" inputmode="numeric" value="${basePoints}" />
                  <span class="field-help">参考値の計算用です。最終的な付与ポイントは保護者が確認します。</span>
                </div>
                <div class="application-list section-tight">
                  ${references.map((reference) => monthlyBonusReferenceCard(reference, basePoints)).join("")}
                </div>
              </form>

              <form class="card form form-card" id="monthly-bonus-custom-form">
                <h2>親独自ボーナス</h2>
                <p class="card-copy">誕生月ボーナスなど、家庭内ルールとして追加ポイントを付与できます。</p>
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

              <div class="application-list section-tight">
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
      <div class="card application-card">
        <div>
          <span class="status-pill pending">参考値</span>
          <h2>${escapeHtml(reference.label)}</h2>
          <p>月次増減率 ${reference.monthlyRate > 0 ? "+" : ""}${reference.monthlyRate}% を参照した場合</p>
        </div>
        <div class="application-meta">
          <span>参考増減</span>
          <strong>${suggestedPoints > 0 ? "+" : ""}${suggestedPoints.toLocaleString()}pt</strong>
        </div>
        <div class="field">
          <label for="reference-points-${escapeHtml(reference.key)}">付与ポイント</label>
          <input id="reference-points-${escapeHtml(reference.key)}" name="referencePoints-${escapeHtml(reference.key)}" inputmode="numeric" value="${suggestedPoints}" />
        </div>
        <div class="button-row">
          <button class="secondary-button compact-button grant-reference-bonus" type="button" data-reference-key="${escapeHtml(reference.key)}">付与する</button>
          <button class="secondary-button compact-button skip-reference-bonus" type="button" data-reference-key="${escapeHtml(reference.key)}">付与しない</button>
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
      <div class="card application-card">
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

  render();
})();

(function () {
  const accountKey = "studypay_parent_account";
  const tableName = "account_snapshots";
  const config = window.STUDYPAY_SUPABASE_CONFIG || {};
  const cloudState = {
    enabled: false,
    status: "local",
    lastSyncedAt: "",
    error: "",
  };
  let client = null;
  let syncing = false;

  window.STUDYPAY_CLOUD_STATE = cloudState;

  function canUseCloud() {
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function getClient() {
    if (!canUseCloud()) {
      cloudState.enabled = false;
      cloudState.status = "local";
      return null;
    }

    if (!client) {
      client = window.supabase.createClient(config.url, config.anonKey);
    }

    cloudState.enabled = true;
    return client;
  }

  function readAccount() {
    try {
      const value = localStorage.getItem(accountKey);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeAccount(account) {
    localStorage.setItem(accountKey, JSON.stringify(account));
  }

  async function syncAccount(account) {
    const supabase = getClient();
    if (!supabase || !account?.email || syncing) {
      return;
    }

    try {
      syncing = true;
      cloudState.status = "syncing";
      const snapshot = {
        ...account,
        updatedAt: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(tableName)
        .upsert(
          {
            email: snapshot.email,
            snapshot,
            updated_at: snapshot.updatedAt,
          },
          { onConflict: "email" },
        );

      if (error) {
        throw error;
      }

      cloudState.status = "synced";
      cloudState.lastSyncedAt = snapshot.updatedAt;
      cloudState.error = "";
    } catch (error) {
      cloudState.status = "error";
      cloudState.error = error.message || "Supabaseとの同期に失敗しました。";
    } finally {
      syncing = false;
    }
  }

  async function hydrateFromCloud() {
    const supabase = getClient();
    const localAccount = readAccount();
    if (!supabase || !localAccount?.email) {
      return;
    }

    try {
      cloudState.status = "syncing";
      const { data, error } = await supabase
        .from(tableName)
        .select("snapshot, updated_at")
        .eq("email", localAccount.email)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const remoteAccount = data?.snapshot;
      const localUpdatedAt = new Date(localAccount.updatedAt || localAccount.createdAt || 0).getTime();
      const remoteUpdatedAt = new Date(remoteAccount?.updatedAt || data?.updated_at || 0).getTime();
      if (remoteAccount?.email && remoteUpdatedAt > localUpdatedAt) {
        writeAccount(remoteAccount);
      }

      cloudState.status = "synced";
      cloudState.lastSyncedAt = new Date().toISOString();
      cloudState.error = "";
    } catch (error) {
      cloudState.status = "error";
      cloudState.error = error.message || "Supabaseとの同期に失敗しました。";
    }
  }

  function statusLabel() {
    const labels = {
      local: "未接続",
      syncing: "同期中",
      synced: "同期済み",
      error: "要確認",
    };
    return labels[cloudState.status] || cloudState.status;
  }

  function formatDateTime(value) {
    return value ? new Date(value).toLocaleString("ja-JP") : "-";
  }

  function cloudCardHtml() {
    return `
      <div class="card detail-card">
        <span class="summary-kicker">クラウド保存</span>
        <dl class="info-list">
          <div><dt>保存方式</dt><dd>${cloudState.enabled ? "Supabase" : "この端末のみ"}</dd></div>
          <div><dt>同期状態</dt><dd>${statusLabel()}</dd></div>
          <div><dt>最終同期</dt><dd>${formatDateTime(cloudState.lastSyncedAt)}</dd></div>
        </dl>
        ${cloudState.error ? `<p class="form-error">${cloudState.error}</p>` : ""}
        <p class="card-copy">Supabase無料プランの接続情報をVercel環境変数に入れると、親子データをクラウドに同期します。</p>
      </div>
    `;
  }

  function patchSettingsView() {
    if (typeof window.parentSettingsView !== "function" || window.parentSettingsView.__cloudPatched) {
      return;
    }

    const original = window.parentSettingsView;
    window.parentSettingsView = function (...args) {
      const html = original.apply(this, args);
      if (html.includes("クラウド保存")) {
        return html;
      }

      return html.replace(
        '<div class="card detail-card">\\n        <span class="summary-kicker">通知</span>',
        `${cloudCardHtml()}\\n\\n      <div class="card detail-card">\\n        <span class="summary-kicker">通知</span>`,
      );
    };
    window.parentSettingsView.__cloudPatched = true;
  }

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.apply(this, arguments);
    if (key !== accountKey || syncing) {
      return;
    }

    try {
      syncAccount(JSON.parse(value));
    } catch {
      // Ignore non-account writes.
    }
  };

  patchSettingsView();
  hydrateFromCloud().then(() => {
    syncAccount(readAccount());
    patchSettingsView();
    if (location.hash === "#/parent/settings" && typeof window.render === "function") {
      window.render();
    }
  });
})();

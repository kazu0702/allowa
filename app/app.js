const ACCOUNT_KEY = "ince_parent_account";
const SESSION_KEY = "ince_parent_session";
const CHILD_SESSION_KEY = "ince_child_session";
const ADMIN_SESSION_KEY = "ince_admin_session";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin123";
const MAX_CHILDREN = 3;
const DEFAULT_SUBJECTS = ["国語", "算数", "英語"];
const REDEMPTION_UNITS = [100, 1000, 10000];
const MONTHLY_BONUS_REFERENCES = [
  { key: "monthly_cheer", label: "今月の応援ボーナス", suggestionPercent: 5 },
  { key: "habit_cheer", label: "習慣づくりボーナス", suggestionPercent: 10 },
];
const SUPABASE_SNAPSHOT_TABLE = "account_snapshots";
const SUPABASE_CONFIG = window.INCE_SUPABASE_CONFIG || {};
const CHILD_CLOUD_REFRESH_INTERVAL_MS = 15000;
const PARENT_CLOUD_REFRESH_INTERVAL_MS = 15000;
const PROFILE_PHOTO_MAX_SIZE = 320;
const PROFILE_PHOTO_JPEG_QUALITY = 0.82;
const APPLICATION_PHOTO_MAX_SIZE = 1280;
const APPLICATION_PHOTO_JPEG_QUALITY = 0.82;
const PARENT_PULL_REFRESH_THRESHOLD = 76;
const PARENT_PULL_REFRESH_MAX_DISTANCE = 112;
const PLAN_OPTIONS = {
  trial: { label: "無料トライアル", price: 0, period: "14日間" },
  monthly: { label: "月払い", price: 500, period: "月" },
  yearly: { label: "年払い", price: 5000, period: "年" },
};

const initialParent = {
  nickname: "保護者さん",
  email: "",
  subscriptionStatus: "trial",
  subscriptionPlan: "trial",
  trialDaysLeft: 14,
};

const state = {
  route: location.hash.replace("#", "") || "/",
  parent: loadSessionParent(),
  flash: "",
  monthlyBonusChildId: "",
  parentApplicationsFilter: "all",
  childHistoryFilter: "all",
};
const cloudState = {
  enabled: false,
  status: "local",
  lastSyncedAt: "",
  error: "",
};
let supabaseClient = null;
let childCloudRefreshPromise = null;
let lastChildCloudRefreshAt = 0;
let parentCloudRefreshPromise = null;
let lastParentCloudRefreshAt = 0;
let cloudAutoRefreshTimer = null;
let parentPullRefreshStartY = 0;
let parentPullRefreshDistance = 0;
let isParentPullRefreshTracking = false;
let isParentPullRefreshing = false;
let isParentPullRefreshBound = false;

function loadAccount() {
  try {
    const value = localStorage.getItem(ACCOUNT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function loadSessionParent() {
  const isSignedIn = localStorage.getItem(SESSION_KEY) === "true";
  return isSignedIn ? loadAccount() : null;
}

function pruneExpiredPhotosIfNeeded() {
  const parent = loadAccount();
  if (!parent) {
    return;
  }

  let changed = false;
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => ({
      ...child,
      applications: (child.applications || []).map((application) => {
        if (!application.photos?.length || !isPhotoExpired(application)) {
          return application;
        }

        changed = true;
        return {
          ...application,
          photos: [],
          photoNames: [],
          photosDeletedAt: new Date().toISOString(),
          photosDeletionReason: "retention_expired",
        };
      }),
    })),
  };

  if (changed) {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextParent));
    if (state.parent) {
      state.parent = nextParent;
    }
  }
}

function saveAccount(parent) {
  const snapshot = {
    ...parent,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(snapshot));
  localStorage.setItem(SESSION_KEY, "true");
  state.parent = snapshot;
  syncAccountToCloud(snapshot);
}

function getAccountUpdatedTime(parent) {
  const timestamps = [
    parent?.updatedAt,
    parent?.createdAt,
    parent?.subscription?.updatedAt,
    ...(parent?.children || []).flatMap((child) => [
      child.updatedAt,
      child.createdAt,
      child.passwordUpdatedAt,
      child.profilePhoto?.updatedAt,
      ...(child.applications || []).flatMap((application) => [
        application.updatedAt,
        application.submittedAt,
        application.reviewedAt,
        application.canceledAt,
        application.deletedAt,
      ]),
      ...(child.redemptions || []).flatMap((redemption) => [
        redemption.updatedAt,
        redemption.requestedAt,
        redemption.reviewedAt,
      ]),
      ...(child.notifications || []).map((notification) => notification.createdAt),
      ...(child.pointHistory || []).map((item) => item.createdAt),
      ...(child.pointRules || []).map((rule) => rule.updatedAt),
      ...(child.subjects || []).map((subject) => subject.updatedAt || subject.createdAt),
    ]),
    ...(parent?.notifications || []).map((notification) => notification.createdAt),
  ];

  return Math.max(
    0,
    ...timestamps
      .map((value) => new Date(value || 0).getTime())
      .filter((value) => Number.isFinite(value)),
  );
}

function canUseCloudStorage() {
  return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase?.createClient);
}

function getSupabaseClient() {
  if (!canUseCloudStorage()) {
    cloudState.enabled = false;
    cloudState.status = "local";
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  }

  cloudState.enabled = true;
  return supabaseClient;
}

async function hydrateAccountFromCloud() {
  const client = getSupabaseClient();
  const localParent = loadAccount();
  if (!client || !localParent?.email) {
    return false;
  }

  try {
    cloudState.status = "syncing";
    const { data, error } = await client
      .from(SUPABASE_SNAPSHOT_TABLE)
      .select("snapshot, updated_at")
      .eq("email", localParent.email)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const remoteParent = data?.snapshot;
    if (remoteParent?.email) {
      const localUpdatedAt = getAccountUpdatedTime(localParent);
      const snapshotUpdatedAt = new Date(remoteParent.updatedAt || 0).getTime();
      const rowUpdatedAt = new Date(data.updated_at || 0).getTime();
      const normalizedUpdatedAtValue = Math.max(snapshotUpdatedAt, rowUpdatedAt);
      const normalizedUpdatedAt = new Date(normalizedUpdatedAtValue || Date.now()).toISOString();
      const nextRemoteParent = {
        ...remoteParent,
        updatedAt: normalizedUpdatedAt,
      };
      const remoteUpdatedAt = new Date(nextRemoteParent.updatedAt).getTime();
      if (remoteUpdatedAt > localUpdatedAt) {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextRemoteParent));
        if (localStorage.getItem(SESSION_KEY) === "true") {
          state.parent = nextRemoteParent;
        }
        cloudState.status = "synced";
        cloudState.lastSyncedAt = new Date().toISOString();
        cloudState.error = "";
        return true;
      }
    }

    cloudState.status = "synced";
    cloudState.lastSyncedAt = new Date().toISOString();
    cloudState.error = "";
    return false;
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = error.message || "Supabaseとの同期に失敗しました。";
    return false;
  }
}

async function syncAccountToCloud(parent) {
  const client = getSupabaseClient();
  if (!client || !parent?.email) {
    return;
  }

  try {
    cloudState.status = "syncing";
    const snapshot = {
      ...parent,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(snapshot));
    state.parent = snapshot;

    const { error } = await client
      .from(SUPABASE_SNAPSHOT_TABLE)
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
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  state.parent = null;
}

function clearChildSession() {
  localStorage.removeItem(CHILD_SESSION_KEY);
}

function getChildSession() {
  const rawSession = localStorage.getItem(CHILD_SESSION_KEY);
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

function setChildSession(child) {
  localStorage.setItem(
    CHILD_SESSION_KEY,
    JSON.stringify({
      childId: child.id,
      passwordUpdatedAt: child.passwordUpdatedAt || null,
    }),
  );
}

function isChildSessionValid(child, session) {
  if (!child || !session) {
    return false;
  }

  const passwordUpdatedAt = child.passwordUpdatedAt || null;
  if (session.legacy) {
    return !passwordUpdatedAt;
  }

  return session.passwordUpdatedAt === passwordUpdatedAt;
}

function navigate(path) {
  location.hash = path;
}

window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "/";
  render();
});

function render() {
  pruneExpiredPhotosIfNeeded();
  const app = document.querySelector("#app");
  const route = state.route;
  document.querySelector(".phone-shell")?.classList.toggle("admin-shell", route.startsWith("/admin"));

  if (route === "/admin/login") {
    app.innerHTML = adminLoginView();
    bindAdminLogin();
    return;
  }

  if (route.startsWith("/admin")) {
    if (!isAdminSignedIn()) {
      navigate("/admin/login");
      return;
    }
    renderAdminRoute(app, route);
    return;
  }

  if (route === "/signup") {
    app.innerHTML = signupView();
    bindSignup();
    return;
  }

  if (route === "/login") {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }

  if (route === "/demo-parent-login") {
    loginAsDemoParent();
    return;
  }

  if (route === "/child/login") {
    app.innerHTML = childLoginView();
    bindChildLogin();
    return;
  }

  if (route === "/demo-child-login") {
    loginAsDemoChild();
    return;
  }

  if (route.startsWith("/child")) {
    if (shouldRefreshChildAccountFromCloud()) {
      refreshChildAccountFromCloud(route);
    }

    const child = getCurrentChild();
    if (!child) {
      navigate("/child/login");
      return;
    }
    const subscription = getSubscription(loadAccount() || initialParent);
    if (!canUseApp(subscription.status)) {
      app.innerHTML = childSubscriptionBlockedView(subscription);
      bindChildShell();
      return;
    }
    renderChildRoute(app, route, child);
    return;
  }

  if (route.startsWith("/parent")) {
    if (!state.parent) {
      navigate("/login");
      return;
    }
    if (shouldRefreshParentAccountFromCloud()) {
      refreshParentAccountFromCloud(route);
    }
    const subscription = getSubscription(loadAccount() || state.parent);
    const canOpenBillingRoute = route === "/parent/billing" || route === "/parent/settings" || route === "/parent/demo-guide";
    if (!canUseApp(subscription.status) && !canOpenBillingRoute) {
      app.innerHTML = parentSubscriptionRequiredView(subscription);
      bindParentShell();
      return;
    }
    renderParentRoute(app, route);
    return;
  }

  app.innerHTML = lpView();
  bindLp();
}

function shouldRefreshChildAccountFromCloud() {
  if (!canUseCloudStorage() || childCloudRefreshPromise) {
    return false;
  }

  const account = loadAccount();
  if (!account?.email) {
    return false;
  }

  return Date.now() - lastChildCloudRefreshAt > CHILD_CLOUD_REFRESH_INTERVAL_MS;
}

function refreshChildAccountFromCloud(routeAtStart = state.route) {
  if (childCloudRefreshPromise) {
    return childCloudRefreshPromise;
  }

  childCloudRefreshPromise = hydrateAccountFromCloud()
    .catch(() => false)
    .then((accountUpdated) => {
      lastChildCloudRefreshAt = Date.now();
      childCloudRefreshPromise = null;
      if (accountUpdated && state.route === routeAtStart && shouldRenderCloudUpdate("child")) {
        render();
      }
      return accountUpdated;
    });
  return childCloudRefreshPromise;
}

function shouldRefreshParentAccountFromCloud() {
  if (!canUseCloudStorage() || parentCloudRefreshPromise) {
    return false;
  }

  const account = loadAccount();
  if (!account?.email || localStorage.getItem(SESSION_KEY) !== "true") {
    return false;
  }

  return Date.now() - lastParentCloudRefreshAt > PARENT_CLOUD_REFRESH_INTERVAL_MS;
}

function refreshParentAccountFromCloud(routeAtStart = state.route) {
  if (parentCloudRefreshPromise) {
    return parentCloudRefreshPromise;
  }

  parentCloudRefreshPromise = hydrateAccountFromCloud()
    .catch(() => false)
    .then((accountUpdated) => {
      lastParentCloudRefreshAt = Date.now();
      parentCloudRefreshPromise = null;
      if (accountUpdated && state.route === routeAtStart && shouldRenderCloudUpdate("parent")) {
        render();
      }
      return accountUpdated;
    });
  return parentCloudRefreshPromise;
}

function startCloudAutoRefresh() {
  if (cloudAutoRefreshTimer) {
    return;
  }

  cloudAutoRefreshTimer = window.setInterval(runCloudAutoRefresh, Math.min(CHILD_CLOUD_REFRESH_INTERVAL_MS, PARENT_CLOUD_REFRESH_INTERVAL_MS));
}

function runCloudAutoRefresh(force = false) {
  if (document.hidden || !canUseCloudStorage()) {
    return;
  }

  if (isCloudAutoRenderBlockedRoute(state.route)) {
    return;
  }

  if (state.route.startsWith("/child")) {
    if (force || shouldRefreshChildAccountFromCloud()) {
      refreshChildAccountFromCloud(state.route);
    }
    return;
  }

  if (state.route.startsWith("/parent")) {
    if (force || shouldRefreshParentAccountFromCloud()) {
      refreshParentAccountFromCloud(state.route);
    }
  }
}

function shouldRenderCloudUpdate(mode) {
  if (mode === "child") {
    return state.route.startsWith("/child") && isCloudAutoRenderRoute(state.route);
  }

  if (mode === "parent") {
    return state.route.startsWith("/parent") && isCloudAutoRenderRoute(state.route);
  }

  return false;
}

function isCloudAutoRenderRoute(route) {
  if (document.querySelector(".parent-switch-modal, .child-complete-modal, #application-submitted-modal, #delete-application-confirm-modal")) {
    return false;
  }

  if (document.activeElement?.matches?.("input, textarea, select")) {
    return false;
  }

  return !isCloudAutoRenderBlockedRoute(route);
}

function isCloudAutoRenderBlockedRoute(route) {
  return (
    route === "/child/login" ||
    route === "/child/apply" ||
    route.startsWith("/child/apply/") ||
    route.startsWith("/child/reapply/") ||
    route === "/child/redeem" ||
    route === "/parent/children/new" ||
    route === "/parent/monthly-bonus" ||
    route.startsWith("/parent/applications/") ||
    route.endsWith("/subjects") ||
    route.endsWith("/rules")
  );
}

function childCloudLoadingView() {
  return `
    <section class="screen auth-screen">
      <div class="card auth-card">
        <h1>読み込み中</h1>
        <p>こども情報を確認しています。</p>
      </div>
    </section>
  `;
}

function renderParentRoute(app, route) {
  if (route.startsWith("/parent/redemptions/")) {
    const redemptionId = route.split("/").at(-1);
    const item = findRedemptionForParent(redemptionId);
    app.innerHTML = item ? parentRedemptionDetailView(item.child, item.redemption) : notFoundView();
    item ? bindParentRedemptionDetail(item.child, item.redemption) : bindParentShell();
    return;
  }

  if (route === "/parent/redemptions") {
    app.innerHTML = parentRedemptionsView();
    bindParentRedemptions();
    return;
  }

  if (route === "/parent/monthly-bonus") {
    app.innerHTML = parentMonthlyBonusView();
    bindParentMonthlyBonus();
    return;
  }

  if (route === "/parent/notifications") {
    app.innerHTML = parentNotificationsView();
    bindParentNotifications();
    return;
  }

  if (route === "/parent/settings") {
    app.innerHTML = parentSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/email") {
    app.innerHTML = parentEmailSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/password") {
    app.innerHTML = parentPasswordSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/logout") {
    app.innerHTML = parentLogoutSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/cancel") {
    app.innerHTML = parentCancelSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/cloud") {
    app.innerHTML = parentCloudSettingsView();
    bindParentShell();
    return;
  }

  if (route === "/parent/settings/data") {
    app.innerHTML = parentDataSettingsView();
    bindParentSettings();
    return;
  }

  if (route === "/parent/demo-guide") {
    app.innerHTML = parentDemoGuideView();
    bindParentDemoGuide();
    return;
  }

  if (route === "/parent/billing") {
    app.innerHTML = parentBillingView();
    bindParentBilling();
    return;
  }

  if (route.startsWith("/parent/applications/")) {
    const applicationId = route.split("/").at(-1);
    const item = findApplicationForParent(applicationId);
    app.innerHTML = item ? parentApplicationDetailView(item.child, item.application) : notFoundView();
    item ? bindParentApplicationDetail(item.child, item.application) : bindParentShell();
    return;
  }

  if (route === "/parent/applications") {
    app.innerHTML = parentApplicationsView();
    bindParentApplications();
    return;
  }

  if (route === "/parent/children/new") {
    app.innerHTML = childNewView();
    bindChildNew();
    return;
  }

  if (route.startsWith("/parent/children/")) {
    const routeParts = route.split("/");
    const childId = routeParts[3];
    const child = findChild(childId);

    if (!child) {
      app.innerHTML = notFoundView();
      bindChildDetail(child);
      return;
    }

    if (routeParts[4] === "subjects") {
      app.innerHTML = subjectsView(child);
      bindSubjects(child);
      return;
    }

    if (routeParts[4] === "rules") {
      app.innerHTML = pointRulesView(child);
      bindPointRules(child);
      return;
    }

    if (routeParts[4] === "points") {
      app.innerHTML = parentChildPointsView(child);
      bindParentShell();
      return;
    }

    app.innerHTML = childDetailView(child);
    bindChildDetail(child);
    return;
  }

  if (route === "/parent/children") {
    app.innerHTML = childrenView();
    bindChildren();
    return;
  }

  app.innerHTML = parentHomeView();
  bindParentHome();
}

function renderAdminRoute(app, route) {
  if (route === "/admin/parents") {
    app.innerHTML = adminParentsView();
    bindAdminShell();
    return;
  }

  if (route === "/admin/children") {
    app.innerHTML = adminChildrenView();
    bindAdminShell();
    return;
  }

  if (route === "/admin/applications") {
    app.innerHTML = adminApplicationsView();
    bindAdminShell();
    return;
  }

  app.innerHTML = adminDashboardView();
  bindAdminShell();
}

function renderChildRoute(app, route, child) {
  if (route === "/child/notifications") {
    app.innerHTML = childNotificationsView(child);
    bindChildNotifications(child);
    return;
  }

  if (route === "/child/points") {
    app.innerHTML = childPointHistoryView(child);
    bindChildShell();
    return;
  }

  if (route === "/child/redeem") {
    app.innerHTML = childRedeemView(child);
    bindChildRedeem(child);
    return;
  }

  if (route.startsWith("/child/reapply/")) {
    const applicationId = route.split("/").at(-1);
    const application = getChildApplications(child).find((item) => item.id === applicationId);
    const reapplyApplication = application
      ? {
          ...application,
          status: "pending",
          submittedAt: null,
          isReapply: true,
        }
      : null;
    app.innerHTML = reapplyApplication ? childApplyView(child, reapplyApplication) : childHistoryView(child);
    reapplyApplication ? bindChildApply(child, reapplyApplication) : bindChildHistory(child);
    return;
  }

  if (route.startsWith("/child/apply/")) {
    const applicationId = route.split("/").at(-1);
    const application = getChildApplications(child).find((item) => item.id === applicationId);
    if (application?.status === "approved") {
      app.innerHTML = childHistoryView(child);
      bindChildHistory(child);
      return;
    }
    app.innerHTML = application ? childApplyView(child, application) : childHistoryView(child);
    application ? bindChildApply(child, application) : bindChildHistory(child);
    return;
  }

  if (route === "/child/apply") {
    app.innerHTML = childApplyView(child);
    bindChildApply(child);
    return;
  }

  if (route === "/child/history") {
    app.innerHTML = childHistoryView(child);
    bindChildHistory(child);
    return;
  }

  app.innerHTML = childHomeView(child);
  bindChildShell();
}

function topbar() {
  return `
    <div class="topbar">
      <div class="brand" aria-label="INCE">
        <span class="brand-mark">S</span>
        <span>INCE</span>
      </div>
      <button class="text-button" type="button" data-route="/login">ログイン</button>
    </div>
  `;
}

function lpView() {
  return `
    <section class="screen lp-screen">
      ${topbar()}

      <div class="hero">
        <h1>がんばった成績を、おこづかいに。</h1>
        <p>テストや学習成果をこどもが自分で申請し、保護者が確認してポイント付与。がんばりが数字で増えるから、次も挑戦したくなります。</p>
        <div class="hero-actions">
          <button class="primary-button" type="button" data-route="/signup">14日間無料で始める</button>
          <button class="secondary-button" type="button" data-route="/login">ログイン</button>
          <button class="secondary-button" type="button" data-route="/child/login">こどもログイン</button>
        </div>
      </div>

      <div class="feature-strip" aria-label="使い方">
        <div class="mini-card">
          <span class="icon-dot">1</span>
          <div><strong>こどもが申請</strong><span>テスト、成績、その他のがんばりを写真つきで送ります。</span></div>
        </div>
        <div class="mini-card">
          <span class="icon-dot">2</span>
          <div><strong>親が確認</strong><span>写真と内容を見て、承認・やり直し・却下を選べます。</span></div>
        </div>
        <div class="mini-card">
          <span class="icon-dot">3</span>
          <div><strong>ポイント付与</strong><span>承認された成果がポイントになり、残高として見えるようになります。</span></div>
        </div>
      </div>

      <section class="section motivation-section">
        <h2>こどものやる気が続きやすい理由</h2>
        <div class="motivation-list">
          <div class="motivation-item">
            <span class="motivation-icon">↑</span>
            <div>
              <strong>がんばりがすぐ見える</strong>
              <p>承認されるとポイントが増えるので、努力がその場で実感できます。</p>
            </div>
          </div>
          <div class="motivation-item">
            <span class="motivation-icon">✓</span>
            <div>
              <strong>親に見てもらえる</strong>
              <p>写真つきで申請するから、点数だけでなく取り組みそのものを伝えられます。</p>
            </div>
          </div>
          <div class="motivation-item">
            <span class="motivation-icon">pt</span>
            <div>
              <strong>おこづかいに納得感が出る</strong>
              <p>何をがんばったからポイントになったのか、親子で同じ履歴を見られます。</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>親子で続けやすい学習の記録</h2>
        <p>スマホだけで使えるシンプルな画面構成。入力は短く、確認は写真中心にして、毎日の利用に負担が出ない形を目指します。</p>
      </section>

      <section class="section">
        <h2>料金</h2>
        <div class="card price-box">
          <span class="summary-kicker">14日間無料トライアル</span>
          <div class="price"><strong>500円</strong><span>/ 月</span></div>
          <p>年払いは5,000円。MVPではまず無料トライアル状態で体験を確認します。</p>
        </div>
      </section>
    </section>
  `;
}

function signupView() {
  return `
    <section class="screen auth-screen">
      <div class="topbar">
        <button class="text-button" type="button" data-route="/">戻る</button>
      </div>
      <div class="card auth-card">
        <h1>無料トライアルを始める</h1>
        <p>まずは保護者アカウントを作成します。Phase 1ではこの端末に仮保存します。</p>
        <form class="form" id="signup-form">
          <div class="field">
            <label for="signup-name">ニックネーム</label>
            <input id="signup-name" name="nickname" autocomplete="name" placeholder="例: たろうの母" required />
          </div>
          <div class="field">
            <label for="signup-email">メールアドレス</label>
            <input id="signup-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label for="signup-password">パスワード</label>
            <input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="6文字以上" required />
          </div>
          <div class="error" id="signup-error"></div>
          <button class="primary-button" type="submit">登録してホームへ</button>
        </form>
      </div>
    </section>
  `;
}

function loginView() {
  return `
    <section class="screen auth-screen">
      <div class="topbar">
        <button class="text-button" type="button" data-route="/">戻る</button>
      </div>
      <div class="card auth-card">
        <h1>ログイン</h1>
        <p>登録済みの保護者アカウントでログインします。未登録の場合は無料トライアルから始められます。</p>
        <form class="form" id="login-form">
          <div class="field">
            <label for="login-email">メールアドレス</label>
            <input id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label for="login-password">パスワード</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="パスワード" required />
          </div>
          <div class="error" id="login-error"></div>
          <button class="primary-button" type="submit">ログイン</button>
          <button class="secondary-button" type="button" data-route="/demo-parent-login">デモ保護者でログイン</button>
          <button class="secondary-button" type="button" data-route="/signup">無料トライアルを始める</button>
          <button class="secondary-button" type="button" data-route="/child/login">こどもログインへ</button>
        </form>
      </div>
    </section>
  `;
}

function childLoginView() {
  return `
    <section class="screen auth-screen">
      <div class="topbar">
        <button class="text-button" type="button" data-route="/">戻る</button>
      </div>
      <div class="card auth-card">
        <h1>こどもログイン</h1>
        <p>保護者からもらったログインIDとパスワードで入ります。</p>
        <form class="form" id="child-login-form">
          <div class="field">
            <label for="child-login-id-input">ログインID</label>
            <input id="child-login-id-input" name="loginId" autocomplete="username" placeholder="kid1234" required />
          </div>
          <div class="field">
            <label for="child-login-password-input">パスワード</label>
            <input id="child-login-password-input" name="password" autocomplete="current-password" placeholder="sp1234" required />
          </div>
          <div class="error" id="child-login-error"></div>
          <button class="primary-button" type="submit">ログイン</button>
          <button class="secondary-button" type="button" data-route="/demo-child-login">デモこどもでログイン</button>
          <button class="secondary-button" type="button" data-route="/login">保護者ログインへ</button>
        </form>
      </div>
    </section>
  `;
}

function adminLoginView() {
  return `
    <section class="admin-page admin-login-page">
      <div class="card auth-card admin-login-card">
        <h1>運営ログイン</h1>
        <p>PC向けの運営管理画面です。プロトタイプ用の管理者でログインします。</p>
        <div class="hint-card">デモ: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}</div>
        <form class="form" id="admin-login-form">
          <div class="field">
            <label for="admin-email">メールアドレス</label>
            <input id="admin-email" name="email" type="email" autocomplete="username" value="${ADMIN_EMAIL}" required />
          </div>
          <div class="field">
            <label for="admin-password">パスワード</label>
            <input id="admin-password" name="password" type="password" autocomplete="current-password" value="${ADMIN_PASSWORD}" required />
          </div>
          <div class="error" id="admin-login-error"></div>
          <button class="primary-button" type="submit">ログイン</button>
          <button class="secondary-button" type="button" data-route="/">LPへ戻る</button>
        </form>
      </div>
    </section>
  `;
}

function parentHomeView() {
  const parent = state.parent || initialParent;
  const subscription = getSubscription(parent);
  const children = isPreviewNoChildren() ? [] : getChildren();
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
      ? "こどもを追加する"
      : "こども一覧を見る";
  const primaryActionCopy = pendingApplications.length
    ? "確認待ちの申請があります。時間のあるときにまとめて見られます。"
    : childCount === 0
      ? "まずはこどもを追加して、ログイン情報を発行します。"
      : "今日は急ぎの申請はありません。こども情報やルールを確認できます。";
  return `
    <section class="screen home-screen">
      <div class="topbar parent-home-topbar">
        <div class="brand">
          <img class="header-logo-image parent-header-logo-image" src="./logo.svg?v=phase206" alt="INCE" />
        </div>
        <div class="parent-header-switch">
          <button class="parent-header-profile" type="button" id="parent-child-switch-trigger" aria-haspopup="menu" aria-expanded="false">
            ${studyPayIcon("circle-user-round", "parent-profile-icon")}
            <span>${escapeHtml(parent.nickname || "保護者")}</span>
          </button>
          ${parentChildSwitchMenu(children)}
        </div>
      </div>

      <div class="parent-home-status">
        <p class="parent-trial-banner">${parentHomeSubscriptionSummary(subscription)}</p>
      </div>

      ${subscription.status === "grace_period" ? `<div class="notice-card">支払い確認中です。猶予期間中は通常どおり利用できます。</div>` : ""}

      ${childCount > 0 ? `
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
      ` : ""}

      ${parentHomeChildrenStatus(children)}

      ${bottomNav("home")}
    </section>
  `;
}

function parentChildSwitchMenu(children) {
  return `
    <div class="parent-child-switch-menu" id="parent-child-switch-menu" role="menu" hidden>
      ${
        children.length
          ? children.map((child) => `
            <button type="button" role="menuitem" data-switch-child-id="${escapeHtml(child.id)}">
              ${childAvatar(child, "parent-child-switch-avatar")}
              <span>${escapeHtml(child.nickname)}</span>
            </button>
          `).join("")
          : `<button type="button" role="menuitem" data-route="/parent/children/new">こどもを追加する</button>`
      }
      <button class="parent-child-switch-logout" type="button" role="menuitem" data-route="/parent/settings/logout">ログアウト</button>
    </div>
  `;
}

function parentHomeChildrenStatus(children) {
  if (!children.length) {
    return `
      <section class="parent-child-status-section">
        <div class="section-label">こどもの状況</div>
        <div class="card parent-child-status-empty">
          ${studyPayIcon("circle-user-round", "parent-child-status-empty-icon")}
          <strong>まずはお子さまを追加してください</strong>
        </div>
        <button class="primary-button compact-button parent-child-add-button" type="button" data-route="/parent/children/new">こどもを追加する</button>
      </section>
    `;
  }

  const canAdd = children.length < MAX_CHILDREN;
  return `
    <section class="parent-child-status-section">
      <div class="section-label">こどもの状況</div>
      <div class="parent-child-status-list">
        ${children.map(parentHomeChildStatusCard).join("")}
      </div>
      ${canAdd ? `<button class="primary-button compact-button parent-child-add-button" type="button" data-route="/parent/children/new">こどもを追加する</button>` : ""}
    </section>
  `;
}

function isPreviewNoChildren() {
  return new URLSearchParams(window.location.search).get("previewNoChildren") === "1";
}

function childAvatar(child, className = "") {
  const photo = child?.profilePhoto?.dataUrl;
  return `
    <span class="child-avatar profile-avatar ${photo ? "profile-avatar-photo" : ""} ${className}">
      ${
        photo
          ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(child?.profilePhoto?.name || `${child?.nickname || "こども"}のプロフィール写真`)}" />`
          : studyPayIcon("circle-user-round", "profile-avatar-icon")
      }
    </span>
  `;
}

function parentHomeChildStatusCard(child) {
  const pendingApplications = getChildApplications(child).filter((application) => application.status === "pending").length;
  const pendingRedemptions = getChildRedemptions(child).filter((redemption) => redemption.status === "pending").length;
  const monthlyEarnedPoints = getMonthlyEarnedPoints(child);
  const monthlyAllowance = getMonthlyReceivedAllowanceTotal(child);

  return `
    <button class="card parent-child-status-card" type="button" data-route="/parent/children/${child.id}">
      <span class="parent-child-status-main">
        <span class="parent-child-status-head">
          <span class="parent-child-status-name">
            ${childAvatar(child, "parent-child-status-avatar")}
            <strong>${escapeHtml(child.nickname)}</strong>
          </span>
          <span class="parent-child-status-detail">詳細を確認</span>
        </span>
        <span class="parent-child-total-points">
          <span>総保有ポイント</span>
          <strong>${getAvailablePoints(child).toLocaleString()}pt</strong>
        </span>
        <span class="parent-child-status-groups">
          <span class="parent-child-status-group">
            <span class="parent-child-status-group-title">今月</span>
            <span class="parent-child-status-row">
              <span>ポイント</span>
              <strong>${parentChildStatusValue(monthlyEarnedPoints, "pt")}</strong>
            </span>
            <span class="parent-child-status-row">
              <span>おこづかい</span>
              <strong>${parentChildStatusValue(monthlyAllowance, "円")}</strong>
            </span>
          </span>
          <span class="parent-child-status-group">
            <span class="parent-child-status-group-title">申請</span>
            <span class="parent-child-status-row">
              <span>やった！</span>
              <strong>${parentChildStatusValue(pendingApplications, "件")}</strong>
            </span>
            <span class="parent-child-status-row">
              <span>おこづかい</span>
              <strong>${parentChildStatusValue(pendingRedemptions, "件")}</strong>
            </span>
          </span>
        </span>
      </span>
    </button>
  `;
}

function parentChildStatusValue(value, unit) {
  return `${Number(value || 0).toLocaleString()}<span class="parent-child-status-unit">${escapeHtml(unit)}</span>`;
}

function parentNotificationsView() {
  const parent = loadAccount() || state.parent || initialParent;
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("通知")}
      <div class="page-heading settings-page-heading">
        <p>未読 ${getUnreadNotifications(parent).length} 件</p>
      </div>

      ${notificationList(parent.notifications || [])}

      ${parent.notifications?.length ? `<button class="secondary-button" type="button" id="read-parent-notifications">すべて既読にする</button>` : ""}

      ${bottomNav("notifications")}
    </section>
  `;
}

function parentSettingsView() {
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader("設定")}

      <div class="settings-menu">
        ${settingsMenuButton("ボーナス設定", "/parent/monthly-bonus")}
        ${settingsMenuButton("こども管理", "/parent/children")}
        ${settingsMenuButton("プラン・支払い設定", "/parent/billing")}
        ${settingsMenuButton("メールアドレス設定", "/parent/settings/email")}
        ${settingsMenuButton("パスワード変更", "/parent/settings/password")}
        ${settingsMenuButton("ログアウト", "/parent/settings/logout")}
        ${settingsMenuButton("退会", "/parent/settings/cancel", true)}
        ${settingsMenuButton("デモの使い方", "/parent/demo-guide", false, "本番では非表示")}
        ${settingsMenuButton("クラウド情報", "/parent/settings/cloud", false, "本番では非表示")}
        ${settingsMenuButton("データ管理", "/parent/settings/data", true, "本番では非表示")}
      </div>

      ${bottomNav("settings")}
    </section>
  `;
}

function settingsMenuButton(label, route, danger = false, note = "") {
  return `
    <button class="card settings-menu-link ${danger ? "danger-zone" : ""}" type="button" data-route="${route}">
      <span>${label}</span>
      ${note ? `<small>${note}</small>` : ""}
      ${studyPayIcon("chevron-right", "settings-menu-chevron")}
    </button>
  `;
}

function parentEmailSettingsView() {
  const parent = loadAccount() || state.parent || initialParent;
  return parentSettingsDetailView(
    "メールアドレス設定",
    `
      <div class="card detail-card">
        <dl class="info-list">
          <div><dt>現在のメール</dt><dd>${escapeHtml(parent.email || "-")}</dd></div>
        </dl>
        <p class="card-copy">メールアドレス変更は本番認証と接続後に利用できます。</p>
      </div>
    `,
  );
}

function parentPasswordSettingsView() {
  return parentSettingsDetailView(
    "パスワード変更",
    `
      <div class="card detail-card">
        <p class="card-copy">パスワード変更は本番認証と接続後に利用できます。</p>
      </div>
    `,
  );
}

function parentLogoutSettingsView() {
  return parentSettingsDetailView(
    "ログアウト",
    `
      <div class="card detail-card">
        <p class="card-copy">この端末の保護者ログインを終了します。</p>
        <button class="secondary-button compact-button" type="button" id="logout-button">ログアウト</button>
      </div>
    `,
  );
}

function parentCancelSettingsView() {
  return parentSettingsDetailView(
    "退会",
    `
      <div class="card detail-card danger-zone">
        <p class="card-copy">退会処理は本番の認証・課金連携後に有効化します。</p>
        <button class="danger-button compact-button" type="button" disabled>本番実装後に利用可能</button>
      </div>
    `,
  );
}

function parentCloudSettingsView() {
  return parentSettingsDetailView(
    "クラウド情報",
    `
      <div class="card detail-card">
        <dl class="info-list">
          <div><dt>保存方式</dt><dd>${cloudStorageLabel()}</dd></div>
          <div><dt>同期状態</dt><dd>${cloudSyncStatusLabel()}</dd></div>
          <div><dt>最終同期</dt><dd>${formatDateTime(cloudState.lastSyncedAt)}</dd></div>
        </dl>
        ${cloudState.error ? `<p class="form-error">${escapeHtml(cloudState.error)}</p>` : ""}
        <p class="card-copy">Supabase無料プランの接続情報をVercel環境変数に入れると、親子データをクラウドに同期します。</p>
      </div>
    `,
  );
}

function parentDataSettingsView() {
  const flashMessage = state.flash;
  state.flash = "";
  return parentSettingsDetailView(
    "データ管理",
    `
      <div class="card detail-card danger-zone">
        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}
        <p class="card-copy">MVP検証用に、この端末に保存されているデータをバックアップできます。初期化すると登録情報・こども・申請・通知が消えます。</p>
        <button class="primary-button compact-button" type="button" id="create-demo-data">デモデータを作成</button>
        <button class="secondary-button compact-button" type="button" id="export-prototype-data">データを書き出す</button>
        <button class="danger-button compact-button" type="button" id="show-reset-prototype-data">プロトタイプを初期化</button>
        <div class="confirm-panel hidden" id="reset-prototype-confirm">
          <strong>保存データを初期化しますか？</strong>
          <p>初期化すると、現在のテストデータはこのブラウザから削除されます。</p>
          <div class="confirm-actions">
            <button class="danger-button" type="button" id="confirm-reset-prototype-data">初期化する</button>
            <button class="secondary-button" type="button" id="cancel-reset-prototype-data">キャンセル</button>
          </div>
        </div>
      </div>
    `,
  );
}

function parentSettingsDetailView(title, content) {
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader(title)}

      ${content}

      ${bottomNav("settings")}
    </section>
  `;
}

function parentDemoGuideView() {
  const demoChild = findDemoChild();
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader("デモの使い方")}
      <div class="page-heading settings-page-heading">
        <p>この順番で触ると、MVPの中心体験を確認できます。</p>
      </div>

      ${
        demoChild
          ? `
            <div class="card detail-card">
              <span class="summary-kicker">こどもログイン</span>
              <dl class="info-list">
                <div><dt>名前</dt><dd>${escapeHtml(demoChild.nickname)}</dd></div>
                <div><dt>ログインID</dt><dd>${escapeHtml(demoChild.loginId)}</dd></div>
                <div><dt>パスワード</dt><dd>${escapeHtml(demoChild.demoPassword)}</dd></div>
              </dl>
            </div>
          `
          : `
            <div class="card empty-state">
              <strong>デモデータがまだありません</strong>
              <p>先にデモデータを作成すると、確認用のこども・申請・ポイント履歴が入ります。</p>
              <button class="primary-button" type="button" id="create-demo-data-from-guide">デモデータを作成</button>
            </div>
          `
      }

      <div class="demo-step-list">
        ${demoStep(1, "保護者で申請を見る", "確認待ち・承認済み・やり直しの状態を見ます。", "/parent/applications", Boolean(demoChild))}
        ${demoStep(2, "ポイントルールを見る", "科目ごとに点数とポイントが変えられることを確認します。", demoChild ? `/parent/children/${demoChild.id}/rules` : "", Boolean(demoChild))}
        ${demoStep(3, "こどもでログイン", "別画面でこどもログインし、申請履歴とポイントを確認します。", "/child/login", Boolean(demoChild))}
        ${demoStep(4, "おこづかい申請を見る", "申請中ポイントが仮で差し引かれることを確認します。", "/parent/redemptions", Boolean(demoChild))}
        ${demoStep(5, "履歴を確認", "ポイント付与・支給・取り消しの履歴を確認します。", demoChild ? `/parent/children/${demoChild.id}/points` : "", Boolean(demoChild))}
      </div>

      ${bottomNav("settings")}
    </section>
  `;
}

function demoStep(number, title, description, route, enabled) {
  return `
    <div class="card demo-step-card">
      <span class="demo-step-number">${number}</span>
      <div>
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
      ${
        enabled && route
          ? `<button class="secondary-button compact-button" type="button" data-route="${route}">開く</button>`
          : `<button class="secondary-button compact-button" type="button" disabled>デモ作成後に開く</button>`
      }
    </div>
  `;
}

function parentBillingView() {
  const parent = loadAccount() || state.parent || initialParent;
  const subscription = getSubscription(parent);
  const flashMessage = state.flash;
  state.flash = "";
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader("プラン・支払い設定")}
      <div class="page-heading settings-page-heading">
        <p>本番決済前の動作確認用です。</p>
      </div>

      <div class="card summary-card">
        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}
        <span class="summary-kicker">現在の契約</span>
        <div class="summary-number">${subscriptionLabel(subscription.status)}</div>
        <p class="fine-print">${planLabel(subscription.plan)} / 次回更新 ${formatDate(subscription.nextBillingAt)}</p>
      </div>

      <div class="plan-grid">
        ${billingPlanCard("monthly", subscription)}
        ${billingPlanCard("yearly", subscription)}
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">支払い状態テスト</span>
        <p class="card-copy">MVPでは決済会社とは未接続です。ここではログイン制御や表示確認のために契約状態だけ切り替えます。</p>
        <div class="row-actions">
          <button class="secondary-button tiny-button" type="button" data-billing-status="payment_failed">支払い失敗にする</button>
          <button class="secondary-button tiny-button" type="button" data-billing-status="grace_period">7日猶予にする</button>
          <button class="danger-button tiny-button" type="button" data-billing-status="canceled">解約にする</button>
        </div>
      </div>

      ${bottomNav("settings")}
    </section>
  `;
}

function parentSubscriptionRequiredView(subscription) {
  return `
    <section class="screen home-screen">
      ${parentHeader("契約確認")}
      <div class="card empty-state">
        <strong>契約状態の確認が必要です</strong>
        <p>現在の状態は「${subscriptionLabel(subscription.status)}」です。プラン・支払い設定を確認してください。</p>
        <button class="primary-button" type="button" data-route="/parent/billing">支払い設定へ</button>
      </div>
      ${bottomNav("settings")}
    </section>
  `;
}

function childSubscriptionBlockedView(subscription) {
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("利用確認")}
      <div class="card empty-state">
        <strong>いまは利用できません</strong>
        <p>保護者の契約状態が「${subscriptionLabel(subscription.status)}」のため、保護者に確認してください。</p>
      </div>
    </section>
  `;
}

function billingPlanCard(plan, subscription) {
  const option = PLAN_OPTIONS[plan];
  const isCurrent = subscription.plan === plan && subscription.status === "active";
  return `
    <div class="card plan-card ${isCurrent ? "active" : ""}">
      <span class="summary-kicker">${option.label}</span>
      <div class="price"><strong>${option.price.toLocaleString()}円</strong><span>/ ${option.period}</span></div>
      <p>${plan === "yearly" ? "2か月分お得な年払いプランです。" : "まずは小さく始めやすい月払いです。"}</p>
      <button class="${isCurrent ? "secondary-button" : "primary-button"} compact-button" type="button" data-billing-plan="${plan}">
        ${isCurrent ? "利用中" : `${option.label}にする`}
      </button>
    </div>
  `;
}

function parentApplicationsView() {
  const items = getParentApplications();
  const pendingItems = items.filter((item) => item.application.status === "pending");
  const activeFilter = state.parentApplicationsFilter || "all";
  const filteredItems = filterParentApplications(items, activeFilter);
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("申請一覧")}
      ${parentApplicationFilterRow(activeFilter)}
      <div class="page-heading settings-page-heading">
        <p>確認待ち ${pendingItems.length} 件</p>
      </div>

      <div class="application-list">
        ${
          items.length === 0
            ? `<div class="card empty-state"><strong>申請はまだありません</strong><p>こどもから申請されるとここに表示されます。</p></div>`
            : filteredItems.length === 0
              ? `<div class="card empty-state"><strong>表示できる申請はありません</strong><p>ほかのタグに切り替えて確認できます。</p></div>`
              : filteredItems.map(({ child, application }) => parentApplicationCard(child, application)).join("")
        }
      </div>

      ${bottomNav("requests")}
    </section>
  `;
}

function parentApplicationFilterRow(activeFilter) {
  return `
    <div class="parent-application-filter-row" aria-label="申請タグ">
      ${parentApplicationFilterButton("all", "すべて", activeFilter)}
      ${parentApplicationFilterButton("pending", "確認待ち", activeFilter)}
      ${parentApplicationFilterButton("approved", "承認済み", activeFilter)}
      ${parentApplicationFilterButton("redo", "やり直し", activeFilter)}
    </div>
  `;
}

function parentApplicationFilterButton(value, label, activeFilter) {
  const isActive = value === activeFilter;
  return `
    <button class="filter-${value} ${isActive ? "active" : ""}" type="button" data-parent-application-filter="${value}" aria-pressed="${isActive ? "true" : "false"}">
      ${label}
    </button>
  `;
}

function filterParentApplications(items, filter) {
  if (filter === "pending") {
    return items.filter((item) => item.application.status === "pending");
  }

  if (filter === "approved") {
    return items.filter((item) => item.application.status === "approved" || item.application.status === "approval_canceled");
  }

  if (filter === "redo") {
    return items.filter((item) => ["returned", "rejected", "canceled"].includes(item.application.status));
  }

  return items;
}

function adminShell(title, content) {
  return `
    <section class="admin-page">
      <aside class="admin-sidebar">
        <div class="brand">
          <span class="brand-mark">S</span>
          <span>運営管理</span>
        </div>
        <nav class="admin-nav" aria-label="運営メニュー">
          <button type="button" data-route="/admin">ダッシュボード</button>
          <button type="button" data-route="/admin/parents">保護者</button>
          <button type="button" data-route="/admin/children">こども</button>
          <button type="button" data-route="/admin/applications">申請</button>
        </nav>
      </aside>
      <main class="admin-main">
        <header class="admin-header">
          <div>
            <h1>${title}</h1>
            <p>ローカルプロトタイプ内のデータを確認しています。</p>
          </div>
          <button class="secondary-button small-action" type="button" id="admin-logout-button">ログアウト</button>
        </header>
        ${content}
      </main>
    </section>
  `;
}

function adminDashboardView() {
  const account = loadAccount();
  const children = getAllChildren();
  const applications = getAdminApplications();
  const pendingCount = applications.filter((item) => item.application.status === "pending").length;
  const approvedCount = applications.filter((item) => item.application.status === "approved").length;
  const subscription = getSubscription(account || initialParent);
  return adminShell(
    "ダッシュボード",
    `
      <div class="admin-stats">
        ${adminStat("保護者", account ? "1" : "0")}
        ${adminStat("こども", String(children.length))}
        ${adminStat("確認待ち申請", String(pendingCount))}
        ${adminStat("承認済み申請", String(approvedCount))}
        ${adminStat("契約状態", subscriptionLabel(subscription.status))}
      </div>
      <div class="admin-panel">
        <h2>最近の申請</h2>
        ${adminApplicationsTable(applications.slice(0, 5))}
      </div>
    `,
  );
}

function adminParentsView() {
  const account = loadAccount();
  const subscription = getSubscription(account || initialParent);
  return adminShell(
    "保護者一覧",
    `
      <div class="admin-panel">
        ${
          account
            ? `
              <table class="admin-table">
                <thead><tr><th>ニックネーム</th><th>メール</th><th>契約</th><th>プラン</th><th>次回更新</th><th>こども数</th><th>登録日</th></tr></thead>
                <tbody>
                  <tr>
                    <td>${escapeHtml(account.nickname)}</td>
                    <td>${escapeHtml(account.email)}</td>
                    <td>${subscriptionLabel(subscription.status)}</td>
                    <td>${planLabel(subscription.plan)}</td>
                    <td>${formatDate(subscription.nextBillingAt)}</td>
                    <td>${getAllChildren().length}</td>
                    <td>${formatDate(account.createdAt)}</td>
                  </tr>
                </tbody>
              </table>
            `
            : `<div class="notice-card">保護者データはまだありません。</div>`
        }
      </div>
    `,
  );
}

function adminChildrenView() {
  const children = getAllChildren();
  return adminShell(
    "こども一覧",
    `
      <div class="admin-panel">
        ${
          children.length
            ? `
              <table class="admin-table">
                <thead><tr><th>名前</th><th>ログインID</th><th>ポイント</th><th>科目数</th><th>申請数</th><th>状態</th></tr></thead>
                <tbody>
                  ${children.map((child) => `
                    <tr>
                      <td>${escapeHtml(child.nickname)}</td>
                      <td>${escapeHtml(child.loginId)}</td>
                      <td>${getAvailablePoints(child).toLocaleString()}pt</td>
                      <td>${getActiveSubjects(child).length}</td>
                      <td>${getChildApplications(child).length}</td>
                      <td>${escapeHtml(child.status)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `<div class="notice-card">こどもデータはまだありません。</div>`
        }
      </div>
    `,
  );
}

function adminApplicationsView() {
  const applications = getAdminApplications();
  return adminShell(
    "申請一覧",
    `
      <div class="admin-panel">
        ${adminApplicationsTable(applications)}
      </div>
    `,
  );
}

function adminStat(label, value) {
  return `
    <div class="card admin-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function adminApplicationsTable(items) {
  if (!items.length) {
    return `<div class="notice-card">申請データはまだありません。</div>`;
  }

  return `
    <table class="admin-table">
      <thead><tr><th>日付</th><th>こども</th><th>分類</th><th>科目</th><th>状態</th><th>ポイント</th></tr></thead>
      <tbody>
        ${items.map(({ child, application }) => `
          <tr>
            <td>${formatDate(application.submittedAt)}</td>
            <td>${escapeHtml(child.nickname)}</td>
            <td>${categoryLabel(application.category)}</td>
            <td>${escapeHtml(application.subjectName || "-")}</td>
            <td><span class="status-pill ${application.status}">${statusLabel(application.status)}</span></td>
            <td>${applicationPointLabel(application)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function parentApplicationCard(child, application) {
  return `
    <div class="card application-card" data-route="/parent/applications/${application.id}" role="button" tabindex="0">
      <div class="application-card-header">
        <div class="application-card-child">
          ${childAvatar(child, "application-card-avatar")}
          <span class="application-card-child-name">${escapeHtml(child.nickname)}</span>
        </div>
        <div class="application-card-title">
          <h2>${parentApplicationCardTitle(application)}</h2>
          <div class="application-card-score-line">
            ${parentApplicationCardSummary(application)}
          </div>
        </div>
        <div class="application-card-aside">
          <time datetime="${escapeHtml(application.submittedAt)}">${new Date(application.submittedAt).toLocaleDateString("ja-JP")}</time>
          <span class="status-pill ${application.status}">${statusLabel(application.status)}</span>
          <strong>${applicationPointLabel(application)}</strong>
        </div>
        ${studyPayIcon("chevron-right", "application-card-chevron")}
      </div>
      ${photoThumbnails(application)}
    </div>
  `;
}

function parentApplicationCardTitle(application) {
  const category = categoryLabel(application.category);
  const subject = application.subjectName || category;
  return `${escapeHtml(subject)}（${escapeHtml(category)}）`;
}

function parentApplicationCardSummary(application) {
  if (application.category === "test") {
    const fullScore = Number(application.testFullScore) || 100;
    return `
      <p>
        <strong class="application-card-score">${Number(application.score || 0).toLocaleString()}</strong>
        <span class="application-card-score-unit"> / ${fullScore.toLocaleString()} 点</span>
      </p>
    `;
  }

  return `<p>${applicationSummary(application)}</p>`;
}

function parentApplicationDetailView(child, application) {
  const editable = application.status === "pending";
  const canCancelApproval = application.status === "approved" && getAvailablePoints(child) >= Number(application.fixedPoints || 0);
  return `
    <section class="screen home-screen">
      ${parentHeader("申請詳細")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}の申請</h1>
          <p>${statusLabel(application.status)}・${new Date(application.submittedAt).toLocaleDateString("ja-JP")}</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/applications">一覧</button>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">申請内容</span>
        <h2>${categoryLabel(application.category)}${application.subjectName ? `・${escapeHtml(application.subjectName)}` : ""}</h2>
        <p class="card-copy">${applicationSummary(application)}</p>
        ${application.childComment ? `<p class="card-copy">コメント: ${escapeHtml(application.childComment)}</p>` : ""}
        ${photoThumbnails(application)}
      </div>

      <form class="card form form-card" id="parent-review-form">
        <div class="field">
          <label for="review-category">分類</label>
          <select id="review-category" name="category" ${editable ? "" : "disabled"}>
            <option value="test" ${selectedAttr(application.category, "test")}>テスト</option>
            <option value="grade" ${selectedAttr(application.category, "grade")}>成績</option>
            <option value="other" ${selectedAttr(application.category, "other")}>その他</option>
          </select>
        </div>
        <div class="field">
          <label for="review-subject-name">科目</label>
          <input id="review-subject-name" name="subjectName" value="${escapeHtml(application.subjectName || "その他")}" ${editable ? "" : "readonly"} />
        </div>
        ${parentReviewExtraFields(application, editable)}
        <div class="field">
          <label for="review-points">確定ポイント</label>
          <input id="review-points" name="fixedPoints" inputmode="numeric" value="${application.fixedPoints ?? application.suggestedPoints ?? application.requestedPoints ?? ""}" ${editable ? "" : "readonly"} />
        </div>
        <div class="field">
          <label for="review-comment">保護者コメント</label>
          <textarea id="review-comment" name="parentComment" rows="3" ${editable ? "" : "readonly"} placeholder="やり直し理由など">${escapeHtml(application.parentComment || "")}</textarea>
        </div>
        <div class="error" id="review-error"></div>
        ${
          editable
            ? `
              <button class="primary-button" type="button" id="approve-application">承認する</button>
              <button class="secondary-button" type="button" id="return-application">やり直し</button>
              <button class="danger-button" type="button" id="reject-application">却下</button>
            `
            : `<div class="notice-card">この申請はすでに処理済みです。</div>`
        }
      </form>

      ${
        application.status === "approved"
          ? `
            <div class="card detail-card danger-zone">
              <span class="summary-kicker">承認取り消し</span>
              <p class="card-copy">間違えて承認した場合、付与したポイントを戻して申請を承認取消にできます。</p>
              ${
                canCancelApproval
                  ? `<button class="danger-button" type="button" id="cancel-approved-application">承認を取り消す</button>`
                  : `<div class="notice-card">おこづかい申請中、または支給済みのポイントがあるため取り消せません。</div>`
              }
            </div>
          `
          : ""
      }

      ${bottomNav("requests")}
    </section>
  `;
}

function parentRedemptionsView() {
  const items = getParentRedemptions();
  const pendingItems = items.filter((item) => item.redemption.status === "pending");
  const paidAllowanceTotal = getParentMonthlyAllowanceTotal();
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("おこづかい申請一覧")}
      <div class="page-heading settings-page-heading">
        <p>確認待ち ${pendingItems.length} 件</p>
      </div>

      <div class="card summary-card">
        <span class="summary-kicker">今月支給したおこづかい</span>
        <div class="summary-number">${paidAllowanceTotal.toLocaleString()}円</div>
      </div>

      <div class="application-list">
        ${
          items.length === 0
            ? `<div class="card empty-state"><strong>おこづかい申請はまだありません</strong><p>こどもから申請されるとここに表示されます。</p></div>`
            : items.map(({ child, redemption }) => parentRedemptionCard(child, redemption)).join("")
        }
      </div>

      ${bottomNav("redemptions")}
    </section>
  `;
}

function parentRedemptionCard(child, redemption) {
  return `
    <div class="card application-card">
      <div>
        <span class="status-pill ${redemption.status}">${redemptionStatusLabel(redemption.status)}</span>
        <h2>${escapeHtml(child.nickname)}・${redemption.points.toLocaleString()}pt</h2>
        <p>支給後に完了処理します。</p>
      </div>
      <div class="application-meta">
        <span>${formatDate(redemption.requestedAt)}</span>
        <strong>${redemption.points.toLocaleString()}円</strong>
      </div>
      <button class="secondary-button compact-button" type="button" data-route="/parent/redemptions/${redemption.id}">詳細を見る</button>
    </div>
  `;
}

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
                  <h2>${escapeHtml(selectedChild?.nickname || "こども")}への追加ポイント</h2>
                </div>
              </div>
              <div class="field">
                <label for="monthly-bonus-child">対象のこども</label>
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
              <p class="card-copy">こどもの申請とは別に、保護者が確認してから付与します。何もしなければポイントは増えません。</p>
            </form>

            <form class="card form form-card monthly-reference-form" id="monthly-bonus-reference-form">
              <div class="form-heading">
                <span class="status-pill home-pill">任意</span>
                <h2>参考ボーナス候補</h2>
              </div>
              <p class="card-copy">家庭内ルールの候補です。使うかどうかと最終的なポイント数は、いずれも保護者が決めます。</p>
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
                ${MONTHLY_BONUS_REFERENCES.map((reference) => monthlyBonusReferenceCard(reference, basePoints)).join("")}
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
          : `<div class="card empty-state"><strong>こどもがまだ登録されていません</strong><p>月次ボーナスを使うには、先にこどもを追加してください。</p><button class="primary-button compact-button" type="button" data-route="/parent/children/new">こどもを追加する</button></div>`
      }

      ${bottomNav("home")}
    </section>
  `;
}

function monthlyBonusReferenceCard(reference, basePoints) {
  const suggestedPoints = Math.round(Number(basePoints || 0) * (reference.suggestionPercent / 100));
  return `
    <div class="card application-card monthly-reference-card">
      <div>
        <span class="status-pill pending">参考候補</span>
        <h2>${escapeHtml(reference.label)}</h2>
        <p>基準ポイントの ${reference.suggestionPercent}% を目安にした候補</p>
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

function parentRedemptionDetailView(child, redemption) {
  const editable = redemption.status === "pending";
  const cancelable = redemption.status === "completed";
  return `
    <section class="screen home-screen">
      ${parentHeader("おこづかい詳細")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}のおこづかい申請</h1>
          <p>${redemptionStatusLabel(redemption.status)}・${formatDate(redemption.requestedAt)}</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/redemptions">一覧</button>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">申請ポイント</span>
        <div class="summary-number">${redemption.points.toLocaleString()}pt</div>
        <p class="card-copy">1pt = 1円として、おこづかい支給後に完了してください。申請中ポイントはすでに利用可能ポイントから仮で差し引かれています。</p>
      </div>

      ${
        editable
          ? `
            <div class="card detail-card">
              <button class="primary-button" type="button" id="complete-redemption">支給済みにして完了</button>
              <button class="danger-button" type="button" id="reject-redemption">却下</button>
            </div>
          `
          : cancelable
            ? `
              <div class="card detail-card danger-zone">
                <span class="summary-kicker">完了取り消し</span>
                <p class="card-copy">間違えて完了にした場合、申請を確認待ちに戻し、ポイントも戻します。</p>
                <button class="danger-button" type="button" id="cancel-completed-redemption">完了を取り消す</button>
              </div>
            `
            : `<div class="notice-card">このおこづかい申請は処理済みです。</div>`
      }

      ${bottomNav("redemptions")}
    </section>
  `;
}

function parentReviewExtraFields(application, editable) {
  if (application.category === "test") {
    return `
      <div class="field">
        <label for="review-score">点数</label>
        <input id="review-score" name="score" inputmode="numeric" value="${application.score || ""}" ${editable ? "" : "readonly"} />
      </div>
    `;
  }

  if (application.category === "grade") {
    return `
      <div class="field">
        <label for="review-grade-value">評価</label>
        <input id="review-grade-value" name="gradeValue" value="${escapeHtml(application.gradeValue || "")}" readonly />
      </div>
    `;
  }

  return `
    <div class="field">
      <label for="review-other-content">内容</label>
      <textarea id="review-other-content" name="otherContent" rows="3" ${editable ? "" : "readonly"}>${escapeHtml(application.otherContent || "")}</textarea>
    </div>
  `;
}

function childrenPreview(children) {
  if (children.length === 0) {
    return `
      <div class="card empty-state">
        <div>
          <strong>まだこどもが登録されていません</strong>
          <p>こどもを追加すると、ポイント残高やログイン情報をここから確認できます。</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="child-list">
      ${children.map((child) => childCard(child)).join("")}
    </div>
  `;
}

function childrenView() {
  const children = getChildren();
  const canAdd = children.length < MAX_CHILDREN;
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader("こども管理")}
      <div class="page-heading children-page-heading">
        <p>お子様は最大３名まで登録できます。</p>
      </div>

      <div class="child-list section-tight">
        ${
          children.length === 0
            ? emptyChildren()
            : children.map((child) => childCard(child)).join("")
        }
      </div>

      ${canAdd ? `<button class="primary-button children-add-button" type="button" data-route="/parent/children/new">こどもを追加する</button>` : `<div class="notice-card">登録できるこどもは最大${MAX_CHILDREN}人です。</div>`}

      ${bottomNav("children")}
    </section>
  `;
}

function childNewView() {
  const children = getChildren();
  const canAdd = children.length < MAX_CHILDREN;
  const generatedLoginId = generateLoginId();
  const generatedPassword = generatePassword();
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("こどもを追加", "/parent/children", "こども管理に戻る")}
      <div class="page-heading settings-page-heading">
        <p>ログインIDとパスワードを自動発行します。</p>
      </div>

      ${
        canAdd
          ? `
            <form class="card form form-card parent-child-form" id="child-form">
              ${childProfilePhotoField()}
              <div class="field">
                <label for="child-name">こどものニックネーム</label>
                <input id="child-name" name="nickname" autocomplete="off" placeholder="例: はる" required />
              </div>
              <div class="issued-login-panel">
                <div class="issued-login-heading">
                  <span>${studyPayIcon("key-round", "issued-login-icon")}</span>
                  <strong>こども用ログイン情報</strong>
                </div>
                <div class="issued-login-grid">
                  <div class="field issued-login-field">
                    <label for="child-login-id">ログインID</label>
                    <input id="child-login-id" name="loginId" autocomplete="off" value="${generatedLoginId}" readonly aria-readonly="true" />
                  </div>
                  <div class="field issued-login-field">
                    <label for="child-password">パスワード</label>
                    <input id="child-password" name="password" autocomplete="off" value="${generatedPassword}" readonly aria-readonly="true" />
                  </div>
                </div>
                <p class="issued-login-note">お子様用のログインIDとパスワードは自動発行されます。お子様用のログインIDとパスワードは設定＞こども管理からいつでも確認できます。</p>
              </div>
              <div class="hint-card parent-child-form-hint">
                追加すると、国語・算数・英語の初期科目と標準ポイントルールの準備データを作ります。
              </div>
              <div class="error" id="child-error"></div>
              <div class="parent-child-form-actions">
                <button class="primary-button" type="submit">こどもを追加する</button>
                <button class="secondary-button" type="button" data-route="/parent/children">キャンセル</button>
              </div>
            </form>
          `
          : `<div class="notice-card">こどもは最大${MAX_CHILDREN}人までです。</div>`
      }

      ${bottomNav("children")}
    </section>
  `;
}

function childProfilePhotoField(profilePhoto = null) {
  const photo = profilePhoto?.dataUrl;
  const preview = photo
    ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(profilePhoto?.name || "プロフィール写真")}" />`
    : studyPayIcon("circle-user-round", "profile-photo-placeholder-icon");

  return `
    <div class="profile-photo-field">
      <span class="profile-photo-label">プロフィール写真</span>
      <div class="profile-photo-control">
        <div class="profile-photo-stack">
          <div class="profile-photo-preview" id="profile-photo-preview" aria-hidden="true">
            ${preview}
          </div>
          <button class="profile-photo-button" type="button" data-profile-photo-button aria-label="写真を追加">
            ${studyPayIcon("camera", "profile-photo-camera-icon")}
          </button>
          <div class="profile-photo-menu" data-profile-photo-menu hidden>
            <button type="button" data-profile-photo-action="camera">写真を撮る</button>
            <button type="button" data-profile-photo-action="library">写真から選択</button>
            <button type="button" data-profile-photo-action="reset">デフォルトに戻す</button>
          </div>
          <input class="profile-photo-input" type="file" accept="image/*" capture="environment" data-profile-photo-input="camera" aria-hidden="true" tabindex="-1" />
          <input class="profile-photo-input" type="file" accept="image/*" data-profile-photo-input="library" aria-hidden="true" tabindex="-1" />
        </div>
      </div>
    </div>
  `;
}

function childDetailView(child) {
  return `
    <section class="screen home-screen parent-child-detail-screen">
      ${parentPlainHeader("こども詳細", "/parent/children", "こども管理に戻る")}
      <div class="child-detail-profile" data-child-detail-profile>
        ${childProfilePhotoField(child.profilePhoto)}
      </div>
      <div class="page-heading child-detail-heading">
        <div class="child-detail-name-row">
          <h1>${escapeHtml(child.nickname)}</h1>
          <button class="child-detail-name-edit-button" type="button" id="edit-child-nickname" aria-label="ニックネームを変更">
            ${studyPayIcon("square-pen", "child-detail-name-edit-icon")}
          </button>
        </div>
        <p>現在ポイント ${getAvailablePoints(child).toLocaleString()}pt</p>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">こどもログイン情報</span>
        <dl class="info-list">
          <div>
            <dt>ログインID</dt>
            <dd>${escapeHtml(child.loginId)}</dd>
          </div>
          <div>
            <dt>パスワード</dt>
            <dd>
              <span class="child-detail-password-display" id="child-detail-password-display" data-password="${escapeHtml(child.demoPassword)}" data-visible="false">
                <span class="child-detail-password-text">${maskedPassword()}</span>
                <button class="password-visibility-button child-detail-password-toggle" type="button" id="toggle-child-detail-password" aria-label="パスワードを表示" aria-pressed="false">
                  ${studyPayIcon("eye", "password-visibility-icon")}
                </button>
              </span>
            </dd>
          </div>
        </dl>
        <button class="secondary-button compact-button" type="button" id="edit-child-password">パスワードを変更する</button>
        <p class="fine-print">本番ではパスワードを平文表示せず、再設定フローで扱います。</p>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">ポイント</span>
        <div class="summary-number">${getAvailablePoints(child).toLocaleString()}pt</div>
        <p class="card-copy">承認・おこづかい支給・取り消しの履歴を確認できます。</p>
        <button class="secondary-button compact-button" type="button" data-route="/parent/children/${child.id}/points">ポイント履歴を見る</button>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">初期科目</span>
        <div class="pill-list">
          ${getActiveSubjects(child).map((subject) => `<span class="pill">${escapeHtml(subject.name)}</span>`).join("")}
        </div>
        <button class="secondary-button compact-button" type="button" data-route="/parent/children/${child.id}/subjects">科目を管理</button>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">ポイントルール</span>
        <p class="card-copy">科目ごとにテストの点数帯と付与ポイントを設定できます。</p>
        <button class="secondary-button compact-button" type="button" data-route="/parent/children/${child.id}/rules">ポイントルールを編集</button>
      </div>

      <div class="card detail-card danger-zone">
        <span class="summary-kicker">こども管理</span>
        <p class="card-copy">削除すると一覧に表示されなくなり、登録人数のカウントから外れます。</p>
        <button class="danger-button compact-button" type="button" id="delete-child-button">こどもを削除</button>
        <div class="confirm-panel hidden" id="delete-child-confirm">
          <strong>${escapeHtml(child.nickname)}を削除しますか？</strong>
          <p>削除後はこども一覧に表示されません。</p>
          <div class="confirm-actions">
            <button class="danger-button" type="button" id="confirm-delete-child">削除する</button>
            <button class="secondary-button" type="button" id="cancel-delete-child">キャンセル</button>
          </div>
        </div>
      </div>

      ${bottomNav("children")}
    </section>
  `;
}

function parentChildPointsView(child) {
  return `
    <section class="screen home-screen">
      ${parentHeader("ポイント履歴")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}のポイント履歴</h1>
          <p>現在ポイント ${getAvailablePoints(child).toLocaleString()}pt</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/children/${child.id}">詳細</button>
      </div>

      ${pointHistoryList(child)}

      ${bottomNav("children")}
    </section>
  `;
}

function subjectsView(child) {
  const subjects = getActiveSubjects(child);
  return `
    <section class="screen home-screen">
      ${parentHeader("科目管理")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}の科目</h1>
          <p>申請時に選ぶ科目を管理します。</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/children/${child.id}">詳細</button>
      </div>

      <form class="card form form-card" id="subject-form">
        <div class="field">
          <label for="subject-name">科目名</label>
          <input id="subject-name" name="subjectName" autocomplete="off" placeholder="例: 理科" required />
        </div>
        <div class="error" id="subject-error"></div>
        <button class="primary-button" type="submit">科目を追加</button>
      </form>

      <div class="subject-list section-tight">
        ${
          subjects.length === 0
            ? `<div class="card empty-state"><strong>科目がありません</strong><p>申請に使う科目を追加してください。</p></div>`
            : subjects.map((subject) => subjectRow(child, subject)).join("")
        }
      </div>

      ${bottomNav("children")}
    </section>
  `;
}

function subjectRow(child, subject) {
  return `
    <div class="card subject-row" data-subject-id="${subject.id}">
      <div class="subject-view">
        <strong>${escapeHtml(subject.name)}</strong>
        <div class="row-actions">
          <button class="secondary-button tiny-button edit-subject" type="button" data-subject-id="${subject.id}">編集</button>
          <button class="danger-button tiny-button delete-subject" type="button" data-subject-id="${subject.id}">削除</button>
        </div>
      </div>
      <form class="subject-edit hidden" data-subject-id="${subject.id}">
        <input name="subjectName" value="${escapeHtml(subject.name)}" autocomplete="off" />
        <div class="row-actions">
          <button class="primary-button tiny-button" type="submit">保存</button>
          <button class="secondary-button tiny-button cancel-subject" type="button" data-subject-id="${subject.id}">戻る</button>
        </div>
      </form>
    </div>
  `;
}

function pointRulesView(child) {
  const subjects = getActiveSubjects(child);
  const selectedSubject = getSelectedRuleSubject(child, subjects);
  const selectedMode = child.ruleEditorMode || "test";
  const selectedGradeType = child.ruleEditorGradeType || "grade_5";
  const flashMessage = state.flash;
  state.flash = "";
  return `
    <section class="screen home-screen">
      ${parentHeader("ポイントルール")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}のルール</h1>
          <p>科目ごとに、点数に応じたポイントを設定できます。</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/children/${child.id}">詳細</button>
      </div>

      <div class="notice-card rule-notice">
        ルール変更は今後の申請にのみ使われます。承認済みのポイントやポイント履歴は変わりません。
      </div>

      ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}

      <div class="card rule-card">
        <div class="field">
          <label for="rule-subject-select">科目</label>
          <select id="rule-subject-select">
            ${subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(selectedSubject?.id, subject.id)}>${escapeHtml(subject.name)}</option>`).join("")}
          </select>
        </div>
        <div class="segmented" role="group" aria-label="ルール種別">
          <button class="segment-button ${selectedMode === "test" ? "active" : ""}" type="button" data-rule-mode="test">テスト用</button>
          <button class="segment-button ${selectedMode === "grade" ? "active" : ""}" type="button" data-rule-mode="grade">成績用</button>
        </div>
      </div>

      ${
        selectedSubject
          ? selectedMode === "grade"
            ? gradeRulesPanel(child, selectedSubject, selectedGradeType)
            : testRulesPanel(child, selectedSubject)
          : `<div class="card empty-state"><strong>科目がありません</strong><p>先に科目を追加してください。</p></div>`
      }

      <div class="card detail-card">
        <span class="summary-kicker">おこづかい申請単位</span>
        <div class="segmented" role="group" aria-label="おこづかい申請単位">
          ${REDEMPTION_UNITS.map((unit) => `
            <button class="segment-button ${child.redemptionUnit === unit ? "active" : ""}" type="button" data-redemption-unit="${unit}">
              ${unit.toLocaleString()}pt
            </button>
          `).join("")}
        </div>
        <p class="fine-print">こどものおこづかい申請で使う単位です。</p>
      </div>

      ${bottomNav("children")}
    </section>
  `;
}

function testRulesPanel(child, subject) {
  return `
    <div class="rule-list">
      ${testRuleEditor(child, subject, "test_100", "満点が100点のテスト", 100)}
      ${testRuleEditor(child, subject, "test_50", "満点が50点のテスト", 50)}
    </div>
  `;
}

function testRuleEditor(child, subject, ruleType, title, fullScore) {
  const rule = normalizeTestRule(getEffectivePointRule(child, subject.id, ruleType), fullScore);
  return `
    <form class="card rule-card point-rule-form" data-subject-id="${subject.id}" data-rule-type="${ruleType}" data-rule-category="test" data-full-score="${fullScore}">
      <div>
        <span class="summary-kicker">${title}</span>
        <h2>${escapeHtml(subject.name)}</h2>
      </div>
      <div class="rule-table-editor test-rule-table">
        <div class="rule-table-head"><span>点数</span><span>条件</span><span>ポイント</span></div>
        ${rule.settings.map((item, index) => `
          ${testRuleRow(item, index, rule.settings.length, fullScore)}
        `).join("")}
      </div>
      <button class="secondary-button compact-button" type="submit">このルールを保存</button>
    </form>
  `;
}

function testRuleRow(item, index, rowCount, fullScore) {
  const isFirst = index === 0;
  const isLast = index === rowCount - 1;
  const score = isFirst ? fullScore : getRuleScore(item.condition);
  return `
    <div class="rule-table-row">
      ${
        isFirst || isLast
          ? `<span class="fixed-rule-value">${score}</span><input type="hidden" name="score-${index}" value="${score}" />`
          : `<input name="score-${index}" inputmode="numeric" value="${score}" />`
      }
      ${
        isFirst
          ? `<span class="fixed-rule-value">満点</span><input type="hidden" name="operator-${index}" value="満点" />`
          : isLast
            ? `<span class="fixed-rule-value">未満</span><input type="hidden" name="operator-${index}" value="未満" />`
            : `<span class="fixed-rule-value">以上</span><input type="hidden" name="operator-${index}" value="以上" />`
      }
      <input name="points-${index}" inputmode="numeric" value="${Number(item.points || 0)}" />
    </div>
  `;
}

function gradeRulesPanel(child, subject, selectedGradeType) {
  const rule = getEffectivePointRule(child, subject.id, selectedGradeType);
  const settings = normalizeGradeSettings(selectedGradeType, rule.settings);
  return `
    <div class="card rule-card">
      <div class="field">
        <label for="rule-grade-type">方式</label>
        <select id="rule-grade-type">
          <option value="grade_5" ${selectedAttr(selectedGradeType, "grade_5")}>5段階評価</option>
          <option value="grade_3" ${selectedAttr(selectedGradeType, "grade_3")}>3段階評価</option>
          <option value="grade_2" ${selectedAttr(selectedGradeType, "grade_2")}>2段階評価</option>
          <option value="grade_abc" ${selectedAttr(selectedGradeType, "grade_abc")}>A/B/C評価</option>
        </select>
      </div>
      <form class="point-rule-form" data-subject-id="${subject.id}" data-rule-type="${selectedGradeType}" data-rule-category="grade">
        <span class="summary-kicker">${ruleLabel(selectedGradeType)}</span>
        <div class="rule-table-editor grade-rule-table">
          <div class="rule-table-head"><span>評価</span><span>ポイント</span></div>
          ${settings.map((item, index) => `
            <div class="rule-table-row">
              <input type="hidden" name="id-${index}" value="${escapeHtml(item.id || `evaluation-${index + 1}`)}" />
              <input name="label-${index}" value="${escapeHtml(item.label || item.condition)}" autocomplete="off" />
              <input name="points-${index}" inputmode="numeric" value="${Number(item.points || 0)}" />
            </div>
          `).join("")}
        </div>
        <button class="secondary-button compact-button" type="submit">このルールを保存</button>
      </form>
    </div>
  `;
}

function notFoundView() {
  return `
    <section class="screen home-screen">
      ${parentHeader("こども")}
      <div class="card empty-state">
        <strong>こども情報が見つかりません</strong>
        <button class="primary-button" type="button" data-route="/parent/children">一覧に戻る</button>
      </div>
      ${bottomNav("children")}
    </section>
  `;
}

function parentSettingsHeader(title) {
  return parentPlainHeader(title, "/parent/settings", "設定に戻る");
}

function parentPlainHeader(title, backRoute = "/parent", backLabel = "ホームに戻る") {
  return `
    <div class="topbar parent-settings-topbar">
      <button class="settings-header-back" type="button" data-route="${backRoute}" aria-label="${escapeHtml(backLabel)}">
        ${studyPayIcon("chevron-left", "settings-header-back-icon")}
      </button>
      <h1>${escapeHtml(title)}</h1>
    </div>
  `;
}

function parentHeader(label) {
  return `
    <div class="topbar">
      <div class="brand">
        <span class="brand-mark">S</span>
        <span>${label}</span>
      </div>
      <button class="text-button" type="button" id="logout-button">ログアウト</button>
    </div>
  `;
}

function childCard(child) {
  return `
    <button class="card child-card" type="button" data-route="/parent/children/${child.id}">
      ${childAvatar(child)}
      <span class="child-main">
        <strong>${escapeHtml(child.nickname)}</strong>
        <span>ID: ${escapeHtml(child.loginId)}</span>
      </span>
      <span class="child-points">${getAvailablePoints(child).toLocaleString()}pt</span>
    </button>
  `;
}

function emptyChildren() {
  return `
    <div class="card empty-state">
      <div>
        <strong>こどもを追加しましょう</strong>
        <p>追加後に、こども用のログインIDとパスワードを確認できます。</p>
      </div>
    </div>
  `;
}

function childHomeView(child) {
  const applications = getChildApplications(child);
  const pendingCount = applications.filter((application) => application.status === "pending").length;
  const pendingRedemptionCount = getChildRedemptions(child).filter((redemption) => redemption.status === "pending").length;
  const pendingRedemptionPoints = getPendingRedemptionPoints(child);
  const availablePoints = getAvailablePoints(child);
  const monthlyEarnedPoints = getMonthlyEarnedPoints(child);
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

function childNotificationsView(child) {
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("通知")}
      <div class="page-heading">
        <div>
          <h1>通知</h1>
          <p>未読 ${getUnreadNotifications(child).length} 件</p>
        </div>
      </div>

      ${notificationList(child.notifications || [])}

      ${child.notifications?.length ? `<button class="secondary-button" type="button" id="read-child-notifications">すべて既読にする</button>` : ""}

      ${childBottomNav("home")}
    </section>
  `;
}

function childRedeemView(child) {
  const flashMessage = state.flash;
  state.flash = "";
  const unit = child.redemptionUnit || 1000;
  const pendingRedemptionPoints = getPendingRedemptionPoints(child);
  const availablePoints = getAvailablePoints(child);
  const maxUnits = Math.floor(availablePoints / unit);
  const options = Array.from({ length: maxUnits }, (_, index) => unit * (index + 1));
  const redemptions = getChildRedemptions(child);
  const receivedAllowanceTotal = getMonthlyReceivedAllowanceTotal(child);
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("おこづかい")}
      <div class="page-heading">
        <div>
          <h1>おこづかい申請</h1>
          <p>ポイントをおこづかいとして申請します。</p>
        </div>
      </div>

      <div class="card summary-card">
        <span class="summary-kicker">現在ポイント</span>
        <div class="summary-number">${availablePoints.toLocaleString()}pt</div>
        <p class="fine-print">確定 ${child.currentPoints.toLocaleString()}pt / 申請中 ${pendingRedemptionPoints.toLocaleString()}pt</p>
      </div>

      <div class="card summary-card">
        <span class="summary-kicker">今月もらったおこづかい</span>
        <div class="summary-number">${receivedAllowanceTotal.toLocaleString()}円</div>
      </div>

      <form class="card form form-card" id="redemption-form">
        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}
        <div class="field">
          <label for="redemption-points">おこづかい申請ポイント</label>
          <select id="redemption-points" name="points" ${options.length ? "" : "disabled"}>
            ${options.map((points) => `<option value="${points}">${points.toLocaleString()}pt</option>`).join("")}
          </select>
          <span class="field-help">設定単位: ${unit.toLocaleString()}pt</span>
        </div>
        <div class="error" id="redemption-error"></div>
        ${
          options.length
            ? `<button class="primary-button" type="submit">おこづかい申請する</button>`
            : `<div class="notice-card">おこづかい申請できるポイントがまだ足りません。</div>`
        }
      </form>

      <div class="application-list section-tight">
        ${
          redemptions.length
            ? redemptions.map(redemptionCard).join("")
            : `<div class="card empty-state"><strong>おこづかい申請はまだありません</strong><p>ポイントが貯まったら申請できます。</p></div>`
        }
      </div>

      ${childBottomNav("redeem")}
    </section>
  `;
}

function childPointHistoryView(child) {
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("ポイント")}
      <div class="page-heading">
        <div>
          <h1>ポイント履歴</h1>
          <p>増えたポイント、使ったポイントを確認できます。</p>
        </div>
      </div>

      <div class="card summary-card">
        <span class="summary-kicker">現在ポイント</span>
        <div class="summary-number">${getAvailablePoints(child).toLocaleString()}pt</div>
        <p class="fine-print">確定 ${child.currentPoints.toLocaleString()}pt / 申請中 ${getPendingRedemptionPoints(child).toLocaleString()}pt</p>
      </div>

      ${pointHistoryList(child)}

      ${childBottomNav("points")}
    </section>
  `;
}

function redemptionCard(redemption) {
  return `
    <div class="card application-card">
      <div>
        <span class="status-pill ${redemption.status}">${redemptionStatusLabel(redemption.status)}</span>
        <h2>${redemption.points.toLocaleString()}pt</h2>
        <p>${formatDate(redemption.requestedAt)} に申請</p>
      </div>
    </div>
  `;
}

function childApplyView(child, editingApplication = null) {
  const subjects = getActiveSubjects(child);
  const isReapply = Boolean(editingApplication?.isReapply);
  const isEditing = Boolean(editingApplication?.id && !isReapply);
  const selectedCategory = editingApplication?.category || "test";
  const selectedSubjectId = editingApplication?.subjectId || "";
  const selectedSubjectName = editingApplication?.subjectName || "";
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("申請")}
      <div class="page-heading child-page-heading">
        <div>
          <h1>${isEditing ? "申請を修正" : isReapply ? "再申請" : "がんばり申請"}</h1>
          <p>${isEditing ? "確認待ちの申請だけ修正できます。" : isReapply ? "キャンセルした申請を確認待ちに戻します。" : "写真と内容を送って、保護者に確認してもらいます。"}</p>
        </div>
      </div>

      <form class="card form form-card child-form-card" id="application-form">
        <div class="child-form-intro">
          <span>新規作成</span>
          <strong>今日のがんばりを記録</strong>
        </div>
        <div class="field">
          <label for="application-category">分類</label>
          <select id="application-category" name="category">
            <option value="test" ${selectedAttr(selectedCategory, "test")}>テスト</option>
            <option value="grade" ${selectedAttr(selectedCategory, "grade")}>成績</option>
            <option value="other" ${selectedAttr(selectedCategory, "other")}>その他</option>
          </select>
        </div>

        <div class="field">
          <label for="application-subject">科目</label>
          <select id="application-subject" name="subjectId">
            ${subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(selectedSubjectId, subject.id)}>${escapeHtml(subject.name)}</option>`).join("")}
            <option value="__other__" ${selectedSubjectName === "その他" || selectedSubjectId === "__other__" ? "selected" : ""}>その他</option>
          </select>
        </div>

        <div class="apply-section" data-apply-section="test">
          <div class="field">
            <label for="test-full-score">満点種別</label>
            <select id="test-full-score" name="testFullScore">
              <option value="100" ${selectedAttr(String(editingApplication?.testFullScore || 100), "100")}>100点満点</option>
              <option value="50" ${selectedAttr(String(editingApplication?.testFullScore || 100), "50")}>50点満点</option>
            </select>
          </div>
          <div class="field">
            <label for="test-score">点数</label>
            <input id="test-score" name="score" inputmode="numeric" placeholder="例: 92" value="${editingApplication?.score || ""}" />
            <span class="field-error" id="test-score-error"></span>
          </div>
        </div>

        <div class="apply-section hidden" data-apply-section="grade">
          <div class="field">
            <label for="grade-type">評価種別</label>
            <select id="grade-type" name="gradeType">
              <option value="grade_5" ${selectedAttr(editingApplication?.gradeType || "grade_5", "grade_5")}>5段階評価</option>
              <option value="grade_3" ${selectedAttr(editingApplication?.gradeType || "grade_5", "grade_3")}>3段階評価</option>
              <option value="grade_2" ${selectedAttr(editingApplication?.gradeType || "grade_5", "grade_2")}>2段階評価</option>
              <option value="grade_abc" ${selectedAttr(editingApplication?.gradeType || "grade_5", "grade_abc")}>A/B/C評価</option>
            </select>
          </div>
          <div class="field" id="grade-evaluation-field">
            ${gradeEvaluationSelect(child, selectedSubjectId, editingApplication?.gradeType || "grade_5", editingApplication)}
          </div>
        </div>

        <div class="apply-section hidden" data-apply-section="other">
          <div class="field">
            <label for="other-content">内容</label>
            <textarea id="other-content" name="otherContent" rows="4" placeholder="例: 漢字ドリルを10ページ進めた">${escapeHtml(editingApplication?.otherContent || "")}</textarea>
          </div>
          <div class="field">
            <label for="requested-points">希望ポイント</label>
            <input id="requested-points" name="requestedPoints" inputmode="numeric" placeholder="空欄ならおまかせ" value="${editingApplication?.requestedPoints || ""}" />
          </div>
        </div>

        <div class="field">
          <label for="application-photos">写真</label>
          <input id="application-photos" name="photos" type="file" accept="image/*" multiple />
          <span class="field-help" id="photo-help">テスト・成績は1〜3枚まで。その他は写真なしでも申請できます。</span>
          ${editingApplication?.photoNames?.length ? `<span class="field-help">現在の写真: ${editingApplication.photoNames.map(escapeHtml).join(", ")}</span>` : ""}
        </div>

        <div class="field">
          <label for="child-comment">コメント</label>
          <textarea id="child-comment" name="childComment" rows="3" placeholder="がんばったところを書いてね">${escapeHtml(editingApplication?.childComment || "")}</textarea>
        </div>

        <div class="error" id="application-error"></div>
        <button class="primary-button" type="submit">${isEditing ? "変更を保存" : isReapply ? "再申請する" : "申請する"}</button>
        ${isEditing ? `<button class="danger-button child-delete-application-button" type="button" id="delete-application-from-edit" data-application-id="${escapeHtml(editingApplication.id)}">削除</button>` : ""}
        <button class="secondary-button" type="button" data-route="${isEditing ? "/child/history" : "/child"}">キャンセル</button>
      </form>

      ${childBottomNav("apply")}
    </section>
  `;
}

function gradeEvaluationSelect(child, subjectId, gradeType, editingApplication = null) {
  const subject = getActiveSubjects(child).find((item) => item.id === subjectId) || getActiveSubjects(child)[0];
  const rule = getEffectivePointRule(child, subject?.id || "", gradeType || "grade_5");
  const settings = normalizeGradeSettings(gradeType || "grade_5", rule.settings);
  return `
    <label for="grade-evaluation-id">評価</label>
    <select id="grade-evaluation-id" name="gradeEvaluationId">
      ${settings.map((item, index) => `
        <option value="${escapeHtml(item.id)}" ${selectedAttr(editingApplication?.gradeEvaluationId || getEvaluationIdByLabel(settings, editingApplication?.gradeValue), item.id)}>
          ${escapeHtml(item.label)}
        </option>
      `).join("")}
    </select>
    <span class="field-help">保護者が設定した評価項目から選びます。</span>
  `;
}

function childHistoryView(child) {
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
}

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

function applicationCard(application) {
  const pointStatus = applicationPointStatus(application.status);
  const scoreLabel = applicationScoreLabel(application);
  const canEdit = !isApprovedApplicationStatus(application.status);
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
          ${application.parentComment ? `<p class="child-parent-comment ${isRedoApplicationStatus(application.status) ? "is-redo" : ""}">${escapeHtml(application.parentComment)}</p>` : ""}
        </div>
        <div class="child-history-side">
          <strong class="child-history-points ${pointStatus.className}">
            ${studyPayIcon(pointStatus.icon, "child-history-point-icon")}
            <span>${applicationPointLabel(application)}</span>
          </strong>
          ${scoreLabel ? `<span class="child-history-score">${scoreLabel}</span>` : ""}
          ${
            canEdit
              ? `<button class="child-history-edit-button" type="button" data-route="/child/apply/${application.id}" aria-label="申請を編集">${studyPayIcon("square-pen", "child-history-edit-icon")}</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function applicationScoreLabel(application) {
  if (application.category !== "test" || application.score == null || application.score === "") {
    return "";
  }

  const fullScore = Number(application.testFullScore) === 50 ? 50 : 100;
  return `${Number(application.score).toLocaleString()} / ${fullScore}`;
}

function applicationPointStatus(status) {
  if (status === "approved" || status === "approval_canceled") {
    return { className: "is-approved", icon: "circle-check" };
  }

  if (status === "returned" || status === "rejected" || status === "canceled") {
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

function pointHistoryList(child) {
  const transactions = getPointTransactions(child);
  return `
    <div class="application-list section-tight">
      ${
        transactions.length
          ? transactions.map(pointHistoryCard).join("")
          : `<div class="card empty-state"><strong>ポイント履歴はまだありません</strong><p>申請が承認されるとここに表示されます。</p></div>`
      }
    </div>
  `;
}

function pointHistoryCard(transaction) {
  const points = Number(transaction.points || 0);
  const positive = points >= 0;
  return `
    <div class="card application-card point-history-card">
      <div>
        <span class="status-pill ${positive ? "approved" : "canceled"}">${pointTransactionLabel(transaction.type)}</span>
        <h2>${positive ? "+" : ""}${points.toLocaleString()}pt</h2>
        <p>${escapeHtml(transaction.note || "ポイント履歴")}</p>
      </div>
      <div class="application-meta">
        <span>${formatDate(transaction.createdAt)}</span>
      </div>
    </div>
  `;
}

function notificationList(notifications) {
  const items = [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return `
    <div class="application-list">
      ${
        items.length
          ? items.map(notificationCard).join("")
          : `<div class="card empty-state"><strong>通知はまだありません</strong><p>申請やおこづかいの動きがあるとここに表示されます。</p></div>`
      }
    </div>
  `;
}

function notificationCard(notification) {
  return `
    <div class="card application-card notification-card ${notification.readAt ? "" : "unread"}">
      <div>
        <span class="status-pill ${notification.readAt ? "approved" : "pending"}">${notification.readAt ? "既読" : "未読"}</span>
        <h2>${escapeHtml(notification.title)}</h2>
        <p>${escapeHtml(notification.message)}</p>
      </div>
      <div class="application-meta">
        <span>${formatDate(notification.createdAt)}</span>
      </div>
      ${notification.route ? `<button class="secondary-button compact-button" type="button" data-route="${escapeHtml(notification.route)}">確認する</button>` : ""}
    </div>
  `;
}

function childHeader(label) {
  const child = typeof getCurrentChild === "function" ? getCurrentChild() : state.child;
  return `
    <div class="topbar child-topbar">
      <div class="brand">
        <img class="header-logo-image child-header-logo-image" src="./logo.svg?v=phase206" alt="INCE" />
      </div>
      <div class="child-profile-pill">
        <button class="child-account-switch-button" type="button" id="child-parent-switch-trigger" aria-haspopup="menu" aria-expanded="false">
          ${childAvatar(child, "child-account-avatar")}
          <span>${escapeHtml(child?.nickname || label)}</span>
        </button>
        ${childParentSwitchMenu()}
        <button class="text-button" type="button" id="child-logout-button">ログアウト</button>
      </div>
    </div>
  `;
}

function childParentSwitchMenu() {
  return `
    <div class="child-parent-switch-menu" id="child-parent-switch-menu" role="menu" hidden>
      <button type="button" role="menuitem" id="child-parent-switch-action">保護者アカウントに切り替える</button>
    </div>
  `;
}

function childBottomNav(active) {
  const items = [
    ["home", "⌂", "ホーム", "/child"],
    ["history", "□", "履歴", "/child/history"],
    ["apply", "+", "申請", "/child/apply"],
    ["redeem", "¥", "おこづかい", "/child/redeem"],
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
}

function bottomNav(active) {
  const activeKey = active === "children" ? "settings" : active;
  const parent = loadAccount() || state.parent || initialParent;
  const requestCount = getParentApplications().filter((item) => item.application.status === "pending").length;
  const redemptionCount = getParentRedemptions().filter((item) => item.redemption.status === "pending").length;
  const notificationCount = getUnreadNotifications(parent).length;
  const items = [
    ["home", studyPayIcon("house", "nav-lucide-icon"), "ホーム", "/parent", 0],
    ["requests", studyPayIcon("laugh", "nav-lucide-icon"), "やった！", "/parent/applications", requestCount],
    ["redemptions", studyPayIcon("hand-coins", "nav-lucide-icon"), "おこづかい", "/parent/redemptions", redemptionCount],
    ["notifications", studyPayIcon("bell", "nav-lucide-icon"), "通知", "/parent/notifications", notificationCount],
    ["settings", studyPayIcon("settings", "nav-lucide-icon"), "設定", "/parent/settings", 0],
  ];

  return `
    <nav class="bottom-nav" aria-label="保護者メニュー">
      ${items
        .map(
          ([key, icon, label, path, badgeCount]) => `
            <button class="nav-item ${activeKey === key ? "active" : ""}" type="button" data-route="${path}" aria-current="${activeKey === key ? "page" : "false"}">
              <span class="nav-icon">${icon}${navBadge(badgeCount)}</span>
              <span>${label}</span>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function navBadge(count) {
  const normalizedCount = Number(count || 0);
  if (normalizedCount <= 0) {
    return "";
  }

  return `<span class="nav-badge">${normalizedCount > 99 ? "99+" : normalizedCount}</span>`;
}

function bindLp() {
  bindRouteButtons();
}

function bindSignup() {
  bindRouteButtons();
  document.querySelector("#signup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nickname = String(form.get("nickname") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const error = document.querySelector("#signup-error");

    if (!nickname || !email || password.length < 6) {
      error.textContent = "入力内容を確認してください。";
      return;
    }

    saveAccount({
      ...initialParent,
      nickname,
      email,
      demoPassword: password,
      subscription: createTrialSubscription(),
      children: [],
      createdAt: new Date().toISOString(),
    });
    navigate("/parent");
  });
}

function bindLogin() {
  bindRouteButtons();
  const storedParent = loadAccount();
  if (storedParent?.email) {
    document.querySelector("#login-email").value = storedParent.email;
  }

  document.querySelector("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const error = document.querySelector("#login-error");
    const stored = loadAccount();

    if (!stored) {
      error.textContent = "先に無料トライアルを開始してください。";
      return;
    }

    if (email !== stored.email) {
      error.textContent = "メールアドレスが登録内容と一致しません。";
      return;
    }

    if (password !== stored.demoPassword) {
      error.textContent = "パスワードが一致しません。";
      return;
    }

    localStorage.setItem(SESSION_KEY, "true");
    state.parent = stored;
    const subscription = getSubscription(stored);
    navigate(canUseApp(subscription.status) ? "/parent" : "/parent/billing");
  });
}

function loginAsDemoParent() {
  const parent = createDemoData();
  localStorage.setItem(SESSION_KEY, "true");
  state.parent = parent;
  navigate("/parent/demo-guide");
}

function bindChildLogin() {
  bindRouteButtons();

  document.querySelector("#child-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (formElement.dataset.submitting === "true") {
      return;
    }

    const form = new FormData(formElement);
    const loginId = String(form.get("loginId") || "").trim();
    const password = String(form.get("password") || "").trim();
    const error = document.querySelector("#child-login-error");
    const submitButton = formElement.querySelector('button[type="submit"]');
    const submitButtonLabel = submitButton?.textContent || "ログイン";
    const loginIdInput = formElement.querySelector("#child-login-id-input");
    const passwordInput = formElement.querySelector("#child-login-password-input");
    if (loginIdInput) {
      loginIdInput.value = loginId;
    }
    if (passwordInput) {
      passwordInput.value = password;
    }
    error.classList.remove("is-info");
    error.textContent = "";

    if (!loginId || !password) {
      error.textContent = "ログインIDとパスワードを入力してください。";
      return;
    }

    let child = findChildByCredentials(loginId, password);

    if (!child) {
      formElement.dataset.submitting = "true";
      error.classList.add("is-info");
      error.textContent = "ログイン情報を確認しています。";
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "確認中";
      }
      try {
        child = await findChildByCredentialsFromCloud(loginId, password);
      } finally {
        formElement.dataset.submitting = "";
        if (submitButton && document.body.contains(submitButton)) {
          submitButton.disabled = false;
          submitButton.textContent = submitButtonLabel;
        }
      }
      if (!document.body.contains(formElement)) {
        return;
      }
      error.classList.remove("is-info");
    }

    if (!child) {
      error.textContent = "ログインIDまたはパスワードが違います。";
      return;
    }

    setChildSession(child);
    navigate("/child");
  });
}

function loginAsDemoChild() {
  createDemoData();
  const child = findDemoChild();
  if (child) {
    setChildSession(child);
    navigate("/child");
  }
}

function bindAdminLogin() {
  bindRouteButtons();
  document.querySelector("#admin-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const error = document.querySelector("#admin-login-error");

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      error.textContent = "管理者ログイン情報が違います。";
      return;
    }

    localStorage.setItem(ADMIN_SESSION_KEY, "true");
    navigate("/admin");
  });
}

function bindParentHome() {
  bindParentShell();
  const trigger = document.querySelector("#parent-child-switch-trigger");
  const menu = document.querySelector("#parent-child-switch-menu");

  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!menu) {
      navigate("/parent/children/new");
      return;
    }

    const nextHidden = !menu.hidden;
    menu.hidden = nextHidden;
    trigger.setAttribute("aria-expanded", String(!nextHidden));
  });

  menu?.querySelectorAll("[data-switch-child-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const child = getChildren().find((item) => item.id === button.dataset.switchChildId);
      if (child) {
        setChildSession(child);
      }
      navigate("/child");
    });
  });

  document.addEventListener("click", (event) => {
    if (!menu || menu.hidden || event.target.closest(".parent-header-switch")) {
      return;
    }

    menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function bindParentApplications() {
  bindParentShell();
  bindPhotoViewer();
  document.querySelectorAll("[data-parent-application-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.parentApplicationsFilter = button.dataset.parentApplicationFilter || "all";
      render();
    });
  });
}

function bindParentRedemptions() {
  bindParentShell();
}

function bindParentMonthlyBonus() {
  bindParentShell();

  document.querySelector("#monthly-bonus-child")?.addEventListener("change", (event) => {
    state.monthlyBonusChildId = event.currentTarget.value;
    render();
  });

  document.querySelectorAll(".grant-reference-bonus").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#monthly-bonus-reference-form");
      const formData = new FormData(form);
      const reference = MONTHLY_BONUS_REFERENCES.find((item) => item.key === button.dataset.referenceKey);
      const basePoints = Number(formData.get("basePoints") || 0);
      const suggestedPoints = Math.round(basePoints * ((reference?.suggestionPercent || 0) / 100));
      const points = Number(formData.get(`referencePoints-${reference?.key}`) || suggestedPoints);
      const childId = String(formData.get("childId") || "");
      const targetMonth = String(formData.get("targetMonth") || getCurrentMonthValue());

      if (!reference || !childId || points <= 0) {
        state.flash = "付与できる参考ポイントがありません。";
        render();
        return;
      }

      grantMonthlyBonus({
        childId,
        targetMonth,
        source: reference.key,
        name: `${reference.label}`,
        points,
        referenceRate: reference.suggestionPercent,
        referencePoints: suggestedPoints,
        note: `${reference.label}を家庭内ルールとして保護者が付与`,
      });
      state.flash = `${reference.label}を付与しました。`;
      render();
    });
  });

  document.querySelectorAll(".skip-reference-bonus").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#monthly-bonus-reference-form");
      const formData = new FormData(form);
      const reference = MONTHLY_BONUS_REFERENCES.find((item) => item.key === button.dataset.referenceKey);
      const childId = String(formData.get("childId") || "");
      const targetMonth = String(formData.get("targetMonth") || getCurrentMonthValue());
      const basePoints = Number(formData.get("basePoints") || 0);
      const referencePoints = Math.round(basePoints * ((reference?.suggestionPercent || 0) / 100));

      if (!reference || !childId) {
        state.flash = "対象を確認してください。";
        render();
        return;
      }

      skipMonthlyBonus({
        childId,
        targetMonth,
        source: reference.key,
        name: `${reference.label}`,
        referenceRate: reference.suggestionPercent,
        referencePoints,
        note: `${reference.label}を確認し、今月は付与しない判断`,
      });
      state.flash = `${reference.label}を付与なしにしました。`;
      render();
    });
  });

  document.querySelector("#monthly-bonus-custom-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const childId = String(formData.get("childId") || "");
    const targetMonth = String(formData.get("targetMonth") || getCurrentMonthValue());
    const name = String(formData.get("name") || "").trim();
    const points = Number(formData.get("points") || 0);
    const note = String(formData.get("note") || "").trim();
    const error = document.querySelector("#monthly-bonus-error");

    if (!childId || !name || points <= 0) {
      error.textContent = "ボーナス名と付与ポイントを入力してください。";
      return;
    }

    grantMonthlyBonus({
      childId,
      targetMonth,
      source: "custom",
      name,
      points,
      referenceRate: null,
      referencePoints: null,
      note,
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

function bindParentSettings() {
  bindParentShell();
  document.querySelector("#create-demo-data")?.addEventListener("click", () => {
    createDemoData();
    state.flash = "デモデータを作成しました。";
    render();
  });
  document.querySelector("#export-prototype-data")?.addEventListener("click", exportPrototypeData);
  document.querySelector("#show-reset-prototype-data")?.addEventListener("click", () => {
    document.querySelector("#reset-prototype-confirm")?.classList.remove("hidden");
  });
  document.querySelector("#cancel-reset-prototype-data")?.addEventListener("click", () => {
    document.querySelector("#reset-prototype-confirm")?.classList.add("hidden");
  });
  document.querySelector("#confirm-reset-prototype-data")?.addEventListener("click", () => {
    resetPrototypeData();
    navigate("/");
  });
}

function bindParentDemoGuide() {
  bindParentShell();
  document.querySelector("#create-demo-data-from-guide")?.addEventListener("click", () => {
    createDemoData();
    state.flash = "デモデータを作成しました。";
    render();
  });
}

function bindParentNotifications() {
  bindParentShell();
  document.querySelector("#read-parent-notifications")?.addEventListener("click", () => {
    markParentNotificationsRead();
    render();
  });
}

function bindParentBilling() {
  bindParentShell();
  document.querySelectorAll("[data-billing-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSubscription({ plan: button.dataset.billingPlan, status: "active" });
      state.flash = `${planLabel(button.dataset.billingPlan)}に変更しました。`;
      render();
    });
  });

  document.querySelectorAll("[data-billing-status]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSubscription({ status: button.dataset.billingStatus });
      state.flash = `契約状態を${subscriptionLabel(button.dataset.billingStatus)}に変更しました。`;
      render();
    });
  });
}

function bindChildNotifications(child) {
  bindChildShell();
  document.querySelector("#read-child-notifications")?.addEventListener("click", () => {
    markChildNotificationsRead(child.id);
    render();
  });
}

function bindParentRedemptionDetail(child, redemption) {
  bindParentShell();
  if (redemption.status === "completed") {
    document.querySelector("#cancel-completed-redemption")?.addEventListener("click", () => {
      updateRedemption(child.id, redemption.id, "pending");
      navigate("/parent/redemptions");
    });
    return;
  }

  if (redemption.status !== "pending") {
    return;
  }

  document.querySelector("#complete-redemption")?.addEventListener("click", () => {
    updateRedemption(child.id, redemption.id, "completed");
    navigate("/parent/redemptions");
  });

  document.querySelector("#reject-redemption")?.addEventListener("click", () => {
    updateRedemption(child.id, redemption.id, "rejected");
    navigate("/parent/redemptions");
  });
}

function bindParentApplicationDetail(child, application) {
  bindParentShell();
  bindPhotoViewer();
  if (application.status === "approved") {
    document.querySelector("#cancel-approved-application")?.addEventListener("click", () => {
      const canceled = cancelApprovedApplication(child.id, application.id);
      if (canceled) {
        navigate("/parent/applications");
      }
    });
  }

  const form = document.querySelector("#parent-review-form");
  const error = document.querySelector("#review-error");
  if (!form || application.status !== "pending") {
    return;
  }

  const getReviewValues = () => {
    const formData = new FormData(form);
    return {
      category: String(formData.get("category") || application.category),
      subjectName: String(formData.get("subjectName") || "").trim() || "その他",
      score: Number(formData.get("score") || application.score || 0) || null,
      gradeValue: String(formData.get("gradeValue") || application.gradeValue || "").trim(),
      otherContent: String(formData.get("otherContent") || application.otherContent || "").trim(),
      fixedPoints: Number(formData.get("fixedPoints") || 0),
      parentComment: String(formData.get("parentComment") || "").trim(),
    };
  };

  document.querySelector("#approve-application")?.addEventListener("click", () => {
    const values = getReviewValues();
    if (values.fixedPoints < 0) {
      error.textContent = "ポイントは0以上で入力してください。";
      return;
    }

    updateReviewedApplication(child.id, application.id, {
      ...values,
      status: "approved",
      reviewedAt: new Date().toISOString(),
    });
    navigate("/parent/applications");
  });

  document.querySelector("#return-application")?.addEventListener("click", () => {
    const values = getReviewValues();
    if (!values.parentComment) {
      error.textContent = "やり直し理由をコメントに入力してください。";
      return;
    }

    updateReviewedApplication(child.id, application.id, {
      ...values,
      fixedPoints: null,
      status: "returned",
      reviewedAt: new Date().toISOString(),
    });
    navigate("/parent/applications");
  });

  document.querySelector("#reject-application")?.addEventListener("click", () => {
    const values = getReviewValues();
    updateReviewedApplication(child.id, application.id, {
      ...values,
      fixedPoints: null,
      status: "rejected",
      reviewedAt: new Date().toISOString(),
    });
    navigate("/parent/applications");
  });
}

function bindChildren() {
  bindParentShell();
}

function bindChildNew() {
  bindParentShell();
  const form = document.querySelector("#child-form");
  if (!form) {
    return;
  }

  bindProfilePhotoPicker(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const children = getChildren();
    const error = document.querySelector("#child-error");

    if (children.length >= MAX_CHILDREN) {
      error.textContent = `こどもは最大${MAX_CHILDREN}人までです。`;
      return;
    }

    const formData = new FormData(event.currentTarget);
    const nickname = String(formData.get("nickname") || "").trim();
    const loginId = document.querySelector("#child-login-id").defaultValue;
    const password = document.querySelector("#child-password").defaultValue;

    if (!nickname || !loginId || password.length < 4) {
      error.textContent = "入力内容を確認してください。";
      return;
    }

    if (children.some((child) => child.loginId === loginId)) {
      error.textContent = "同じログインIDのこどもがいます。";
      return;
    }

    try {
      if (form._profilePhotoError) {
        error.textContent = form._profilePhotoError;
        return;
      }

      const profilePhoto = form._profilePhoto || null;
      const child = createChild({ nickname, profilePhoto, loginId, password });
      addChild(child);
      navigate(`/parent/children/${child.id}`);
    } catch (submitError) {
      error.textContent = submitError.message || "こどもを追加できませんでした。写真を変更してもう一度お試しください。";
    }
  });
}

function bindProfilePhotoPicker(container, { onFileSelected, onReset } = {}) {
  const profilePhotoMenu = container.querySelector("[data-profile-photo-menu]");
  const profilePhotoButton = container.querySelector("[data-profile-photo-button]");
  profilePhotoButton?.addEventListener("click", () => {
    if (profilePhotoMenu) {
      profilePhotoMenu.hidden = !profilePhotoMenu.hidden;
    }
  });

  container.addEventListener("click", (event) => {
    if (!event.target.closest(".profile-photo-stack") && profilePhotoMenu) {
      profilePhotoMenu.hidden = true;
    }
  });

  container.querySelectorAll("[data-profile-photo-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.profilePhotoAction === "reset") {
        container._profilePhotoFile = null;
        container._profilePhoto = null;
        container._profilePhotoError = "";
        container.querySelectorAll("[data-profile-photo-input]").forEach((input) => {
          input.value = "";
        });
        updateProfilePhotoPreview(null);
        onReset?.();
        if (profilePhotoMenu) {
          profilePhotoMenu.hidden = true;
        }
        return;
      }

      const input = container.querySelector(`[data-profile-photo-input="${button.dataset.profilePhotoAction}"]`);
      if (profilePhotoMenu) {
        profilePhotoMenu.hidden = true;
      }
      input?.click();
    });
  });

  container.querySelectorAll("[data-profile-photo-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0] || null;
      container._profilePhotoFile = file;
      container._profilePhoto = null;
      container._profilePhotoError = "";
      if (!file) {
        updateProfilePhotoPreview(null);
        return;
      }

      try {
        const profilePhoto = await createProfilePhotoFromFile(file);
        container._profilePhoto = profilePhoto;
        updateProfilePhotoPreview(profilePhoto);
        await onFileSelected?.(profilePhoto);
      } catch {
        container._profilePhotoError = "写真を読み込めませんでした。別の写真を選んでください。";
        updateProfilePhotoPreview(null);
      }
    });
  });
}

function updateProfilePhotoPreview(profilePhoto) {
  const preview = document.querySelector("#profile-photo-preview");
  if (!preview) {
    return;
  }

  if (!profilePhoto?.dataUrl) {
    preview.innerHTML = studyPayIcon("circle-user-round", "profile-photo-placeholder-icon");
    return;
  }

  preview.innerHTML = `<img src="${escapeHtml(profilePhoto.dataUrl)}" alt="${escapeHtml(profilePhoto.name || "選択したプロフィール写真")}" />`;
}

function bindChildDetail(child) {
  bindParentShell();
  if (!child) {
    return;
  }

  const profilePhotoContainer = document.querySelector("[data-child-detail-profile]");
  if (profilePhotoContainer) {
    bindProfilePhotoPicker(profilePhotoContainer, {
      onFileSelected: async (profilePhoto) => {
        updateChild(child.id, { profilePhoto });
      },
      onReset: () => {
        updateChild(child.id, { profilePhoto: null });
      },
    });
  }

  document.querySelector("#edit-child-password")?.addEventListener("click", () => {
    showChildPasswordModal(child);
  });

  document.querySelector("#toggle-child-detail-password")?.addEventListener("click", () => {
    toggleChildDetailPassword();
  });

  document.querySelector("#edit-child-nickname")?.addEventListener("click", () => {
    showChildNicknameModal(child);
  });

  document.querySelector("#delete-child-button")?.addEventListener("click", () => {
    document.querySelector("#delete-child-confirm")?.classList.remove("hidden");
  });

  document.querySelector("#cancel-delete-child")?.addEventListener("click", () => {
    document.querySelector("#delete-child-confirm")?.classList.add("hidden");
  });

  document.querySelector("#confirm-delete-child")?.addEventListener("click", () => {
    updateChild(child.id, { status: "deleted", deletedAt: new Date().toISOString() });
    navigate("/parent/children");
  });
}

function maskedPassword() {
  return "●●●●●●";
}

function isValidChildPassword(password) {
  return /^[A-Za-z0-9]{6,}$/.test(password);
}

function toggleChildDetailPassword() {
  const display = document.querySelector("#child-detail-password-display");
  const text = display?.querySelector(".child-detail-password-text");
  const toggle = document.querySelector("#toggle-child-detail-password");
  if (!display || !text || !toggle) {
    return;
  }

  const isVisible = display.dataset.visible === "true";
  display.dataset.visible = String(!isVisible);
  text.textContent = isVisible ? maskedPassword() : display.dataset.password || "";
  toggle.setAttribute("aria-label", isVisible ? "パスワードを表示" : "パスワードを非表示");
  toggle.setAttribute("aria-pressed", String(!isVisible));
  toggle.innerHTML = studyPayIcon(isVisible ? "eye" : "eye-off", "password-visibility-icon");
}

function showChildNicknameModal(child) {
  document.querySelector("#child-nickname-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-nickname-modal";
  modal.id = "child-nickname-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-nickname-title">
      <h2 id="child-nickname-title">ニックネームを変更</h2>
      <form class="form parent-switch-form" id="child-nickname-form">
        <div class="field">
          <label for="child-nickname-input">ニックネーム</label>
          <input id="child-nickname-input" name="nickname" type="text" autocomplete="off" value="${escapeHtml(child.nickname)}" required />
        </div>
        <div class="error" id="child-nickname-error"></div>
        <button class="primary-button" type="submit">保存する</button>
        <button class="secondary-button" type="button" id="cancel-child-nickname">キャンセル</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-child-nickname")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  const input = document.querySelector("#child-nickname-input");
  input?.focus();
  input?.select();
  document.querySelector("#child-nickname-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nickname = String(new FormData(event.currentTarget).get("nickname") || "").trim();
    const error = document.querySelector("#child-nickname-error");
    if (!nickname) {
      error.textContent = "ニックネームを入力してください。";
      return;
    }

    updateChild(child.id, { nickname });
    closeModal();
    render();
  });
}

function showChildPasswordModal(child) {
  document.querySelector("#child-password-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-password-modal";
  modal.id = "child-password-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-password-title">
      <h2 id="child-password-title">${escapeHtml(child.nickname)}のパスワード変更</h2>
      <form class="form parent-switch-form" id="child-password-form">
        <div class="field">
          <label for="child-password-input">新しいパスワード</label>
          <div class="password-input-wrap">
            <input id="child-password-input" name="password" type="password" autocomplete="off" value="${escapeHtml(child.demoPassword)}" required />
            <button class="password-visibility-button" type="button" id="toggle-child-password" aria-label="パスワードを表示" aria-pressed="false">
              ${studyPayIcon("eye", "password-visibility-icon")}
            </button>
          </div>
          <span class="field-help">英数字6文字以上で入力してください。</span>
        </div>
        <div class="error" id="child-password-error"></div>
        <button class="primary-button" type="submit">保存する</button>
        <button class="secondary-button" type="button" id="cancel-child-password">キャンセル</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-child-password")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  const input = document.querySelector("#child-password-input");
  const toggle = document.querySelector("#toggle-child-password");
  input?.focus();
  input?.select();
  toggle?.addEventListener("click", () => {
    const isVisible = input?.type === "text";
    if (!input) {
      return;
    }

    input.type = isVisible ? "password" : "text";
    toggle.setAttribute("aria-label", isVisible ? "パスワードを表示" : "パスワードを非表示");
    toggle.setAttribute("aria-pressed", String(!isVisible));
    toggle.innerHTML = studyPayIcon(isVisible ? "eye" : "eye-off", "password-visibility-icon");
    input.focus();
  });
  document.querySelector("#child-password-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") || "").trim();
    const error = document.querySelector("#child-password-error");
    if (!isValidChildPassword(password)) {
      error.textContent = "パスワードは英数字6文字以上で入力してください。";
      return;
    }

    updateChild(child.id, {
      demoPassword: password,
      passwordUpdatedAt: new Date().toISOString(),
    });
    closeModal();
    render();
  });
}

function bindSubjects(child) {
  bindParentShell();
  document.querySelector("#subject-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const error = document.querySelector("#subject-error");
    const formData = new FormData(event.currentTarget);
    const subjectName = String(formData.get("subjectName") || "").trim();
    const subjects = getActiveSubjects(child);

    if (!subjectName) {
      error.textContent = "科目名を入力してください。";
      return;
    }

    if (subjects.some((subject) => subject.name === subjectName)) {
      error.textContent = "同じ名前の科目があります。";
      return;
    }

    const nextSubjects = [
      ...(child.subjects || []),
      {
        id: `subject-${Date.now()}`,
        name: subjectName,
        sortOrder: subjects.length + 1,
        status: "active",
      },
    ];
    updateChild(child.id, { subjects: nextSubjects });
    render();
  });

  document.querySelectorAll(".edit-subject").forEach((button) => {
    button.addEventListener("click", () => {
      const row = document.querySelector(`[data-subject-id="${button.dataset.subjectId}"]`);
      row.querySelector(".subject-view").classList.add("hidden");
      row.querySelector(".subject-edit").classList.remove("hidden");
    });
  });

  document.querySelectorAll(".cancel-subject").forEach((button) => {
    button.addEventListener("click", () => {
      const row = document.querySelector(`[data-subject-id="${button.dataset.subjectId}"]`);
      row.querySelector(".subject-view").classList.remove("hidden");
      row.querySelector(".subject-edit").classList.add("hidden");
    });
  });

  document.querySelectorAll(".subject-edit").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const subjectId = event.currentTarget.dataset.subjectId;
      const formData = new FormData(event.currentTarget);
      const subjectName = String(formData.get("subjectName") || "").trim();
      if (!subjectName) {
        return;
      }

      const nextSubjects = (child.subjects || []).map((subject) =>
        subject.id === subjectId ? { ...subject, name: subjectName } : subject,
      );
      updateChild(child.id, { subjects: nextSubjects });
      render();
    });
  });

  document.querySelectorAll(".delete-subject").forEach((button) => {
    button.addEventListener("click", () => {
      const subjectId = button.dataset.subjectId;
      const nextSubjects = (child.subjects || []).map((subject) =>
        subject.id === subjectId
          ? { ...subject, status: "deleted", deletedAt: new Date().toISOString() }
          : subject,
      );
      updateChild(child.id, { subjects: nextSubjects });
      render();
    });
  });
}

function bindPointRules(child) {
  bindParentShell();
  document.querySelectorAll("[data-redemption-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      updateChild(child.id, { redemptionUnit: Number(button.dataset.redemptionUnit) });
      render();
    });
  });

  document.querySelector("#rule-subject-select")?.addEventListener("change", (event) => {
    updateChild(child.id, { ruleEditorSubjectId: event.currentTarget.value });
    render();
  });

  document.querySelectorAll("[data-rule-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      updateChild(child.id, { ruleEditorMode: button.dataset.ruleMode });
      render();
    });
  });

  document.querySelector("#rule-grade-type")?.addEventListener("change", (event) => {
    updateChild(child.id, { ruleEditorGradeType: event.currentTarget.value });
    render();
  });

  document.querySelectorAll(".point-rule-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const ruleCategory = event.currentTarget.dataset.ruleCategory;
      const rowCount = event.currentTarget.querySelectorAll(".rule-table-row").length;
      const settings = Array.from({ length: rowCount }, (_, index) => {
        const points = Number(formData.get(`points-${index}`) || 0);
        if (ruleCategory === "test") {
          return {
            condition: createScoreCondition(formData.get(`score-${index}`), formData.get(`operator-${index}`)),
            points,
          };
        }

        return {
          id: String(formData.get(`id-${index}`) || `evaluation-${index + 1}`),
          label: String(formData.get(`label-${index}`) || "").trim(),
          points,
        };
      });
      const nextSettings =
        ruleCategory === "test"
          ? normalizeSavedTestSettings(settings, Number(event.currentTarget.dataset.fullScore || 100))
          : settings;

      if (nextSettings.some((setting) => !(setting.condition || setting.label) || setting.points < 0)) {
        return;
      }

      updateSubjectPointRule(child.id, event.currentTarget.dataset.subjectId, event.currentTarget.dataset.ruleType, nextSettings);
      state.flash = "ポイントルールを保存しました。";
      render();
    });
  });
}

function bindChildApply(child, editingApplication = null) {
  bindChildShell();
  const applicationForm = document.querySelector("#application-form");
  const categorySelect = document.querySelector("#application-category");
  const subjectSelect = document.querySelector("#application-subject");
  const gradeTypeSelect = document.querySelector("#grade-type");
  const photoInput = document.querySelector("#application-photos");
  const photoHelp = document.querySelector("#photo-help");
  const scoreInput = document.querySelector("#test-score");
  const scoreError = document.querySelector("#test-score-error");
  if (applicationForm) {
    applicationForm.noValidate = true;
  }

  const clearScoreError = () => {
    if (scoreError) {
      scoreError.textContent = "";
    }
    scoreInput?.classList.remove("input-error");
  };
  const syncGradeEvaluations = () => {
    const field = document.querySelector("#grade-evaluation-field");
    if (!field) {
      return;
    }
    field.innerHTML = gradeEvaluationSelect(child, subjectSelect.value, gradeTypeSelect.value, editingApplication);
  };
  const syncSections = () => {
    document.querySelectorAll("[data-apply-section]").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.applySection !== categorySelect.value);
    });
    photoInput.required = false;
    if (photoHelp) {
      photoHelp.textContent =
        categorySelect.value === "other"
          ? "その他は写真なしでも申請できます。写真がある場合は3枚まで追加できます。"
          : "テスト・成績は写真が必須です。1〜3枚まで追加できます。";
    }
    syncGradeEvaluations();
  };
  categorySelect.addEventListener("change", syncSections);
  subjectSelect.addEventListener("change", syncGradeEvaluations);
  gradeTypeSelect.addEventListener("change", syncGradeEvaluations);
  scoreInput?.addEventListener("input", clearScoreError);
  syncSections();

  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = document.querySelector("#application-error");
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const submitButtonLabel = submitButton?.textContent || "";
    error.textContent = "";
    clearScoreError();
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "送信中";
    }

    try {
    const category = String(form.get("category") || "test");
    const subjectId = String(form.get("subjectId") || "");
    const subject =
      subjectId === "__other__"
        ? { id: "__other__", name: "その他" }
        : getActiveSubjects(child).find((item) => item.id === subjectId);
    const photoInput = document.querySelector("#application-photos");
    const storedPhotos = window.__studyPaySelectedPhotoFiles?.length
      ? window.__studyPaySelectedPhotoFiles
      : photoInput._studyPayFiles?.length
        ? photoInput._studyPayFiles
        : null;
    const photos = storedPhotos || photoInput.files;

    if (!subject) {
      error.textContent = "科目を選んでください。";
      return;
    }

    const scoreText = String(form.get("score") || "").trim();
    if (category === "test" && scoreText && !/^[0-9]+$/.test(scoreText)) {
      if (scoreError) {
        scoreError.textContent = "半角数字で入力してください";
      }
      scoreInput?.classList.add("input-error");
      return;
    }

    const existingPhotoNames = Array.isArray(photoInput._studyPayExistingPhotoNames)
      ? photoInput._studyPayExistingPhotoNames
      : Array.isArray(window.__studyPayExistingPhotoNames)
        ? window.__studyPayExistingPhotoNames
        : editingApplication?.photoNames || [];
    const existingPhotos = Array.isArray(photoInput._studyPayExistingPhotos)
      ? photoInput._studyPayExistingPhotos
      : Array.isArray(window.__studyPayExistingPhotos)
        ? window.__studyPayExistingPhotos
        : editingApplication?.photos || [];
    const totalPhotoCount = existingPhotoNames.length + photos.length;
    if (totalPhotoCount > 3) {
      error.textContent = "写真は1〜3枚で追加してください。";
      return;
    }

    if (category !== "other" && totalPhotoCount < 1) {
      error.textContent = "テスト・成績は写真を追加してください。";
      return;
    }

    const uploadedPhotos = photos.length ? await readPhotoFiles(photos) : [];
    const nextPhotos = photos.length ? [...existingPhotos, ...uploadedPhotos] : existingPhotos;
    const nextPhotoNames = photos.length ? [...existingPhotoNames, ...Array.from(photos).map((file) => file.name)] : existingPhotoNames;
    const application = createApplication(child, {
      existingApplication: editingApplication,
      category,
      subject,
      testFullScore: Number(form.get("testFullScore") || 100),
      score: Number(scoreText || 0),
      gradeType: String(form.get("gradeType") || ""),
      gradeEvaluationId: String(form.get("gradeEvaluationId") || ""),
      otherContent: String(form.get("otherContent") || "").trim(),
      requestedPoints: Number(form.get("requestedPoints") || 0) || null,
      childComment: String(form.get("childComment") || "").trim(),
      photoNames: nextPhotoNames,
      photos: nextPhotos,
    });

    const validationMessage = validateApplication(application);
    if (validationMessage) {
      error.textContent = validationMessage;
      return;
    }

    updateChildWithoutParentLogin(child.id, {
      applications: editingApplication
        ? (child.applications || []).map((item) => (item.id === editingApplication.id ? application : item))
        : [application, ...(child.applications || [])],
    });
    appendParentNotification({
      type: editingApplication ? "application_updated" : "application_submitted",
      title: editingApplication ? "申請が修正されました" : "新しい申請が届きました",
      message: `${child.nickname}さんから${categoryLabel(application.category)}の申請が届いています。`,
      route: `/parent/applications/${application.id}`,
    });
    await syncCurrentAccountToCloud();

    if (editingApplication) {
      navigate("/child/history");
      return;
    }

    showApplicationSubmittedModal();
    } catch (submitError) {
      error.textContent =
        submitError?.name === "QuotaExceededError"
          ? "写真の保存容量が大きすぎます。別の写真を選ぶか、写真を1枚にしてもう一度送信してください。"
          : submitError?.message || "送信できませんでした。写真を選び直してもう一度お試しください。";
    } finally {
      if (submitButton && document.body.contains(submitButton)) {
        submitButton.disabled = false;
        submitButton.textContent = submitButtonLabel;
      }
    }
  });

  document.querySelector("#delete-application-from-edit")?.addEventListener("click", (event) => {
    const applicationId = event.currentTarget.dataset.applicationId;
    showDeleteApplicationConfirm(child, applicationId);
  });
}

function showApplicationSubmittedModal() {
  document.querySelector("#application-submitted-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "child-complete-modal";
  modal.id = "application-submitted-modal";
  modal.innerHTML = `
    <div class="child-complete-modal-panel" role="dialog" aria-modal="true" aria-labelledby="application-submitted-title">
      <strong id="application-submitted-title">送信完了</strong>
      <p>${escapeHtml(randomApplicationSubmittedMessage())}</p>
      <button class="primary-button child-complete-modal-button" type="button" id="application-submitted-ok">OK</button>
    </div>
  `;

  document.body.appendChild(modal);

  document.querySelector("#application-submitted-ok")?.addEventListener("click", () => {
    modal.remove();
    navigate("/child/history");
  });
}

function randomApplicationSubmittedMessage() {
  const messages = [
    "今日のがんばり、ちゃんと届いたよ。",
    "ナイスチャレンジ！次のがんばりも楽しみだね。",
    "よくできました。自分から送れたのがすごい！",
    "その調子！コツコツ続ける力が育ってるよ。",
    "がんばったことを伝えられてえらい！",
    "一歩前進！今日の努力をしっかり残せたね。",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function showDeleteApplicationConfirm(child, applicationId) {
  document.querySelector("#delete-application-confirm-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "child-delete-modal";
  modal.id = "delete-application-confirm-modal";
  modal.innerHTML = `
    <div class="child-delete-modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-application-confirm-title">
      <strong id="delete-application-confirm-title">この申請を削除しますか？</strong>
      <p>削除すると履歴に表示されなくなります。</p>
      <div class="child-delete-modal-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-delete-application-from-edit">削除する</button>
        <button class="secondary-button child-delete-modal-cancel" type="button" id="cancel-delete-application-from-edit">キャンセル</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-delete-application-from-edit")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.querySelector("#confirm-delete-application-from-edit")?.addEventListener("click", () => {
    const nextApplications = (child.applications || []).map((application) =>
      application.id === applicationId ? { ...application, status: "deleted", deletedAt: new Date().toISOString() } : application,
    );
    updateChildWithoutParentLogin(child.id, { applications: nextApplications });
    syncCurrentAccountToCloud();
    closeModal();
    navigate("/child/history");
  });
}

function bindChildRedeem(child) {
  bindChildShell();
  const form = document.querySelector("#redemption-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const points = Number(formData.get("points") || 0);
    const error = document.querySelector("#redemption-error");

    if (!points || points > getAvailablePoints(child)) {
      error.textContent = "申請ポイントを確認してください。";
      return;
    }

    const redemption = {
      id: `redemption-${Date.now()}`,
      childId: child.id,
      points,
      status: "pending",
      requestedAt: new Date().toISOString(),
      completedAt: null,
      rejectedAt: null,
    };
    updateChildWithoutParentLogin(child.id, {
      redemptions: [redemption, ...(child.redemptions || [])],
    });
    appendParentNotification({
      type: "redemption_requested",
      title: "おこづかい申請が届きました",
      message: `${child.nickname}さんから${points.toLocaleString()}ptのおこづかい申請が届いています。`,
      route: `/parent/redemptions/${redemption.id}`,
    });
    await syncCurrentAccountToCloud();
    state.flash = `${points.toLocaleString()}ptのおこづかい申請を送りました。`;
    render();
  });
}

function bindChildHistory(child) {
  bindChildShell();
  bindPhotoViewer();
  document.querySelectorAll("[data-child-history-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.childHistoryFilter = button.dataset.childHistoryFilter || "all";
      render();
      window.dispatchEvent(new CustomEvent("ince:child-rendered"));
    });
  });

  document.querySelectorAll(".cancel-application").forEach((button) => {
    button.addEventListener("click", () => {
      const applicationId = button.dataset.applicationId;
      const nextApplications = (child.applications || []).map((application) =>
        application.id === applicationId && application.status === "pending"
          ? { ...application, status: "canceled", canceledAt: new Date().toISOString() }
          : application,
      );
      updateChildWithoutParentLogin(child.id, { applications: nextApplications });
      syncCurrentAccountToCloud();
      render();
    });
  });

  document.querySelectorAll(".delete-application").forEach((button) => {
    button.addEventListener("click", () => {
      const applicationId = button.dataset.applicationId;
      const nextApplications = (child.applications || []).map((application) =>
        application.id === applicationId && application.status === "canceled"
          ? { ...application, status: "deleted", deletedAt: new Date().toISOString() }
          : application,
      );
      updateChildWithoutParentLogin(child.id, { applications: nextApplications });
      syncCurrentAccountToCloud();
      render();
    });
  });
}

function bindPhotoViewer() {
  document.querySelectorAll(".thumbnail-button").forEach((button) => {
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showPhotoModal(button.dataset.photoSrc, button.dataset.photoName);
    });
  });
}

function bindChildShell() {
  bindRouteButtons();
  bindChildParentSwitchMenu();
  document.querySelector("#child-logout-button")?.addEventListener("click", () => {
    clearChildSession();
    navigate("/");
  });
}

function bindChildParentSwitchMenu() {
  const trigger = document.querySelector("#child-parent-switch-trigger");
  const menu = document.querySelector("#child-parent-switch-menu");

  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleChildParentSwitchMenu();
  });

  document.querySelector("#child-parent-switch-action")?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeChildParentSwitchMenu();
    showParentSwitchPasswordModal();
  });

  document.addEventListener("click", (event) => {
    if (!menu || menu.hidden || event.target.closest(".child-profile-pill, .child-design-profile-wrap")) {
      return;
    }

    closeChildParentSwitchMenu();
  });
}

function toggleChildParentSwitchMenu() {
  const trigger = document.querySelector("#child-parent-switch-trigger");
  const menu = document.querySelector("#child-parent-switch-menu");

  if (!menu) {
    return;
  }

  const shouldOpen = menu.hidden;
  menu.hidden = !shouldOpen;
  trigger?.setAttribute("aria-expanded", String(shouldOpen));
}

function closeChildParentSwitchMenu() {
  const trigger = document.querySelector("#child-parent-switch-trigger");
  const menu = document.querySelector("#child-parent-switch-menu");

  if (menu) {
    menu.hidden = true;
  }
  trigger?.setAttribute("aria-expanded", "false");
}

function showParentSwitchPasswordModal() {
  const parent = loadAccount();
  if (!parent) {
    navigate("/login");
    return;
  }

  document.querySelector("#parent-switch-password-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal";
  modal.id = "parent-switch-password-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="parent-switch-title">
      <h2 id="parent-switch-title">保護者に切り替え</h2>
      <p>保護者アカウントのパスワードを入力してください。</p>
      <form class="form parent-switch-form" id="parent-switch-password-form">
        <div class="field">
          <label for="parent-switch-password">パスワード</label>
          <input id="parent-switch-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <div class="error" id="parent-switch-error"></div>
        <button class="primary-button" type="submit">保護者に切り替える</button>
        <button class="secondary-button" type="button" id="cancel-parent-switch">キャンセル</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-parent-switch")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.querySelector("#parent-switch-password")?.focus();
  document.querySelector("#parent-switch-password-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") || "");
    const error = document.querySelector("#parent-switch-error");

    if (password !== parent.demoPassword) {
      error.textContent = "パスワードが一致しません。";
      return;
    }

    localStorage.setItem(SESSION_KEY, "true");
    state.parent = parent;
    clearChildSession();
    closeModal();
    navigate("/parent");
  });
}

function bindParentShell() {
  bindRouteButtons();
  ensureParentPullRefreshIndicator();
  bindParentPullToRefresh();
  document.querySelector("#logout-button")?.addEventListener("click", () => {
    clearSession();
    navigate("/");
  });
}

function ensureParentPullRefreshIndicator() {
  const screen = document.querySelector(".screen.home-screen");
  if (!screen || !state.route.startsWith("/parent") || screen.querySelector("[data-parent-pull-refresh]")) {
    return;
  }

  const indicator = document.createElement("div");
  indicator.className = "parent-pull-refresh";
  indicator.dataset.parentPullRefresh = "";
  indicator.setAttribute("aria-hidden", "true");
  indicator.innerHTML = `
    <span class="parent-pull-refresh-icon" aria-hidden="true">${studyPayIcon("refresh-cw", "parent-pull-refresh-svg")}</span>
    <strong data-parent-pull-refresh-label>下に引っ張って更新</strong>
  `;

  const header = screen.querySelector(".topbar");
  if (header) {
    header.insertAdjacentElement("afterend", indicator);
    return;
  }

  screen.prepend(indicator);
}

function bindParentPullToRefresh() {
  if (isParentPullRefreshBound) {
    return;
  }

  isParentPullRefreshBound = true;

  document.addEventListener(
    "touchstart",
    (event) => {
      const screen = event.target.closest?.(".screen.home-screen");
      if (!screen || !state.route.startsWith("/parent") || isParentPullRefreshing) {
        return;
      }

      if (screen.scrollTop > 0 || event.touches.length !== 1) {
        return;
      }

      parentPullRefreshStartY = event.touches[0].clientY;
      parentPullRefreshDistance = 0;
      isParentPullRefreshTracking = true;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!isParentPullRefreshTracking || isParentPullRefreshing || event.touches.length !== 1) {
        return;
      }

      const screen = getActiveParentPullRefreshScreen();
      if (!screen || screen.scrollTop > 0) {
        resetParentPullRefresh(screen);
        return;
      }

      const distance = Math.max(0, event.touches[0].clientY - parentPullRefreshStartY);
      if (distance <= 0) {
        return;
      }

      event.preventDefault();
      parentPullRefreshDistance = Math.min(PARENT_PULL_REFRESH_MAX_DISTANCE, distance * 0.55);
      updateParentPullRefreshIndicator(screen, parentPullRefreshDistance);
    },
    { passive: false },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (!isParentPullRefreshTracking) {
        return;
      }

      const screen = getActiveParentPullRefreshScreen();
      isParentPullRefreshTracking = false;
      if (!screen || parentPullRefreshDistance < PARENT_PULL_REFRESH_THRESHOLD) {
        resetParentPullRefresh(screen);
        return;
      }

      runParentPullRefresh(screen);
    },
    { passive: true },
  );

  document.addEventListener(
    "touchcancel",
    () => {
      isParentPullRefreshTracking = false;
      resetParentPullRefresh(getActiveParentPullRefreshScreen());
    },
    { passive: true },
  );
}

function getActiveParentPullRefreshScreen() {
  if (!state.route.startsWith("/parent")) {
    return null;
  }

  return document.querySelector(".screen.home-screen");
}

function updateParentPullRefreshIndicator(screen, distance) {
  if (!screen) {
    return;
  }

  const indicator = screen.querySelector("[data-parent-pull-refresh]");
  const label = indicator?.querySelector("[data-parent-pull-refresh-label]");
  const ready = distance >= PARENT_PULL_REFRESH_THRESHOLD;
  screen.classList.add("is-parent-pulling-refresh");
  screen.classList.toggle("is-parent-pull-refresh-ready", ready);
  if (indicator) {
    indicator.style.height = `${Math.round(distance)}px`;
  }
  if (label) {
    label.textContent = ready ? "離して更新" : "下に引っ張って更新";
  }
}

function resetParentPullRefresh(screen) {
  parentPullRefreshDistance = 0;
  if (!screen) {
    return;
  }

  screen.classList.remove("is-parent-pulling-refresh", "is-parent-pull-refresh-ready", "is-parent-refreshing");
  const indicator = screen.querySelector("[data-parent-pull-refresh]");
  if (indicator) {
    indicator.style.removeProperty("height");
  }
  const label = screen.querySelector("[data-parent-pull-refresh-label]");
  if (label) {
    label.textContent = "下に引っ張って更新";
  }
}

function runParentPullRefresh(screen) {
  if (!screen || isParentPullRefreshing) {
    return;
  }

  isParentPullRefreshing = true;
  screen.classList.add("is-parent-pulling-refresh", "is-parent-refreshing");
  screen.classList.remove("is-parent-pull-refresh-ready");
  const indicator = screen.querySelector("[data-parent-pull-refresh]");
  if (indicator) {
    indicator.style.height = "72px";
  }
  const label = screen.querySelector("[data-parent-pull-refresh-label]");
  if (label) {
    label.textContent = "更新中";
  }

  const routeAtStart = state.route;
  Promise.resolve(hydrateAccountFromCloud())
    .then((accountUpdated) => {
      if (accountUpdated && state.route === routeAtStart && state.route.startsWith("/parent")) {
        render();
      }
    })
    .finally(() => {
      isParentPullRefreshing = false;
      resetParentPullRefresh(getActiveParentPullRefreshScreen());
    });
}

function bindAdminShell() {
  bindRouteButtons();
  document.querySelector("#admin-logout-button")?.addEventListener("click", () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    navigate("/admin/login");
  });
}

function bindRouteButtons() {
  document.querySelectorAll("[data-route]").forEach((routeTarget) => {
    routeTarget.addEventListener("click", () => navigate(routeTarget.dataset.route));
    if (routeTarget.tagName !== "BUTTON") {
      routeTarget.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(routeTarget.dataset.route);
        }
      });
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getChildren() {
  return (state.parent?.children || []).filter((child) => child.status !== "deleted");
}

function getAllChildren() {
  return (loadAccount()?.children || []).filter((child) => child.status !== "deleted");
}

function isAdminSignedIn() {
  return localStorage.getItem(ADMIN_SESSION_KEY) === "true";
}

function getCurrentChild() {
  const session = getChildSession();
  if (!session?.childId) {
    return null;
  }

  const child = getAllChildren().find((item) => item.id === session.childId);
  if (!isChildSessionValid(child, session)) {
    clearChildSession();
    return null;
  }

  return child;
}

function findChildByCredentials(loginId, password) {
  return getAllChildren().find(
    (child) => child.loginId === loginId && child.demoPassword === password,
  );
}

async function findChildByCredentialsFromCloud(loginId, password) {
  const client = getSupabaseClient();
  if (!client || !loginId || !password) {
    return null;
  }

  try {
    cloudState.status = "syncing";
    const { data, error } = await client
      .from(SUPABASE_SNAPSHOT_TABLE)
      .select("snapshot, updated_at");

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const parent = row?.snapshot;
      const child = (parent?.children || []).find(
        (item) =>
          item.status !== "deleted" &&
          item.loginId === loginId &&
          item.demoPassword === password,
      );

      if (!child) {
        continue;
      }

      const nextParent = {
        ...parent,
        updatedAt: parent.updatedAt || row.updated_at || new Date().toISOString(),
      };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextParent));
      if (localStorage.getItem(SESSION_KEY) === "true") {
        state.parent = nextParent;
      }
      cloudState.status = "synced";
      cloudState.lastSyncedAt = new Date().toISOString();
      cloudState.error = "";
      return child;
    }

    cloudState.status = "synced";
    cloudState.lastSyncedAt = new Date().toISOString();
    cloudState.error = "";
    return null;
  } catch (error) {
    cloudState.status = "error";
    cloudState.error = error.message || "こどもログイン情報の確認に失敗しました。";
    return null;
  }
}

function findChild(childId) {
  return getChildren().find((child) => child.id === childId);
}

function getParentApplications() {
  return getChildren()
    .flatMap((child) =>
      getChildApplications(child)
        .filter((application) => !["canceled", "deleted"].includes(application.status))
        .map((application) => ({ child, application })),
    )
    .sort((a, b) => new Date(b.application.submittedAt).getTime() - new Date(a.application.submittedAt).getTime());
}

function getParentRedemptions() {
  return getChildren()
    .flatMap((child) => getChildRedemptions(child).map((redemption) => ({ child, redemption })))
    .sort((a, b) => new Date(b.redemption.requestedAt).getTime() - new Date(a.redemption.requestedAt).getTime());
}

function findRedemptionForParent(redemptionId) {
  return getParentRedemptions().find((item) => item.redemption.id === redemptionId);
}

function getAdminApplications() {
  return getAllChildren()
    .flatMap((child) => getChildApplications(child).map((application) => ({ child, application })))
    .sort((a, b) => new Date(b.application.submittedAt).getTime() - new Date(a.application.submittedAt).getTime());
}

function findApplicationForParent(applicationId) {
  return getParentApplications().find((item) => item.application.id === applicationId);
}

function addChild(child) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: [...(parent.children || []), child],
  };
  saveAccount(nextParent);
  return nextParent;
}

function updateChild(childId, updates) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) =>
      child.id === childId ? { ...child, ...updates } : child,
    ),
  };
  saveAccount(nextParent);
}

function updateReviewedApplication(childId, applicationId, updates) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const previousApplication = (child.applications || []).find((item) => item.id === applicationId);
      const pointDelta = updates.status === "approved" ? Number(updates.fixedPoints || 0) : 0;
      const now = new Date().toISOString();
      const nextApplications = (child.applications || []).map((application) =>
        application.id === applicationId
          ? {
              ...application,
              category: updates.category,
              subjectName: updates.subjectName,
              score: updates.score,
              gradeEvaluationId: application.gradeEvaluationId || "",
              gradeValue: updates.gradeValue,
              otherContent: updates.otherContent,
              fixedPoints: updates.fixedPoints,
              parentComment: updates.parentComment,
              status: updates.status,
              reviewedAt: updates.reviewedAt,
            }
          : application,
      );
      const pointTransactions =
        updates.status === "approved"
          ? [
              {
                id: `point-${Date.now()}`,
                type: "grant",
                applicationId,
                points: pointDelta,
                createdAt: now,
                note: `${previousApplication?.subjectName || updates.subjectName}の申請承認`,
              },
              ...(child.pointTransactions || []),
            ]
          : child.pointTransactions || [];
      const notification = createNotification({
        type: `application_${updates.status}`,
        title: applicationStatusNotificationTitle(updates.status),
        message: applicationStatusNotificationMessage(updates.status, updates.subjectName, pointDelta),
        route: "/child/history",
        createdAt: now,
      });

      return {
        ...child,
        applications: nextApplications,
        pointTransactions,
        notifications: [notification, ...(child.notifications || [])],
        currentPoints: child.currentPoints + pointDelta,
      };
    }),
  };
  saveAccount(nextParent);
}

function cancelApprovedApplication(childId, applicationId) {
  const parent = loadAccount();
  let canceled = false;
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const application = (child.applications || []).find((item) => item.id === applicationId);
      const points = Number(application?.fixedPoints || 0);
      if (!application || application.status !== "approved" || getAvailablePoints(child) < points) {
        return child;
      }

      canceled = true;
      const now = new Date().toISOString();
      const notification = createNotification({
        type: "application_approval_canceled",
        title: "承認が取り消されました",
        message: `${application.subjectName || "申請"}の承認が取り消され、${points.toLocaleString()}ptが戻されました。`,
        route: "/child/history",
        createdAt: now,
      });
      return {
        ...child,
        applications: (child.applications || []).map((item) =>
          item.id === applicationId
            ? {
                ...item,
                status: "approval_canceled",
                approvalCanceledAt: now,
              }
            : item,
        ),
        pointTransactions: [
          {
            id: `point-${Date.now()}`,
            type: "cancel_grant",
            applicationId,
            points: -points,
            createdAt: now,
            note: `${application.subjectName || "申請"}の承認取り消し`,
          },
          ...(child.pointTransactions || []),
        ],
        notifications: [notification, ...(child.notifications || [])],
        currentPoints: Math.max(0, child.currentPoints - points),
      };
    }),
  };

  if (canceled) {
    saveAccount(nextParent);
  }
  return canceled;
}

function updateRedemption(childId, redemptionId, status) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const redemption = (child.redemptions || []).find((item) => item.id === redemptionId);
      const points = redemption?.points || 0;
      const completed = status === "completed";
      const cancelCompleted = redemption?.status === "completed" && status === "pending";
      const now = new Date().toISOString();
      const nextRedemptions = (child.redemptions || []).map((item) =>
        item.id === redemptionId
          ? {
              ...item,
              status,
              completedAt: completed ? now : item.completedAt,
              canceledCompletedAt: cancelCompleted ? now : item.canceledCompletedAt,
              rejectedAt: status === "rejected" ? now : item.rejectedAt,
            }
          : item,
      );
      const pointTransactions = completed || cancelCompleted
        ? [
            {
              id: `point-${Date.now()}`,
              type: completed ? "redemption" : "cancel_redemption",
              redemptionId,
              points: completed ? -points : points,
              createdAt: now,
              note: completed ? "おこづかい完了" : "おこづかい完了取り消し",
            },
            ...(child.pointTransactions || []),
          ]
        : child.pointTransactions || [];
      const shouldNotify = completed || cancelCompleted || status === "rejected";
      const notification = shouldNotify
        ? createNotification({
            type: `redemption_${status}`,
            title: redemptionStatusNotificationTitle(status, cancelCompleted),
            message: redemptionStatusNotificationMessage(status, points, cancelCompleted),
            route: "/child/redeem",
            createdAt: now,
          })
        : null;

      return {
        ...child,
        redemptions: nextRedemptions,
        pointTransactions,
        notifications: notification ? [notification, ...(child.notifications || [])] : child.notifications || [],
        currentPoints: completed
          ? Math.max(0, child.currentPoints - points)
          : cancelCompleted
            ? child.currentPoints + points
            : child.currentPoints,
      };
    }),
  };
  saveAccount(nextParent);
}

function grantMonthlyBonus({ childId, targetMonth, source, name, points, referenceRate, referencePoints, note }) {
  const parent = loadAccount();
  const now = new Date().toISOString();
  const bonusId = `monthly-bonus-${Date.now()}`;
  const normalizedPoints = Number(points || 0);
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const bonus = {
        id: bonusId,
        childId,
        targetMonth,
        source,
        name,
        points: normalizedPoints,
        referenceRate,
        referencePoints,
        status: "granted",
        note,
        grantedAt: now,
        canceledAt: null,
      };
      const notification = createNotification({
        type: "monthly_bonus_granted",
        title: "月次ボーナスが付与されました",
        message: `${name}として${normalizedPoints.toLocaleString()}ptが増えました。`,
        route: "/child/points",
        createdAt: now,
      });

      return {
        ...child,
        monthlyBonuses: [bonus, ...(child.monthlyBonuses || [])],
        pointTransactions: [
          {
            id: `point-${Date.now()}`,
            type: "monthly_bonus",
            monthlyBonusId: bonusId,
            points: normalizedPoints,
            createdAt: now,
            note: name,
          },
          ...(child.pointTransactions || []),
        ],
        notifications: [notification, ...(child.notifications || [])],
        currentPoints: child.currentPoints + normalizedPoints,
      };
    }),
  };
  saveAccount(nextParent);
}

function skipMonthlyBonus({ childId, targetMonth, source, name, referenceRate, referencePoints, note }) {
  const parent = loadAccount();
  const now = new Date().toISOString();
  const bonusId = `monthly-bonus-${Date.now()}`;
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      return {
        ...child,
        monthlyBonuses: [
          {
            id: bonusId,
            childId,
            targetMonth,
            source,
            name,
            points: 0,
            referenceRate,
            referencePoints,
            status: "skipped",
            note,
            grantedAt: null,
            skippedAt: now,
            canceledAt: null,
          },
          ...(child.monthlyBonuses || []),
        ],
      };
    }),
  };
  saveAccount(nextParent);
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
      const notification = createNotification({
        type: "monthly_bonus_canceled",
        title: "月次ボーナスが取り消されました",
        message: `${bonus.name}の${points.toLocaleString()}ptが取り消されました。`,
        route: "/child/points",
        createdAt: now,
      });
      return {
        ...child,
        monthlyBonuses: (child.monthlyBonuses || []).map((item) =>
          item.id === bonusId
            ? {
                ...item,
                status: "canceled",
                canceledAt: now,
              }
            : item,
        ),
        pointTransactions: [
          {
            id: `point-${Date.now()}`,
            type: "cancel_monthly_bonus",
            monthlyBonusId: bonusId,
            points: -points,
            createdAt: now,
            note: `${bonus.name}の取り消し`,
          },
          ...(child.pointTransactions || []),
        ],
        notifications: [notification, ...(child.notifications || [])],
        currentPoints: Math.max(0, child.currentPoints - points),
      };
    }),
  };

  if (canceled) {
    saveAccount(nextParent);
  }
  return canceled;
}

function updateChildWithoutParentLogin(childId, updates) {
  const parent = loadAccount();
  const updatedAt = new Date().toISOString();
  const nextParent = {
    ...parent,
    updatedAt,
    children: (parent.children || []).map((child) =>
      child.id === childId ? { ...child, ...updates, updatedAt } : child,
    ),
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextParent));
  if (state.parent) {
    state.parent = nextParent;
  }
}

function appendParentNotification(input) {
  const parent = loadAccount();
  if (!parent) {
    return;
  }

  const notification = createNotification(input);
  const nextParent = {
    ...parent,
    updatedAt: new Date().toISOString(),
    notifications: [notification, ...(parent.notifications || [])],
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextParent));
  if (state.parent) {
    state.parent = nextParent;
  }
}

async function syncCurrentAccountToCloud() {
  const parent = loadAccount();
  if (!parent?.email) {
    return;
  }

  await syncAccountToCloud(parent);
}

function markParentNotificationsRead() {
  const parent = loadAccount();
  if (!parent) {
    return;
  }

  const now = new Date().toISOString();
  saveAccount({
    ...parent,
    notifications: (parent.notifications || []).map((notification) => ({
      ...notification,
      readAt: notification.readAt || now,
    })),
  });
}

function markChildNotificationsRead(childId) {
  const parent = loadAccount();
  if (!parent) {
    return;
  }

  const now = new Date().toISOString();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) =>
      child.id === childId
        ? {
            ...child,
            notifications: (child.notifications || []).map((notification) => ({
              ...notification,
              readAt: notification.readAt || now,
            })),
          }
        : child,
    ),
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(nextParent));
  if (state.parent) {
    state.parent = nextParent;
  }
}

function exportPrototypeData() {
  const data = {
    exportedAt: new Date().toISOString(),
    app: "ince-prototype",
    version: "phase11",
    localStorage: {
      [ACCOUNT_KEY]: localStorage.getItem(ACCOUNT_KEY),
      [SESSION_KEY]: localStorage.getItem(SESSION_KEY),
      [CHILD_SESSION_KEY]: localStorage.getItem(CHILD_SESSION_KEY),
      [ADMIN_SESSION_KEY]: localStorage.getItem(ADMIN_SESSION_KEY),
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ince-prototype-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetPrototypeData() {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CHILD_SESSION_KEY);
  localStorage.removeItem(ADMIN_SESSION_KEY);
  state.parent = null;
  state.flash = "";
}

function createDemoData() {
  const parent = loadAccount() || {
    ...initialParent,
    nickname: "デモ保護者",
    email: "demo@example.com",
    demoPassword: "demo123",
    subscription: createTrialSubscription(),
    children: [],
    createdAt: new Date().toISOString(),
  };
  const now = new Date();
  const demoChild = createDemoChild(now);
  const otherChildren = (parent.children || []).filter((child) => child.loginId !== demoChild.loginId);
  const nextParent = {
    ...parent,
    children: [demoChild, ...otherChildren].slice(0, MAX_CHILDREN),
    notifications: [
      createNotification({
        type: "demo_ready",
        title: "デモデータを作成しました",
        message: "親子の申請・承認・おこづかい申請をすぐ確認できます。",
        route: "/parent/children",
      }),
      ...(parent.notifications || []),
    ],
  };
  saveAccount(nextParent);
  return nextParent;
}

function createDemoChild(now) {
  const childId = "child-demo-mana";
  const subjects = [
    { id: "subject-demo-japanese", name: "国語", sortOrder: 1, status: "active" },
    { id: "subject-demo-math", name: "算数", sortOrder: 2, status: "active" },
    { id: "subject-demo-english", name: "英語", sortOrder: 3, status: "active" },
    { id: "subject-demo-science", name: "理科", sortOrder: 4, status: "active" },
  ];
  const submittedAt = getDateAfterDays(now, -2).toISOString();
  const approvedAt = getDateAfterDays(now, -1).toISOString();
  const pendingAt = getDateAfterDays(now, 0).toISOString();
  const mathApplication = {
    id: "application-demo-approved-math",
    childId,
    parentId: "local-parent",
    applicantType: "child",
    category: "test",
    status: "approved",
    subjectId: "subject-demo-math",
    subjectName: "算数",
    testFullScore: 100,
    score: 92,
    gradeType: "",
    gradeEvaluationId: "",
    gradeValue: "",
    otherContent: "",
    requestedPoints: null,
    suggestedPoints: 900,
    fixedPoints: 900,
    childComment: "文章題をがんばりました。",
    parentComment: "よく見直しできていました。",
    photoNames: [],
    photos: [],
    submittedAt,
    updatedAt: null,
    reviewedAt: approvedAt,
  };
  const englishApplication = {
    ...mathApplication,
    id: "application-demo-pending-english",
    category: "test",
    status: "pending",
    subjectId: "subject-demo-english",
    subjectName: "英語",
    score: 86,
    suggestedPoints: 500,
    fixedPoints: null,
    childComment: "単語をたくさん覚えました。",
    parentComment: "",
    submittedAt: pendingAt,
    reviewedAt: null,
  };
  const japaneseApplication = {
    ...mathApplication,
    id: "application-demo-returned-japanese",
    status: "returned",
    subjectId: "subject-demo-japanese",
    subjectName: "国語",
    score: 78,
    suggestedPoints: 250,
    fixedPoints: null,
    childComment: "漢字テストです。",
    parentComment: "点数が分かる写真をもう一度送ってください。",
    submittedAt: getDateAfterDays(now, -3).toISOString(),
    reviewedAt: getDateAfterDays(now, -2).toISOString(),
  };
  const completedRedemption = {
    id: "redemption-demo-completed",
    childId,
    points: 500,
    status: "completed",
    requestedAt: getDateAfterDays(now, -1).toISOString(),
    completedAt: now.toISOString(),
    rejectedAt: null,
  };
  const pendingRedemption = {
    id: "redemption-demo-pending",
    childId,
    points: 500,
    status: "pending",
    requestedAt: now.toISOString(),
    completedAt: null,
    rejectedAt: null,
  };
  const demoMonthlyBonus = {
    id: "monthly-bonus-demo-birthday",
    childId,
    targetMonth: getCurrentMonthValue(),
    source: "custom",
    name: "誕生月ボーナス",
    points: 300,
    referenceRate: null,
    referencePoints: null,
    status: "granted",
    note: "家庭内ルールとして付与",
    grantedAt: now.toISOString(),
    canceledAt: null,
  };

  return {
    id: childId,
    nickname: "Mana",
    loginId: "demo-mana",
    demoPassword: "mana1234",
    currentPoints: 1700,
    status: "active",
    subjects,
    pointRules: createDemoPointRules(),
    redemptionUnit: 500,
    applications: [englishApplication, mathApplication, japaneseApplication],
    redemptions: [pendingRedemption, completedRedemption],
    monthlyBonuses: [demoMonthlyBonus],
    pointTransactions: [
      {
        id: "point-demo-monthly-bonus",
        type: "monthly_bonus",
        monthlyBonusId: demoMonthlyBonus.id,
        points: 300,
        createdAt: now.toISOString(),
        note: "誕生月ボーナス",
      },
      {
        id: "point-demo-redemption",
        type: "redemption",
        redemptionId: completedRedemption.id,
        points: -500,
        createdAt: now.toISOString(),
        note: "おこづかい完了",
      },
      {
        id: "point-demo-initial",
        type: "adjustment",
        points: 1000,
        createdAt: getDateAfterDays(now, -4).toISOString(),
        note: "デモ初期ポイント",
      },
      {
        id: "point-demo-grant",
        type: "grant",
        applicationId: mathApplication.id,
        points: 900,
        createdAt: approvedAt,
        note: "算数の申請承認",
      },
    ],
    notifications: [
      createNotification({
        type: "application_approved",
        title: "申請が承認されました",
        message: "算数が承認され、900ptが増えました。",
        route: "/child/history",
        createdAt: approvedAt,
      }),
      createNotification({
        type: "redemption_completed",
        title: "おこづかいが支給されました",
        message: "500円のおこづかいが支給済みになりました。",
        route: "/child/redeem",
        createdAt: now.toISOString(),
      }),
    ],
    createdAt: getDateAfterDays(now, -7).toISOString(),
  };
}

function createDemoPointRules() {
  return [
    ...createDefaultPointRules(),
    {
      id: "rule-demo-math-test100",
      subjectId: "subject-demo-math",
      category: "test",
      ruleType: "test_100",
      method: "tier",
      preset: "custom",
      settings: [
        { condition: "100点", points: 1200 },
        { condition: "90点以上", points: 900 },
        { condition: "80点以上", points: 400 },
      ],
    },
    {
      id: "rule-demo-english-test100",
      subjectId: "subject-demo-english",
      category: "test",
      ruleType: "test_100",
      method: "tier",
      preset: "custom",
      settings: [
        { condition: "100点", points: 1000 },
        { condition: "85点以上", points: 500 },
        { condition: "70点以上", points: 200 },
      ],
    },
  ];
}

function updateSubscription({ plan, status }) {
  const parent = loadAccount();
  if (!parent) {
    return;
  }

  const current = getSubscription(parent);
  const nextPlan = plan || current.plan;
  const nextStatus = status || current.status;
  const now = new Date();
  const nextSubscription = {
    ...current,
    plan: nextPlan,
    status: nextStatus,
    price: PLAN_OPTIONS[nextPlan]?.price ?? current.price,
    updatedAt: now.toISOString(),
  };

  if (nextStatus === "active") {
    nextSubscription.startedAt = current.startedAt || now.toISOString();
    nextSubscription.nextBillingAt = getNextBillingDate(nextPlan, now).toISOString();
    nextSubscription.gracePeriodEndsAt = null;
    nextSubscription.canceledAt = null;
  }

  if (nextStatus === "payment_failed") {
    nextSubscription.paymentFailedAt = now.toISOString();
    nextSubscription.gracePeriodEndsAt = getDateAfterDays(now, 7).toISOString();
  }

  if (nextStatus === "grace_period") {
    nextSubscription.gracePeriodEndsAt = getDateAfterDays(now, 7).toISOString();
  }

  if (nextStatus === "canceled") {
    nextSubscription.canceledAt = now.toISOString();
    nextSubscription.nextBillingAt = null;
  }

  saveAccount({
    ...parent,
    subscriptionStatus: nextStatus,
    subscriptionPlan: nextPlan,
    trialDaysLeft: nextStatus === "trial" ? parent.trialDaysLeft ?? 14 : 0,
    subscription: nextSubscription,
  });
}

function updateSubjectPointRule(childId, subjectId, ruleType, settings) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const existingRules = child.pointRules || [];
      const existingRule = existingRules.find((rule) => rule.subjectId === subjectId && rule.ruleType === ruleType);
      const baseRule = getEffectivePointRule(child, subjectId, ruleType);
      const nextRule = {
        ...baseRule,
        ...existingRule,
        id: existingRule?.id || `rule-${Date.now()}-${subjectId}-${ruleType}`,
        subjectId,
        ruleType,
        category: ruleType.startsWith("grade_") ? "grade" : "test",
        method: "tier",
        preset: "custom",
        settings,
        updatedAt: new Date().toISOString(),
      };

      return {
        ...child,
        pointRules: existingRule
          ? existingRules.map((rule) => (rule.id === existingRule.id ? nextRule : rule))
          : [nextRule, ...existingRules],
      };
    }),
  };
  saveAccount(nextParent);
}

function createNotification({ type, title, message, route = "", createdAt = new Date().toISOString() }) {
  return {
    id: `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    message,
    route,
    createdAt,
    readAt: null,
  };
}

function createTrialSubscription() {
  const now = new Date();
  return {
    plan: "trial",
    status: "trial",
    price: 0,
    trialStartedAt: now.toISOString(),
    trialEndsAt: getDateAfterDays(now, 14).toISOString(),
    nextBillingAt: getDateAfterDays(now, 14).toISOString(),
    paymentFailedAt: null,
    gracePeriodEndsAt: null,
    canceledAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function createChild({ nickname, profilePhoto, loginId, password }) {
  return {
    id: `child-${Date.now()}`,
    nickname,
    profilePhoto: profilePhoto || null,
    loginId,
    demoPassword: password,
    currentPoints: 0,
    status: "active",
    subjects: DEFAULT_SUBJECTS.map((name, index) => ({
      id: `subject-${Date.now()}-${index}`,
      name,
      sortOrder: index + 1,
      status: "active",
    })),
    pointRules: createDefaultPointRules(),
    redemptionUnit: 1000,
    createdAt: new Date().toISOString(),
  };
}

function createDefaultPointRules() {
  return [
    {
      id: `rule-${Date.now()}-test100`,
      category: "test",
      ruleType: "test_100",
      method: "tier",
      preset: "normal",
      settings: [
        { condition: "100点", points: 1000 },
        { condition: "90点以上", points: 700 },
        { condition: "80点以上", points: 300 },
        { condition: "80点未満", points: 50 },
      ],
    },
    {
      id: `rule-${Date.now()}-test50`,
      category: "test",
      ruleType: "test_50",
      method: "tier",
      preset: "normal",
      settings: [
        { condition: "50点", points: 500 },
        { condition: "45点以上", points: 350 },
        { condition: "40点以上", points: 150 },
        { condition: "40点未満", points: 0 },
      ],
    },
    {
      id: `rule-${Date.now()}-grade5`,
      category: "grade",
      ruleType: "grade_5",
      method: "tier",
      preset: "normal",
      settings: [
        { id: "evaluation-1", label: "5", points: 1000 },
        { id: "evaluation-2", label: "4", points: 500 },
        { id: "evaluation-3", label: "3", points: 100 },
      ],
    },
    {
      id: `rule-${Date.now()}-gradeabc`,
      category: "grade",
      ruleType: "grade_abc",
      method: "tier",
      preset: "normal",
      settings: [
        { id: "evaluation-1", label: "A", points: 600 },
        { id: "evaluation-2", label: "B", points: 200 },
        { id: "evaluation-3", label: "C", points: 0 },
      ],
    },
    {
      id: `rule-${Date.now()}-grade3`,
      category: "grade",
      ruleType: "grade_3",
      method: "tier",
      preset: "normal",
      settings: [
        { id: "evaluation-1", label: "A", points: 500 },
        { id: "evaluation-2", label: "B", points: 300 },
        { id: "evaluation-3", label: "C", points: 100 },
      ],
    },
    {
      id: `rule-${Date.now()}-grade2`,
      category: "grade",
      ruleType: "grade_2",
      method: "tier",
      preset: "normal",
      settings: [
        { id: "evaluation-1", label: "A", points: 500 },
        { id: "evaluation-2", label: "B", points: 300 },
      ],
    },
  ];
}

function createApplication(child, values) {
  const suggestedPoints = calculateSuggestedPoints(child, values);
  const gradeEvaluation = values.category === "grade" ? getGradeEvaluation(child, values) : null;
  const existingApplication = values.existingApplication;
  return {
    id: existingApplication?.id || `application-${Date.now()}`,
    childId: child.id,
    parentId: loadAccount()?.id || "local-parent",
    applicantType: "child",
    category: values.category,
    status: existingApplication?.status || "pending",
    subjectId: values.subject?.id || "",
    subjectName: values.subject?.name || "",
    testFullScore: values.category === "test" ? values.testFullScore : null,
    score: values.category === "test" ? values.score : null,
    gradeType: values.category === "grade" ? values.gradeType : "",
    gradeEvaluationId: values.category === "grade" ? values.gradeEvaluationId : "",
    gradeValue: values.category === "grade" ? gradeEvaluation?.label || "" : "",
    otherContent: values.category === "other" ? values.otherContent : "",
    requestedPoints: values.category === "other" ? values.requestedPoints : null,
    suggestedPoints,
    fixedPoints: null,
    childComment: values.childComment,
    parentComment: "",
    photoNames: values.photoNames,
    photos: values.photos || [],
    submittedAt: existingApplication?.submittedAt || new Date().toISOString(),
    updatedAt: existingApplication?.id ? new Date().toISOString() : null,
    reviewedAt: null,
  };
}

function createProfilePhotoFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("画像ファイルを選択してください。"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("写真を読み込めませんでした。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("写真を読み込めませんでした。"));
      image.onload = () => {
        const scale = Math.min(
          1,
          PROFILE_PHOTO_MAX_SIZE / image.width,
          PROFILE_PHOTO_MAX_SIZE / image.height,
        );
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("写真を処理できませんでした。"));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        resolve({
          name: file.name,
          dataUrl: canvas.toDataURL("image/jpeg", PROFILE_PHOTO_JPEG_QUALITY),
        });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function readPhotoFiles(fileList) {
  return Promise.all(Array.from(fileList).map(createApplicationPhotoFromFile));
}

function createApplicationPhotoFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("画像ファイルを選択してください。"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("写真を読み込めませんでした。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("写真を読み込めませんでした。別の写真を選んでください。"));
      image.onload = () => {
        const scale = Math.min(
          1,
          APPLICATION_PHOTO_MAX_SIZE / image.width,
          APPLICATION_PHOTO_MAX_SIZE / image.height,
        );
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("写真を処理できませんでした。"));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        resolve({
          name: file.name,
          dataUrl: canvas.toDataURL("image/jpeg", APPLICATION_PHOTO_JPEG_QUALITY),
        });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

window.studyPayCreateApplicationPhotoFromFile = createApplicationPhotoFromFile;

function showPhotoModal(src, name) {
  if (!src) {
    return;
  }

  const existing = document.querySelector("#photo-modal");
  existing?.remove();

  const modal = document.createElement("div");
  modal.className = "photo-modal";
  modal.id = "photo-modal";
  modal.innerHTML = `
    <div class="photo-modal-content">
      <div class="photo-modal-header">
        <strong>${escapeHtml(name || "申請写真")}</strong>
        <button class="text-button" type="button" id="close-photo-modal">閉じる</button>
      </div>
      <img src="${escapeHtml(src)}" alt="${escapeHtml(name || "申請写真")}" />
    </div>
  `;
  document.body.appendChild(modal);
  document.querySelector("#close-photo-modal").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.remove();
    }
  });
}

function validateApplication(application) {
  if (application.category === "test") {
    if (!application.score || application.score < 1) {
      return "点数を入力してください。";
    }

    if (application.score > application.testFullScore) {
      return "点数が満点を超えています。";
    }
  }

  if (application.category === "grade" && !application.gradeValue) {
    return "評価を入力してください。";
  }

  if (application.category === "other" && !application.otherContent) {
    return "内容を入力してください。";
  }

  return "";
}

function calculateSuggestedPoints(child, values) {
  if (values.category === "other") {
    return values.requestedPoints || null;
  }

  const ruleType =
    values.category === "test"
      ? values.testFullScore === 50
        ? "test_50"
        : "test_100"
      : values.gradeType;
  const rule = getEffectivePointRule(child, values.subject?.id || values.subjectId || "", ruleType);

  if (!rule) {
    return null;
  }

  if (values.category === "test") {
    const score = Number(values.score || 0);
    const normalizedRule = normalizeTestRule(rule, values.testFullScore === 50 ? 50 : 100);
    for (const setting of normalizedRule.settings) {
      const threshold = Number(setting.condition.match(/\d+/)?.[0] || 0);
      if (setting.condition.includes("未満") && score < threshold) {
        return setting.points;
      }
      if (setting.condition.includes("以上") && score >= threshold) {
        return setting.points;
      }
      if (!setting.condition.includes("以上") && !setting.condition.includes("未満") && score === threshold) {
        return setting.points;
      }
    }
    return 0;
  }

  const gradeValue = String(values.gradeValue || "").trim().toUpperCase();
  const matched = values.gradeEvaluationId
    ? rule.settings.find((setting) => setting.id === values.gradeEvaluationId)
    : rule.settings.find((setting) => String(setting.label || setting.condition).toUpperCase() === gradeValue);
  return matched ? matched.points : 0;
}

function getChildApplications(child) {
  return [...(child.applications || [])].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  ).filter((application) => application.status !== "deleted");
}

function getChildRedemptions(child) {
  return [...(child.redemptions || [])].sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );
}

function getChildMonthlyBonuses(child) {
  return [...(child?.monthlyBonuses || [])].sort(
    (a, b) =>
      new Date(b.grantedAt || b.skippedAt || b.canceledAt).getTime() -
      new Date(a.grantedAt || a.skippedAt || a.canceledAt).getTime(),
  );
}

function getPointTransactions(child) {
  return [...(child.pointTransactions || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function findDemoChild() {
  return getChildren().find((child) => child.loginId === "demo-mana");
}

function getPendingRedemptionPoints(child) {
  return getChildRedemptions(child)
    .filter((redemption) => redemption.status === "pending")
    .reduce((total, redemption) => total + redemption.points, 0);
}

function getAvailablePoints(child) {
  return Math.max(0, child.currentPoints - getPendingRedemptionPoints(child));
}

function getSubscription(parent) {
  const fallback = createSubscriptionFallback(parent);
  return {
    ...fallback,
    ...(parent?.subscription || {}),
    plan: parent?.subscription?.plan || parent?.subscriptionPlan || fallback.plan,
    status: parent?.subscription?.status || parent?.subscriptionStatus || fallback.status,
  };
}

function getEffectivePointRule(child, subjectId, ruleType) {
  const rules = child.pointRules || [];
  return (
    rules.find((rule) => rule.subjectId === subjectId && rule.ruleType === ruleType) ||
    rules.find((rule) => !rule.subjectId && rule.ruleType === ruleType) ||
    createDefaultPointRules().find((rule) => rule.ruleType === ruleType)
  );
}

function getSelectedRuleSubject(child, subjects) {
  return subjects.find((subject) => subject.id === child.ruleEditorSubjectId) || subjects[0] || null;
}

function normalizeTestRule(rule, fullScore) {
  const fallback =
    fullScore === 50
      ? [
          { condition: "50点", points: 50 },
          { condition: "40点以上", points: 30 },
          { condition: "40点未満", points: 0 },
        ]
      : [
          { condition: "100点", points: 100 },
          { condition: "90点以上", points: 90 },
          { condition: "80点以上", points: 50 },
          { condition: "70点以上", points: 30 },
          { condition: "70点未満", points: 5 },
        ];
  const currentSettings = rule?.settings || [];
  return { ...rule, settings: normalizeSavedTestSettings(currentSettings.length ? currentSettings : fallback, fullScore) };
}

function normalizeSavedTestSettings(settings, fullScore) {
  const first = settings[0] || { condition: `${fullScore}点`, points: 0 };
  const middle = settings
    .slice(1, -1)
    .map((setting) => ({
      condition: `${getRuleScore(setting.condition)}点以上`,
      points: Number(setting.points || 0),
    }))
    .filter((setting) => getRuleScore(setting.condition) > 0)
    .sort((a, b) => getRuleScore(b.condition) - getRuleScore(a.condition));
  const minScore = middle.length ? Math.min(...middle.map((setting) => getRuleScore(setting.condition))) : fullScore;
  const last = settings.at(-1) || { points: 0 };

  return [
    { condition: `${fullScore}点`, points: Number(first.points || 0) },
    ...middle,
    { condition: `${minScore}点未満`, points: Number(last.points || 0) },
  ];
}

function normalizeGradeSettings(ruleType, settings = []) {
  const labels = {
    grade_5: ["5", "4", "3", "2", "1"],
    grade_3: ["A", "B", "C"],
    grade_2: ["A", "B"],
    grade_abc: ["A", "B", "C"],
  }[ruleType] || ["A", "B", "C"];
  return labels.map((label, index) => ({
    id: settings[index]?.id || `evaluation-${index + 1}`,
    label: settings[index]?.label || settings[index]?.condition || label,
    points: settings[index]?.points ?? [1000, 700, 300, 100, 50][index] ?? 0,
  }));
}

function getGradeEvaluation(child, values) {
  const rule = getEffectivePointRule(child, values.subject?.id || values.subjectId || "", values.gradeType || "grade_5");
  return normalizeGradeSettings(values.gradeType || "grade_5", rule.settings).find(
    (setting) => setting.id === values.gradeEvaluationId,
  );
}

function getEvaluationIdByLabel(settings, label) {
  const matched = settings.find((setting) => String(setting.label).toUpperCase() === String(label || "").toUpperCase());
  return matched?.id || "";
}

function getRuleScore(condition) {
  return Number(String(condition || "").match(/\d+/)?.[0] || 0);
}

function getRuleOperator(condition) {
  if (String(condition).includes("未満")) {
    return "未満";
  }
  if (String(condition).includes("以上")) {
    return "以上";
  }
  return "満点";
}

function createScoreCondition(scoreValue, operatorValue) {
  const score = Number(scoreValue || 0);
  const operator = String(operatorValue || "以上");
  if (!score) {
    return "";
  }
  return operator === "満点" ? `${score}点` : `${score}点${operator}`;
}

function canUseApp(status) {
  return ["trial", "active", "grace_period"].includes(status);
}

function createSubscriptionFallback(parent) {
  const now = new Date();
  const createdAt = parent?.createdAt ? new Date(parent.createdAt) : now;
  const trialEndsAt = getDateAfterDays(createdAt, 14);
  return {
    plan: parent?.subscriptionPlan || "trial",
    status: parent?.subscriptionStatus || "trial",
    price: PLAN_OPTIONS[parent?.subscriptionPlan || "trial"]?.price || 0,
    trialStartedAt: createdAt.toISOString(),
    trialEndsAt: trialEndsAt.toISOString(),
    nextBillingAt: trialEndsAt.toISOString(),
    paymentFailedAt: null,
    gracePeriodEndsAt: null,
    canceledAt: null,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
}

function getUnreadNotifications(owner) {
  return (owner?.notifications || []).filter((notification) => !notification.readAt);
}

function getMonthlyReceivedAllowanceTotal(child) {
  return getChildRedemptions(child)
    .filter((redemption) => redemption.status === "completed" && isThisMonth(redemption.completedAt))
    .reduce((total, redemption) => total + redemption.points, 0);
}

function getMonthlyEarnedPoints(child) {
  return getPointTransactions(child)
    .filter((transaction) => Number(transaction.points || 0) > 0 && isThisMonth(transaction.createdAt))
    .reduce((total, transaction) => total + Number(transaction.points || 0), 0);
}

function getParentMonthlyAllowanceTotal() {
  return getAllChildren().reduce((total, child) => total + getMonthlyReceivedAllowanceTotal(child), 0);
}

function isThisMonth(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function photoThumbnails(application) {
  const photos = application.photos || [];
  if (!photos.length && application.photosDeletedAt) {
    return `<div class="notice-card">写真は保存期限により削除済みです。</div>`;
  }

  if (!photos.length) {
    return "";
  }

  return `
    <div class="thumbnail-row" aria-label="アップロード写真">
      ${photos.map((photo, index) => `
        <button class="thumbnail-button" type="button" data-photo-src="${escapeHtml(photo.dataUrl)}" data-photo-name="${escapeHtml(photo.name)}">
          <img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.name || `申請写真${index + 1}`)}" />
        </button>
      `).join("")}
    </div>
  `;
}

function isPhotoExpired(application) {
  const days = getPhotoRetentionDays(application);
  if (!days) {
    return false;
  }

  const baseDate = new Date(application.reviewedAt || application.approvalCanceledAt || application.submittedAt);
  if (Number.isNaN(baseDate.getTime())) {
    return false;
  }

  const elapsedDays = (Date.now() - baseDate.getTime()) / (1000 * 60 * 60 * 24);
  return elapsedDays >= days;
}

function getPhotoRetentionDays(application) {
  if (application.status === "approved" || application.status === "approval_canceled") {
    return 60;
  }

  if (application.status === "returned" || application.status === "rejected") {
    return 30;
  }

  return null;
}

function categoryLabel(category) {
  const labels = {
    test: "テスト",
    grade: "成績",
    other: "その他",
  };
  return labels[category] || category;
}

function statusLabel(status) {
  const labels = {
    pending: "確認待ち",
    returned: "やり直し",
    approved: "承認済み",
    rejected: "却下",
    canceled: "キャンセル",
    approval_canceled: "承認取消",
  };
  return labels[status] || status;
}

function applicationStatusNotificationTitle(status) {
  const labels = {
    approved: "申請が承認されました",
    returned: "申請がやり直しになりました",
    rejected: "申請が却下されました",
  };
  return labels[status] || "申請が更新されました";
}

function applicationStatusNotificationMessage(status, subjectName, points) {
  if (status === "approved") {
    return `${subjectName || "申請"}が承認され、${points.toLocaleString()}ptが増えました。`;
  }

  if (status === "returned") {
    return `${subjectName || "申請"}がやり直しになりました。コメントを確認して修正できます。`;
  }

  if (status === "rejected") {
    return `${subjectName || "申請"}が却下されました。`;
  }

  return `${subjectName || "申請"}の状態が変わりました。`;
}

function redemptionStatusNotificationTitle(status, cancelCompleted) {
  if (cancelCompleted) {
    return "おこづかい完了が取り消されました";
  }

  const labels = {
    completed: "おこづかいが支給されました",
    rejected: "おこづかい申請が却下されました",
  };
  return labels[status] || "おこづかい申請が更新されました";
}

function redemptionStatusNotificationMessage(status, points, cancelCompleted) {
  if (cancelCompleted) {
    return `${points.toLocaleString()}ptのおこづかい申請が確認待ちに戻りました。`;
  }

  if (status === "completed") {
    return `${points.toLocaleString()}円のおこづかいが支給済みになりました。`;
  }

  if (status === "rejected") {
    return `${points.toLocaleString()}ptのおこづかい申請が却下され、ポイントが戻りました。`;
  }

  return `${points.toLocaleString()}ptのおこづかい申請が更新されました。`;
}

function pointTransactionLabel(type) {
  const labels = {
    grant: "ポイント付与",
    redemption: "おこづかい支給",
    cancel_redemption: "支給取消",
    cancel_grant: "承認取消",
    adjustment: "調整",
    monthly_bonus: "月次ボーナス",
    cancel_monthly_bonus: "ボーナス取消",
  };
  return labels[type] || "ポイント";
}

function monthlyBonusSourceLabel(source) {
  const labels = {
    sp500: "今月の応援ボーナス",
    all_country: "習慣づくりボーナス",
    custom: "親独自ボーナス",
  };
  return labels[source] || "月次ボーナス";
}

function redemptionStatusLabel(status) {
  const labels = {
    pending: "確認待ち",
    completed: "完了",
    rejected: "却下",
  };
  return labels[status] || status;
}

function subscriptionLabel(status) {
  const labels = {
    trial: "無料トライアル",
    active: "契約中",
    canceled: "解約済み",
    payment_failed: "支払い失敗",
    grace_period: "猶予期間",
    expired: "期限切れ",
  };
  return labels[status] || status || "-";
}

function subscriptionSummary(subscription) {
  if (subscription.status === "trial") {
    return `無料トライアル中 / ${formatDate(subscription.trialEndsAt)}まで`;
  }

  if (subscription.status === "active") {
    return `${planLabel(subscription.plan)} / 次回更新 ${formatDate(subscription.nextBillingAt)}`;
  }

  if (subscription.status === "grace_period") {
    return `支払い確認中 / 猶予期限 ${formatDate(subscription.gracePeriodEndsAt)}`;
  }

  return `${subscriptionLabel(subscription.status)} / 支払い設定を確認してください`;
}

function parentHomeSubscriptionSummary(subscription) {
  if (subscription.status === "trial") {
    return `無料トライアル中 ${formatJapaneseDate(subscription.trialEndsAt)}まで`;
  }

  return subscriptionSummary(subscription);
}

function planLabel(plan) {
  return PLAN_OPTIONS[plan]?.label || plan || "-";
}

function getDateAfterDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getNextBillingDate(plan, date) {
  const nextDate = new Date(date);
  if (plan === "yearly") {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
}

function selectedAttr(value, expectedValue) {
  return String(value) === String(expectedValue) ? "selected" : "";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("ja-JP");
}

function formatJapaneseDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("ja-JP");
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function cloudStorageLabel() {
  return cloudState.enabled ? "Supabase" : "この端末のみ";
}

function cloudSyncStatusLabel() {
  const labels = {
    local: "未接続",
    syncing: "同期中",
    synced: "同期済み",
    error: "要確認",
  };
  return labels[cloudState.status] || cloudState.status;
}

function applicationSummary(application) {
  if (application.category === "test") {
    return `${application.testFullScore}点満点中 ${application.score}点`;
  }

  if (application.category === "grade") {
    return `${application.gradeValue} の成績`;
  }

  return application.otherContent;
}

function applicationPointLabel(application) {
  const points = application.fixedPoints ?? application.suggestedPoints;
  return points == null ? "おまかせ" : `${points.toLocaleString()}pt`;
}

function studyPayIcon(name, className = "") {
  if (window.INCEIcons?.icon) {
    return window.INCEIcons.icon(name, className);
  }

  const fallbackIcons = {
    bell: `
      <path d="M10.268 21a2 2 0 0 0 3.464 0"/>
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.674C19.41 13.956 18 12.499 18 8a6 6 0 0 0-12 0c0 4.499-1.411 5.956-2.738 7.326"/>
    `,
    camera: `
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/>
      <circle cx="12" cy="13" r="3"/>
    `,
    "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
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
    "circle-user-round": `
      <path d="M18 20a6 6 0 0 0-12 0"/>
      <circle cx="12" cy="10" r="4"/>
      <circle cx="12" cy="12" r="10"/>
    `,
    eye: `
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
      <circle cx="12" cy="12" r="3"/>
    `,
    "eye-off": `
      <path d="M10.733 5.076A10.744 10.744 0 0 1 12 5c4.664 0 8.282 2.626 9.938 6.652a1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>
      <path d="M17.479 17.499A10.75 10.75 0 0 1 12 19c-4.664 0-8.282-2.626-9.938-6.652a1 1 0 0 1 0-.696A10.75 10.75 0 0 1 6.602 6.35"/>
      <path d="m2 2 20 20"/>
    `,
    "hand-coins": `
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/>
      <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/>
      <path d="m2 16 6 6"/>
      <circle cx="16" cy="9" r="2.9"/>
      <circle cx="6" cy="5" r="3"/>
    `,
    house: `
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    `,
    laugh: `
      <circle cx="12" cy="12" r="10"/>
      <path d="M18 13a6 6 0 0 1-12 0h12Z"/>
      <line x1="9" x2="9.01" y1="9" y2="9"/>
      <line x1="15" x2="15.01" y1="9" y2="9"/>
    `,
    "key-round": `
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/>
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>
    `,
    "refresh-cw": `
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M8 16H3v5"/>
    `,
    settings: `
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    `,
    "square-pen": `
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
    `,
    "square-check-big": `
      <path d="M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5"/>
      <path d="m9 11 3 3L22 4"/>
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

function generateLoginId() {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `kid${suffix}`;
}

function generatePassword() {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `sp${suffix}`;
}

function getActiveSubjects(child) {
  return (child.subjects || [])
    .filter((subject) => subject.status !== "deleted")
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function ruleLabel(ruleType) {
  const labels = {
    test_100: "テスト 100点満点",
    test_50: "テスト 50点満点",
    grade_5: "成績 5段階評価",
    grade_3: "成績 3段階評価",
    grade_2: "成績 2段階評価",
    grade_abc: "成績 A/B/C評価",
  };
  return labels[ruleType] || ruleType;
}

window.inceForceNavigate = function inceForceNavigate(path) {
  state.route = path;
  location.hash = path;
  render();
};

hydrateAccountFromCloud().finally(() => {
  render();
  startCloudAutoRefresh();
});

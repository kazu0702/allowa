const ACCOUNT_KEY = "ince_parent_account";
const SESSION_KEY = "ince_parent_session";
const CHILD_SESSION_KEY = "ince_child_session";
const ADMIN_SESSION_KEY = "ince_admin_session";
const LAST_APP_MODE_KEY = "ince_last_app_mode";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin123";
const MAX_CHILDREN = 3;
const MAX_OTHER_POINT_TASKS = 30;
const DEFAULT_SUBJECTS = ["国語", "算数", "英語"];
const REDEMPTION_UNITS = [100, 1000, 10000];
const DEFAULT_EXCHANGE_ITEM_SETTINGS = [
  { id: "allowance", name: "おこづかい", points: 100, exchangeValue: 100, unit: "円" },
  { id: "game", name: "ゲーム", points: 100, exchangeValue: 30, unit: "分" },
  { id: "smartphone", name: "スマホ", points: 100, exchangeValue: 30, unit: "分" },
];
const EXCHANGE_ITEM_UNIT_OPTIONS = ["円", "分", "時間", "回", "個"];
const DEFAULT_EXCHANGE_ITEMS = DEFAULT_EXCHANGE_ITEM_SETTINGS.map((item) => formatExchangeItemLabel(item));
const MONTHLY_BONUS_REFERENCES = [
  { key: "monthly_cheer", label: "今月の応援ボーナス", suggestionPercent: 5 },
  { key: "habit_cheer", label: "習慣づくりボーナス", suggestionPercent: 10 },
];
const BONUS_SETTING_TYPES = [
  { value: "event", label: "行事" },
  { value: "achievement", label: "達成" },
];
const SUPABASE_SNAPSHOT_TABLE = "account_snapshots";
const SUPABASE_CONFIG = window.INCE_SUPABASE_CONFIG || {};
const CHILD_CLOUD_REFRESH_INTERVAL_MS = 15000;
const PARENT_CLOUD_REFRESH_INTERVAL_MS = 15000;
const PROFILE_PHOTO_MAX_SIZE = 320;
const PROFILE_PHOTO_JPEG_QUALITY = 0.82;
const APPLICATION_PHOTO_MAX_SIZE = 900;
const APPLICATION_PHOTO_MIN_SIZE = 560;
const APPLICATION_PHOTO_JPEG_QUALITY = 0.68;
const APPLICATION_PHOTO_MIN_JPEG_QUALITY = 0.46;
const APPLICATION_PHOTO_MAX_DATA_URL_LENGTH = 240000;
const MAX_RANK_RULE_ROWS = 10;
const MAX_GRADE_RULE_ROWS = 10;
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
  monthlyBonusFormType: "event",
  monthlyBonusAchievementCategory: "test",
  monthlyBonusAchievementMetric: "score",
  monthlyBonusSettingFilter: "event",
  parentApplicationsType: "points",
  parentApplicationsFilter: "all",
  parentApplicationsFilterTouched: false,
  parentNotificationReadFilter: "all",
  childHistoryType: "points",
  childHistoryFilter: "all",
  childHistoryFilterTouched: false,
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

installPointRuleLeaveGuard();

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

      if (localUpdatedAt > remoteUpdatedAt) {
        await syncAccountToCloud(localParent);
      }
    } else {
      await syncAccountToCloud(localParent);
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
  if (localStorage.getItem(LAST_APP_MODE_KEY) === "parent") {
    localStorage.removeItem(LAST_APP_MODE_KEY);
  }
  state.parent = null;
}

function clearChildSession() {
  localStorage.removeItem(CHILD_SESSION_KEY);
  if (localStorage.getItem(LAST_APP_MODE_KEY) === "child") {
    localStorage.removeItem(LAST_APP_MODE_KEY);
  }
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
  setLastAppMode("child");
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

function setLastAppMode(mode) {
  if (mode === "parent" || mode === "child") {
    localStorage.setItem(LAST_APP_MODE_KEY, mode);
  }
}

function rememberAppModeFromRoute(path) {
  if (path.startsWith("/parent") && path !== "/parent/login") {
    setLastAppMode("parent");
    return;
  }

  if (path.startsWith("/child") && path !== "/child/login") {
    setLastAppMode("child");
  }
}

function getParentStartupRoute(parent) {
  const subscription = getSubscription(parent);
  return canUseApp(subscription.status) ? "/parent" : "/parent/billing";
}

function getStartupRouteFromSession() {
  const parent = loadSessionParent();
  const child = getCurrentChild();
  const lastMode = localStorage.getItem(LAST_APP_MODE_KEY);

  if (lastMode === "child" && child) {
    return "/child";
  }

  if (lastMode === "parent" && parent) {
    state.parent = parent;
    return getParentStartupRoute(parent);
  }

  if (parent) {
    state.parent = parent;
    return getParentStartupRoute(parent);
  }

  if (child) {
    return "/child";
  }

  return "";
}

function navigate(path) {
  if (shouldConfirmPointRuleLeave(path)) {
    showPointRuleLeaveModal(path);
    return;
  }

  if (path === "/parent/applications") {
    const wasPointApplications = state.parentApplicationsType === "points";
    state.parentApplicationsType = "points";
    if (!wasPointApplications) {
      state.parentApplicationsFilter = "all";
      state.parentApplicationsFilterTouched = false;
    }
  }

  if (path === "/parent/redemptions") {
    const wasAllowanceApplications = state.parentApplicationsType === "allowance";
    state.parentApplicationsType = "allowance";
    if (!wasAllowanceApplications) {
      state.parentApplicationsFilter = "all";
      state.parentApplicationsFilterTouched = false;
    }
  }

  rememberAppModeFromRoute(path);
  location.hash = path;
}

function installPointRuleLeaveGuard() {
  document.addEventListener(
    "click",
    (event) => {
      const routeTarget = event.target.closest?.("[data-route]");
      const nextPath = routeTarget?.dataset?.route;
      if (!nextPath || !shouldConfirmPointRuleLeave(nextPath)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showPointRuleLeaveModal(nextPath);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const routeTarget = event.target.closest?.("[data-route]");
      const nextPath = routeTarget?.dataset?.route;
      if (!nextPath || !shouldConfirmPointRuleLeave(nextPath)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showPointRuleLeaveModal(nextPath);
    },
    true,
  );
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

  if (route === "/") {
    const startupRoute = getStartupRouteFromSession();
    if (startupRoute) {
      navigate(startupRoute);
      return;
    }
  }

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
    setLastAppMode("child");
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
    setLastAppMode("parent");
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
    route === "/child/exchange" ||
    route === "/child/redeem" ||
    route === "/parent/children/new" ||
    route.startsWith("/parent/monthly-bonus") ||
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
    state.parentApplicationsType = "allowance";
    app.innerHTML = parentApplicationsView();
    bindParentApplications();
    return;
  }

  if (route === "/parent/monthly-bonus") {
    app.innerHTML = parentMonthlyBonusView();
    bindParentShell();
    return;
  }

  if (route.startsWith("/parent/monthly-bonus/")) {
    const childId = decodeURIComponent(route.split("/").at(-1) || "");
    const child = getChildren().find((item) => item.id === childId);
    app.innerHTML = child ? parentMonthlyBonusDetailView(child) : notFoundView();
    child ? bindParentMonthlyBonus() : bindParentShell();
    return;
  }

  if (route === "/parent/notifications") {
    app.innerHTML = parentNotificationsView();
    bindParentNotifications();
    scrollNotificationsToLatest();
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

  if (route === "/parent/settings/exchange-unit") {
    app.innerHTML = parentExchangeUnitSettingsView();
    bindParentShell();
    return;
  }

  if (route.startsWith("/parent/settings/exchange-unit/")) {
    const childId = decodeURIComponent(route.split("/").at(-1) || "");
    const child = getChildren().find((item) => item.id === childId);
    app.innerHTML = child ? parentExchangeUnitSettingsDetailView(child) : notFoundView();
    child ? bindParentExchangeUnitSettings() : bindParentShell();
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

  if (route === "/admin/supabase") {
    app.innerHTML = adminSupabaseView();
    bindAdminSupabase();
    return;
  }

  app.innerHTML = adminDashboardView();
  bindAdminShell();
}

function renderChildRoute(app, route, child) {
  if (route === "/child/notifications") {
    app.innerHTML = childNotificationsView(child);
    bindChildNotifications(child);
    scrollNotificationsToLatest();
    return;
  }

  if (route === "/child/points") {
    app.innerHTML = childPointHistoryView(child);
    bindChildShell();
    return;
  }

  if (route === "/child/redeem") {
    navigate("/child/exchange");
    return;
  }

  if (route === "/child/exchange") {
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
      <div class="brand" aria-label="allowa">
        <img class="header-logo-image lp-header-logo-image" src="./logo.svg?v=phase322" alt="allowa" />
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
        <h1>がんばったをおこづかいに</h1>
      </div>
      <div class="hero-copy">
        <span class="lp-section-kicker">about</span>
        <span class="hero-eyebrow">allowa（アロワ）とは</span>
        <div class="hero-copy-card">
          <h2>親子でたのしく取り組む<br />おこづかいの仕組み化サービスです</h2>
          <p>毎月定額で支給するおこづかい。こどもたちはそれを当たり前だと思ったり、少ないと不満をもらすことも、、、<br />allowaならテストや成績・お手伝いなど、こどもの「がんばり」に応じてポイントを付与できます。<br />貯まったポイントを家庭内でおこづかいやスマホやゲームの時間と交換。<br />がんばりがポイントとして数字で増えるから次も挑戦したくなります。</p>
        </div>
        <div class="hero-actions">
          <button class="primary-button" type="button" data-route="/signup">14日間無料で始める</button>
        </div>
      </div>

      <section class="section motivation-section">
        <span class="lp-section-kicker">reason</span>
        <h2>こどものやる気が<br />続きやすい理由</h2>
        <div class="motivation-list">
          <div class="motivation-item">
            <div>
              <strong><span class="motivation-number">1</span><span>見てもらえる</span></strong>
              <span class="motivation-subtitle">show</span>
              <p>写真つきで申請するから、点数だけでなく取り組みそのものを伝えられます。</p>
              <img class="motivation-image" src="./apply.png?v=phase322" alt="" loading="lazy" />
            </div>
          </div>
          <div class="motivation-item">
            <div>
              <strong><span class="motivation-number">2</span><span>認めてもらえる</span></strong>
              <span class="motivation-subtitle">approval</span>
              <p>承認されるとポイントが増えるので、努力がその場で実感できます。</p>
              <img class="motivation-image" src="./approve.png?v=phase322" alt="" loading="lazy" />
            </div>
          </div>
          <div class="motivation-item">
            <div>
              <strong><span class="motivation-number">3</span><span>がんばりが見える</span></strong>
              <span class="motivation-subtitle">visualization</span>
              <p>何をがんばったからポイントになったのか、親子で同じ履歴を見られます。</p>
              <img class="motivation-image" src="./reward.png?v=phase322" alt="" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      <section class="section feature-strip">
        <span class="lp-section-kicker">How to use</span>
        <h2>使い方</h2>
        <div class="feature-list">
          <div class="mini-card">
            <span class="feature-number">1</span>
            <div>
              <strong>ポイント付与の基準を設定</strong>
              <p>テストや成績、お手伝いなど、家庭ごとの基準を決めます。</p>
            </div>
          </div>
          <div class="mini-card">
            <span class="feature-number">2</span>
            <div>
              <strong>こどもが申請</strong>
              <p>がんばった内容を、写真やメモと一緒に送ります。</p>
            </div>
          </div>
          <div class="mini-card">
            <span class="feature-number">3</span>
            <div>
              <strong>親が確認</strong>
              <p>申請内容を見て、承認・やり直し・却下を選びます。</p>
            </div>
          </div>
          <div class="mini-card">
            <span class="feature-number">4</span>
            <div>
              <strong>ポイント付与</strong>
              <p>承認された内容に応じて、家庭内ポイントが増えます。</p>
            </div>
          </div>
          <div class="mini-card">
            <span class="feature-number">5</span>
            <div>
              <strong>おこづかい申請</strong>
              <p>貯まったポイントを使って、こどもから申請できます。</p>
            </div>
          </div>
          <div class="mini-card">
            <span class="feature-number">6</span>
            <div>
              <strong>おこづかい支給</strong>
              <p>親が確認して、家庭内のおこづかいとして支給します。</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section faq-section">
        <span class="lp-section-kicker">FAQ</span>
        <h2>よくある質問</h2>
        <div class="faq-list">
          <div class="faq-item">
            <h3>ポイントは何に使えますか？</h3>
            <p>家庭内のおこづかいや、スマホ・ゲーム時間などのごほうびルールに使えます。</p>
          </div>
          <div class="faq-item">
            <h3>こどもは自分でポイントを増やせますか？</h3>
            <p>いいえ。こどもの申請を保護者が確認し、承認した内容だけポイントになります。</p>
          </div>
          <div class="faq-item">
            <h3>スマホだけで使えますか？</h3>
            <p>はい。親もこどもも、スマホで申請・確認しやすい画面を前提にしています。</p>
          </div>
          <div class="faq-item">
            <h3>無料で試せますか？</h3>
            <p>14日間無料でお試しいただけます。家庭に合うか確認してから続けられます。</p>
          </div>
        </div>
      </section>

      <footer class="lp-footer">
        <div class="lp-footer-brand">
          <img class="lp-footer-icon" src="./icon.svg?v=phase322" alt="" />
          <img class="lp-footer-logo" src="./logo.svg?v=phase322" alt="allowa" />
        </div>
        <p>がんばったをおこづかいに</p>
        <small>&copy; 2026 allowa</small>
      </footer>
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
  return `
    <section class="screen home-screen">
      <div class="topbar parent-home-topbar">
        <div class="brand">
          <img class="header-logo-image parent-header-logo-image" src="./logo.svg?v=phase322" alt="allowa" />
        </div>
        <div class="parent-header-switch">
          ${parentHeaderChildButtons(children)}
          ${children.length < MAX_CHILDREN ? `
            <button class="parent-header-add-child-button" type="button" data-route="/parent/children/new" aria-label="こどもを追加する">
              ${studyPayIcon("user-round-plus", "parent-header-add-child-icon")}
            </button>
          ` : ""}
          ${parentChildSwitchMenu(children)}
        </div>
      </div>

      ${subscription.status === "grace_period" ? `<div class="notice-card">支払い確認中です。猶予期間中は通常どおり利用できます。</div>` : ""}

      ${parentHomeChildrenStatus(children)}

      ${bottomNav("home")}
    </section>
  `;
}

function parentHeaderChildButtons(children) {
  if (!children.length) {
    return `<span class="parent-header-child-empty" aria-hidden="true">${studyPayIcon("circle-user-round", "parent-header-child-empty-icon")}</span>`;
  }

  return `
    <span class="parent-header-child-list">
      ${children.map((child) => `
        <button class="parent-header-child-button" type="button" data-parent-header-child-id="${escapeHtml(child.id)}" data-parent-header-child-name="${escapeHtml(child.nickname)}" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(child.nickname)}に切り替える">
          ${childAvatar(child, "parent-header-child-avatar")}
        </button>
      `).join("")}
    </span>
  `;
}

function parentChildSwitchMenu(children) {
  return `
    <div class="parent-child-switch-menu" id="parent-child-switch-menu" role="menu" hidden>
      <button class="parent-child-switch-title" type="button" role="menuitem" data-switch-child-id="" ${children.length ? "" : "disabled"}>こどもに切り替える</button>
    </div>
  `;
}

function parentHomeChildrenStatus(children) {
  if (!children.length) {
    return `
      <section class="parent-child-status-section">
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
      <div class="parent-child-status-list">
        ${children.map(parentHomeChildStatusBlock).join("")}
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
  const photoStyle = profilePhotoImageStyle(child?.profilePhoto);
  return `
    <span class="child-avatar profile-avatar ${photo ? "profile-avatar-photo" : ""} ${className}">
      ${
        photo
          ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(child?.profilePhoto?.name || `${child?.nickname || "こども"}のプロフィール写真`)}" ${photoStyle} />`
          : studyPayIcon("circle-user-round", "profile-avatar-icon")
      }
    </span>
  `;
}

function parentHomeChildStatusBlock(child) {
  return `
    <div class="parent-child-status-block">
      ${parentHomeChildStatusCard(child)}
    </div>
  `;
}

function parentHomeChildStatusCard(child) {
  const monthlyEarnedPoints = getMonthlyEarnedPoints(child);
  const monthlyAllowance = getMonthlyReceivedAllowanceTotal(child);

  return `
    <button class="card parent-child-status-card" type="button" data-route="/parent/children/${child.id}">
      <span class="parent-child-status-main">
        <span class="parent-child-status-overview">
          <span class="parent-child-status-profile">
            ${childAvatar(child, "parent-child-status-avatar")}
            <strong>${escapeHtml(child.nickname)}</strong>
          </span>
          <span class="parent-child-total-points">
            <span>ポイント残高</span>
            <strong>${getAvailablePoints(child).toLocaleString()}<span class="parent-child-total-unit">pt</span></strong>
          </span>
          <span class="parent-child-detail-button">詳細</span>
        </span>
        <span class="parent-child-status-table" aria-label="${escapeHtml(child.nickname)}の今月分">
          <span class="parent-child-status-heading">
            <span>今月分</span>
          </span>
          <span class="parent-child-status-cell parent-child-status-label">ポイント</span>
          <span class="parent-child-status-cell parent-child-status-label">おこづかい</span>
          <strong class="parent-child-status-cell parent-child-status-value">${parentChildStatusValue(monthlyEarnedPoints, "pt")}</strong>
          <strong class="parent-child-status-cell parent-child-status-value">${parentChildStatusValue(monthlyAllowance, "円")}</strong>
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
  const readFilter = state.parentNotificationReadFilter || "all";
  const notifications = getParentAnnouncements(parent);
  const visibleNotifications = filterNotificationsByReadState(notifications, readFilter);
  return `
    <section class="screen home-screen notification-screen">
      ${parentSettingsRootHeader("お知らせ")}

      <div class="parent-notification-list-head">
        ${notifications.length && readFilter !== "read" ? `<button class="parent-notification-read-all-button" type="button" id="read-parent-notifications">すべて既読にする</button>` : "<span></span>"}
        ${parentNotificationReadTabs(readFilter)}
      </div>

      ${notificationList(visibleNotifications, { owner: "parent" })}

      ${bottomNav("notifications")}
    </section>
  `;
}

function getParentAnnouncements(parent) {
  return (parent?.notifications || []).filter((notification) => parentNotificationSource(notification) === "system");
}

function parentNotificationReadTabs(activeFilter) {
  return `
    <div class="parent-notification-read-tabs" role="tablist" aria-label="お知らせの表示">
      ${parentNotificationReadTab("all", "すべて", activeFilter)}
      ${parentNotificationReadTab("read", "既読", activeFilter)}
      ${parentNotificationReadTab("unread", "未読", activeFilter)}
    </div>
  `;
}

function parentNotificationReadTab(value, label, activeFilter) {
  const isActive = value === activeFilter;
  return `
    <button class="${isActive ? "active" : ""}" type="button" role="tab" aria-selected="${isActive ? "true" : "false"}" data-parent-notification-read="${value}">
      ${label}
    </button>
  `;
}

function parentNotificationSource(notification) {
  const type = notification.type || "";
  if (type === "demo_ready" || type.startsWith("demo_system")) {
    return "system";
  }

  const childSourceTypes = new Set([
    "application_submitted",
    "application_updated",
    "application_reapplied",
    "redemption_requested",
  ]);

  if (childSourceTypes.has(type)) {
    return "child";
  }

  const route = String(notification.route || "");
  if (route.startsWith("/parent/applications") || route.startsWith("/parent/redemptions")) {
    return "child";
  }

  return "system";
}

function filterNotificationsByReadState(notifications, readFilter) {
  if (readFilter === "all") {
    return notifications;
  }

  return notifications.filter((notification) => (readFilter === "read" ? Boolean(notification.readAt) : !notification.readAt));
}

function parentSettingsView() {
  return `
    <section class="screen home-screen parent-settings-screen">
      ${parentSettingsRootHeader("設定")}

      <div class="settings-menu">
        ${settingsMenuButton("ボーナス設定", "/parent/monthly-bonus")}
        ${settingsMenuButton("ポイント交換設定", "/parent/settings/exchange-unit")}
        ${settingsMenuButton("メールアドレス設定", "/parent/settings/email")}
        ${settingsMenuButton("パスワード変更", "/parent/settings/password")}
        ${settingsMenuButton("ログアウト", "/parent/settings/logout")}
        ${settingsMenuButton("退会", "/parent/settings/cancel", true)}
      </div>

      ${bottomNav("settings")}
    </section>
  `;
}

function parentExchangeUnitSettingsView() {
  const children = getChildren();
  return `
    <section class="screen home-screen monthly-bonus-index-screen">
      ${parentSettingsHeader("ポイント交換設定")}

      ${
        children.length
          ? `
            <div class="exchange-setting-child-list">
              ${children.map(exchangeSettingChildCard).join("")}
            </div>
          `
          : `<div class="card empty-state"><strong>こどもがまだ登録されていません</strong><p>ポイント交換設定を使うには、先にこどもを追加してください。</p><button class="primary-button compact-button" type="button" data-route="/parent/children/new">こどもを追加する</button></div>`
      }

      ${bottomNav("settings")}
    </section>
  `;
}

function exchangeSettingChildCard(child) {
  return `
    <button class="card exchange-setting-child-card" type="button" data-route="/parent/settings/exchange-unit/${encodeURIComponent(child.id)}">
      ${childAvatar(child, "exchange-setting-child-avatar")}
      <span>${escapeHtml(child.nickname)}</span>
      ${studyPayIcon("chevron-right", "exchange-setting-child-chevron")}
    </button>
  `;
}

function parentExchangeUnitSettingsDetailView(child) {
  return parentSettingsDetailView(
    `${child.nickname}のポイント交換設定`,
    `
      <div class="settings-exchange-unit-list">
        ${childPointExchangeUnitCard(child)}
      </div>
    `,
  );
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
      <form class="card detail-card form parent-account-settings-form" id="parent-email-form">
        <dl class="info-list">
          <div><dt>現在のメール</dt><dd>${escapeHtml(parent.email || "-")}</dd></div>
        </dl>
        <div class="field">
          <label for="parent-email-input">新しいメールアドレス</label>
          <input id="parent-email-input" name="email" type="email" autocomplete="email" value="${escapeHtml(parent.email || "")}" required />
        </div>
        <div class="field">
          <label for="parent-email-password">現在のパスワード</label>
          <input id="parent-email-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <div class="error" id="parent-email-error"></div>
        <button class="primary-button" type="submit">保存</button>
      </form>
    `,
  );
}

function parentPasswordSettingsView() {
  return parentSettingsDetailView(
    "パスワード変更",
    `
      <form class="card detail-card form parent-account-settings-form" id="parent-password-form">
        <div class="field">
          <label for="parent-current-password">現在のパスワード</label>
          <input id="parent-current-password" name="currentPassword" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="parent-new-password">新しいパスワード</label>
          <input id="parent-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" placeholder="6文字以上" required />
        </div>
        <div class="field">
          <label for="parent-new-password-confirm">新しいパスワード（確認）</label>
          <input id="parent-new-password-confirm" name="newPasswordConfirm" type="password" autocomplete="new-password" minlength="6" required />
        </div>
        <div class="error" id="parent-password-error"></div>
        <button class="primary-button" type="submit">保存</button>
      </form>
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
        <p class="card-copy">退会すると、この端末に保存されている保護者アカウント・こども情報・申請履歴などのデータを削除します。</p>
        <button class="danger-button compact-button" type="button" id="show-parent-cancel-modal">退会する</button>
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
        <p class="card-copy">MVP検証用に、この端末に保存されているデータをバックアップできます。初期化すると登録情報・こども・申請・お知らせが消えます。</p>
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
  const activeType = state.parentApplicationsType || "points";
  const isAllowance = activeType === "allowance";
  const items = isAllowance ? getParentRedemptions() : getParentApplications();
  const pendingItems = items.filter((item) => (isAllowance ? item.redemption.status : item.application.status) === "pending");
  const preferredFilter = getDefaultPendingAwareFilter({
    currentFilter: state.parentApplicationsFilter,
    pendingCount: pendingItems.length,
    touched: state.parentApplicationsFilterTouched,
  });
  const activeFilter = normalizeParentApplicationFilter(preferredFilter, activeType);
  state.parentApplicationsFilter = activeFilter;
  const filteredItems = isAllowance ? filterParentRedemptions(items, activeFilter) : filterParentApplications(items, activeFilter);
  return `
    <section class="screen home-screen">
      ${parentSettingsRootHeader("申請一覧")}
      ${parentApplicationTypeTabs(activeType)}
      ${parentApplicationFilterRow(activeFilter, activeType, pendingItems.length)}
      <div class="page-heading settings-page-heading">
        <p>確認待ち ${pendingItems.length} 件</p>
      </div>

      <div class="application-list">
        ${
          items.length === 0
            ? `<div class="card empty-state"><strong>${isAllowance ? "交換申請" : "ポイント申請"}はまだありません</strong><p>こどもから申請されるとここに表示されます。</p></div>`
            : filteredItems.length === 0
              ? `<div class="card empty-state"><strong>表示できる申請はありません</strong><p>ほかのタグに切り替えて確認できます。</p></div>`
              : renderDateGroupedCards(
                  filteredItems,
                  (item) => (isAllowance ? item.redemption.requestedAt : item.application.submittedAt),
                  (item) => (isAllowance ? parentRedemptionCard(item.child, item.redemption) : parentApplicationCard(item.child, item.application)),
                )
        }
      </div>

      ${bottomNav("requests")}
    </section>
  `;
}

function parentApplicationTypeTabs(activeType) {
  const pendingPointCount = getParentApplications().filter((item) => item.application.status === "pending").length;
  const pendingAllowanceCount = getParentRedemptions().filter((item) => item.redemption.status === "pending").length;
  return `
    <div class="parent-application-type-tabs" role="tablist" aria-label="申請の種類">
      ${parentApplicationTypeTab("points", "ポイント申請", activeType, pendingPointCount)}
      ${parentApplicationTypeTab("allowance", "交換申請", activeType, pendingAllowanceCount)}
    </div>
  `;
}

function parentApplicationTypeTab(value, label, activeType, pendingCount) {
  const isActive = value === activeType;
  return `
    <button class="${isActive ? "active" : ""}" type="button" role="tab" aria-selected="${isActive ? "true" : "false"}" data-parent-application-type="${value}" data-pending-count="${pendingCount}">
      ${label}
      ${pendingCount > 0 ? `<span class="parent-application-type-badge">${pendingCount > 99 ? "99+" : pendingCount}</span>` : ""}
    </button>
  `;
}

function parentApplicationFilterRow(activeFilter, activeType = "points", pendingCount = 0) {
  const isAllowance = activeType === "allowance";
  return `
    <div class="parent-application-filter-row" aria-label="申請タグ">
      ${parentApplicationFilterButton("all", "すべて", activeFilter)}
      ${parentApplicationFilterButton("pending", "確認待ち", activeFilter, pendingCount > 0)}
      ${
        isAllowance
          ? `
            ${parentApplicationFilterButton("completed", "承認済み", activeFilter)}
            ${parentApplicationFilterButton("rejected", "却下", activeFilter)}
          `
          : `
            ${parentApplicationFilterButton("approved", "承認済み", activeFilter)}
            ${parentApplicationFilterButton("redo", "やり直し", activeFilter)}
          `
      }
    </div>
  `;
}

function parentApplicationFilterButton(value, label, activeFilter, hasDot = false) {
  const isActive = value === activeFilter;
  return `
    <button class="filter-${value} ${isActive ? "active" : ""}" type="button" data-parent-application-filter="${value}" aria-pressed="${isActive ? "true" : "false"}">
      ${label}
      ${hasDot ? `<span class="filter-notification-dot" aria-hidden="true"></span>` : ""}
    </button>
  `;
}

function renderDateGroupedCards(items, getDate, renderCard) {
  const sortedItems = [...items].sort((a, b) => {
    const firstDate = new Date(getDate(a)).getTime();
    const secondDate = new Date(getDate(b)).getTime();
    return firstDate - secondDate;
  });
  let currentDateKey = "";

  return sortedItems.map((item) => {
    const dateValue = getDate(item);
    const dateKey = notificationDateKey(dateValue);
    const dateLabel = formatMonthDayWithWeekday(dateValue);
    const dateHeading = dateKey && dateKey !== currentDateKey
      ? `<div class="notification-date-separator application-list-date-separator">${dateLabel}</div>`
      : "";
    currentDateKey = dateKey || currentDateKey;
    return `${dateHeading}${renderCard(item)}`;
  }).join("");
}

function normalizeParentApplicationFilter(filter, activeType) {
  const allowedFilters = activeType === "allowance"
    ? ["all", "pending", "completed", "rejected"]
    : ["all", "pending", "approved", "redo"];
  return allowedFilters.includes(filter) ? filter : "all";
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

function filterParentRedemptions(items, filter) {
  if (filter === "pending") {
    return items.filter((item) => item.redemption.status === "pending");
  }

  if (filter === "completed") {
    return items.filter((item) => item.redemption.status === "completed");
  }

  if (filter === "rejected") {
    return items.filter((item) => item.redemption.status === "rejected");
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
          <button type="button" data-route="/admin/supabase">Supabase</button>
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

function adminSupabaseView() {
  return adminShell(
    "Supabaseデータ",
    `
      <div class="admin-panel">
        <div class="admin-panel-header">
          <div>
            <h2>account_snapshots</h2>
            <p>Supabaseに保存されているアカウントスナップショットを確認します。</p>
          </div>
          <button class="primary-button small-action" type="button" id="admin-supabase-refresh">再読み込み</button>
        </div>
        <div class="admin-supabase-status" id="admin-supabase-status">読み込み中...</div>
        <div id="admin-supabase-content"></div>
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

function adminSupabaseTable(rows) {
  if (!rows.length) {
    return `<div class="notice-card">Supabaseにデータはまだありません。</div>`;
  }

  return `
    <table class="admin-table admin-supabase-table">
      <thead>
        <tr><th>メール</th><th>更新日時</th><th>概要</th><th>snapshot</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => adminSupabaseRow(row)).join("")}
      </tbody>
    </table>
  `;
}

function adminSupabaseRow(row) {
  const snapshot = row.snapshot || {};
  const children = Array.isArray(snapshot.children) ? snapshot.children : [];
  const applicationsCount = children.reduce(
    (total, child) => total + (Array.isArray(child.applications) ? child.applications.length : 0),
    0,
  );
  const redemptionsCount = children.reduce(
    (total, child) => total + (Array.isArray(child.redemptions) ? child.redemptions.length : 0),
    0,
  );
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  return `
    <tr>
      <td>
        <strong>${escapeHtml(row.email || snapshot.email || "-")}</strong>
        <span class="admin-subtext">${escapeHtml(snapshot.nickname || "名前未設定")}</span>
      </td>
      <td>${formatDateTime(row.updated_at || snapshot.updatedAt)}</td>
      <td>
        <div class="admin-snapshot-summary">
          <span>こども ${children.length}人</span>
          <span>申請 ${applicationsCount}件</span>
          <span>おこづかい申請 ${redemptionsCount}件</span>
        </div>
      </td>
      <td>
        <details class="admin-json-details">
          <summary>中身を見る</summary>
          <pre>${escapeHtml(snapshotJson)}</pre>
        </details>
      </td>
    </tr>
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
          <strong class="application-card-points ${application.status}">${applicationCardPointLabel(application)}</strong>
        </div>
        ${studyPayIcon("chevron-right", "application-card-chevron")}
      </div>
      ${photoThumbnails(application)}
    </div>
  `;
}

function parentApplicationCardTitle(application) {
  if (application.category === "other") {
    return escapeHtml(application.otherContent || "その他");
  }

  const category = categoryLabel(application.category);
  const subject = application.subjectName || category;
  return escapeHtml(subject);
}

function parentApplicationCardSummary(application) {
  if (application.category === "test") {
    if (application.testMethod === "rank") {
      return `
        <p>
          <strong class="application-card-score">${Number(application.rank || 0).toLocaleString()}</strong>
          <span class="application-card-score-unit"> 位</span>
        </p>
      `;
    }

    const fullScore = Number(application.testFullScore) || 100;
    return `
      <p>
        <strong class="application-card-score">${Number(application.score || 0).toLocaleString()}</strong>
        <span class="application-card-score-unit"> / ${fullScore.toLocaleString()} 点</span>
      </p>
    `;
  }

  if (application.category === "other") {
    return "";
  }

  return `<p>${applicationSummary(application)}</p>`;
}

function parentApplicationDetailTitle(application) {
  if (application.category === "other") {
    return escapeHtml(application.otherContent || "その他");
  }

  return `${categoryLabel(application.category)}${application.subjectName ? `・${escapeHtml(application.subjectName)}` : ""}`;
}

function parentApplicationDetailView(child, application) {
  const editable = application.status === "pending";
  const canCancelApproval = application.status === "approved" && getAvailablePoints(child) >= Number(application.fixedPoints || 0);
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("ポイント申請内容", "/parent/applications", "申請一覧に戻る")}
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(child.nickname)}の申請</h1>
          <p>${statusLabel(application.status)}・${new Date(application.submittedAt).toLocaleDateString("ja-JP")}</p>
        </div>
        <button class="secondary-button small-action" type="button" data-route="/parent/applications">一覧</button>
      </div>

      <div class="card detail-card">
        <span class="summary-kicker">申請内容</span>
        <h2>${parentApplicationDetailTitle(application)}</h2>
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
        <div class="field ${application.category === "other" ? "hidden" : ""}">
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
            : renderDateGroupedCards(
                items,
                (item) => item.redemption.requestedAt,
                ({ child, redemption }) => parentRedemptionCard(child, redemption),
              )
        }
      </div>

      ${bottomNav("redemptions")}
    </section>
  `;
}

function parentRedemptionCard(child, redemption) {
  const exchangeInfo = getRedemptionExchangeInfo(child, redemption);
  return `
    <div class="card application-card redemption-application-card" data-route="/parent/redemptions/${redemption.id}" role="button" tabindex="0">
      <div class="application-card-header">
        <div class="application-card-child">
          ${childAvatar(child, "application-card-avatar")}
          <span class="application-card-child-name">${escapeHtml(child.nickname)}</span>
        </div>
        <div class="application-card-title">
          <span class="redemption-exchange-item-name">${escapeHtml(exchangeInfo.name)}</span>
          <div class="redemption-flow-line">
            <strong>${redemption.points.toLocaleString()}<small>pt</small></strong>
            ${studyPayIcon("move-right", "redemption-flow-icon")}
            <strong>${Number(exchangeInfo.exchangeValue || 0).toLocaleString()}<small>${escapeHtml(exchangeInfo.unit)}</small></strong>
          </div>
        </div>
        <div class="application-card-aside"></div>
        ${studyPayIcon("chevron-right", "application-card-chevron")}
      </div>
    </div>
  `;
}

function parentMonthlyBonusView() {
  const children = getChildren();
  return `
    <section class="screen home-screen monthly-bonus-index-screen">
      ${parentSettingsHeader("ボーナス設定")}

      ${
        children.length
          ? `
            <div class="monthly-bonus-child-list">
              ${children.map(monthlyBonusChildCard).join("")}
            </div>
          `
          : `<div class="card empty-state"><strong>こどもがまだ登録されていません</strong><p>ボーナス設定を使うには、先にこどもを追加してください。</p><button class="primary-button compact-button" type="button" data-route="/parent/children/new">こどもを追加する</button></div>`
      }

      ${bottomNav("settings")}
    </section>
  `;
}

function monthlyBonusChildCard(child) {
  return `
    <button class="card monthly-bonus-child-card" type="button" data-route="/parent/monthly-bonus/${encodeURIComponent(child.id)}">
      ${childAvatar(child, "monthly-bonus-child-avatar")}
      <span>${escapeHtml(child.nickname)}</span>
      ${studyPayIcon("chevron-right", "monthly-bonus-child-chevron")}
    </button>
  `;
}

function parentMonthlyBonusDetailView(selectedChild) {
  const bonusSettings = getChildBonusSettings(selectedChild);
  const flashMessage = state.flash;
  const subjects = getBonusAvailableSubjects(selectedChild);
  const gradeOptions = getBonusGradeOptions(selectedChild);
  state.flash = "";
  return `
    <section class="screen home-screen">
      ${parentSettingsHeader(`${selectedChild?.nickname || "こども"}のボーナス設定`)}

      ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}

      ${
        selectedChild
          ? `
            <form class="card form form-card monthly-bonus-setting-form" id="monthly-bonus-setting-form">
              <h2>ボーナスを追加</h2>
              <input type="hidden" name="childId" value="${escapeHtml(selectedChild.id)}" />
              <div class="field">
                ${bonusChoiceButtons("type", [
                  { value: "event", label: "行事" },
                  { value: "achievement", label: "条件達成" },
                ], state.monthlyBonusFormType)}
              </div>
              <div class="bonus-type-fields" data-bonus-type-section="event">
                <div class="bonus-sentence-line">
                  <span>毎年</span>
                  <div class="bonus-select-wrap">
                    <select id="bonus-event-month" name="eventMonth" aria-label="月">
                      ${Array.from({ length: 12 }, (_, index) => {
                        const month = index + 1;
                        return `<option value="${month}">${month}月</option>`;
                      }).join("")}
                    </select>
                    ${studyPayIcon("chevron-down", "bonus-select-icon")}
                  </div>
                  <div class="bonus-select-wrap bonus-day-select">
                    <select id="bonus-event-day" name="eventDay" aria-label="日">
                      ${Array.from({ length: 31 }, (_, index) => {
                        const day = index + 1;
                        return `<option value="${day}">${day}日</option>`;
                      }).join("")}
                    </select>
                    ${studyPayIcon("chevron-down", "bonus-select-icon")}
                  </div>
                </div>
                <div class="bonus-sentence-line">
                  <input id="bonus-event-name" name="eventName" placeholder="例: 誕生日" autocomplete="off" />
                  <span>に</span>
                </div>
                <div class="bonus-sentence-line">
                  <input id="bonus-event-points" name="eventPoints" inputmode="numeric" placeholder="例: 5000" />
                  <span>ポイント</span>
                </div>
              </div>
              <div class="bonus-type-fields" data-bonus-type-section="achievement" hidden>
                <div class="field">
                  ${bonusChoiceButtons("achievementCategory", [
                    { value: "test", label: "テスト" },
                    { value: "grade", label: "成績" },
                  ], state.monthlyBonusAchievementCategory)}
                </div>
                <div class="field" data-achievement-category-section="test">
                  ${bonusChoiceButtons("achievementMetric", [
                    { value: "score", label: "点数" },
                    { value: "rank", label: "順位" },
                  ], state.monthlyBonusAchievementMetric)}
                </div>
                <div class="bonus-condition-divider">
                  <span>条件</span>
                </div>
                <p class="bonus-condition-note" data-achievement-category-section="test">50点満点のテストはボーナスの対象外となります。</p>
                <div class="bonus-sentence-line">
                  <div class="bonus-select-wrap bonus-subject-select">
                    <select id="bonus-achievement-subject" name="achievementSubjectId" aria-label="科目">
                      ${
                        subjects.length
                          ? subjects.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")
                          : `<option value="">科目なし</option>`
                      }
                    </select>
                    ${studyPayIcon("chevron-down", "bonus-select-icon")}
                  </div>
                  <span>の</span>
                  <span data-bonus-sentence-category-text>テストで</span>
                </div>
                <div class="bonus-sentence-line" data-achievement-category-section="test" data-achievement-metric-section="score">
                  <input id="bonus-achievement-score" class="bonus-inline-number" name="achievementScore" inputmode="numeric" placeholder="100" aria-label="点数" />
                  <span>点以上を</span>
                </div>
                <div class="bonus-sentence-line" data-achievement-category-section="test" data-achievement-metric-section="rank" hidden>
                  <input id="bonus-achievement-rank" class="bonus-inline-number" name="achievementRank" inputmode="numeric" placeholder="1" aria-label="順位" />
                  <span>位以上を</span>
                </div>
                <div class="bonus-sentence-line" data-achievement-category-section="grade" hidden>
                  <div class="bonus-select-wrap">
                    <select id="bonus-achievement-grade" name="achievementGrade" aria-label="成績">
                      ${gradeOptions.map((item) => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)}</option>`).join("")}
                    </select>
                    ${studyPayIcon("chevron-down", "bonus-select-icon")}
                  </div>
                  <span>を</span>
                </div>
                <div class="bonus-sentence-line">
                  <input id="bonus-achievement-count" class="bonus-inline-number" name="achievementCount" inputmode="numeric" placeholder="10" aria-label="達成回数" />
                  <span>回</span>
                  <div class="bonus-select-wrap bonus-mode-select">
                    <select id="bonus-achievement-mode" name="achievementMode" aria-label="達成方法">
                      <option value="single">達成したら</option>
                      <option value="streak">連続達成したら</option>
                    </select>
                    ${studyPayIcon("chevron-down", "bonus-select-icon")}
                  </div>
                </div>
                <div class="bonus-sentence-line">
                  <input id="bonus-achievement-points" class="bonus-inline-number" name="achievementPoints" inputmode="numeric" placeholder="100" />
                  <span>ポイント</span>
                </div>
              </div>
              <div class="error" id="bonus-setting-error"></div>
              <button class="primary-button" type="submit">保存</button>
            </form>

            <div class="section-label">
              <span>設定中のボーナス</span>
            </div>
            <div class="monthly-bonus-setting-filter" role="tablist" aria-label="ボーナス種別">
              <button class="${state.monthlyBonusSettingFilter === "event" ? "active" : ""}" type="button" data-bonus-setting-filter="event">行事系</button>
              <button class="${state.monthlyBonusSettingFilter === "achievement" ? "active" : ""}" type="button" data-bonus-setting-filter="achievement">達成系</button>
            </div>
            <div class="monthly-bonus-setting-list">
              ${monthlyBonusSettingsList(selectedChild, bonusSettings)}
            </div>
          `
          : `<div class="card empty-state"><strong>こどもが見つかりません</strong><p>設定画面からこどもを選び直してください。</p><button class="primary-button compact-button" type="button" data-route="/parent/monthly-bonus">こどもを選ぶ</button></div>`
      }

      ${bottomNav("settings")}
    </section>
  `;
}

function monthlyBonusSettingsList(child, settings) {
  const filter = state.monthlyBonusSettingFilter || "event";
  const visibleSettings = settings.filter((setting) => !isHiddenDemoBonusSetting(child, setting));
  const filteredSettings = visibleSettings.filter((setting) => setting.type === filter);
  if (!settings.length) {
    return `<div class="empty-state monthly-bonus-setting-empty"><strong>ボーナス設定はまだありません</strong><p>ボーナスを設定しておくと誕生日・お年玉などの行事や「国語で90点以上を5回連続達成したら100pt」などの条件達成時に自動でポイントを付与することができます。</p></div>`;
  }

  if (!filteredSettings.length) {
    return `<div class="empty-state monthly-bonus-setting-empty"><strong>${filter === "event" ? "行事系" : "達成系"}のボーナス設定はまだありません</strong></div>`;
  }

  return filteredSettings.map((setting) => monthlyBonusSettingCard(child, setting)).join("");
}

function isHiddenDemoBonusSetting(child, setting) {
  return child?.id === "child-demo-mana" && setting.id === "bonus-setting-demo-new-year";
}

function monthlyBonusSettingCard(child, setting) {
  const title = formatBonusSettingTitle(setting);
  return `
    <div class="monthly-bonus-setting-row">
      <div>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <strong>${Number(setting.points || 0).toLocaleString()}<span>pt</span></strong>
      <button class="rule-other-icon-button is-danger" type="button" data-delete-bonus-setting="${escapeHtml(setting.id)}" data-bonus-setting-child-id="${escapeHtml(child.id)}" aria-label="${escapeHtml(title)}を削除">
        ${studyPayIcon("trash-2", "rule-other-icon")}
      </button>
    </div>
  `;
}

function formatBonusSettingTitle(setting) {
  if (setting.type === "event") {
    return [setting.condition, setting.name].filter(Boolean).join(" ") || "条件未設定";
  }

  const title = setting.condition || setting.name || "条件未設定";
  return title.replaceAll("のテストで", " ").replaceAll("テストで", "");
}

function bonusSettingTypeLabel(type) {
  return BONUS_SETTING_TYPES.find((item) => item.value === type)?.label || "その他";
}

function bonusChoiceButtons(name, options, selectedValue) {
  return `
    <div class="bonus-choice-group" role="group">
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selectedValue)}" data-bonus-choice-value="${escapeHtml(name)}" />
      ${options.map((option) => `
        <button class="bonus-choice-button ${option.value === selectedValue ? "active" : ""}" type="button" data-bonus-choice="${escapeHtml(name)}" data-bonus-choice-option="${escapeHtml(option.value)}">
          ${escapeHtml(option.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function bonusConditionTypeLabel(type) {
  if (type === "annual_date") {
    return "毎年指定日";
  }
  if (type === "achievement_score" || type === "achievement_rank" || type === "achievement_grade") {
    return "達成条件";
  }
  return "条件";
}

function getBonusGradeOptions(child) {
  const subject = getActiveSubjects(child || {})[0];
  const rule = getEffectivePointRule(child || {}, subject?.id || "", "grade_5");
  return normalizeGradeSettings("grade_5", rule.settings);
}

function getBonusAvailableSubjects(child) {
  const usedSubjectIds = new Set(
    getChildBonusSettings(child)
      .filter((setting) => setting.type === "achievement")
      .map((setting) => setting.conditionDetails?.subjectId)
      .filter(Boolean),
  );
  return getActiveSubjects(child || {}).filter((subject) => !usedSubjectIds.has(subject.id));
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
  const exchangeInfo = getRedemptionExchangeInfo(child, redemption);
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("交換申請内容", "/parent/redemptions", "申請一覧に戻る")}

      <div class="parent-redemption-detail-layout">
        <div class="parent-redemption-detail-child">
          ${childAvatar(child, "parent-redemption-detail-avatar")}
          <span>${escapeHtml(child.nickname)}</span>
        </div>

        <div class="card detail-card parent-redemption-detail-card">
          <div class="parent-redemption-detail-labels">
            <span>ポイント</span>
            <span>${escapeHtml(exchangeInfo.name)}</span>
          </div>
          <div class="parent-redemption-detail-values">
            <strong>${redemption.points.toLocaleString()}<small>pt</small></strong>
            <strong>${escapeHtml(formatExchangeResultLabel(exchangeInfo))}</strong>
          </div>
        </div>
      </div>

      ${
        editable
          ? `
            <div class="card detail-card">
              <button class="primary-button" type="button" id="complete-redemption">承認する</button>
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
            : `<div class="notice-card">この交換申請は処理済みです。</div>`
      }

      ${bottomNav("redemptions")}
    </section>
  `;
}

function parentReviewExtraFields(application, editable) {
  if (application.category === "test") {
    if (application.testMethod === "rank") {
      return `
        <div class="field">
          <label for="review-rank">順位</label>
          <input id="review-rank" name="rank" inputmode="numeric" value="${application.rank || ""}" ${editable ? "" : "readonly"} />
        </div>
      `;
    }

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

function childNewView() {
  const children = getChildren();
  const canAdd = children.length < MAX_CHILDREN;
  const generatedLoginId = generateLoginId();
  const generatedPassword = generatePassword();
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("こどもを追加", "/parent", "ホームに戻る")}
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
                <p class="issued-login-note">お子様用のログインIDとパスワードは自動発行されます。お子様用のログインIDとパスワードは保護者ホームのこどもカードからいつでも確認できます。</p>
              </div>
              <div class="hint-card parent-child-form-hint">
                追加すると、国語・算数・英語の初期科目と標準ポイントルールの準備データを作ります。
              </div>
              <div class="error" id="child-error"></div>
              <div class="parent-child-form-actions">
                <button class="primary-button" type="submit">こどもを追加する</button>
                <button class="secondary-button" type="button" data-route="/parent">キャンセル</button>
              </div>
            </form>
          `
          : `<div class="notice-card">こどもは最大${MAX_CHILDREN}人までです。</div>`
      }

      ${bottomNav("home")}
    </section>
  `;
}

function childProfilePhotoField(profilePhoto = null) {
  const photo = profilePhoto?.dataUrl;
  const photoStyle = profilePhotoImageStyle(profilePhoto);
  const preview = photo
    ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(profilePhoto?.name || "プロフィール写真")}" ${photoStyle} />`
    : studyPayIcon("circle-user-round", "profile-photo-placeholder-icon");

  return `
    <div class="profile-photo-field">
      <span class="profile-photo-label">プロフィール写真<span class="required-mark">必須</span></span>
      <div class="profile-photo-control">
        <div class="profile-photo-stack">
          <div class="profile-photo-preview" id="profile-photo-preview" aria-hidden="true">
            ${preview}
          </div>
          <button class="profile-photo-button" type="button" data-profile-photo-button aria-label="写真を追加">
            ${studyPayIcon("camera", "profile-photo-camera-icon")}
          </button>
          <input class="profile-photo-input" type="file" accept="image/*" data-profile-photo-input aria-hidden="true" tabindex="-1" />
        </div>
      </div>
    </div>
  `;
}

function childDetailView(child) {
  return `
    <section class="screen home-screen parent-child-detail-screen">
      ${parentPlainHeader("こども詳細", "/parent", "ホームに戻る")}

      <div class="card detail-card child-login-detail-card">
        <div class="child-login-detail-layout">
          <div class="child-login-detail-profile" data-child-detail-profile>
            ${childProfilePhotoField(child.profilePhoto)}
            <div class="child-detail-name-row">
              <h1>
                <button class="child-detail-name-text" type="button" id="edit-child-nickname-name" aria-label="ニックネームを変更">
                  ${escapeHtml(child.nickname)}
                </button>
              </h1>
              <button class="child-detail-name-edit-button" type="button" id="edit-child-nickname" aria-label="ニックネームを変更">
                ${studyPayIcon("square-pen", "child-detail-name-edit-icon")}
              </button>
            </div>
          </div>
          <div class="child-login-detail-credentials">
            <dl class="info-list child-login-info-list">
              <div>
                <dt>ログインID</dt>
                <dd>${escapeHtml(child.loginId)}</dd>
              </div>
              <div>
                <dt>パスワード</dt>
                <dd>${escapeHtml(child.demoPassword)}</dd>
              </div>
            </dl>
            <button class="secondary-button compact-button child-login-password-button" type="button" id="edit-child-password">パスワードを変更する</button>
          </div>
        </div>
      </div>

      ${parentChildBalanceCard(child)}

      <button class="secondary-button compact-button child-detail-rule-button" type="button" data-route="/parent/children/${child.id}/rules">ポイント基準を編集</button>

      <div class="child-delete-action-area">
        <button class="danger-button compact-button" type="button" id="delete-child-button">こどもアカウントを削除</button>
      </div>

      ${bottomNav("home")}
    </section>
  `;
}

function parentChildBalanceCard(child) {
  const availablePoints = getAvailablePoints(child);
  const displayedAvailablePoints = Math.min(999999, Math.max(0, Number(availablePoints) || 0));
  const isAvailablePointsCapped = Number(availablePoints || 0) >= 999999;
  const monthlyEarnedPoints = getMonthlyEarnedPoints(child);
  const pendingApprovalPoints = getChildApplications(child)
    .filter((application) => application.status === "pending")
    .reduce((total, application) => total + getApplicationPointValue(application), 0);
  const balanceBackground = getChildBalanceCardBackground(child);
  const balanceBackgroundStyle = balanceBackground
    ? ` style="--child-balance-bg-image: url('${escapeInlineStyleUrl(balanceBackground)}')"`
    : "";

  return `
    <section class="child-balance-card parent-child-balance-card ${balanceBackground ? "has-custom-bg" : ""}"${balanceBackgroundStyle}>
      <div class="child-balance-copy">
        <span>${escapeHtml(child.nickname || "こども")}のポイント</span>
        <strong><span class="child-balance-number ${isAvailablePointsCapped ? "is-capped" : ""}">${displayedAvailablePoints.toLocaleString()}</span><small>ポイント</small></strong>
      </div>
      <button class="child-exchange-button" type="button" data-route="/parent/children/${child.id}/points">履歴を見る</button>
      <div class="child-balance-metrics">
        <div>
          <span>今月の獲得</span>
          <strong>${monthlyEarnedPoints.toLocaleString()} <small>ポイント</small></strong>
        </div>
        <button class="child-balance-metric-button" type="button" data-route="/parent/applications">
          <span>承認待ち</span>
          <strong>${pendingApprovalPoints.toLocaleString()} <small>ポイント</small></strong>
        </button>
      </div>
    </section>
  `;
}

function getApplicationPointValue(application) {
  return Number(application.fixedPoints ?? application.suggestedPoints ?? application.requestedPoints ?? 0);
}

function getChildBalanceCardBackground(child) {
  if (child.balanceCardBackground) {
    return child.balanceCardBackground;
  }

  const key = `ince_child_balance_card_bg:${child.id || child.loginId || "default"}`;
  try {
    return window.localStorage?.getItem(key) || window.__studyPayBalanceCardBackgrounds?.[key] || "";
  } catch (error) {
    return window.__studyPayBalanceCardBackgrounds?.[key] || "";
  }
}

function escapeInlineStyleUrl(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

      ${bottomNav("home")}
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

      ${bottomNav("home")}
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
  const selectedMode = ["test", "grade", "other"].includes(child.ruleEditorMode) ? child.ruleEditorMode : "test";
  const selectedGradeType = "grade_5";
  const selectedTestMethod = ["score", "rank"].includes(child.ruleEditorTestMethod) ? child.ruleEditorTestMethod : "score";
  const flashMessage = state.flash;
  state.flash = "";
  return `
    <section class="screen home-screen">
      ${parentPlainHeader("ポイント基準", `/parent/children/${child.id}`, "こども詳細に戻る")}
      <div class="notice-card rule-notice">
        変更内容は今後の申請分にのみ適用となります。
      </div>
      ${parentRuleFilterRow(selectedMode)}

      ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}

      ${
        selectedMode === "other"
          ? parentRuleOtherPanel(child)
          : `
        <div class="card rule-card rule-subject-card">
          <div class="field">
            <span class="field-label">科目</span>
            <div class="rule-subject-picker">
              <button class="rule-subject-trigger" type="button" id="rule-subject-trigger" aria-haspopup="menu" aria-expanded="false">
                <span>${escapeHtml(selectedSubject?.name || "科目を選択")}</span>
                ${studyPayIcon("chevron-down", "rule-subject-trigger-icon")}
              </button>
              <div class="rule-subject-menu" id="rule-subject-menu" role="menu" hidden>
                ${subjects.map((subject) => `
                  <div class="rule-subject-option-row ${selectedSubject?.id === subject.id ? "active" : ""}">
                    <button class="rule-subject-option-name" type="button" role="menuitem" data-rule-subject-option="${subject.id}">
                      ${escapeHtml(subject.name)}
                    </button>
                    <div class="rule-subject-option-actions">
                      <button class="rule-subject-option-icon" type="button" data-rule-subject-edit="${subject.id}" aria-label="${escapeHtml(subject.name)}を編集">
                        ${studyPayIcon("square-pen", "rule-subject-action-icon")}
                      </button>
                      <button class="rule-subject-option-icon is-danger" type="button" data-rule-subject-delete="${subject.id}" aria-label="${escapeHtml(subject.name)}を削除">
                        ${studyPayIcon("trash-2", "rule-subject-action-icon")}
                      </button>
                    </div>
                  </div>
                `).join("")}
                <button class="rule-subject-add-option" type="button" role="menuitem" data-rule-subject-add>科目を追加</button>
              </div>
            </div>
          </div>
          ${
            selectedMode === "test"
              ? `
                <div class="field rule-test-method-field">
                  <span class="field-label">基準</span>
                  ${parentRuleTestMethodRow(selectedTestMethod)}
                </div>
              `
              : ""
          }
        </div>

        ${
          selectedSubject
            ? selectedMode === "grade"
              ? gradeRulesPanel(child, selectedSubject, selectedGradeType)
              : selectedTestMethod === "rank"
                ? rankRulesPanel(child, selectedSubject)
                : testRulesPanel(child, selectedSubject)
            : `<div class="card empty-state"><strong>科目がありません</strong><p>先に科目を追加してください。</p></div>`
        }
      `
      }

      ${bottomNav("home")}
    </section>
  `;
}

function parentRuleTestMethodRow(activeMethod) {
  return `
    <div class="rule-test-method-row" aria-label="テストの基準">
      ${parentRuleTestMethodButton("score", "点数基準", activeMethod)}
      ${parentRuleTestMethodButton("rank", "順位基準", activeMethod)}
    </div>
  `;
}

function parentRuleTestMethodButton(value, label, activeMethod) {
  const isActive = value === activeMethod;
  return `
    <button class="${isActive ? "active" : ""}" type="button" data-rule-test-method="${value}" aria-pressed="${isActive ? "true" : "false"}">
      ${label}
    </button>
  `;
}

function parentRuleFilterRow(activeFilter) {
  return `
    <div class="parent-rule-filter-row parent-application-filter-row" aria-label="ポイント基準種別">
      ${parentRuleFilterButton("test", "テスト", activeFilter)}
      ${parentRuleFilterButton("grade", "成績", activeFilter)}
      ${parentRuleFilterButton("other", "その他", activeFilter)}
    </div>
  `;
}

function parentRuleFilterButton(value, label, activeFilter) {
  const isActive = value === activeFilter;
  return `
    <button class="filter-${value} ${isActive ? "active" : ""}" type="button" data-rule-mode="${value}" aria-pressed="${isActive ? "true" : "false"}">
      ${label}
    </button>
  `;
}

function parentRuleOtherPanel(child) {
  const tasks = getOtherPointTasks(child);
  const categories = getOtherTaskCategories(child);
  const visibleTasks = sortOtherTasksByCategory(tasks, categories);
  const remainingTaskCount = Math.max(0, MAX_OTHER_POINT_TASKS - tasks.length);
  const canAddTask = remainingTaskCount > 0;
  const isAdding = Boolean(child.ruleOtherTaskFormOpen);
  const editingTask = tasks.find((task) => task.id === child.ruleOtherTaskEditingId) || null;
  return `
    <div class="rule-other-panel">
      <div class="rule-other-head">
        <span class="rule-other-remaining-count">あと${remainingTaskCount}個追加できます</span>
        <button class="rule-other-add-button" type="button" data-open-other-task-form ${canAddTask ? "" : "disabled"}>
          ${studyPayIcon("plus", "rule-add-row-icon")}
          追加
        </button>
      </div>

      <div class="rule-other-list">
        <div class="rule-other-list-head">
          <span>カテゴリー</span>
          <span>タスク名</span>
          <span>ポイント</span>
          <span></span>
        </div>
        ${
          tasks.length === 0
            ? `<div class="rule-other-empty">タスクを追加してください</div>`
            : visibleTasks.map((task) => otherPointTaskRow(task, categories)).join("")
        }
      </div>

      ${isAdding ? otherPointTaskForm(child, editingTask) : ""}
    </div>
  `;
}

function sortOtherTasksByCategory(tasks, categories) {
  const categoryOrder = new Map(categories.map((category, index) => [category.name, index]));
  return [...tasks].sort((a, b) => {
    const categoryA = categoryOrder.has(a.category) ? categoryOrder.get(a.category) : Number.MAX_SAFE_INTEGER;
    const categoryB = categoryOrder.has(b.category) ? categoryOrder.get(b.category) : Number.MAX_SAFE_INTEGER;
    if (categoryA !== categoryB) {
      return categoryA - categoryB;
    }
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
}

function otherTaskCategoryFilter(categories, activeFilter) {
  const activeCategory = activeFilter === "all"
    ? { name: "すべて", backgroundColor: "#f3eee9", textColor: "#5c3b22" }
    : categories.find((item) => item.name === activeFilter) || getDefaultOtherTaskCategory(activeFilter);
  return `
    <div class="rule-subject-picker rule-other-filter-picker">
      <button class="rule-subject-trigger rule-other-filter-trigger" type="button" id="rule-other-filter-trigger" aria-haspopup="menu" aria-expanded="false">
        ${activeFilter === "all" ? `<span class="rule-other-filter-all">すべて</span>` : otherTaskCategoryTag(activeCategory)}
        ${studyPayIcon("chevron-down", "rule-subject-trigger-icon")}
      </button>
      <div class="rule-subject-menu rule-other-filter-menu" id="rule-other-filter-menu" role="menu" hidden>
        <button class="rule-other-filter-option ${activeFilter === "all" ? "active" : ""}" type="button" role="menuitem" data-rule-other-category-filter="all">
          <span class="rule-other-filter-all">すべて</span>
        </button>
        ${categories.map((item) => `
          <button class="rule-other-filter-option ${item.name === activeFilter ? "active" : ""}" type="button" role="menuitem" data-rule-other-category-filter="${escapeHtml(item.name)}">
            ${otherTaskCategoryTag(item)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function otherPointTaskRow(task, categories = []) {
  const category = task.category || "その他";
  const categorySetting = categories.find((item) => item.name === category) || getDefaultOtherTaskCategory(category);
  return `
    <div class="rule-other-row">
      <span class="rule-other-category-tag" style="background:${escapeHtml(categorySetting.backgroundColor)};color:${escapeHtml(categorySetting.textColor)};">${escapeHtml(category)}</span>
      <span class="rule-other-task-name">${escapeHtml(task.name)}</span>
      <span class="rule-other-task-points">${Number(task.points || 0).toLocaleString()}<small>pt</small></span>
      <span class="rule-other-actions">
        <button class="rule-other-icon-button" type="button" data-edit-other-task="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を編集">
          ${studyPayIcon("square-pen", "rule-subject-action-icon")}
        </button>
        <button class="rule-other-icon-button is-danger" type="button" data-delete-other-task="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.name)}を削除">
          ${studyPayIcon("trash-2", "rule-subject-action-icon")}
        </button>
      </span>
    </div>
  `;
}

function otherPointTaskForm(child, task = null) {
  const isEditing = Boolean(task);
  const category = task?.category || "その他";
  const categories = getOtherTaskCategories(child);
  const selectedCategory = categories.find((item) => item.name === category) || getDefaultOtherTaskCategory(category);
  return `
    <div class="parent-switch-modal rule-other-task-modal" id="other-task-modal">
      <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="other-task-modal-title">
        <form class="rule-other-form" id="other-task-form" novalidate>
          <div class="test-rule-card-heading rule-other-form-heading">
            <span class="rule-heading-spacer"></span>
            <strong class="test-rule-card-title" id="other-task-modal-title">${isEditing ? "タスク編集" : "タスク追加"}</strong>
            <span class="rule-heading-spacer"></span>
          </div>
          <input type="hidden" name="taskId" value="${escapeHtml(task?.id || "")}" />
          <div class="rule-edit-grid">
            <div class="rule-edit-field">
              <div class="rule-edit-label-row">
                <label for="other-task-category">カテゴリー</label>
              </div>
              <input type="hidden" id="other-task-category" name="category" value="${escapeHtml(selectedCategory.name)}" />
              <div class="rule-subject-picker rule-other-category-picker">
                <button class="rule-subject-trigger rule-other-category-trigger" type="button" id="other-task-category-trigger" aria-haspopup="menu" aria-expanded="false">
                  ${otherTaskCategoryTag(selectedCategory)}
                  ${studyPayIcon("chevron-down", "rule-subject-trigger-icon")}
                </button>
                <div class="rule-subject-menu rule-other-category-menu" id="other-task-category-menu" role="menu" hidden>
                  ${categories.map((item) => `
                    <button class="rule-other-category-option ${item.name === selectedCategory.name ? "active" : ""}" type="button" role="menuitem" data-other-task-category="${escapeHtml(item.name)}">
                      ${otherTaskCategoryTag(item)}
                    </button>
                  `).join("")}
                </div>
              </div>
            </div>
            <label class="rule-edit-field" for="other-task-name">
              タスク名
              <input id="other-task-name" name="taskName" type="text" placeholder="例: お風呂そうじ" autocomplete="off" value="${escapeHtml(task?.name || "")}" />
            </label>
            <label class="rule-edit-field" for="other-task-points">
              ポイント
              <input id="other-task-points" name="points" inputmode="numeric" placeholder="例: 100" value="${escapeHtml(String(task?.points || ""))}" />
            </label>
          </div>
          <p class="error" id="other-task-error"></p>
          <div class="rule-other-form-actions">
            <button class="secondary-button compact-button" type="button" data-close-other-task-form>キャンセル</button>
            <button class="primary-button compact-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function otherTaskCategoryTag(category) {
  return `
    <span class="rule-other-category-tag rule-other-category-select-tag" style="background:${escapeHtml(category.backgroundColor)};color:${escapeHtml(category.textColor || "#ffffff")};">
      ${escapeHtml(category.name)}
    </span>
  `;
}

function childPointExchangeUnitCard(child) {
  const exchangeItems = getChildExchangeItemSettings(child);
  return `
    <div class="card detail-card child-point-exchange-unit-card" data-exchange-unit-child-id="${escapeHtml(child.id)}">
      <div class="exchange-unit-control-row">
        <button class="primary-button compact-button exchange-reward-add-button" type="button" data-add-exchange-item>ごほうび追加</button>
      </div>
      <div class="exchange-items-field">
        <div class="exchange-items-table" role="table" aria-label="${escapeHtml(child.nickname)}のポイント交換設定">
          <div class="exchange-items-header" role="row">
            <span>交換するもの</span>
            <span>pt交換単位</span>
            <span>金額／数量／時間</span>
            <span>単位</span>
            <span aria-label="操作"></span>
          </div>
          ${exchangeItems.map((item, index) => exchangeItemSettingRow(child, item, index)).join("")}
        </div>
      </div>
      <p class="error exchange-unit-error" aria-live="polite"></p>
    </div>
  `;
}

function getChildExchangeItems(child) {
  return getChildExchangeItemSettings(child).map(formatExchangeItemLabel);
}

function getChildExchangeItemSettings(child) {
  const unit = Number(child?.redemptionUnit || 100);
  const sourceItems = Array.isArray(child?.exchangeItems) ? child.exchangeItems : [];
  const items = sourceItems.map((item, index) => normalizeExchangeItemSetting(item, index, unit)).filter(Boolean);
  return items.length ? items : DEFAULT_EXCHANGE_ITEM_SETTINGS.map((item) => ({ ...item }));
}

function normalizeExchangeItemSetting(item, index, unit) {
  if (item && typeof item === "object") {
    const name = String(item.name || item.label || "").trim();
    if (!name) {
      return null;
    }
    return {
      id: String(item.id || `exchange-item-${index + 1}`),
      name,
      points: normalizePositiveNumber(item.points, unit),
      exchangeValue: normalizePositiveNumber(item.exchangeValue, item.value ?? unit),
      unit: String(item.unit || "円").trim() || "円",
    };
  }

  const label = String(item || "").trim();
  if (!label) {
    return null;
  }

  if (label.includes("ゲーム")) {
    return { id: `exchange-item-${index + 1}`, name: "ゲーム", points: unit, exchangeValue: 30, unit: "分" };
  }

  if (label.includes("スマホ")) {
    return { id: `exchange-item-${index + 1}`, name: "スマホ", points: unit, exchangeValue: 30, unit: "分" };
  }

  return { id: `exchange-item-${index + 1}`, name: label, points: unit, exchangeValue: unit, unit: "円" };
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : Number(fallback || 1);
}

function formatExchangeItemLabel(item) {
  if (!item || typeof item !== "object") {
    return String(item || "").trim();
  }

  if (String(item.unit || "") === "分") {
    return `${item.name}${toFullWidthNumber(item.exchangeValue)}分`;
  }

  return String(item.name || "").trim();
}

function formatExchangeItemDetail(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  return `${Number(item.points).toLocaleString()}ポイント　→　${Number(item.exchangeValue).toLocaleString()} ${item.unit}`;
}

function calculateExchangeValueForPoints(item, points) {
  const pointUnit = Number(item?.points || 0);
  const exchangeValue = Number(item?.exchangeValue || 0);
  const requestPoints = Number(points || 0);
  if (!pointUnit || !exchangeValue || !requestPoints) {
    return exchangeValue || requestPoints;
  }

  return (requestPoints / pointUnit) * exchangeValue;
}

function getRedemptionExchangeInfo(child, redemption) {
  const items = getChildExchangeItemSettings(child);
  const savedName = String(redemption?.itemName || "").trim();
  const savedInfo = {
    name: savedName,
    points: Number(redemption?.points || 0),
    exchangeValue: Number(redemption?.exchangeValue || 0),
    unit: String(redemption?.exchangeUnit || "").trim(),
  };
  const matchedItem = items.find((item) =>
    item.name === savedName || formatExchangeItemLabel(item) === savedName
  );
  const base = matchedItem || null;
  return {
    name: savedInfo.name || base?.name || "交換",
    points: savedInfo.points || Number(base?.points || 0),
    exchangeValue: savedInfo.exchangeValue || calculateExchangeValueForPoints(base, savedInfo.points),
    unit: savedInfo.unit || base?.unit || "円",
  };
}

function formatExchangeResultLabel(info) {
  if (!info) {
    return "";
  }

  return `${Number(info.exchangeValue || 0).toLocaleString()} ${info.unit || ""}`.trim();
}

function formatExchangeHistoryTitle(info) {
  const name = String(info?.name || "").trim();
  return name && name !== "交換" ? `${name}交換申請` : "交換申請";
}

function toFullWidthNumber(value) {
  return String(value).replace(/[0-9]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
}

function exchangeItemSettingRow(child, item, index) {
  const label = formatExchangeItemLabel(item) || "交換するもの";
  return `
    <div class="exchange-items-row" role="row" data-exchange-item-row="${index}">
      <span class="exchange-item-cell-text">${escapeHtml(item.name)}</span>
      <span class="exchange-item-cell-text">${Number(item.points).toLocaleString()}</span>
      <span class="exchange-item-cell-text">${Number(item.exchangeValue).toLocaleString()}</span>
      <span class="exchange-item-cell-text">${escapeHtml(item.unit)}</span>
      <span class="exchange-item-actions">
        <button class="rule-other-icon-button" type="button" data-edit-exchange-item="${index}" aria-label="${escapeHtml(label)}を編集">
          ${studyPayIcon("square-pen", "rule-subject-action-icon")}
        </button>
      </span>
    </div>
  `;
}

function testRulesPanel(child, subject) {
  return `
    <div class="rule-list">
      ${testRuleEditor(child, subject, "test_100", "100点満点用", 100)}
      ${testRuleEditor(child, subject, "test_50", "50点満点用", 50)}
    </div>
  `;
}

function rankRulesPanel(child, subject) {
  const rule = normalizeRankRule(getEffectivePointRule(child, subject.id, "test_rank"));
  return `
    <div class="rule-list">
      <div class="rule-card-block">
        <form class="card rule-card point-rule-form rank-rule-form" data-subject-id="${subject.id}" data-rule-type="test_rank" data-rule-category="rank">
          <div class="test-rule-card-heading rank-rule-card-heading">
            <span class="rule-heading-spacer" aria-hidden="true"></span>
            <span class="summary-kicker test-rule-card-title">順位基準</span>
            <button class="rule-reset-button" type="button" data-reset-test-rule>デフォルトに戻す</button>
          </div>
          <div class="rule-table-editor rank-rule-table">
            <div class="rule-table-head"><span>順位</span><span>条件</span><span>ポイント</span><span></span></div>
            ${rule.settings.map((item, index) => `
              ${rankRuleRow(item, index, rule.settings.length)}
            `).join("")}
          </div>
          <button class="rule-add-row-button" type="button" data-add-rank-rule-row>
            ${studyPayIcon("plus", "rule-add-row-icon")}
            <span>条件を追加</span>
          </button>
          <button class="primary-button compact-button rule-save-button" type="submit">保存</button>
          <button class="secondary-button compact-button rule-apply-subjects-button" type="button" data-apply-rule-to-subjects>他の科目にも適用する</button>
        </form>
      </div>
    </div>
  `;
}

function rankRuleRow(item, index, rowCount) {
  const rank = getRuleRank(item.condition);
  const isFirst = index === 0;
  const isLast = index === rowCount - 1;
  const operator = isFirst ? "ー" : isLast ? "未満" : "以内";
  const rankId = `rank-${index}`;
  const rankCell =
    isFirst || isLast
      ? `<span class="fixed-rule-value rank-rule-rank"><span>${rank}</span><span class="fixed-rule-unit">位</span></span><input type="hidden" name="${rankId}" value="${rank}" />`
      : `
        <div class="rule-input-cell">
          <div class="rule-input-unit-row">
            <input type="number" name="${rankId}" inputmode="numeric" step="1" value="${rank}" />
            <span class="rule-input-unit">位</span>
          </div>
          <span class="rule-input-error" data-rule-input-error></span>
        </div>
      `;

  return `
    <div class="rule-table-row">
      ${rankCell}
      <span class="fixed-rule-value rank-rule-condition">${operator}</span><input type="hidden" name="operator-${index}" value="${operator}" />
      <div class="rule-input-cell">
        <div class="rule-input-unit-row">
          <input type="number" name="points-${index}" inputmode="numeric" step="1" value="${Number(item.points || 0)}" />
          <span class="rule-input-unit">pt</span>
        </div>
        <span class="rule-input-error" data-rule-input-error></span>
      </div>
      ${
        isFirst || isLast
          ? `<span class="rule-row-action-spacer" aria-hidden="true"></span>`
          : `
            <button class="rule-row-delete-button" type="button" data-delete-rank-rule-row aria-label="${rank}位以内の条件を削除">
              ${studyPayIcon("trash-2", "rule-row-delete-icon")}
            </button>
          `
      }
    </div>
  `;
}

function testRuleEditor(child, subject, ruleType, title, fullScore) {
  const rule = normalizeTestRule(getEffectivePointRule(child, subject.id, ruleType), fullScore);
  const isToggleable = ruleType === "test_50";
  const isEnabled = rule.enabled !== false;
  const toggleLabel = isEnabled ? "無効にする" : "有効にする";
  return `
    <div class="rule-card-block">
      <form class="card rule-card point-rule-form ${isToggleable && !isEnabled ? "is-rule-disabled" : ""}" data-subject-id="${subject.id}" data-rule-type="${ruleType}" data-rule-category="test" data-full-score="${fullScore}" data-rule-enabled="${isEnabled ? "true" : "false"}">
        <div class="test-rule-card-heading">
          ${
            isToggleable
              ? `<button class="rule-enabled-toggle ${isEnabled ? "active" : ""}" type="button" data-toggle-test-rule-enabled aria-pressed="${isEnabled ? "true" : "false"}">${toggleLabel}</button>`
              : `<span class="rule-heading-spacer" aria-hidden="true"></span>`
          }
          <span class="summary-kicker test-rule-card-title">${title}</span>
          <button class="rule-reset-button" type="button" data-reset-test-rule>デフォルトに戻す</button>
        </div>
        <div class="rule-table-editor test-rule-table">
          <div class="rule-table-head"><span>点数</span><span>条件</span><span>ポイント</span><span></span></div>
          ${rule.settings.map((item, index) => `
            ${testRuleRow(item, index, rule.settings.length, fullScore)}
          `).join("")}
        </div>
        <button class="rule-add-row-button" type="button" data-add-test-rule-row>
          ${studyPayIcon("plus", "rule-add-row-icon")}
          <span>条件を追加</span>
        </button>
        <button class="primary-button compact-button rule-save-button" type="submit">保存</button>
        <button class="secondary-button compact-button rule-apply-subjects-button" type="button" data-apply-rule-to-subjects>他の科目にも適用する</button>
      </form>
    </div>
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
          ? `<span class="fixed-rule-value fixed-rule-score-value"><span>${score}</span><small>点</small></span><input type="hidden" name="score-${index}" value="${score}" />`
          : `<div class="rule-input-cell">
              <div class="rule-input-unit-row">
                <input type="number" name="score-${index}" inputmode="numeric" step="1" value="${score}" />
                <span class="rule-input-unit">点</span>
              </div>
              <span class="rule-input-error" data-rule-input-error></span>
            </div>`
      }
      ${
        isFirst
          ? `<span class="fixed-rule-value">満点</span><input type="hidden" name="operator-${index}" value="満点" />`
          : isLast
            ? `<span class="fixed-rule-value">未満</span><input type="hidden" name="operator-${index}" value="未満" />`
            : `<span class="fixed-rule-value">以上</span><input type="hidden" name="operator-${index}" value="以上" />`
      }
      <div class="rule-input-cell">
        <div class="rule-input-unit-row">
          <input type="number" name="points-${index}" inputmode="numeric" step="1" value="${Number(item.points || 0)}" />
          <span class="rule-input-unit">pt</span>
        </div>
        <span class="rule-input-error" data-rule-input-error></span>
      </div>
      ${
        isFirst || isLast
          ? `<span class="rule-row-action-spacer" aria-hidden="true"></span>`
          : `<button class="rule-row-delete-button" type="button" data-delete-test-rule-row aria-label="${score}点以上の欄を削除">
              ${studyPayIcon("trash-2", "rule-row-delete-icon")}
            </button>`
      }
    </div>
  `;
}

function gradeRulesPanel(child, subject, selectedGradeType) {
  const rule = getEffectivePointRule(child, subject.id, selectedGradeType);
  const settings = normalizeGradeSettings(selectedGradeType, rule.settings);
  return `
    <div class="rule-card-block">
      <span class="rule-table-label">基準</span>
      <div class="card rule-card">
        <form class="point-rule-form" data-subject-id="${subject.id}" data-rule-type="${selectedGradeType}" data-rule-category="grade">
          <div class="rule-table-editor grade-rule-table">
            <div class="rule-table-head"><span>評価</span><span>ポイント</span></div>
            ${settings.map((item, index) => `
              ${gradeRuleRow(item, index, index > 0)}
            `).join("")}
          </div>
          <button class="rule-add-row-button" type="button" data-add-grade-rule-row>
            ${studyPayIcon("plus", "rule-add-row-icon")}
            <span>条件を追加</span>
          </button>
          <button class="primary-button compact-button rule-save-button" type="submit">保存</button>
          <button class="secondary-button compact-button rule-apply-subjects-button" type="button" data-apply-rule-to-subjects>他の科目にも適用する</button>
        </form>
      </div>
    </div>
  `;
}

function gradeRuleRow(item, index, canDelete) {
  const label = item.label || item.condition || "";
  return `
    <div class="rule-table-row">
      <input type="hidden" name="id-${index}" value="${escapeHtml(item.id || `evaluation-${index + 1}`)}" />
      <div class="rule-input-cell">
        <input name="label-${index}" value="${escapeHtml(label)}" autocomplete="off" />
        <span class="rule-input-error" data-rule-input-error></span>
      </div>
      <div class="rule-input-cell">
        <input name="points-${index}" inputmode="numeric" value="${Number(item.points || 0)}" />
        <span class="rule-input-error" data-rule-input-error></span>
      </div>
      ${
        canDelete
          ? `<button class="rule-row-delete-button" type="button" data-delete-grade-rule-row aria-label="${escapeHtml(label || "追加した条件")}を削除">
              ${studyPayIcon("trash-2", "rule-row-delete-icon")}
            </button>`
          : ""
      }
    </div>
  `;
}

function notFoundView() {
  return `
    <section class="screen home-screen">
      ${parentHeader("こども")}
      <div class="card empty-state">
        <strong>こども情報が見つかりません</strong>
        <button class="primary-button" type="button" data-route="/parent">ホームに戻る</button>
      </div>
      ${bottomNav("home")}
    </section>
  `;
}

function parentSettingsHeader(title) {
  return parentPlainHeader(title, "/parent/settings", "設定に戻る");
}

function parentSettingsRootHeader(title) {
  return `
    <div class="topbar parent-settings-topbar">
      <h1>${escapeHtml(title)}</h1>
    </div>
  `;
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
          <button class="child-exchange-button" type="button" data-route="/child/exchange">申請する</button>
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
          <strong>お知らせ</strong>
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
    <section class="screen home-screen child-theme notification-screen">
      ${childHeader("お知らせ")}
      <div class="page-heading">
        <div>
          <h1>お知らせ</h1>
          <p>未読 ${getUnreadNotifications(child).length} 件</p>
        </div>
      </div>

      ${notificationList(child.notifications || [], { owner: "child", childId: child.id })}

      ${child.notifications?.length ? `<button class="secondary-button" type="button" id="read-child-notifications">すべて既読にする</button>` : ""}

      ${childBottomNav("home")}
    </section>
  `;
}

function childRedeemView(child) {
  const flashMessage = state.flash;
  state.flash = "";
  const availablePoints = getAvailablePoints(child);
  const exchangeItems = getChildExchangeItemSettings(child);
  const firstExchangeItem = exchangeItems[0] || null;
  const canExchange = exchangeItems.some((item) => availablePoints >= Number(item.points || 0));
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("ポイント交換")}
      <div class="page-heading">
        <div>
          <h1>ポイント交換</h1>
        </div>
      </div>
      <form class="card form form-card" id="redemption-form">
        ${flashMessage ? `<div class="success">${escapeHtml(flashMessage)}</div>` : ""}
        <div class="child-exchange-balance">
          <span>現在のポイント残高</span>
          <strong>${availablePoints.toLocaleString()}<span>ポイント</span></strong>
        </div>
        <div class="field child-exchange-item-field">
          <label for="redemption-item">交換するもの</label>
          <select id="redemption-item" name="itemName" ${canExchange ? "" : "disabled"}>
            ${exchangeItems.map((item, index) => {
              const label = String(item.name || "").trim();
              return `<option value="${escapeHtml(label)}" data-exchange-item-index="${index}">${escapeHtml(label)}</option>`;
            }).join("")}
          </select>
          <span class="child-exchange-item-detail" id="exchange-item-detail">${escapeHtml(formatExchangeItemDetail(firstExchangeItem))}</span>
        </div>
        <div class="field child-exchange-points-field">
          <label for="redemption-points">交換ポイント</label>
          <span class="child-exchange-points-input-wrap">
            <input id="redemption-points" name="points" inputmode="numeric" autocomplete="off" ${canExchange ? "" : "disabled"} />
            <span>ポイント</span>
          </span>
        </div>
        <div class="error" id="redemption-error"></div>
        ${
          canExchange
            ? `<button class="primary-button" type="submit">申請する</button>`
            : `<div class="notice-card">交換できるポイントがまだ足りません。</div>`
        }
      </form>

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
  const otherTasks = sortOtherTasksByCategory(getOtherPointTasks(child), getOtherTaskCategories(child));
  const isReapply = Boolean(editingApplication?.isReapply);
  const isEditing = Boolean(editingApplication?.id && !isReapply);
  const selectedCategory = editingApplication?.category || "test";
  const selectedSubjectId = editingApplication?.subjectId || "";
  const selectedSubjectName = editingApplication?.subjectName || "";
  const initialSubjectId = selectedSubjectId || subjects[0]?.id || "";
  const showFullScoreSelect =
    Number(editingApplication?.testFullScore) === 50 || isPointRuleEnabled(child, initialSubjectId, "test_50");
  const selectedFullScore = showFullScoreSelect ? String(editingApplication?.testFullScore || 100) : "100";
  const selectedTestMethod = editingApplication?.testMethod === "rank" || editingApplication?.rank ? "rank" : "score";
  return `
    <section class="screen home-screen child-theme">
      ${childHeader("申請")}
      <div class="page-heading child-page-heading">
        <div>
          <h1>${isEditing ? "申請を修正" : isReapply ? "再申請" : "ポイント申請"}</h1>
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
          <div class="field rule-test-method-field">
            <span class="field-label">基準</span>
            <input type="hidden" id="test-method" name="testMethod" value="${selectedTestMethod}" />
            <div class="rule-test-method-row child-apply-test-method-row" aria-label="テストの基準">
              <button class="${selectedTestMethod === "score" ? "active" : ""}" type="button" data-child-test-method="score" aria-pressed="${selectedTestMethod === "score" ? "true" : "false"}">点数基準</button>
              <button class="${selectedTestMethod === "rank" ? "active" : ""}" type="button" data-child-test-method="rank" aria-pressed="${selectedTestMethod === "rank" ? "true" : "false"}">順位基準</button>
            </div>
          </div>
          <div class="field ${showFullScoreSelect ? "" : "hidden"}" id="test-full-score-field">
            <label for="test-full-score">満点種別</label>
            <select id="test-full-score" name="testFullScore" ${showFullScoreSelect ? "" : "disabled"}>
              <option value="100" ${selectedAttr(selectedFullScore, "100")}>100点満点</option>
              <option value="50" ${selectedAttr(selectedFullScore, "50")}>50点満点</option>
            </select>
          </div>
          <div class="field" id="test-score-field">
            <label for="test-score">点数</label>
            <input id="test-score" name="score" inputmode="numeric" placeholder="例: 92" value="${editingApplication?.score || ""}" />
            <span class="field-error" id="test-score-error"></span>
          </div>
          <div class="field hidden" id="test-rank-field">
            <label for="test-rank">順位</label>
            <input id="test-rank" name="rank" inputmode="numeric" placeholder="例: 10" value="${editingApplication?.rank || ""}" />
            <span class="field-error" id="test-rank-error"></span>
          </div>
        </div>

        <div class="apply-section hidden" data-apply-section="grade">
          <div class="field" id="grade-evaluation-field">
            ${gradeEvaluationSelect(child, selectedSubjectId, editingApplication)}
          </div>
        </div>

        <div class="apply-section hidden" data-apply-section="other">
          <div class="field">
            <label for="other-task-id">タスク</label>
            <select id="other-task-id" name="otherTaskId" ${otherTasks.length ? "" : "disabled"}>
              ${
                otherTasks.length
                  ? otherTasks.map((task) => `
                    <option value="${escapeHtml(task.id)}" ${selectedAttr(editingApplication?.otherTaskId, task.id)}>
                      ${escapeHtml(task.name)}（${Number(task.points || 0).toLocaleString()}pt）
                    </option>
                  `).join("")
                  : `<option value="">設定済みのタスクがありません</option>`
              }
            </select>
            <span class="field-help">${otherTasks.length ? "保護者が設定したタスクから選びます。" : "保護者にタスクを追加してもらってください。"}</span>
          </div>
        </div>

        <div class="field" id="application-photo-field">
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

function gradeEvaluationSelect(child, subjectId, editingApplication = null) {
  const subject = getActiveSubjects(child).find((item) => item.id === subjectId) || getActiveSubjects(child)[0];
  const rule = getEffectivePointRule(child, subject?.id || "", "grade_5");
  const settings = normalizeGradeSettings("grade_5", rule.settings);
  return `
    <label for="grade-evaluation-id">評価</label>
    <select id="grade-evaluation-id" name="gradeEvaluationId">
      ${settings.map((item, index) => `
        <option value="${escapeHtml(item.id)}" ${selectedAttr(editingApplication?.gradeEvaluationId || getEvaluationIdByLabel(settings, editingApplication?.gradeValue), item.id)}>
          ${escapeHtml(item.label)}
        </option>
      `).join("")}
    </select>
    <span class="field-help">この中にない場合は保護者に追加してもらってください</span>
  `;
}

function childHistoryView(child) {
  const applications = getChildApplications(child);
  const redemptions = getChildRedemptions(child);
  const activeType = state.childHistoryType || "points";
  const isAllowance = activeType === "allowance";
  const items = isAllowance ? redemptions : applications;
  const pendingCount = isAllowance
    ? redemptions.filter((redemption) => redemption.status === "pending").length
    : applications.filter((application) => application.status === "pending").length;
  const redoCount = isAllowance
    ? 0
    : applications.filter((application) => ["returned", "rejected", "canceled"].includes(application.status)).length;
  const preferredFilter = getDefaultPendingAwareFilter({
    currentFilter: state.childHistoryFilter,
    pendingCount: pendingCount + redoCount,
    touched: state.childHistoryFilterTouched,
    fallbackFilter: isAllowance ? "pending" : "approved",
  });
  const activeFilter = normalizeChildHistoryFilter(preferredFilter, activeType);
  state.childHistoryFilter = activeFilter;
  const filteredItems = isAllowance ? filterChildHistoryRedemptions(redemptions, activeFilter) : filterChildHistoryApplications(applications, activeFilter);
  return `
    <section class="screen home-screen child-theme">
      <div class="topbar child-topbar child-history-topbar">
        <h1>履歴</h1>
      </div>
      ${childHistoryTypeTabs(child, activeType)}
      ${childHistoryFilterRow(activeFilter, activeType, { pendingCount, redoCount })}
      <div class="application-list">
        ${
          items.length === 0
            ? `<p class="child-history-empty-text">履歴なし</p>`
            : filteredItems.length === 0
              ? `<p class="child-history-empty-text">履歴なし</p>`
              : renderDateGroupedCards(
                  filteredItems,
                  (item) => (isAllowance ? item.requestedAt : item.submittedAt),
                  (item) => (isAllowance ? childHistoryRedemptionCard(child, item) : applicationCard(item)),
                )
        }
      </div>

      ${childBottomNav("history")}
    </section>
  `;
}

function childHistoryTypeTabs(child, activeType) {
  const pendingApplicationCount = getChildApplications(child).filter((application) => application.status === "pending").length;
  const redoApplicationCount = getChildApplications(child).filter((application) => ["returned", "rejected", "canceled"].includes(application.status)).length;
  const pendingRedemptionCount = getChildRedemptions(child).filter((redemption) => redemption.status === "pending").length;
  return `
    <div class="child-history-type-tabs" role="tablist" aria-label="履歴の種類">
      ${childHistoryTypeTab("points", "ポイント", activeType, pendingApplicationCount + redoApplicationCount)}
      ${childHistoryTypeTab("allowance", "交換", activeType, pendingRedemptionCount)}
    </div>
  `;
}

function childHistoryTypeTab(value, label, activeType, pendingCount) {
  const isActive = value === activeType;
  return `
    <button class="${isActive ? "active" : ""}" type="button" role="tab" aria-selected="${isActive ? "true" : "false"}" data-child-history-type="${value}" data-pending-count="${pendingCount}">
      ${label}
      ${pendingCount > 0 ? `<span class="child-history-type-badge">${pendingCount > 99 ? "99+" : pendingCount}</span>` : ""}
    </button>
  `;
}

function childHistoryFilterRow(activeFilter, activeType = "points", counts = {}) {
  const isAllowance = activeType === "allowance";
  return `
    <div class="child-filter-row ${isAllowance ? "is-allowance" : "is-points"}" aria-label="申請状態">
      ${
        isAllowance
          ? `
            ${childHistoryFilterButton("completed", "受け取り済み", activeFilter)}
            ${childHistoryFilterButton("pending", "確認待ち", activeFilter, Number(counts.pendingCount || 0) > 0)}
          `
          : `
            ${childHistoryFilterButton("approved", "承認済み", activeFilter)}
            ${childHistoryFilterButton("pending", "確認待ち", activeFilter, Number(counts.pendingCount || 0) > 0)}
            ${childHistoryFilterButton("redo", "やり直し", activeFilter, Number(counts.redoCount || 0) > 0)}
          `
      }
    </div>
  `;
}

function childHistoryFilterButton(value, label, activeFilter, hasDot = false) {
  const isActive = value === activeFilter;
  return `
    <button class="filter-${value} ${isActive ? "active" : ""}" type="button" data-child-history-filter="${value}" aria-pressed="${isActive ? "true" : "false"}">
      ${label}
      ${hasDot ? `<span class="filter-notification-dot" aria-hidden="true"></span>` : ""}
    </button>
  `;
}

function getDefaultPendingAwareFilter({ currentFilter, pendingCount, touched, fallbackFilter = "all" }) {
  if (!touched && pendingCount > 0 && (!currentFilter || currentFilter === "all")) {
    return "pending";
  }

  if (!touched && pendingCount === 0 && currentFilter === "pending") {
    return fallbackFilter;
  }

  return currentFilter || fallbackFilter;
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

function filterChildHistoryRedemptions(redemptions, filter) {
  if (filter === "pending") {
    return redemptions.filter((redemption) => redemption.status === "pending");
  }

  if (filter === "completed") {
    return redemptions.filter((redemption) => redemption.status === "completed");
  }

  if (filter === "rejected") {
    return redemptions.filter((redemption) => redemption.status === "rejected");
  }

  return redemptions;
}

function normalizeChildHistoryFilter(filter, activeType) {
  const allowedFilters = activeType === "allowance"
    ? ["completed", "pending"]
    : ["approved", "pending", "redo"];
  return allowedFilters.includes(filter) ? filter : allowedFilters[0];
}

function applicationCard(application) {
  const canEdit = !isApprovedApplicationStatus(application.status);
  return `
    <div class="card application-card child-history-card">
      <div class="application-card-header child-history-application-header">
        <div class="application-card-title child-history-main">
          <h2>${applicationHistoryTitle(application)}</h2>
          <div class="application-card-score-line">
            ${parentApplicationCardSummary(application)}
          </div>
        </div>
        <strong class="application-card-points ${application.status}">${childHistoryPointLabel(application)}</strong>
        ${
          canEdit
            ? `<button class="child-history-edit-button application-card-chevron" type="button" data-route="/child/apply/${application.id}" aria-label="申請を編集">${studyPayIcon("square-pen", "child-history-edit-icon")}</button>`
            : studyPayIcon("chevron-right", "application-card-chevron")
        }
      </div>
      ${application.parentComment ? `<p class="child-parent-comment ${isRedoApplicationStatus(application.status) ? "is-redo" : ""}">${escapeHtml(application.parentComment)}</p>` : ""}
    </div>
  `;
}

function childHistoryRedemptionCard(child, redemption) {
  const exchangeInfo = getRedemptionExchangeInfo(child, redemption);
  return `
    <div class="card application-card child-history-card">
      <div class="application-card-header child-history-application-header child-history-redemption-content">
        <div class="application-card-title child-history-main">
          <span class="redemption-exchange-item-name">${escapeHtml(exchangeInfo.name)}</span>
          <div class="redemption-flow-line">
            <strong>${redemption.points.toLocaleString()}<small>pt</small></strong>
            ${studyPayIcon("move-right", "redemption-flow-icon")}
            <strong>${Number(exchangeInfo.exchangeValue || 0).toLocaleString()}<small>${escapeHtml(exchangeInfo.unit)}</small></strong>
          </div>
        </div>
        ${studyPayIcon("chevron-right", "application-card-chevron")}
      </div>
    </div>
  `;
}

function childHistoryPointLabel(application) {
  const points = Number(application.fixedPoints ?? application.suggestedPoints ?? application.requestedPoints ?? 0);
  return `${points.toLocaleString()}<small>pt</small>`;
}

function redemptionHistoryStatus(status) {
  if (status === "completed") {
    return { className: "is-approved", icon: "circle-check" };
  }

  if (status === "pending") {
    return { className: "is-pending", icon: "clock" };
  }

  return { className: "is-redo", icon: "circle-alert" };
}

function applicationScoreLabel(application) {
  if (application.category !== "test") {
    return "";
  }

  if (application.testMethod === "rank") {
    return application.rank == null || application.rank === "" ? "" : `${Number(application.rank).toLocaleString()}位`;
  }

  if (application.score == null || application.score === "") {
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

function applicationHistoryTitle(application) {
  if (application.category === "test" || application.category === "grade") {
    return escapeHtml(application.subjectName || categoryLabel(application.category));
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

function notificationList(notifications, context = {}) {
  const items = [...notifications].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let currentDateKey = "";
  return `
    <div class="application-list notification-list">
      ${
        items.length
          ? items.map((notification) => {
              const dateKey = notificationDateKey(notification.createdAt);
              const dateLabel = dateKey !== currentDateKey
                ? `<div class="notification-date-separator">${formatMonthDayWithWeekday(notification.createdAt)}</div>`
                : "";
              currentDateKey = dateKey;
              return `${dateLabel}${notificationCard(notification, context)}`;
            }).join("")
          : `<div class="notification-empty-state"><strong>お知らせはまだありません</strong></div>`
      }
    </div>
  `;
}

function notificationCard(notification, context = {}) {
  const source = parentNotificationSource(notification);
  const isUnread = !notification.readAt;
  const owner = context.owner || "parent";
  const child = owner === "parent" && source === "child" ? getNotificationChild(notification) : null;
  const shouldShowMessage = !(owner === "parent" && source === "child");
  const avatar = child
    ? `<div class="notification-avatar" aria-hidden="true">${childAvatar(child, "notification-child-avatar")}</div>`
    : source === "child"
      ? `<div class="notification-avatar" aria-hidden="true">${studyPayIcon("file-check", "notification-avatar-icon")}</div>`
      : "";
  return `
    <div class="notification-card ${source === "child" ? "from-child" : "from-system"} ${avatar ? "" : "no-avatar"} ${isUnread ? "unread" : ""}" data-notification-id="${escapeHtml(notification.id)}" data-notification-owner="${escapeHtml(owner)}" ${notification.route ? `data-notification-route="${escapeHtml(notification.route)}"` : ""} ${context.childId ? `data-notification-child-id="${escapeHtml(context.childId)}"` : ""}>
      ${avatar}
      <div class="notification-message-stack">
        <div class="notification-bubble">
          <div class="notification-title-row">
            <h2>${escapeHtml(notification.title)}</h2>
          </div>
          ${shouldShowMessage && notification.message ? `<p>${escapeHtml(notification.message)}</p>` : ""}
        </div>
        <span class="notification-read-label ${isUnread ? "unread" : "read"}">${isUnread ? "未読" : "既読"}</span>
      </div>
    </div>
  `;
}

function scrollNotificationsToLatest() {
  window.setTimeout(() => {
    const screen = document.querySelector(".notification-screen");
    if (screen) {
      screen.scrollTop = screen.scrollHeight;
    }
  }, 0);
}

function getNotificationChild(notification) {
  const parent = loadAccount() || state.parent;
  const children = parent?.children || [];
  const route = String(notification.route || "");
  const routeId = route.split("/").pop();
  return children.find((child) =>
    (child.applications || []).some((application) => application.id === routeId)
      || (child.redemptions || []).some((redemption) => redemption.id === routeId),
  ) || children[0] || null;
}

function childHeader(label) {
  const child = typeof getCurrentChild === "function" ? getCurrentChild() : state.child;
  return `
    <div class="topbar child-topbar">
      <div class="brand">
        <img class="header-logo-image child-header-logo-image" src="./logo.svg?v=phase322" alt="allowa" />
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
    ["redeem", "¥", "おこづかい申請", "/child/exchange"],
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
  const applicationCount = requestCount + redemptionCount;
  const notificationCount = getUnreadNotifications({ notifications: getParentAnnouncements(parent) }).length;
  const items = [
    ["home", studyPayIcon("house", "nav-lucide-icon"), "ホーム", "/parent", 0],
    ["requests", studyPayIcon("list-check", "nav-lucide-icon"), "申請一覧", "/parent/applications", applicationCount],
    ["notifications", studyPayIcon("bell", "nav-lucide-icon"), "お知らせ", "/parent/notifications", notificationCount],
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
  bindRouteButtons();
  bindHomeExchangeUnitButtons();
  const triggers = document.querySelectorAll("[data-parent-header-child-id]");
  const menu = document.querySelector("#parent-child-switch-menu");
  const switchButton = menu?.querySelector("[data-switch-child-id]");

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!menu || !switchButton) {
        return;
      }

      const nextHidden = !menu.hidden && switchButton.dataset.switchChildId === trigger.dataset.parentHeaderChildId;
      switchButton.dataset.switchChildId = trigger.dataset.parentHeaderChildId || "";
      switchButton.textContent = `${trigger.dataset.parentHeaderChildName || "こども"}に切り替える`;
      menu.hidden = nextHidden;
      triggers.forEach((item) => item.setAttribute("aria-expanded", "false"));
      trigger.setAttribute("aria-expanded", String(!nextHidden));
    });
  });

  switchButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const child = getChildren().find((item) => item.id === event.currentTarget.dataset.switchChildId);
    if (child) {
      setChildSession(child);
      navigate("/child");
    }
  });

  document.addEventListener("click", (event) => {
    if (!menu || menu.hidden || event.target.closest(".parent-header-switch")) {
      return;
    }

    menu.hidden = true;
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  });
}

function bindHomeExchangeUnitButtons() {
  document.querySelectorAll("[data-add-exchange-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const child = findChild(button.closest("[data-exchange-unit-child-id]")?.dataset.exchangeUnitChildId);
      if (child) {
        showExchangeItemModal(child);
      }
    });
  });
  document.querySelectorAll("[data-edit-exchange-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const child = findChild(button.closest("[data-exchange-unit-child-id]")?.dataset.exchangeUnitChildId);
      const item = child ? getChildExchangeItemSettings(child)[Number(button.dataset.editExchangeItem)] : null;
      if (child && item) {
        showExchangeItemModal(child, item, Number(button.dataset.editExchangeItem));
      }
    });
  });
}

function validateExchangeUnitInput(input) {
  const card = input.closest("[data-exchange-unit-child-id]");
  const error = card?.querySelector(".exchange-unit-error");
  const value = Number(String(input.value || "").replaceAll(",", ""));

  if (!Number.isInteger(value) || value < 1 || value > 10000) {
    input.classList.add("is-error");
    if (error) {
      error.textContent = "1〜10000の数字を入力してください。";
    }
    return null;
  }

  input.classList.remove("is-error");
  if (error) {
    error.textContent = "";
  }
  return value;
}

function saveExchangeUnitInput(input) {
  const card = input.closest("[data-exchange-unit-child-id]");
  const childId = card?.dataset.exchangeUnitChildId;
  const value = validateExchangeUnitInput(input);

  if (!childId || value === null) {
    return;
  }

  input.value = String(value);
  updateChild(childId, { redemptionUnit: value });
}

function deleteExchangeItemSetting(button) {
  const card = button.closest("[data-exchange-unit-child-id]");
  const childId = card?.dataset.exchangeUnitChildId;
  const row = button.closest("[data-exchange-item-row]");
  if (!card || !childId || !row) {
    return;
  }

  const nextItems = readExchangeItemSettingsFromCard(card, row.dataset.exchangeItemRow);
  updateChild(childId, { exchangeItems: nextItems });
  render();
}

function readExchangeItemSettingsFromCard(card, excludedIndex = "") {
  const child = findChild(card?.dataset.exchangeUnitChildId);
  return getChildExchangeItemSettings(child).filter((_, index) => String(index) !== String(excludedIndex));
}

function showExchangeItemModal(child, item = null, itemIndex = -1) {
  document.querySelector("#exchange-item-modal")?.remove();
  const isEditing = itemIndex >= 0;
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal exchange-item-modal";
  modal.id = "exchange-item-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="exchange-item-modal-title">
      <h2 id="exchange-item-modal-title">${isEditing ? "ごほうび編集" : "ごほうび追加"}</h2>
      <form class="exchange-item-modal-form" id="exchange-item-form">
        <label class="rule-edit-field" for="exchange-item-name">
          <span>交換するもの</span>
          <input id="exchange-item-name" name="name" autocomplete="off" value="${escapeHtml(item?.name || "")}" placeholder="例: おこづかい" />
        </label>
        <div class="exchange-item-modal-grid">
          <label class="rule-edit-field" for="exchange-item-points">
            <span>pt交換単位</span>
            <input id="exchange-item-points" name="points" inputmode="numeric" value="${escapeHtml(String(item?.points || child.redemptionUnit || 100))}" />
          </label>
          <label class="rule-edit-field" for="exchange-item-value">
            <span>金額／数量／時間</span>
            <input id="exchange-item-value" name="exchangeValue" inputmode="numeric" value="${escapeHtml(String(item?.exchangeValue || ""))}" placeholder="例: 30" />
          </label>
          <label class="rule-edit-field exchange-item-unit-field" for="exchange-item-unit">
            <span>単位</span>
            <select id="exchange-item-unit" name="unit">
              ${EXCHANGE_ITEM_UNIT_OPTIONS.map((unitOption) => `<option value="${escapeHtml(unitOption)}" ${selectedAttr(item?.unit || "円", unitOption)}>${escapeHtml(unitOption)}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="error" id="exchange-item-error" aria-live="polite"></p>
        <div class="exchange-item-modal-actions">
          <button class="primary-button compact-button" type="submit">${isEditing ? "保存" : "追加"}</button>
          ${isEditing ? `<button class="danger-button compact-button" type="button" id="delete-exchange-item">削除</button>` : ""}
          <button class="secondary-button compact-button" type="button" id="cancel-exchange-item">キャンセル</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  document.querySelector("#cancel-exchange-item")?.addEventListener("click", closeModal);
  document.querySelector("#delete-exchange-item")?.addEventListener("click", () => {
    updateChild(child.id, {
      exchangeItems: getChildExchangeItemSettings(child).filter((_, index) => index !== itemIndex),
    });
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  document.querySelector("#exchange-item-name")?.focus();

  document.querySelector("#exchange-item-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = document.querySelector("#exchange-item-error");
    const name = String(form.get("name") || "").trim();
    const unit = String(form.get("unit") || "").trim();
    const points = Number(String(form.get("points") || "").replaceAll(",", ""));
    const exchangeValue = Number(String(form.get("exchangeValue") || "").replaceAll(",", ""));

    if (!name || !unit || !Number.isInteger(points) || points <= 0 || !Number.isInteger(exchangeValue) || exchangeValue <= 0) {
      if (error) {
        error.textContent = "交換するもの、pt交換単位、金額／数量／時間、単位を入力してください。";
      }
      return;
    }

    const currentItems = getChildExchangeItemSettings(child);
    const nextItem = {
      id: item?.id || `exchange-item-${Date.now()}`,
      name,
      points,
      exchangeValue,
      unit,
    };
    const nextItems = isEditing
      ? currentItems.map((currentItem, index) => (index === itemIndex ? nextItem : currentItem))
      : [...currentItems, nextItem];

    updateChild(child.id, { exchangeItems: nextItems });
    closeModal();
    render();
  });
}

function bindParentApplications() {
  bindParentShell();
  bindPhotoViewer();
  document.querySelectorAll("[data-parent-application-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.parentApplicationsType = button.dataset.parentApplicationType || "points";
      state.parentApplicationsFilter = Number(button.dataset.pendingCount || 0) > 0 ? "pending" : "all";
      state.parentApplicationsFilterTouched = false;
      navigate(state.parentApplicationsType === "allowance" ? "/parent/redemptions" : "/parent/applications");
    });
  });
  document.querySelectorAll("[data-parent-application-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.parentApplicationsFilter = button.dataset.parentApplicationFilter || "all";
      state.parentApplicationsFilterTouched = true;
      render();
    });
  });
}

function bindParentRedemptions() {
  bindParentShell();
}

function bindParentMonthlyBonus() {
  bindParentShell();
  syncBonusSettingFields();
  document.querySelector("#bonus-achievement-mode")?.addEventListener("change", syncBonusSettingFields);
  document.querySelectorAll("[data-bonus-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.bonusChoice;
      const value = button.dataset.bonusChoiceOption || "";
      const group = button.closest(".bonus-choice-group");
      group?.querySelectorAll("[data-bonus-choice]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      const input = document.querySelector(`[data-bonus-choice-value="${name}"]`);
      if (input) {
        input.value = value;
      }
      if (name === "type") {
        state.monthlyBonusFormType = value || "event";
      }
      if (name === "achievementCategory") {
        state.monthlyBonusAchievementCategory = value || "test";
      }
      if (name === "achievementMetric") {
        state.monthlyBonusAchievementMetric = value || "score";
      }
      syncBonusSettingFields();
    });
  });

  document.querySelector("#monthly-bonus-setting-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const childId = String(formData.get("childId") || "");
    const type = String(formData.get("type") || "event");
    const name = buildBonusSettingName(formData, findChild(childId));
    const conditionType = buildBonusConditionType(formData);
    const conditionDetails = buildBonusConditionDetails(formData, findChild(childId));
    const condition = bonusConditionSummary(conditionType, conditionDetails);
    const points = Number(type === "achievement" ? formData.get("achievementPoints") : formData.get("eventPoints"));
    const error = document.querySelector("#bonus-setting-error");

    if (!childId || !name || !isValidBonusCondition(conditionType, conditionDetails) || points <= 0) {
      error.textContent = "ボーナス名、条件、ポイントを入力してください。";
      return;
    }

    addBonusSetting({
      childId,
      type,
      name,
      condition,
      conditionType,
      conditionDetails,
      points,
    });
    state.flash = `${name}を保存しました。`;
    state.monthlyBonusSettingFilter = type;
    render();
  });

  document.querySelectorAll("[data-bonus-setting-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.monthlyBonusSettingFilter = button.dataset.bonusSettingFilter || "event";
      render();
    });
  });

  document.querySelectorAll("[data-delete-bonus-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const child = findChild(button.dataset.bonusSettingChildId);
      const setting = getChildBonusSettings(child).find((item) => item.id === button.dataset.deleteBonusSetting);
      if (child && setting) {
        showBonusSettingDeleteModal(child, setting);
      }
    });
  });
}

function showBonusSettingDeleteModal(child, setting) {
  document.querySelector("#bonus-setting-delete-modal")?.remove();
  const title = formatBonusSettingTitle(setting);
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-delete-modal";
  modal.id = "bonus-setting-delete-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="bonus-setting-delete-title">
      <h2 id="bonus-setting-delete-title">ボーナス設定を削除しますか？</h2>
      <p class="fine-print">「${escapeHtml(title)}」を削除します。この操作は元に戻せません。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-bonus-setting-delete">削除する</button>
        <button class="secondary-button" type="button" id="cancel-bonus-setting-delete">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-bonus-setting-delete")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-bonus-setting-delete")?.addEventListener("click", () => {
    deleteBonusSetting(child.id, setting.id);
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function syncBonusSettingFields() {
  const selectedType = document.querySelector('[data-bonus-choice-value="type"]')?.value || "event";
  const achievementCategory = document.querySelector('[data-bonus-choice-value="achievementCategory"]')?.value || "test";
  const achievementMetric = document.querySelector('[data-bonus-choice-value="achievementMetric"]')?.value || "score";

  document.querySelectorAll("[data-bonus-type-section]").forEach((section) => {
    section.hidden = section.dataset.bonusTypeSection !== selectedType;
  });

  document.querySelectorAll("[data-achievement-category-section]").forEach((section) => {
    section.hidden = selectedType !== "achievement" || section.dataset.achievementCategorySection !== achievementCategory;
  });

  document.querySelectorAll("[data-achievement-metric-section]").forEach((section) => {
    section.hidden = selectedType !== "achievement" || achievementCategory !== "test" || section.dataset.achievementMetricSection !== achievementMetric;
  });

  document.querySelector("[data-bonus-sentence-category-text]")?.replaceChildren(
    document.createTextNode(achievementCategory === "grade" ? "成績が" : "テストで"),
  );
}

function buildBonusSettingName(formData, child) {
  const type = String(formData.get("type") || "event");
  if (type === "event") {
    return String(formData.get("eventName") || "").trim();
  }

  const details = buildBonusConditionDetails(formData, child);
  if (details.category === "grade") {
    const subject = details.subjectName ? `${details.subjectName} ` : "";
    return `${subject}成績 ${details.gradeValue}${details.mode === "streak" ? ` ${details.count}回連続達成` : " 達成"}`;
  }

  const subject = details.subjectName ? `${details.subjectName} ` : "";
  const metric = details.metric === "rank" ? `${details.rank}位以上` : `${details.score}点以上`;
  return `${subject}テスト ${metric}${details.mode === "streak" ? ` ${details.count}回連続達成` : " 達成"}`;
}

function buildBonusConditionType(formData) {
  const type = String(formData.get("type") || "event");
  if (type === "event") {
    return "annual_date";
  }

  const category = String(formData.get("achievementCategory") || "test");
  if (category === "grade") {
    return "achievement_grade";
  }

  return String(formData.get("achievementMetric") || "score") === "rank" ? "achievement_rank" : "achievement_score";
}

function buildBonusConditionDetails(formData, child) {
  const type = String(formData.get("type") || "event");
  if (type === "event") {
    const eventDate = parseBonusEventDate(formData);
    return {
      month: eventDate.month,
      day: eventDate.day,
    };
  }

  const subjectId = String(formData.get("achievementSubjectId") || "");
  const subject = getActiveSubjects(child || {}).find((item) => item.id === subjectId);
  const category = String(formData.get("achievementCategory") || "test");
  const metric = String(formData.get("achievementMetric") || "score");
  const mode = String(formData.get("achievementMode") || "single");

  return {
    category,
    metric: category === "test" ? metric : "grade",
    mode,
    subjectId,
    subjectName: subject?.name || "",
    score: Number(formData.get("achievementScore") || 0),
    rank: Number(formData.get("achievementRank") || 0),
    gradeValue: String(formData.get("achievementGrade") || "").trim(),
    count: Number(formData.get("achievementCount") || 0),
  };
}

function parseBonusEventDate(formData) {
  const eventDate = String(formData.get("eventDate") || "");
  const match = eventDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      month: Number(match[1]),
      day: Number(match[2]),
    };
  }

  return {
    month: Number(formData.get("eventMonth") || 1),
    day: Number(formData.get("eventDay") || 0),
  };
}

function bonusConditionSummary(conditionType, details) {
  if (conditionType === "annual_date") {
    return `${Number(details.month || 1)}月${Number(details.day || 0)}日`;
  }

  if (conditionType === "achievement_grade") {
    const subject = details.subjectName ? `${details.subjectName} ` : "";
    return `${subject}成績で${details.gradeValue}${achievementModeSuffix(details.mode, details.count)}`;
  }

  const subject = details.subjectName ? `${details.subjectName} ` : "";
  const target = conditionType === "achievement_rank" ? `${Number(details.rank || 0)}位以上` : `${Number(details.score || 0)}点以上`;
  return `${subject}${target}${achievementModeSuffix(details.mode, details.count)}`;
}

function isValidBonusCondition(conditionType, details) {
  if (conditionType === "annual_date") {
    return Number(details.month || 0) >= 1 && Number(details.month || 0) <= 12 && Number(details.day || 0) >= 1 && Number(details.day || 0) <= 31;
  }

  if (conditionType === "achievement_grade") {
    return Boolean(details.subjectId) && Boolean(details.gradeValue) && Number(details.count || 0) > 0;
  }

  if (conditionType === "achievement_rank") {
    return Boolean(details.subjectId) && Number(details.rank || 0) > 0 && Number(details.count || 0) > 0;
  }

  return Boolean(details.subjectId) && Number(details.score || 0) > 0 && Number(details.count || 0) > 0;
}

function achievementModeSuffix(mode, count) {
  return mode === "streak" ? `を${Number(count || 0)}回連続達成` : `を${Number(count || 0)}回達成`;
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
  bindNotificationCards();
  document.querySelectorAll("[data-parent-notification-read]").forEach((button) => {
    button.addEventListener("click", () => {
      state.parentNotificationReadFilter = button.dataset.parentNotificationRead || "all";
      render();
    });
  });
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
  bindNotificationCards();
  document.querySelector("#read-child-notifications")?.addEventListener("click", () => {
    markChildNotificationsRead(child.id);
    render();
  });
}

function bindNotificationCards() {
  let longPressTimer = null;
  let didLongPress = false;
  document.querySelectorAll("[data-notification-id]").forEach((card) => {
    const startLongPress = () => {
      didLongPress = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        showNotificationActionMenu(card);
      }, 560);
    };
    const cancelLongPress = () => {
      clearTimeout(longPressTimer);
    };

    card.addEventListener("pointerdown", startLongPress);
    card.addEventListener("pointerup", cancelLongPress);
    card.addEventListener("pointerleave", cancelLongPress);
    card.addEventListener("pointercancel", cancelLongPress);
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showNotificationActionMenu(card);
    });
    card.addEventListener("click", () => {
      if (didLongPress) {
        didLongPress = false;
        return;
      }

      updateNotificationReadStateFromCard(card, card.classList.contains("unread"));
      render();
    });
  });
}

function showNotificationActionMenu(card) {
  const notificationId = card.dataset.notificationId;
  const owner = card.dataset.notificationOwner || "parent";
  const childId = card.dataset.notificationChildId || "";
  const title = card.querySelector(".notification-title-row h2")?.textContent.trim() || "お知らせ";
  const message = card.querySelector(".notification-bubble p")?.textContent.trim() || "";
  document.querySelector("#notification-action-menu")?.remove();
  const modal = document.createElement("div");
  modal.className = "notification-action-backdrop";
  modal.id = "notification-action-menu";
  modal.innerHTML = `
    <div class="notification-action-panel" role="dialog" aria-label="お知らせの操作">
      <div class="notification-action-preview">
        <div class="notification-action-preview-head">
          <h2>お知らせ内容</h2>
        </div>
        <strong>${escapeHtml(title)}</strong>
        ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      </div>
      <div class="notification-action-buttons">
        <button class="danger" type="button" data-notification-action="delete">削除</button>
        <button type="button" data-notification-action="cancel">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeMenu = () => modal.remove();
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.dataset.notificationAction === "cancel") {
      closeMenu();
      return;
    }

    const action = event.target.dataset.notificationAction;
    if (action === "delete") {
      deleteNotification({ owner, childId, notificationId });
      closeMenu();
      render();
    }
  });
}

function updateNotificationReadStateFromCard(card, read) {
  updateNotificationReadState({
    owner: card.dataset.notificationOwner || "parent",
    childId: card.dataset.notificationChildId || "",
    notificationId: card.dataset.notificationId,
    read,
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
      rank: Number(formData.get("rank") || application.rank || 0) || null,
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
      if (!profilePhoto?.dataUrl) {
        error.textContent = "プロフィール写真を追加してください。";
        return;
      }

      const child = createChild({ nickname, profilePhoto, loginId, password });
      addChild(child);
      showChildDeviceChoiceModal(child);
    } catch (submitError) {
      error.textContent = submitError.message || "こどもを追加できませんでした。写真を変更してもう一度お試しください。";
    }
  });
}

function showChildDeviceChoiceModal(child) {
  document.querySelector("#child-device-choice-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-device-modal";
  modal.id = "child-device-choice-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel child-device-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-device-choice-title">
      <h2 id="child-device-choice-title">${escapeHtml(child.nickname)}さん用のスマホ or タブレットはありますか？</h2>
      <div class="child-device-modal-actions">
        <button class="primary-button" type="button" id="child-device-has-device">ある</button>
        <button class="secondary-button" type="button" id="child-device-no-device">ない</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#child-device-has-device")?.addEventListener("click", () => {
    closeModal();
    showChildLoginQrModal(child);
  });
  document.querySelector("#child-device-no-device")?.addEventListener("click", () => {
    closeModal();
    showChildNoDeviceModal(child);
  });
}

function showChildLoginQrModal(child) {
  document.querySelector("#child-login-qr-modal")?.remove();

  const loginUrl = childLoginUrl();
  const qrSrc = childLoginQrUrl(loginUrl);
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-device-modal";
  modal.id = "child-login-qr-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel child-device-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-login-qr-title">
      <h2 id="child-login-qr-title">こどもログイン</h2>
      <div class="child-login-qr-frame">
        <img src="${escapeHtml(qrSrc)}" alt="こどもログインQRコード" />
      </div>
      <p>このQRコードを${escapeHtml(child.nickname)}さんの端末で読み取ってログインしてください</p>
      <p>ログインID・パスワードは ホーム ＞ 詳細 で確認できます。</p>
      <button class="primary-button" type="button" id="child-login-qr-ok">OK</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.querySelector("#child-login-qr-ok")?.addEventListener("click", () => {
    modal.remove();
    navigate("/parent");
  });
}

function showChildNoDeviceModal(child) {
  document.querySelector("#child-no-device-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-device-modal";
  modal.id = "child-no-device-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel child-device-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-no-device-title">
      <h2 id="child-no-device-title">${escapeHtml(child.nickname)}さんの利用方法</h2>
      <p>ホーム画面の右上のアイコンをタップして</p>
      <p>アカウントを切り替えてご利用ください。</p>
      <button class="primary-button" type="button" id="child-no-device-ok">OK</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.querySelector("#child-no-device-ok")?.addEventListener("click", () => {
    modal.remove();
    navigate("/parent");
  });
}

function childLoginUrl() {
  const baseUrl = `${location.origin}${location.pathname}`;
  return `${baseUrl}#/child/login`;
}

function childLoginQrUrl(loginUrl) {
  const encodedUrl = encodeURIComponent(loginUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodedUrl}`;
}

function bindProfilePhotoPicker(container, { onFileSelected } = {}) {
  const profilePhotoButton = container.querySelector("[data-profile-photo-button]");
  const profilePhotoPreview = container.querySelector("#profile-photo-preview");
  const profilePhotoInput = container.querySelector("[data-profile-photo-input]");
  const initialImage = profilePhotoPreview?.querySelector("img");
  const initialPosition = readProfilePhotoImagePosition(initialImage);
  const initialCrop = readProfilePhotoImageCrop(initialImage);
  const initialPhoto = initialImage
    ? {
        name: initialImage.getAttribute("alt") || "プロフィール写真",
        dataUrl: initialImage.getAttribute("src") || "",
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        scale: initialCrop.scale,
      }
    : null;
  container._profilePhoto = container._profilePhoto || initialPhoto;

  const openProfilePhotoInput = () => {
    profilePhotoInput?.click();
  };

  profilePhotoButton?.addEventListener("click", () => {
    openProfilePhotoInput();
  });
  profilePhotoPreview?.addEventListener("click", () => {
    openProfilePhotoInput();
  });

  profilePhotoInput?.addEventListener("change", async () => {
    const file = profilePhotoInput.files?.[0] || null;
    container._profilePhotoFile = file;
    container._profilePhoto = null;
    container._profilePhotoError = "";
    if (!file) {
      return;
    }

    try {
      const profilePhoto = await createProfilePhotoSourceFromFile(file);
      const positionedProfilePhoto = await showProfilePhotoPositionModal(profilePhoto);
      if (!positionedProfilePhoto) {
        profilePhotoInput.value = "";
        return;
      }
      container._profilePhoto = positionedProfilePhoto;
      updateProfilePhotoPreview(positionedProfilePhoto);
      await onFileSelected?.(positionedProfilePhoto);
    } catch {
      container._profilePhotoError = "写真を読み込めませんでした。別の写真を選んでください。";
      updateProfilePhotoPreview(null);
    }
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

  preview.innerHTML = `<img src="${escapeHtml(profilePhoto.dataUrl)}" alt="${escapeHtml(profilePhoto.name || "選択したプロフィール写真")}" ${profilePhotoImageStyle(profilePhoto)} />`;
}

function showProfilePhotoPositionModal(profilePhoto) {
  return new Promise((resolve) => {
    document.querySelector("#profile-photo-position-modal")?.remove();
    const crop = normalizeProfilePhotoCrop(profilePhoto);
    const modal = document.createElement("div");
    modal.className = "parent-switch-modal profile-photo-position-modal";
    modal.id = "profile-photo-position-modal";
    modal.innerHTML = `
      <div class="profile-photo-position-panel" role="dialog" aria-modal="true" aria-labelledby="profile-photo-position-title">
        <div class="profile-photo-position-header">
          <button class="profile-photo-position-text-button" type="button" data-profile-position-cancel>キャンセル</button>
          <h2 id="profile-photo-position-title">プロフィール画像</h2>
          <button class="profile-photo-position-done-button" type="button" data-profile-position-save>完了</button>
        </div>
        <div class="profile-photo-position-stage">
          <div class="profile-photo-position-frame" data-profile-position-frame>
            <img src="${escapeHtml(profilePhoto.dataUrl)}" alt="${escapeHtml(profilePhoto.name || "プロフィール写真")}" data-profile-position-image />
          </div>
        </div>
        <p class="profile-photo-position-hint">写真を動かして位置調整・2本指で拡大縮小</p>
      </div>
    `;
    document.body.appendChild(modal);

    const frame = modal.querySelector("[data-profile-position-frame]");
    const image = modal.querySelector("[data-profile-position-image]");
    const setImageTransform = () => {
      constrainProfilePhotoCrop(crop, frame, image);
      const metrics = profilePhotoRenderMetrics(
        image.naturalWidth || image.width || PROFILE_PHOTO_MAX_SIZE,
        image.naturalHeight || image.height || PROFILE_PHOTO_MAX_SIZE,
        crop,
        frame,
      );
      image.style.width = `${metrics.renderedWidth}px`;
      image.style.height = `${metrics.renderedHeight}px`;
      image.style.transform = `translate(${metrics.targetX}px, ${metrics.targetY}px)`;
    };
    image.addEventListener("load", setImageTransform, { once: true });
    setImageTransform();

    const pointers = new Map();
    let dragState = null;
    let pinchState = null;
    const getPointerDistance = () => {
      const points = Array.from(pointers.values());
      if (points.length < 2) {
        return 0;
      }
      return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
    };
    const startDrag = (event) => {
      event.preventDefault();
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      frame.setPointerCapture?.(event.pointerId);
      if (pointers.size === 2) {
        pinchState = {
          distance: getPointerDistance(),
          scale: crop.scale,
          offsetX: crop.offsetX,
          offsetY: crop.offsetY,
        };
        dragState = null;
        return;
      }
      dragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: crop.offsetX,
        offsetY: crop.offsetY,
      };
    };
    const moveDrag = (event) => {
      if (!pointers.has(event.pointerId)) {
        return;
      }
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (pointers.size >= 2 && pinchState) {
        const nextDistance = getPointerDistance();
        if (pinchState.distance > 0) {
          crop.scale = clampProfilePhotoScale(pinchState.scale * (nextDistance / pinchState.distance));
          setImageTransform();
        }
        return;
      }
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      crop.offsetX = dragState.offsetX + event.clientX - dragState.startClientX;
      crop.offsetY = dragState.offsetY + event.clientY - dragState.startClientY;
      setImageTransform();
    };
    const endDrag = (event) => {
      pointers.delete(event.pointerId);
      frame.releasePointerCapture?.(event.pointerId);
      if (pointers.size < 2) {
        pinchState = null;
      }
      if (dragState?.pointerId === event.pointerId || pointers.size === 0) {
        dragState = pointers.size === 1
          ? {
              pointerId: Array.from(pointers.keys())[0],
              startClientX: Array.from(pointers.values())[0].clientX,
              startClientY: Array.from(pointers.values())[0].clientY,
              offsetX: crop.offsetX,
              offsetY: crop.offsetY,
            }
          : null;
      }
    };

    frame.addEventListener("pointerdown", startDrag);
    frame.addEventListener("pointermove", moveDrag);
    frame.addEventListener("pointerup", endDrag);
    frame.addEventListener("pointercancel", endDrag);
    frame.addEventListener("wheel", (event) => {
      event.preventDefault();
      crop.scale = clampProfilePhotoScale(crop.scale + (event.deltaY < 0 ? 0.08 : -0.08));
      setImageTransform();
    });

    const closeModal = (result) => {
      modal.remove();
      resolve(result);
    };
    modal.querySelector("[data-profile-position-save]")?.addEventListener("click", async () => {
      try {
        closeModal(await createCroppedProfilePhoto(profilePhoto, crop, frame));
      } catch {
        closeModal(null);
      }
    });
    modal.querySelector("[data-profile-position-cancel]")?.addEventListener("click", () => closeModal(null));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal(null);
      }
    });
  });
}

function normalizeProfilePhotoPosition(profilePhoto) {
  return {
    x: clampProfilePhotoPosition(profilePhoto?.positionX ?? 50),
    y: clampProfilePhotoPosition(profilePhoto?.positionY ?? 50),
  };
}

function normalizeProfilePhotoCrop(profilePhoto) {
  return {
    scale: clampProfilePhotoScale(profilePhoto?.scale ?? 1),
    offsetX: Number.isFinite(Number(profilePhoto?.offsetX)) ? Number(profilePhoto.offsetX) : 0,
    offsetY: Number.isFinite(Number(profilePhoto?.offsetY)) ? Number(profilePhoto.offsetY) : 0,
  };
}

function clampProfilePhotoPosition(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 50;
  }
  return Math.min(100, Math.max(0, number));
}

function clampProfilePhotoScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 1;
  }
  return Math.min(3, Math.max(1, number));
}

function profilePhotoImageStyle(profilePhoto) {
  const position = normalizeProfilePhotoPosition(profilePhoto);
  const crop = normalizeProfilePhotoCrop(profilePhoto);
  return `style="object-position: ${position.x}% ${position.y}%; transform: scale(${crop.scale});"`;
}

function readProfilePhotoImagePosition(image) {
  if (!image) {
    return { x: 50, y: 50 };
  }
  const [x = "50%", y = "50%"] = String(image.style.objectPosition || "50% 50%").split(/\s+/);
  return {
    x: clampProfilePhotoPosition(String(x).replace("%", "")),
    y: clampProfilePhotoPosition(String(y).replace("%", "")),
  };
}

function readProfilePhotoImageCrop(image) {
  if (!image) {
    return { scale: 1 };
  }
  const scaleMatch = String(image.style.transform || "").match(/scale\(([^)]+)\)/);
  return {
    scale: clampProfilePhotoScale(scaleMatch?.[1] ?? 1),
  };
}

function createCroppedProfilePhoto(profilePhoto, crop, frame) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("写真を処理できませんでした。"));
    image.onload = () => {
      const outputSize = PROFILE_PHOTO_MAX_SIZE;
      const frameSize = Math.max(1, Math.round(frame.getBoundingClientRect().width || outputSize));
      const sourceWidth = image.naturalWidth || image.width || outputSize;
      const sourceHeight = image.naturalHeight || image.height || outputSize;
      const metrics = profilePhotoRenderMetrics(sourceWidth, sourceHeight, crop, frame);
      const outputRatio = outputSize / frameSize;
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("写真を処理できませんでした。"));
        return;
      }

      context.fillStyle = "#fff";
      context.fillRect(0, 0, outputSize, outputSize);
      context.drawImage(
        image,
        metrics.targetX * outputRatio,
        metrics.targetY * outputRatio,
        metrics.renderedWidth * outputRatio,
        metrics.renderedHeight * outputRatio,
      );
      resolve({
        name: profilePhoto.name || "プロフィール写真",
        dataUrl: canvas.toDataURL("image/jpeg", PROFILE_PHOTO_JPEG_QUALITY),
        positionX: 50,
        positionY: 50,
        scale: 1,
        updatedAt: new Date().toISOString(),
      });
    };
    image.src = profilePhoto.dataUrl;
  });
}

function constrainProfilePhotoCrop(crop, frame, image) {
  const fallbackFrameSize = Math.max(1, Math.round(frame?.getBoundingClientRect()?.width || PROFILE_PHOTO_MAX_SIZE));
  const sourceWidth = image?.naturalWidth || image?.width || fallbackFrameSize;
  const sourceHeight = image?.naturalHeight || image?.height || fallbackFrameSize;
  const { frameSize, renderedWidth, renderedHeight } = profilePhotoRenderMetrics(sourceWidth, sourceHeight, crop, frame);
  const maxOffsetX = Math.max(0, (renderedWidth - frameSize) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - frameSize) / 2);
  crop.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, crop.offsetX));
  crop.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, crop.offsetY));
}

function profilePhotoRenderMetrics(sourceWidth, sourceHeight, crop, frame) {
  const rect = frame?.getBoundingClientRect();
  const frameSize = Math.max(1, Math.round(rect?.width || PROFILE_PHOTO_MAX_SIZE));
  const normalizedSourceWidth = Math.max(1, Number(sourceWidth || frameSize));
  const normalizedSourceHeight = Math.max(1, Number(sourceHeight || frameSize));
  const coverScale = Math.max(frameSize / normalizedSourceWidth, frameSize / normalizedSourceHeight);
  const renderedWidth = normalizedSourceWidth * coverScale * crop.scale;
  const renderedHeight = normalizedSourceHeight * coverScale * crop.scale;
  return {
    frameSize,
    renderedWidth,
    renderedHeight,
    targetX: (frameSize - renderedWidth) / 2 + crop.offsetX,
    targetY: (frameSize - renderedHeight) / 2 + crop.offsetY,
  };
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
    });
  }

  document.querySelector("#edit-child-password")?.addEventListener("click", () => {
    showChildPasswordModal(child);
  });

  document.querySelector("#edit-child-nickname")?.addEventListener("click", () => {
    showChildNicknameModal(child);
  });

  document.querySelector("#edit-child-nickname-name")?.addEventListener("click", () => {
    showChildNicknameModal(child);
  });

  document.querySelector("#delete-child-button")?.addEventListener("click", () => {
    showChildDeleteModal(child);
  });

  bindRedemptionUnitButtons(child);
}

function maskedPassword() {
  return "●●●●●●";
}

function isValidChildPassword(password) {
  return /^[A-Za-z0-9]{6,}$/.test(password);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
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

function showChildDeleteModal(child) {
  document.querySelector("#child-delete-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-delete-modal";
  modal.id = "child-delete-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="child-delete-title">
      <h2 id="child-delete-title">${escapeHtml(child.nickname)}のアカウントを削除しますか？</h2>
      <p>削除すると、ログイン情報・申請履歴・ポイント履歴などのデータは確認できなくなります。この操作は元に戻せません。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-delete-child">削除する</button>
        <button class="secondary-button" type="button" id="cancel-delete-child">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-delete-child")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-delete-child")?.addEventListener("click", () => {
    updateChild(child.id, { status: "deleted", deletedAt: new Date().toISOString() });
    closeModal();
    navigate("/parent");
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function showParentCancelModal() {
  document.querySelector("#parent-cancel-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-delete-modal";
  modal.id = "parent-cancel-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="parent-cancel-title">
      <h2 id="parent-cancel-title">退会しますか？</h2>
      <p>退会すると、この端末に保存されている保護者アカウント・こども情報・申請履歴・ポイント履歴などのデータは削除されます。この操作は元に戻せません。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-parent-cancel">退会する</button>
        <button class="secondary-button" type="button" id="cancel-parent-cancel">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-parent-cancel")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-parent-cancel")?.addEventListener("click", () => {
    cancelParentAccount();
    closeModal();
    navigate("/");
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
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
  bindRedemptionUnitButtons(child);
  if (seedDefaultOtherTasksIfNeeded(child)) {
    render();
    return;
  }

  const subjectTrigger = document.querySelector("#rule-subject-trigger");
  const subjectMenu = document.querySelector("#rule-subject-menu");
  const closeSubjectMenu = () => {
    if (subjectMenu) {
      subjectMenu.hidden = true;
    }
    subjectTrigger?.setAttribute("aria-expanded", "false");
  };
  subjectTrigger?.addEventListener("click", () => {
    if (!subjectMenu) {
      return;
    }

    subjectMenu.hidden = !subjectMenu.hidden;
    subjectTrigger.setAttribute("aria-expanded", String(!subjectMenu.hidden));
  });

  document.querySelectorAll("[data-rule-subject-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const subjectId = button.dataset.ruleSubjectOption;
      updateChild(child.id, { ruleEditorSubjectId: subjectId });
      render();
    });
  });

  document.querySelector("[data-rule-subject-add]")?.addEventListener("click", () => {
    closeSubjectMenu();
    showRuleSubjectModal(child);
  });

  document.querySelectorAll("[data-rule-subject-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const subject = getActiveSubjects(child).find((item) => item.id === button.dataset.ruleSubjectEdit);
      if (subject) {
        closeSubjectMenu();
        showRuleSubjectModal(child, subject);
      }
    });
  });

  document.querySelectorAll("[data-rule-subject-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const subject = getActiveSubjects(child).find((item) => item.id === button.dataset.ruleSubjectDelete);
      if (subject) {
        closeSubjectMenu();
        showRuleSubjectDeleteModal(child, subject);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!subjectMenu || subjectMenu.hidden || event.target.closest(".rule-subject-picker")) {
      return;
    }

    subjectMenu.hidden = true;
    subjectTrigger?.setAttribute("aria-expanded", "false");
  });

  const gradeTypeTrigger = document.querySelector("#rule-grade-type-trigger");
  const gradeTypeMenu = document.querySelector("#rule-grade-type-menu");
  const closeGradeTypeMenu = () => {
    if (gradeTypeMenu) {
      gradeTypeMenu.hidden = true;
    }
    gradeTypeTrigger?.setAttribute("aria-expanded", "false");
  };
  gradeTypeTrigger?.addEventListener("click", () => {
    if (!gradeTypeMenu) {
      return;
    }

    gradeTypeMenu.hidden = !gradeTypeMenu.hidden;
    gradeTypeTrigger.setAttribute("aria-expanded", String(!gradeTypeMenu.hidden));
  });

  document.querySelectorAll("[data-rule-grade-type-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextGradeType = button.dataset.ruleGradeTypeOption;
      const currentGradeType = child.ruleEditorGradeType || "grade_5";
      closeGradeTypeMenu();
      if (!nextGradeType || nextGradeType === currentGradeType) {
        return;
      }

      if (hasUnsavedPointRuleChanges() && !document.querySelector("#point-rule-leave-modal")) {
        showPointRuleLeaveModal("", () => {
          updateChild(child.id, { ruleEditorGradeType: nextGradeType });
          render();
        }, "切り替える");
        return;
      }

      updateChild(child.id, { ruleEditorGradeType: nextGradeType });
      render();
    });
  });

  document.addEventListener("click", (event) => {
    if (!gradeTypeMenu || gradeTypeMenu.hidden || event.target.closest(".rule-grade-type-picker")) {
      return;
    }

    gradeTypeMenu.hidden = true;
    gradeTypeTrigger?.setAttribute("aria-expanded", "false");
  });

  document.querySelector("#rule-subject-select")?.addEventListener("change", (event) => {
    if (event.currentTarget.value === "__add_subject__") {
      navigate(`/parent/children/${child.id}/subjects`);
      return;
    }

    updateChild(child.id, { ruleEditorSubjectId: event.currentTarget.value });
    render();
  });

  document.querySelectorAll("[data-rule-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      updateChild(child.id, { ruleEditorMode: button.dataset.ruleMode });
      render();
    });
  });

  document.querySelector("[data-open-other-task-form]")?.addEventListener("click", () => {
    if (getOtherPointTasks(child).length >= MAX_OTHER_POINT_TASKS) {
      return;
    }
    updateChild(child.id, { ruleOtherTaskFormOpen: true, ruleOtherTaskEditingId: "" });
    render();
  });

  document.querySelector("[data-close-other-task-form]")?.addEventListener("click", () => {
    updateChild(child.id, { ruleOtherTaskFormOpen: false, ruleOtherTaskEditingId: "" });
    render();
  });

  const otherCategoryTrigger = document.querySelector("#other-task-category-trigger");
  const otherCategoryMenu = document.querySelector("#other-task-category-menu");
  const otherCategoryInput = document.querySelector("#other-task-category");
  const closeOtherCategoryMenu = () => {
    if (otherCategoryMenu) {
      otherCategoryMenu.hidden = true;
    }
    otherCategoryTrigger?.setAttribute("aria-expanded", "false");
  };
  otherCategoryTrigger?.addEventListener("click", () => {
    if (!otherCategoryMenu) {
      return;
    }

    otherCategoryMenu.hidden = !otherCategoryMenu.hidden;
    otherCategoryTrigger.setAttribute("aria-expanded", String(!otherCategoryMenu.hidden));
  });

  document.querySelectorAll("[data-other-task-category]").forEach((button) => {
    button.addEventListener("click", () => {
      if (otherCategoryInput) {
        otherCategoryInput.value = button.dataset.otherTaskCategory || "その他";
      }
      const selectedTag = button.querySelector(".rule-other-category-select-tag")?.cloneNode(true);
      if (selectedTag && otherCategoryTrigger) {
        otherCategoryTrigger.querySelector(".rule-other-category-select-tag")?.replaceWith(selectedTag);
      }
      document.querySelectorAll("[data-other-task-category]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      closeOtherCategoryMenu();
    });
  });

  document.addEventListener("click", (event) => {
    if (!otherCategoryMenu || otherCategoryMenu.hidden || event.target.closest(".rule-other-category-picker")) {
      return;
    }

    closeOtherCategoryMenu();
  });

  document.querySelectorAll("[data-edit-other-task]").forEach((button) => {
    button.addEventListener("click", () => {
      updateChild(child.id, { ruleOtherTaskFormOpen: true, ruleOtherTaskEditingId: button.dataset.editOtherTask });
      render();
    });
  });

  document.querySelectorAll("[data-delete-other-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const task = getOtherPointTasks(child).find((item) => item.id === button.dataset.deleteOtherTask);
      if (task) {
        showOtherTaskDeleteModal(child, task);
      }
    });
  });

  document.querySelector("#other-task-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector("#other-task-error");
    const formData = new FormData(form);
    const taskId = String(formData.get("taskId") || "");
    const category = String(formData.get("category") || "その他").trim() || "その他";
    const taskName = String(formData.get("taskName") || "").trim();
    const points = Number(formData.get("points") || 0);
    if (!taskName) {
      if (error) {
        error.textContent = "タスク名を入力してください。";
      }
      return;
    }

    if (!Number.isFinite(points) || points < 1) {
      if (error) {
        error.textContent = "ポイントは1以上で入力してください。";
      }
      return;
    }

    if (!taskId && getOtherPointTasks(child).length >= MAX_OTHER_POINT_TASKS) {
      if (error) {
        error.textContent = `タスクは最大${MAX_OTHER_POINT_TASKS}件までです。`;
      }
      return;
    }

    if (taskId) {
      updateOtherPointTask(child.id, taskId, { category, name: taskName, points });
    } else {
      addOtherPointTask(child.id, { category, name: taskName, points });
    }
    render();
  });

  document.querySelectorAll("[data-rule-test-method]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextMethod = button.dataset.ruleTestMethod;
      if (nextMethod === child.ruleEditorTestMethod) {
        return;
      }

      if (hasUnsavedPointRuleChanges() && !document.querySelector("#point-rule-leave-modal")) {
        showPointRuleLeaveModal("", () => {
          updateChild(child.id, { ruleEditorTestMethod: nextMethod });
          render();
        }, "切り替える");
        return;
      }

      updateChild(child.id, { ruleEditorTestMethod: nextMethod });
      render();
    });
  });

  document.querySelectorAll("[data-add-test-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      addTestRuleRow(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll("[data-add-rank-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      addRankRuleRow(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll("[data-add-grade-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      addGradeRuleRow(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll("[data-toggle-test-rule-enabled]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (!form) {
        return;
      }

      updateSubjectPointRuleEnabled(child.id, form.dataset.subjectId, form.dataset.ruleType, form.dataset.ruleEnabled === "false");
      render();
    });
  });

  document.querySelectorAll("[data-reset-test-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (!form || form.dataset.ruleEnabled === "false") {
        return;
      }

      showRuleResetModal(child, form.dataset.subjectId, form.dataset.ruleType);
    });
  });

  document.querySelectorAll("[data-apply-rule-to-subjects]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (!form || form.dataset.ruleEnabled === "false") {
        return;
      }

      showApplyRuleToSubjectsModal(child, form);
    });
  });

  document.querySelectorAll("[data-delete-test-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const table = button.closest(".test-rule-table");
      const form = table?.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      button.closest(".rule-table-row")?.remove();
      syncTestRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updateAddTestRuleButtonState(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll("[data-delete-rank-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const table = button.closest(".rank-rule-table");
      const form = table?.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      button.closest(".rule-table-row")?.remove();
      syncRankRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updateAddRankRuleButtonState(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll("[data-delete-grade-rule-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".point-rule-form");
      if (form?.dataset.ruleEnabled === "false") {
        return;
      }
      button.closest(".rule-table-row")?.remove();
      updateAddGradeRuleButtonState(form);
      updatePointRuleDirtyState(form);
    });
  });

  document.querySelectorAll(".point-rule-form").forEach((form) => {
    setPointRuleFormBaseline(form);
    validateTestRuleForm(form);
    updateAddTestRuleButtonState(form);
    updateAddRankRuleButtonState(form);
    updateAddGradeRuleButtonState(form);
    updateRuleFormEnabledState(form);
    form.querySelectorAll(".rule-table-editor input").forEach((input) => {
      input.addEventListener("input", () => {
        syncRankRuleBoundaryRow(input.closest(".rank-rule-table"));
        validateTestRuleForm(form);
        updatePointRuleDirtyState(form);
      });
      input.addEventListener("blur", () => {
        syncTestRuleBoundaryRow(input.closest(".test-rule-table"));
        syncRankRuleBoundaryRow(input.closest(".rank-rule-table"));
        validateTestRuleForm(form);
        updatePointRuleDirtyState(form);
      });
      input.addEventListener("change", () => {
        syncTestRuleBoundaryRow(input.closest(".test-rule-table"));
        syncRankRuleBoundaryRow(input.closest(".rank-rule-table"));
        validateTestRuleForm(form);
        updatePointRuleDirtyState(form);
      });
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.currentTarget.dataset.ruleEnabled === "false") {
        return;
      }
      const nextSettings = collectPointRuleSettings(event.currentTarget);
      if (!nextSettings) {
        return;
      }

      updateSubjectPointRule(child.id, event.currentTarget.dataset.subjectId, event.currentTarget.dataset.ruleType, nextSettings);
      setPointRuleFormBaseline(event.currentTarget);
      render();
      showPointRuleSavedModal();
    });
  });
}

function bindRedemptionUnitButtons(child) {
  bindHomeExchangeUnitButtons();
}

function addTestRuleRow(form) {
  const table = form?.querySelector(".test-rule-table");
  const rows = Array.from(table?.querySelectorAll(".rule-table-row") || []);
  const lastRow = rows.at(-1);
  if (!form || !table || !lastRow || rows.length < 2) {
    return;
  }

  if (rows.length >= getMaxTestRuleRows(form.dataset.ruleType)) {
    updateAddTestRuleButtonState(form);
    return;
  }

  const row = document.createElement("div");
  row.className = "rule-table-row";
  row.innerHTML = testRuleDynamicRowHtml();
  table.insertBefore(row, lastRow);
  syncTestRuleBoundaryRow(table);
  updateAddTestRuleButtonState(form);
  row.querySelector("[data-delete-test-rule-row]")?.addEventListener("click", () => {
    row.remove();
    syncTestRuleBoundaryRow(table);
    validateTestRuleForm(form);
    updateAddTestRuleButtonState(form);
    updatePointRuleDirtyState(form);
  });
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
    input.addEventListener("blur", () => {
      syncTestRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
    input.addEventListener("change", () => {
      syncTestRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
  });
}

function collectPointRuleSettings(form) {
  if (!validateTestRuleForm(form)) {
    return null;
  }

  const ruleCategory = form.dataset.ruleCategory;
  const rows = Array.from(form.querySelectorAll(".rule-table-row"));
  const settings = rows.map((row, index) => {
    const points = Number(row.querySelector('[name^="points-"]')?.value || 0);
    if (ruleCategory === "test") {
      const score = row.querySelector('[name^="score-"]')?.value || "";
      const operator = row.querySelector('[name^="operator-"]')?.value || "";
      return {
        condition: createScoreCondition(score, operator),
        points,
      };
    }

    if (ruleCategory === "rank") {
      const rank = row.querySelector('[name^="rank-"]')?.value || "";
      const operator = row.querySelector('[name^="operator-"]')?.value || "";
      return {
        condition: createRankCondition(rank, operator),
        points,
      };
    }

    return {
      id: String(row.querySelector('[name^="id-"]')?.value || `evaluation-${index + 1}`),
      label: String(row.querySelector('[name^="label-"]')?.value || "").trim(),
      points,
    };
  });
  const nextSettings =
    ruleCategory === "test"
      ? normalizeSavedTestSettings(settings, Number(form.dataset.fullScore || 100))
      : ruleCategory === "rank"
        ? normalizeRankSettings(settings)
        : settings;

  if (nextSettings.some((setting) => !(setting.condition || setting.label) || setting.points < 0)) {
    return null;
  }

  return nextSettings;
}

function addRankRuleRow(form) {
  const table = form?.querySelector(".rank-rule-table");
  const rows = Array.from(table?.querySelectorAll(".rule-table-row") || []);
  const lastRow = rows.at(-1);
  if (!form || !table || !lastRow || rows.length < 2) {
    return;
  }

  if (rows.length >= MAX_RANK_RULE_ROWS) {
    updateAddRankRuleButtonState(form);
    return;
  }

  const row = document.createElement("div");
  row.className = "rule-table-row";
  row.innerHTML = rankRuleDynamicRowHtml();
  table.insertBefore(row, lastRow);
  syncRankRuleBoundaryRow(table);
  updateAddRankRuleButtonState(form);
  row.querySelector("[data-delete-rank-rule-row]")?.addEventListener("click", () => {
    row.remove();
    syncRankRuleBoundaryRow(table);
    validateTestRuleForm(form);
    updateAddRankRuleButtonState(form);
    updatePointRuleDirtyState(form);
  });
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      syncRankRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
    input.addEventListener("blur", () => {
      syncRankRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
    input.addEventListener("change", () => {
      syncRankRuleBoundaryRow(table);
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
  });
}

function addGradeRuleRow(form) {
  const table = form?.querySelector(".grade-rule-table");
  if (!form || !table) {
    return;
  }

  const rows = Array.from(table.querySelectorAll(".rule-table-row"));
  if (rows.length >= MAX_GRADE_RULE_ROWS) {
    updateAddGradeRuleButtonState(form);
    return;
  }

  const row = document.createElement("div");
  row.className = "rule-table-row";
  row.innerHTML = gradeRuleDynamicRowHtml();
  table.appendChild(row);
  updateAddGradeRuleButtonState(form);
  row.querySelector("[data-delete-grade-rule-row]")?.addEventListener("click", () => {
    row.remove();
    updateAddGradeRuleButtonState(form);
    updatePointRuleDirtyState(form);
  });
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
    input.addEventListener("change", () => {
      validateTestRuleForm(form);
      updatePointRuleDirtyState(form);
    });
  });
}

function updateAddTestRuleButtonState(form) {
  const button = form?.querySelector("[data-add-test-rule-row]");
  const rowCount = form?.querySelectorAll(".test-rule-table .rule-table-row").length || 0;
  if (!button) {
    return;
  }

  const isMax = rowCount >= getMaxTestRuleRows(form.dataset.ruleType);
  const isDisabled = form.dataset.ruleEnabled === "false" || isMax;
  button.disabled = isDisabled;
  button.setAttribute("aria-disabled", String(isDisabled));
}

function updateAddRankRuleButtonState(form) {
  const button = form?.querySelector("[data-add-rank-rule-row]");
  const rowCount = form?.querySelectorAll(".rank-rule-table .rule-table-row").length || 0;
  if (!button) {
    return;
  }

  const isDisabled = form.dataset.ruleEnabled === "false" || rowCount >= MAX_RANK_RULE_ROWS;
  button.disabled = isDisabled;
  button.setAttribute("aria-disabled", String(isDisabled));
}

function updateAddGradeRuleButtonState(form) {
  const button = form?.querySelector("[data-add-grade-rule-row]");
  const rowCount = form?.querySelectorAll(".grade-rule-table .rule-table-row").length || 0;
  if (!button) {
    return;
  }

  const isDisabled = form.dataset.ruleEnabled === "false" || rowCount >= MAX_GRADE_RULE_ROWS;
  button.disabled = isDisabled;
  button.setAttribute("aria-disabled", String(isDisabled));
}

function updateRuleFormEnabledState(form) {
  const isDisabled = form?.dataset.ruleEnabled === "false";
  if (!form) {
    return;
  }

  form.querySelectorAll(".test-rule-table input, [data-reset-test-rule], [data-delete-test-rule-row], button[type='submit']").forEach((control) => {
    control.disabled = isDisabled;
  });
}

function setPointRuleFormBaseline(form) {
  if (!form) {
    return;
  }

  form.dataset.savedState = serializePointRuleForm(form);
  updatePointRuleDirtyState(form);
}

function updatePointRuleDirtyState(form) {
  if (!form) {
    return false;
  }

  const isDirty = form.dataset.savedState !== serializePointRuleForm(form);
  form.dataset.dirty = isDirty ? "true" : "false";
  return isDirty;
}

function serializePointRuleForm(form) {
  const rows = Array.from(form?.querySelectorAll(".rule-table-row") || []);
  return JSON.stringify({
    subjectId: form?.dataset.subjectId || "",
    ruleType: form?.dataset.ruleType || "",
    enabled: form?.dataset.ruleEnabled || "true",
    rows: rows.map((row) => ({
      id: row.querySelector('[name^="id-"]')?.value || "",
      label: row.querySelector('[name^="label-"]')?.value || "",
      score: row.querySelector('[name^="score-"]')?.value || "",
      rank: row.querySelector('[name^="rank-"]')?.value || "",
      operator: row.querySelector('[name^="operator-"]')?.value || "",
      points: row.querySelector('[name^="points-"]')?.value || "",
    })),
  });
}

function hasUnsavedPointRuleChanges() {
  return Array.from(document.querySelectorAll(".point-rule-form")).some((form) => updatePointRuleDirtyState(form));
}

function shouldConfirmPointRuleLeave(nextPath) {
  if (!state.route.endsWith("/rules") || nextPath === state.route) {
    return false;
  }

  if (document.querySelector("#point-rule-leave-modal")) {
    return false;
  }

  return hasUnsavedPointRuleChanges();
}

function showPointRuleLeaveModal(nextPath, onConfirm = null, confirmLabel = "移動する") {
  document.querySelector("#point-rule-leave-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal";
  modal.id = "point-rule-leave-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="point-rule-leave-title">
      <h2 id="point-rule-leave-title">保存していない変更があります</h2>
      <p>このまま進むと、保存していないポイント基準の変更は反映されません。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-point-rule-leave">${escapeHtml(confirmLabel)}</button>
        <button class="secondary-button" type="button" id="cancel-point-rule-leave">この画面に戻る</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-point-rule-leave")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-point-rule-leave")?.addEventListener("click", () => {
    closeModal();
    if (typeof onConfirm === "function") {
      onConfirm();
      return;
    }

    location.hash = nextPath;
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function showPointRuleSavedModal() {
  document.querySelector("#point-rule-saved-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal";
  modal.id = "point-rule-saved-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel point-rule-saved-modal-panel" role="dialog" aria-modal="true" aria-labelledby="point-rule-saved-title">
      <h2 id="point-rule-saved-title">保存しました</h2>
      <p>ポイント基準の変更を保存しました。</p>
      <div class="confirm-actions">
        <button class="primary-button" type="button" id="confirm-point-rule-saved">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#confirm-point-rule-saved")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function getMaxTestRuleRows(ruleType) {
  return ruleType === "test_50" ? 6 : 11;
}

function validateTestRuleForm(form) {
  if (form?.dataset.ruleCategory === "grade") {
    return validateGradeRuleForm(form);
  }

  const rankTable = form?.querySelector(".rank-rule-table");
  if (rankTable) {
    return validateRankRuleForm(form);
  }

  const table = form?.querySelector(".test-rule-table");
  const rows = Array.from(table?.querySelectorAll(".rule-table-row") || []);
  if (!rows.length) {
    return true;
  }

  let isValid = true;
  rows.forEach((row, index) => {
    const scoreInput = row.querySelector('input[name^="score-"]:not([type="hidden"])');
    const pointsInput = row.querySelector('input[name^="points-"]');

    if (scoreInput) {
      const value = getInputNumber(scoreInput);
      const upperScore = getRuleRowNumber(rows[index - 1], "score");
      const lowerScore = getNextEditableRuleScore(rows, index);
      const message =
        value == null
          ? "点数を入力してください"
          : upperScore != null && value >= upperScore
            ? `上の点数（${upperScore}点）より小さくしてください`
            : lowerScore != null && value <= lowerScore
              ? `下の点数（${lowerScore}点）より大きくしてください`
              : value < 0
                ? "0以上で入力してください"
                : "";
      setRuleInputError(scoreInput, message);
      isValid = isValid && !message;
    }

    if (pointsInput) {
      const value = getInputNumber(pointsInput);
      const upperPoints = getRuleRowNumber(rows[index - 1], "points");
      const lowerPoints = getRuleRowNumber(rows[index + 1], "points");
      const message =
        value == null
          ? "ポイントを入力してください"
          : upperPoints != null && value >= upperPoints
            ? `上のポイント（${upperPoints}pt）より小さくしてください`
            : lowerPoints != null && value <= lowerPoints
              ? `下のポイント（${lowerPoints}pt）より大きくしてください`
              : value < 0
                ? "0以上で入力してください"
                : "";
      setRuleInputError(pointsInput, message);
      isValid = isValid && !message;
    }
  });

  return isValid;
}

function validateGradeRuleForm(form) {
  const rows = Array.from(form?.querySelectorAll(".grade-rule-table .rule-table-row") || []);
  if (!rows.length) {
    return true;
  }

  let isValid = true;
  rows.forEach((row) => {
    const labelInput = row.querySelector('input[name^="label-"]');
    const pointsInput = row.querySelector('input[name^="points-"]');

    if (labelInput) {
      const message = labelInput.value.trim() ? "" : "評価を入力してください";
      setRuleInputError(labelInput, message);
      isValid = isValid && !message;
    }

    if (pointsInput) {
      const value = getInputNumber(pointsInput);
      const message =
        value == null
          ? "ポイントを入力してください"
          : value < 0
            ? "0以上で入力してください"
            : "";
      setRuleInputError(pointsInput, message);
      isValid = isValid && !message;
    }
  });

  return isValid;
}

function validateRankRuleForm(form) {
  const rows = Array.from(form?.querySelectorAll(".rank-rule-table .rule-table-row") || []);
  if (!rows.length) {
    return true;
  }

  let isValid = true;
  rows.forEach((row, index) => {
    const rankInput = row.querySelector('input[name^="rank-"]:not([type="hidden"])');
    const pointsInput = row.querySelector('input[name^="points-"]');

    if (rankInput) {
      const value = getInputNumber(rankInput);
      const upperRank = getRuleRowNumber(rows[index - 1], "rank");
      const lowerRank = getNextEditableRuleRank(rows, index);
      const message =
        value == null
          ? "順位を入力してください"
          : upperRank != null && value <= upperRank
            ? `上の順位（${upperRank}位）より大きくしてください`
            : lowerRank != null && value >= lowerRank
              ? `下の順位（${lowerRank}位）より小さくしてください`
              : value < 1
                ? "1以上で入力してください"
                : "";
      setRuleInputError(rankInput, message);
      isValid = isValid && !message;
    }

    if (pointsInput) {
      const value = getInputNumber(pointsInput);
      const message =
        value == null
          ? "ポイントを入力してください"
          : value < 0
            ? "0以上で入力してください"
            : "";
      setRuleInputError(pointsInput, message);
      isValid = isValid && !message;
    }
  });

  return isValid;
}

function setRuleInputError(input, message) {
  const error = input?.closest(".rule-input-cell")?.querySelector("[data-rule-input-error]");
  if (!error) {
    return;
  }

  error.textContent = message || "";
  input.classList.toggle("input-error", Boolean(message));
}

function getInputNumber(input) {
  if (!input || input.value === "") {
    return null;
  }
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function getRuleRowNumber(row, field) {
  if (!row) {
    return null;
  }

  const input = row.querySelector(`input[name^="${field}-"]`);
  return getInputNumber(input);
}

function getNextEditableRuleScore(rows, index) {
  for (let i = index + 1; i < rows.length - 1; i += 1) {
    const score = getRuleRowNumber(rows[i], "score");
    if (score != null) {
      return score;
    }
  }
  return null;
}

function getNextEditableRuleRank(rows, index) {
  for (let i = index + 1; i < rows.length - 1; i += 1) {
    const rank = getRuleRowNumber(rows[i], "rank");
    if (rank != null) {
      return rank;
    }
  }
  return null;
}

function syncTestRuleBoundaryRow(table) {
  const rows = Array.from(table?.querySelectorAll(".rule-table-row") || []);
  if (rows.length < 2) {
    return;
  }

  const firstScore = getRuleRowNumber(rows[0], "score") || 0;
  const middleScores = rows
    .slice(1, -1)
    .map((row) => getRuleRowNumber(row, "score"))
    .filter((score) => score > 0 && score < firstScore);
  const boundaryScore = middleScores.length ? Math.min(...middleScores) : firstScore;
  const lastRow = rows[rows.length - 1];
  const fixedValue = lastRow.querySelector(".fixed-rule-value");
  const fixedScoreNumber = fixedValue?.querySelector("span");
  const hiddenScore = lastRow.querySelector('[name^="score-"]');

  if (fixedScoreNumber) {
    fixedScoreNumber.textContent = String(boundaryScore);
  } else if (fixedValue) {
    fixedValue.textContent = String(boundaryScore);
  }

  if (hiddenScore) {
    hiddenScore.value = String(boundaryScore);
  }
}

function syncRankRuleBoundaryRow(table) {
  const rows = Array.from(table?.querySelectorAll(".rule-table-row") || []);
  if (rows.length < 2) {
    return;
  }

  const middleRanks = rows
    .slice(1, -1)
    .map((row) => getRuleRowNumber(row, "rank"))
    .filter((rank) => rank > 1);
  const boundaryRank = middleRanks.length ? Math.max(...middleRanks) : 1;
  const lastRow = rows[rows.length - 1];
  const fixedValue = lastRow.querySelector(".fixed-rule-value");
  const fixedRankNumber = fixedValue?.querySelector("span");
  const hiddenRank = lastRow.querySelector('[name^="rank-"]');

  if (fixedRankNumber) {
    fixedRankNumber.textContent = String(boundaryRank);
  } else if (fixedValue) {
    fixedValue.textContent = String(boundaryRank);
  }

  if (hiddenRank) {
    hiddenRank.value = String(boundaryRank);
  }
}

function testRuleDynamicRowHtml(score = "", points = "") {
  const rowId = `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deleteLabel = score === "" ? "追加した条件を削除" : `${score}点以上の欄を削除`;
  return `
    <div class="rule-input-cell">
      <div class="rule-input-unit-row">
        <input type="number" name="score-${rowId}" inputmode="numeric" step="1" value="${score}" />
        <span class="rule-input-unit">点</span>
      </div>
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <span class="fixed-rule-value">以上</span><input type="hidden" name="operator-${rowId}" value="以上" />
    <div class="rule-input-cell">
      <div class="rule-input-unit-row">
        <input type="number" name="points-${rowId}" inputmode="numeric" step="1" value="${points}" />
        <span class="rule-input-unit">pt</span>
      </div>
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <button class="rule-row-delete-button" type="button" data-delete-test-rule-row aria-label="${deleteLabel}">
      ${studyPayIcon("trash-2", "rule-row-delete-icon")}
    </button>
  `;
}

function rankRuleDynamicRowHtml(rank = "", points = "") {
  const rowId = `rank-custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deleteLabel = rank === "" ? "追加した条件を削除" : `${rank}位以内の条件を削除`;
  return `
    <div class="rule-input-cell">
      <div class="rule-input-unit-row">
        <input type="number" name="rank-${rowId}" inputmode="numeric" step="1" value="${rank}" />
        <span class="rule-input-unit">位</span>
      </div>
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <span class="fixed-rule-value rank-rule-condition">以内</span><input type="hidden" name="operator-${rowId}" value="以内" />
    <div class="rule-input-cell">
      <div class="rule-input-unit-row">
        <input type="number" name="points-${rowId}" inputmode="numeric" step="1" value="${points}" />
        <span class="rule-input-unit">pt</span>
      </div>
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <button class="rule-row-delete-button" type="button" data-delete-rank-rule-row aria-label="${deleteLabel}">
      ${studyPayIcon("trash-2", "rule-row-delete-icon")}
    </button>
  `;
}

function gradeRuleDynamicRowHtml(label = "", points = "") {
  const rowId = `grade-custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `
    <input type="hidden" name="id-${rowId}" value="${rowId}" />
    <div class="rule-input-cell">
      <input name="label-${rowId}" value="${escapeHtml(label)}" autocomplete="off" />
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <div class="rule-input-cell">
      <input name="points-${rowId}" inputmode="numeric" value="${points}" />
      <span class="rule-input-error" data-rule-input-error></span>
    </div>
    <button class="rule-row-delete-button" type="button" data-delete-grade-rule-row aria-label="${escapeHtml(label || "追加した条件")}を削除">
      ${studyPayIcon("trash-2", "rule-row-delete-icon")}
    </button>
  `;
}

function showOtherTaskCategoryModal(child) {
  document.querySelector("#other-task-category-modal")?.remove();
  const colorPresets = getOtherTaskCategoryColorPresets();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal rule-subject-modal";
  modal.id = "other-task-category-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="other-task-category-modal-title">
      <h2 id="other-task-category-modal-title">カテゴリー追加</h2>
      <form class="form parent-switch-form" id="other-task-category-form">
        <div class="field">
          <label for="other-task-category-name-input">カテゴリー名</label>
          <input id="other-task-category-name-input" name="categoryName" autocomplete="off" placeholder="例: 運動" required />
        </div>
        <div class="field">
          <span class="field-label">背景色</span>
          <div class="category-color-grid" data-category-color-group="background">
            ${colorPresets.map((color, index) => `
              <label class="category-color-swatch" style="background:${escapeHtml(color)};">
                <input type="radio" name="backgroundColor" value="${escapeHtml(color)}" ${index === 0 ? "checked" : ""} />
                <span></span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="error" id="other-task-category-error"></div>
        <button class="primary-button" type="submit">追加する</button>
        <button class="secondary-button" type="button" id="cancel-other-task-category">キャンセル</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  const closeModalAndRestoreTask = () => {
    closeModal();
    document.querySelector("#other-task-modal")?.classList.remove("is-temporarily-hidden");
  };
  document.querySelector("#cancel-other-task-category")?.addEventListener("click", closeModalAndRestoreTask);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModalAndRestoreTask();
    }
  });

  const input = document.querySelector("#other-task-category-name-input");
  input?.focus();

  bindCategoryColorPalette(modal);

  document.querySelector("#other-task-category-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const categoryName = String(formData.get("categoryName") || "").trim();
    const backgroundColor = normalizeColorCode(String(formData.get("backgroundColor") || "#2ecb89"));
    const textColor = "#ffffff";
    const error = document.querySelector("#other-task-category-error");
    const categories = getOtherTaskCategories(child);

    if (!categoryName) {
      error.textContent = "カテゴリー名を入力してください。";
      return;
    }

    if (categories.some((category) => category.name === categoryName)) {
      error.textContent = "同じ名前のカテゴリーがあります。";
      return;
    }

    addOtherTaskCategory(child.id, { name: categoryName, backgroundColor, textColor });
    closeModal();
    render();
  });
}

function showOtherTaskDeleteModal(child, task) {
  document.querySelector("#other-task-delete-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal child-delete-modal";
  modal.id = "other-task-delete-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="other-task-delete-title">
      <h2 id="other-task-delete-title">タスクを削除しますか？</h2>
      <p class="fine-print">「${escapeHtml(task.name)}」を削除します。この操作は元に戻せません。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-other-task-delete">削除する</button>
        <button class="secondary-button" type="button" id="cancel-other-task-delete">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-other-task-delete")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-other-task-delete")?.addEventListener("click", () => {
    deleteOtherPointTask(child.id, task.id);
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function bindCategoryColorPalette(modal) {
  const syncCategoryNameInputColor = (color) => {
    const nameInput = modal.querySelector("#other-task-category-name-input");
    if (nameInput) {
      nameInput.style.backgroundColor = color;
    }
  };
  syncCategoryNameInputColor(modal.querySelector('input[name="backgroundColor"]:checked')?.value || "#2ecb89");

  modal.querySelectorAll(".category-color-swatch input").forEach((input) => {
    input.addEventListener("change", () => {
      syncCategoryNameInputColor(input.value);
    });
  });
}

function normalizeColorCode(value) {
  const trimmed = String(value || "").trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : "#f47b20";
}

function showRuleSubjectModal(child, subject = null) {
  document.querySelector("#rule-subject-modal")?.remove();
  const isEditing = Boolean(subject);
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal rule-subject-modal";
  modal.id = "rule-subject-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="rule-subject-modal-title">
      <h2 id="rule-subject-modal-title">${isEditing ? "科目名を変更" : "科目を追加"}</h2>
      <form class="form parent-switch-form" id="rule-subject-form">
        <div class="field">
          <label for="rule-subject-name-input">科目名</label>
          <input id="rule-subject-name-input" name="subjectName" autocomplete="off" value="${escapeHtml(subject?.name || "")}" placeholder="例: 理科" required />
        </div>
        <div class="error" id="rule-subject-error"></div>
        <button class="primary-button" type="submit">${isEditing ? "保存する" : "追加する"}</button>
        <button class="secondary-button" type="button" id="cancel-rule-subject">キャンセル</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-rule-subject")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  const input = document.querySelector("#rule-subject-name-input");
  input?.focus();
  input?.select();

  document.querySelector("#rule-subject-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const subjectName = String(new FormData(event.currentTarget).get("subjectName") || "").trim();
    const error = document.querySelector("#rule-subject-error");
    const subjects = getActiveSubjects(child);

    if (!subjectName) {
      error.textContent = "科目名を入力してください。";
      return;
    }

    if (subjects.some((item) => item.id !== subject?.id && item.name === subjectName)) {
      error.textContent = "同じ名前の科目があります。";
      return;
    }

    if (isEditing) {
      const nextSubjects = (child.subjects || []).map((item) =>
        item.id === subject.id ? { ...item, name: subjectName, updatedAt: new Date().toISOString() } : item,
      );
      updateChild(child.id, { subjects: nextSubjects, ruleEditorSubjectId: subject.id });
    } else {
      const subjectId = `subject-${Date.now()}`;
      const nextSubjects = [
        ...(child.subjects || []),
        {
          id: subjectId,
          name: subjectName,
          sortOrder: subjects.length + 1,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      ];
      updateChild(child.id, { subjects: nextSubjects, ruleEditorSubjectId: subjectId });
    }

    closeModal();
    render();
  });
}

function showRuleSubjectDeleteModal(child, subject) {
  document.querySelector("#rule-subject-delete-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal rule-subject-modal";
  modal.id = "rule-subject-delete-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="rule-subject-delete-title">
      <h2 id="rule-subject-delete-title">${escapeHtml(subject.name)}を削除しますか？</h2>
      <p>今後の申請やルール設定では選べなくなります。過去の申請履歴に保存された科目名はそのまま残ります。</p>
      <div class="confirm-actions">
        <button class="danger-button child-delete-modal-confirm" type="button" id="confirm-rule-subject-delete">削除する</button>
        <button class="secondary-button" type="button" id="cancel-rule-subject-delete">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-rule-subject-delete")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-rule-subject-delete")?.addEventListener("click", () => {
    const nextSubjects = (child.subjects || []).map((item) =>
      item.id === subject.id ? { ...item, status: "deleted", deletedAt: new Date().toISOString() } : item,
    );
    const nextSelectedSubject = getActiveSubjects({ ...child, subjects: nextSubjects })[0];
    updateChild(child.id, {
      subjects: nextSubjects,
      ruleEditorSubjectId: nextSelectedSubject?.id || "",
    });
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function showRuleResetModal(child, subjectId, ruleType) {
  const defaultSettings = getDefaultPointRuleSettings(ruleType);
  if (!defaultSettings.length) {
    return;
  }

  document.querySelector("#rule-reset-modal")?.remove();
  const modal = document.createElement("div");
  const ruleTitle =
    ruleType === "test_rank"
      ? "順位基準"
      : ruleType === "test_50"
        ? "50点満点用"
        : "100点満点用";
  modal.className = "parent-switch-modal rule-reset-modal";
  modal.id = "rule-reset-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="rule-reset-title">
      <h2 id="rule-reset-title">${ruleTitle}をデフォルトに戻しますか？</h2>
      <p>現在入力している内容は、デフォルト設定に置き換わります。この操作を行うと、未保存の変更も消えます。</p>
      <div class="confirm-actions">
        <button class="primary-button" type="button" id="confirm-rule-reset">デフォルトに戻す</button>
        <button class="secondary-button" type="button" id="cancel-rule-reset">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.querySelector("#cancel-rule-reset")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-rule-reset")?.addEventListener("click", () => {
    updateSubjectPointRule(child.id, subjectId, ruleType, defaultSettings);
    state.flash = "デフォルト設定に戻しました。";
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
}

function showApplyRuleToSubjectsModal(child, form) {
  const settings = collectPointRuleSettings(form);
  if (!settings) {
    return;
  }

  const subjects = getActiveSubjects(child);
  const targetSubjects = subjects.filter((subject) => subject.id !== form.dataset.subjectId);
  const targetCount = targetSubjects.length;
  if (!targetCount) {
    state.flash = "適用できる他の科目がありません。";
    render();
    return;
  }

  document.querySelector("#apply-rule-subjects-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "parent-switch-modal rule-reset-modal";
  modal.id = "apply-rule-subjects-modal";
  modal.innerHTML = `
    <div class="parent-switch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="apply-rule-subjects-title">
      <h2 id="apply-rule-subjects-title">他の科目にも適用しますか？</h2>
      <p>現在の基準を、選択した科目に適用します。各科目で設定済みの同じ基準は置き換わります。</p>
      <div class="field apply-rule-subject-field">
        <span class="field-label">どの科目に適用しますか？</span>
        <div class="rule-subject-picker apply-rule-subject-picker">
          <button class="rule-subject-trigger" type="button" id="apply-rule-subject-trigger" aria-haspopup="menu" aria-expanded="false">
            <span id="apply-rule-subject-label">すべて</span>
            ${studyPayIcon("chevron-down", "rule-subject-trigger-icon")}
          </button>
          <div class="rule-subject-menu apply-rule-subject-menu" id="apply-rule-subject-menu" role="menu" hidden>
            <div class="rule-subject-option-row active">
              <button class="rule-subject-option-name" type="button" role="menuitem" data-apply-rule-subject-option="__all__">すべて</button>
            </div>
            ${targetSubjects.map((subject) => `
              <div class="rule-subject-option-row">
                <button class="rule-subject-option-name" type="button" role="menuitem" data-apply-rule-subject-option="${escapeHtml(subject.id)}">
                  ${escapeHtml(subject.name)}
                </button>
              </div>
            `).join("")}
          </div>
        </div>
        <input type="hidden" id="apply-rule-subject-value" value="__all__" />
      </div>
      <div class="confirm-actions">
        <button class="primary-button" type="button" id="confirm-apply-rule-subjects">適用する</button>
        <button class="secondary-button" type="button" id="cancel-apply-rule-subjects">キャンセル</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  const applySubjectTrigger = document.querySelector("#apply-rule-subject-trigger");
  const applySubjectMenu = document.querySelector("#apply-rule-subject-menu");
  applySubjectTrigger?.addEventListener("click", () => {
    if (!applySubjectMenu) {
      return;
    }

    applySubjectMenu.hidden = !applySubjectMenu.hidden;
    applySubjectTrigger.setAttribute("aria-expanded", String(!applySubjectMenu.hidden));
  });
  document.querySelectorAll("[data-apply-rule-subject-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.applyRuleSubjectOption || "__all__";
      const label = button.textContent.trim() || "すべて";
      document.querySelector("#apply-rule-subject-value").value = value;
      document.querySelector("#apply-rule-subject-label").textContent = label;
      document.querySelectorAll("#apply-rule-subject-menu .rule-subject-option-row").forEach((row) => {
        row.classList.toggle("active", row.contains(button));
      });
      applySubjectMenu.hidden = true;
      applySubjectTrigger?.setAttribute("aria-expanded", "false");
    });
  });
  document.querySelector("#cancel-apply-rule-subjects")?.addEventListener("click", closeModal);
  document.querySelector("#confirm-apply-rule-subjects")?.addEventListener("click", () => {
    const selectedSubjectId = document.querySelector("#apply-rule-subject-value")?.value || "__all__";
    updatePointRuleForOtherSubjects(child.id, form.dataset.subjectId, form.dataset.ruleType, settings, selectedSubjectId);
    state.flash = selectedSubjectId === "__all__" ? "他の科目にも適用しました。" : "選択した科目に適用しました。";
    closeModal();
    render();
  });
  modal.addEventListener("click", (event) => {
    if (applySubjectMenu && !applySubjectMenu.hidden && !event.target.closest(".apply-rule-subject-picker")) {
      applySubjectMenu.hidden = true;
      applySubjectTrigger?.setAttribute("aria-expanded", "false");
    }

    if (event.target === modal) {
      closeModal();
    }
  });
}

function bindChildApply(child, editingApplication = null) {
  bindChildShell();
  const applicationForm = document.querySelector("#application-form");
  const categorySelect = document.querySelector("#application-category");
  const subjectSelect = document.querySelector("#application-subject");
  const subjectField = subjectSelect?.closest(".field");
  const fullScoreField = document.querySelector("#test-full-score-field");
  const fullScoreSelect = document.querySelector("#test-full-score");
  const testMethodInput = document.querySelector("#test-method");
  const photoInput = document.querySelector("#application-photos");
  const photoHelp = document.querySelector("#photo-help");
  const scoreInput = document.querySelector("#test-score");
  const scoreError = document.querySelector("#test-score-error");
  const rankInput = document.querySelector("#test-rank");
  const rankError = document.querySelector("#test-rank-error");
  if (applicationForm) {
    applicationForm.noValidate = true;
  }
  ensureChildApplyPhotoDesign(editingApplication);
  ensureChildApplyOtherTaskDropdown(child);

  const clearScoreError = () => {
    if (scoreError) {
      scoreError.textContent = "";
    }
    scoreInput?.classList.remove("input-error");
  };
  const clearRankError = () => {
    if (rankError) {
      rankError.textContent = "";
    }
    rankInput?.classList.remove("input-error");
  };
  function getSelectedTestMethod() {
    return testMethodInput?.value === "rank" ? "rank" : "score";
  }
  function syncPhotoHelp() {
    if (!photoHelp) {
      return;
    }

    if (categorySelect.value === "other") {
      photoHelp.textContent = "その他は写真なしでも申請できます。写真がある場合は3枚まで追加できます。";
      return;
    }

    if (categorySelect.value === "test" && getSelectedTestMethod() === "rank") {
      photoHelp.textContent = "順位基準は写真なしでも申請できます。写真がある場合は3枚まで追加できます。";
      return;
    }

    photoHelp.textContent = "テスト・成績は写真が必須です。1〜3枚まで追加できます。";
  }
  const syncTestMethodFields = () => {
    const method = getSelectedTestMethod();
    const currentScoreField = document.querySelector("#test-score")?.closest(".field");
    const currentRankField = document.querySelector("#test-rank")?.closest(".field");
    const currentPhotoField = document.querySelector("#application-photos")?.closest(".field");
    const currentFullScoreField = document.querySelector("#test-full-score")?.closest(".field");
    document.querySelectorAll("[data-child-test-method]").forEach((button) => {
      const isActive = button.dataset.childTestMethod === method;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    currentScoreField?.classList.toggle("hidden", method !== "score");
    currentRankField?.classList.toggle("hidden", method !== "rank");
    currentPhotoField?.classList.toggle("hidden", categorySelect.value === "test" && method === "rank");
    if (currentFullScoreField) {
      currentFullScoreField.classList.toggle("hidden", method === "rank" || Boolean(fullScoreSelect?.disabled));
    }
    if (method === "score") {
      if (rankInput) {
        rankInput.value = "";
      }
      clearRankError();
    } else {
      if (scoreInput) {
        scoreInput.value = "";
      }
      clearScoreError();
    }
    syncPhotoHelp();
  };
  const syncGradeEvaluations = () => {
    const field = document.querySelector("#grade-evaluation-field");
    if (!field) {
      return;
    }
    field.innerHTML = gradeEvaluationSelect(child, subjectSelect.value, editingApplication);
  };
  const syncTestFullScoreField = () => {
    if (!fullScoreField || !fullScoreSelect) {
      return;
    }

    const shouldShow =
      Number(editingApplication?.testFullScore) === 50 || isPointRuleEnabled(child, subjectSelect.value, "test_50");
    fullScoreField.classList.toggle("hidden", !shouldShow);
    fullScoreSelect.disabled = !shouldShow;
    if (!shouldShow) {
      fullScoreSelect.value = "100";
    }
  };
  const syncSections = () => {
    document.querySelectorAll("[data-apply-section]").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.applySection !== categorySelect.value);
    });
    subjectField?.classList.toggle("hidden", categorySelect.value === "other");
    syncTestFullScoreField();
    syncTestMethodFields();
    photoInput.required = false;
    syncPhotoHelp();
    syncGradeEvaluations();
  };
  categorySelect.addEventListener("change", syncSections);
  subjectSelect.addEventListener("change", () => {
    syncTestFullScoreField();
    syncTestMethodFields();
    syncGradeEvaluations();
  });
  applicationForm.addEventListener("click", (event) => {
    const fullScoreButton = event.target.closest("[data-score-value]");
    if (fullScoreButton && applicationForm.contains(fullScoreButton)) {
      event.preventDefault();
      if (fullScoreSelect && !fullScoreSelect.disabled) {
        fullScoreSelect.value = fullScoreButton.dataset.scoreValue || "100";
        fullScoreSelect.dispatchEvent(new Event("change", { bubbles: true }));
        applicationForm.querySelectorAll("[data-score-value]").forEach((item) => {
          item.classList.toggle("active", item === fullScoreButton);
        });
      }
      return;
    }

    const button = event.target.closest("[data-child-test-method]");
    if (!button || !applicationForm.contains(button)) {
      return;
    }

    event.preventDefault();
    if (testMethodInput) {
      testMethodInput.value = button.dataset.childTestMethod || "score";
    }
    syncTestMethodFields();
  });
  scoreInput?.addEventListener("input", clearScoreError);
  rankInput?.addEventListener("input", clearRankError);
  syncTestMethodFields();
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
    const selectedOtherTaskId = String(form.get("otherTaskId") || "");
    const selectedOtherTask = category === "other"
      ? getOtherPointTasks(child).find((task) => task.id === selectedOtherTaskId)
      : null;
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

    if (category === "other" && !selectedOtherTask) {
      error.textContent = "タスクを選んでください。";
      return;
    }

    const testMethod = String(form.get("testMethod") || "score") === "rank" ? "rank" : "score";
    const scoreText = String(form.get("score") || "").trim();
    const rankText = String(form.get("rank") || "").trim();
    if (category === "test" && testMethod === "score" && scoreText && !/^[0-9]+$/.test(scoreText)) {
      if (scoreError) {
        scoreError.textContent = "半角数字で入力してください";
      }
      scoreInput?.classList.add("input-error");
      return;
    }
    if (category === "test" && testMethod === "rank" && rankText && !/^[0-9]+$/.test(rankText)) {
      if (rankError) {
        rankError.textContent = "半角数字で入力してください";
      }
      rankInput?.classList.add("input-error");
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

    if (category !== "other" && !(category === "test" && testMethod === "rank") && totalPhotoCount < 1) {
      error.textContent = "写真を追加してください";
      return;
    }

    const uploadedPhotos = photos.length ? await readPhotoFiles(photos) : [];
    const nextPhotos = photos.length ? [...existingPhotos, ...uploadedPhotos] : existingPhotos;
    const nextPhotoNames = photos.length ? [...existingPhotoNames, ...Array.from(photos).map((file) => file.name)] : existingPhotoNames;
    const application = createApplication(child, {
      existingApplication: editingApplication,
      category,
      subject,
      testMethod,
      testFullScore: Number(form.get("testFullScore") || 100),
      score: testMethod === "score" ? Number(scoreText || 0) : null,
      rank: testMethod === "rank" ? Number(rankText || 0) : null,
      gradeType: category === "grade" ? "grade_5" : "",
      gradeEvaluationId: String(form.get("gradeEvaluationId") || ""),
      otherTaskId: selectedOtherTask?.id || "",
      otherContent: selectedOtherTask?.name || "",
      requestedPoints: selectedOtherTask ? Number(selectedOtherTask.points || 0) : null,
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

function ensureChildApplyPhotoDesign(editingApplication = null) {
  const photoInput = document.querySelector("#application-photos");
  const photoField = photoInput?.closest(".field");
  if (!photoInput || !photoField || photoField.querySelector(".child-photo-drop")) {
    return;
  }

  photoField.classList.add("child-photo-field");
  photoField.querySelector("#photo-help")?.remove();
  photoInput.classList.add("child-photo-hidden-input");
  photoInput.dataset.childPhotoInput = "library";
  photoInput.setAttribute("accept", "image/*");
  photoInput.setAttribute("multiple", "");
  const useNativeIOSPhotoPicker = isIOSNativePhotoPickerDevice();

  const cameraInput = document.createElement("input");
  cameraInput.className = "child-photo-hidden-input";
  cameraInput.type = "file";
  cameraInput.accept = "image/*";
  cameraInput.setAttribute("capture", "environment");
  cameraInput.dataset.childPhotoInput = "camera";
  cameraInput.tabIndex = -1;

  const drop = document.createElement("button");
  drop.className = "child-photo-drop";
  drop.type = "button";
  drop.setAttribute("aria-label", "写真を選択");
  drop.innerHTML = `<span class="child-photo-lucide-icon" aria-hidden="true">${studyPayIcon("camera", "child-photo-svg")}</span>`;
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
  if (useNativeIOSPhotoPicker) {
    menu.remove();
  } else {
    menu.querySelector('[data-child-photo-action="camera"]')?.appendChild(cameraInput);
    menu.querySelector('[data-child-photo-action="library"]')?.appendChild(photoInput);
  }

  window.__studyPayExistingPhotos = [...(editingApplication?.photos || [])];
  window.__studyPayExistingPhotoNames = [...(editingApplication?.photoNames || [])];
  window.__studyPaySelectedPhotoFiles = [];
  photoInput._studyPayExistingPhotos = window.__studyPayExistingPhotos;
  photoInput._studyPayExistingPhotoNames = window.__studyPayExistingPhotoNames;
  photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;

  const closePhotoMenu = () => {
    menu.hidden = true;
  };
  const renderPreview = async () => {
    const existingPhotos = (window.__studyPayExistingPhotos || []).map((photo, index) => ({
      dataUrl: photo.dataUrl,
      name: photo.name,
      photoType: "existing",
      sourceIndex: index,
    }));
    const selectedPhotos = await Promise.all(
      (window.__studyPaySelectedPhotoFiles || []).slice(0, 3).map(
        (file, index) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                dataUrl: String(reader.result || ""),
                name: file.name,
                photoType: "selected",
                sourceIndex: index,
              });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const photos = [...existingPhotos, ...selectedPhotos.filter(Boolean)].slice(0, 3);
    preview.innerHTML = photos
      .map(
        (photo) => `
          <span class="child-photo-preview-item">
            <img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.name || "選択した写真")}" />
            <button class="child-photo-remove-button" type="button" data-photo-type="${escapeHtml(photo.photoType)}" data-photo-index="${Number(photo.sourceIndex)}" aria-label="写真を削除">×</button>
          </span>
        `,
      )
      .join("");
    drop.classList.toggle("is-hidden", photos.length > 0);
    if (photos.length > 0 && photos.length < 3) {
      preview.insertAdjacentHTML(
        "beforeend",
        `<button class="child-photo-preview-add" type="button" data-child-photo-open aria-label="写真を追加">${studyPayIcon("camera", "child-photo-preview-add-icon")}</button>`,
      );
    }
  };
  const handleInputChange = async (input) => {
    const incomingFiles = Array.from(input.files || []);
    if (incomingFiles.length) {
      const existingCount = (window.__studyPayExistingPhotos || []).length;
      window.__studyPaySelectedPhotoFiles = [...(window.__studyPaySelectedPhotoFiles || []), ...incomingFiles].slice(
        0,
        Math.max(0, 3 - existingCount),
      );
      photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;
      input.value = "";
    }
    closePhotoMenu();
    await renderPreview();
  };

  drop.addEventListener("click", (event) => {
    event.preventDefault();
    if (useNativeIOSPhotoPicker) {
      photoInput.click();
      return;
    }
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (event) => {
    if (!photoField.contains(event.target)) {
      closePhotoMenu();
    }
  });
  photoInput.addEventListener("change", () => handleInputChange(photoInput));
  cameraInput.addEventListener("change", () => handleInputChange(cameraInput));
  preview.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-child-photo-open]");
    if (openButton) {
      event.preventDefault();
      if (useNativeIOSPhotoPicker) {
        photoInput.click();
        return;
      }
      menu.hidden = !menu.hidden;
      return;
    }

    const removeButton = event.target.closest(".child-photo-remove-button");
    if (!removeButton) {
      return;
    }

    const index = Number(removeButton.dataset.photoIndex);
    if (removeButton.dataset.photoType === "existing") {
      window.__studyPayExistingPhotos = (window.__studyPayExistingPhotos || []).filter((_, itemIndex) => itemIndex !== index);
      window.__studyPayExistingPhotoNames = (window.__studyPayExistingPhotoNames || []).filter((_, itemIndex) => itemIndex !== index);
      photoInput._studyPayExistingPhotos = window.__studyPayExistingPhotos;
      photoInput._studyPayExistingPhotoNames = window.__studyPayExistingPhotoNames;
    } else {
      window.__studyPaySelectedPhotoFiles = (window.__studyPaySelectedPhotoFiles || []).filter((_, itemIndex) => itemIndex !== index);
      photoInput._studyPayFiles = window.__studyPaySelectedPhotoFiles;
    }
    await renderPreview();
  });

  renderPreview();
}

function isIOSNativePhotoPickerDevice() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

function ensureChildApplyOtherTaskDropdown(child) {
  const select = document.querySelector("#other-task-id");
  const field = select?.closest(".field");
  if (!select || !field) {
    return;
  }

  field.classList.add("child-apply-dropdown-field");
  field.querySelector(".child-apply-dropdown")?.remove();

  const tasks = sortOtherTasksByCategory(getOtherPointTasks(child), getOtherTaskCategories(child));
  const renderTaskContent = (taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      const fallback = select.options[select.selectedIndex]?.textContent?.trim() || "";
      return `<span class="child-task-option-content"><span class="child-task-name">${escapeHtml(fallback)}</span></span>`;
    }

    const category = getDefaultOtherTaskCategory(task.category || "その他");
    return `
      <span class="child-task-option-content">
        <span class="child-task-category-tag" style="background:${escapeHtml(category.backgroundColor)};color:${escapeHtml(category.textColor || "#ffffff")};">${escapeHtml(category.name)}</span>
        <span class="child-task-name">${escapeHtml(task.name)}</span>
        <span class="child-task-points">${Number(task.points || 0).toLocaleString()}pt</span>
      </span>
    `;
  };

  const dropdown = document.createElement("div");
  dropdown.className = "child-apply-dropdown child-apply-task-dropdown";
  dropdown.innerHTML = `
    <button class="child-apply-dropdown-trigger" type="button" aria-haspopup="menu" aria-expanded="false">
      ${renderTaskContent(select.value)}
      ${studyPayIcon("chevron-down", "child-apply-dropdown-icon")}
    </button>
    <div class="child-apply-dropdown-menu" role="menu" hidden>
      ${tasks
        .map(
          (task) => `
            <button class="child-apply-dropdown-option ${task.id === select.value ? "active" : ""}" type="button" role="menuitem" data-select-value="${escapeHtml(task.id)}">
              ${renderTaskContent(task.id)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
  select.insertAdjacentElement("afterend", dropdown);

  const trigger = dropdown.querySelector(".child-apply-dropdown-trigger");
  const menu = dropdown.querySelector(".child-apply-dropdown-menu");
  const closeMenu = () => {
    if (!menu || !trigger) {
      return;
    }
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !menu.hidden;
    document.querySelectorAll(".child-apply-dropdown-menu").forEach((item) => {
      if (item !== menu) {
        item.hidden = true;
        item.closest(".child-apply-dropdown")?.querySelector(".child-apply-dropdown-trigger")?.setAttribute("aria-expanded", "false");
      }
    });
    menu.hidden = isOpen;
    trigger.setAttribute("aria-expanded", String(!isOpen));
  });

  menu?.querySelectorAll("[data-select-value]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      select.value = button.dataset.selectValue || "";
      trigger.innerHTML = `${renderTaskContent(select.value)}${studyPayIcon("chevron-down", "child-apply-dropdown-icon")}`;
      menu.querySelectorAll(".child-apply-dropdown-option").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      closeMenu();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.addEventListener("click", (event) => {
    if (!field.contains(event.target)) {
      closeMenu();
    }
  });
}

function bindChildRedeem(child) {
  bindChildShell();
  const form = document.querySelector("#redemption-form");
  const itemSelect = document.querySelector("#redemption-item");
  const itemDetail = document.querySelector("#exchange-item-detail");
  const exchangeItems = getChildExchangeItemSettings(child);
  const syncExchangeItemDetail = () => {
    const selectedIndex = Number(itemSelect?.selectedOptions?.[0]?.dataset.exchangeItemIndex || 0);
    if (itemDetail) {
      itemDetail.textContent = formatExchangeItemDetail(exchangeItems[selectedIndex]);
    }
  };

  itemSelect?.addEventListener("change", syncExchangeItemDetail);
  syncExchangeItemDetail();

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const points = Number(String(formData.get("points") || "").replaceAll(",", ""));
    const itemName = String(formData.get("itemName") || getChildExchangeItems(child)[0] || "おこづかい").trim();
    const selectedIndex = Number(itemSelect?.selectedOptions?.[0]?.dataset.exchangeItemIndex || 0);
    const selectedItem = exchangeItems[selectedIndex] || exchangeItems[0] || null;
    const itemPointUnit = Number(selectedItem?.points || child.redemptionUnit || 100);
    const error = document.querySelector("#redemption-error");

    if (!points || points > getAvailablePoints(child)) {
      error.textContent = "ポイントが足りません";
      return;
    }

    if (!Number.isInteger(points) || points % itemPointUnit !== 0) {
      error.textContent = `${itemPointUnit.toLocaleString()}ポイント単位で入力してください。`;
      return;
    }

    if (!itemName) {
      error.textContent = "交換アイテムを選択してください。";
      return;
    }

    const redemption = {
      id: `redemption-${Date.now()}`,
      childId: child.id,
      points,
      itemName,
      exchangeValue: calculateExchangeValueForPoints(selectedItem, points),
      exchangeUnit: String(selectedItem?.unit || "円"),
      status: "pending",
      requestedAt: new Date().toISOString(),
      completedAt: null,
      rejectedAt: null,
    };
    updateChildWithoutParentLogin(child.id, {
      redemptions: [redemption, ...(child.redemptions || [])],
    });
    await syncCurrentAccountToCloud();
    showExchangeSubmittedModal();
  });
}

function showExchangeSubmittedModal() {
  document.querySelector("#exchange-submitted-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "child-complete-modal";
  modal.id = "exchange-submitted-modal";
  modal.innerHTML = `
    <div class="child-complete-modal-panel" role="dialog" aria-modal="true" aria-labelledby="exchange-submitted-title">
      <strong id="exchange-submitted-title">申請完了</strong>
      <p>交換申請を送りました。</p>
      <button class="primary-button child-complete-modal-button" type="button" id="exchange-submitted-ok">OK</button>
    </div>
  `;

  document.body.appendChild(modal);

  document.querySelector("#exchange-submitted-ok")?.addEventListener("click", () => {
    modal.remove();
    state.childHistoryType = "allowance";
    state.childHistoryFilter = "pending";
    state.childHistoryFilterTouched = true;
    navigate("/child/history");
  });
}

function bindChildHistory(child) {
  bindChildShell();
  bindPhotoViewer();
  document.querySelectorAll("[data-child-history-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.childHistoryType = button.dataset.childHistoryType || "points";
      state.childHistoryFilter = Number(button.dataset.pendingCount || 0) > 0 ? "pending" : "all";
      state.childHistoryFilterTouched = false;
      render();
      window.dispatchEvent(new CustomEvent("ince:child-rendered"));
    });
  });
  document.querySelectorAll("[data-child-history-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.childHistoryFilter = button.dataset.childHistoryFilter || "all";
      state.childHistoryFilterTouched = true;
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
  document.querySelector("#show-parent-cancel-modal")?.addEventListener("click", showParentCancelModal);
  bindParentEmailSettingsForm();
  bindParentPasswordSettingsForm();
}

function bindParentEmailSettingsForm() {
  document.querySelector("#parent-email-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const parent = loadAccount();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const error = document.querySelector("#parent-email-error");
    if (!parent) {
      error.textContent = "アカウント情報を確認できませんでした。";
      return;
    }
    if (!isValidEmail(email)) {
      error.textContent = "メールアドレスを確認してください。";
      return;
    }
    if (password !== parent.demoPassword) {
      error.textContent = "現在のパスワードが一致しません。";
      return;
    }

    saveAccount({
      ...parent,
      email,
    });
    state.flash = "メールアドレスを変更しました。";
    render();
  });
}

function bindParentPasswordSettingsForm() {
  document.querySelector("#parent-password-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const parent = loadAccount();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const newPasswordConfirm = String(form.get("newPasswordConfirm") || "");
    const error = document.querySelector("#parent-password-error");
    if (!parent) {
      error.textContent = "アカウント情報を確認できませんでした。";
      return;
    }
    if (currentPassword !== parent.demoPassword) {
      error.textContent = "現在のパスワードが一致しません。";
      return;
    }
    if (newPassword.length < 6) {
      error.textContent = "新しいパスワードは6文字以上で入力してください。";
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      error.textContent = "新しいパスワードが一致しません。";
      return;
    }

    saveAccount({
      ...parent,
      demoPassword: newPassword,
      passwordUpdatedAt: new Date().toISOString(),
    });
    state.flash = "パスワードを変更しました。";
    render();
  });
}

function bindParentExchangeUnitSettings() {
  bindParentShell();
  bindHomeExchangeUnitButtons();
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

function bindAdminSupabase() {
  bindAdminShell();
  const refreshButton = document.querySelector("#admin-supabase-refresh");
  refreshButton?.addEventListener("click", loadAdminSupabaseSnapshots);
  loadAdminSupabaseSnapshots();
}

async function loadAdminSupabaseSnapshots() {
  const status = document.querySelector("#admin-supabase-status");
  const content = document.querySelector("#admin-supabase-content");
  const refreshButton = document.querySelector("#admin-supabase-refresh");
  if (!status || !content) {
    return;
  }

  if (!canUseCloudStorage()) {
    status.textContent = "Supabase設定が読み込まれていません。";
    content.innerHTML = `<div class="notice-card">config.js のURLとpublishable keyを確認してください。</div>`;
    return;
  }

  const client = getSupabaseClient();
  status.textContent = "読み込み中...";
  content.innerHTML = "";
  if (refreshButton) {
    refreshButton.disabled = true;
  }

  try {
    const { data, error } = await client
      .from(SUPABASE_SNAPSHOT_TABLE)
      .select("email, snapshot, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    status.textContent = `${rows.length}件を表示しています。`;
    content.innerHTML = adminSupabaseTable(rows);
  } catch (error) {
    status.textContent = "読み込みに失敗しました。";
    content.innerHTML = `
      <div class="notice-card">
        ${escapeHtml(error.message || "Supabaseデータを取得できませんでした。")}
      </div>
    `;
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
    }
  }
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

function getChildBonusSettings(child) {
  if (!Array.isArray(child?.bonusSettings) && child?.id === "child-demo-mana") {
    return getDemoBonusSettings(new Date());
  }

  return [...(child?.bonusSettings || [])].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
}

function addBonusSetting({ childId, type, name, condition, conditionType, conditionDetails, points }) {
  const child = findChild(childId);
  if (!child) {
    return;
  }

  updateChild(childId, {
    bonusSettings: [
      ...getChildBonusSettings(child),
      {
        id: `bonus-setting-${Date.now()}`,
        type,
        name,
        condition,
        conditionType,
        conditionDetails,
        points: Number(points || 0),
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
  });
}

function deleteBonusSetting(childId, settingId) {
  const child = findChild(childId);
  if (!child) {
    return;
  }

  updateChild(childId, {
    bonusSettings: getChildBonusSettings(child).filter((setting) => setting.id !== settingId),
  });
}

function getOtherPointTasks(child) {
  return [...(child?.otherTasks || [])].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
}

function seedDefaultOtherTasksIfNeeded(child) {
  if (!child || child.defaultOtherTasksSeededAt) {
    return false;
  }

  const existingTasks = child.otherTasks || [];
  const existingKeys = new Set(existingTasks.map((task) => `${task.category || "その他"}:${task.name}`));
  const defaults = createDefaultOtherPointTasks(new Date()).filter((task) => !existingKeys.has(`${task.category}:${task.name}`));
  const availableSlots = Math.max(0, MAX_OTHER_POINT_TASKS - existingTasks.length);
  const tasksToAdd = defaults.slice(0, availableSlots);
  updateChild(child.id, {
    otherTasks: [...existingTasks, ...tasksToAdd],
    defaultOtherTasksSeededAt: new Date().toISOString(),
  });
  return true;
}

function getDefaultOtherTaskCategories() {
  return [
    { id: "other-category-help", name: "お手伝い", backgroundColor: "#fff7ed", textColor: "#f47b20" },
    { id: "other-category-study", name: "学習", backgroundColor: "#eef8ff", textColor: "#3279c8" },
    { id: "other-category-life", name: "生活", backgroundColor: "#f1f8ef", textColor: "#3f8f55" },
    { id: "other-category-other", name: "その他", backgroundColor: "#f3eee9", textColor: "#5c3b22" },
  ];
}

function createDefaultOtherPointTasks(now = new Date()) {
  const tasks = [
    ["学習", "宿題をやった"],
    ["学習", "○○分勉強した"],
    ["学習", "読書した"],
    ["お手伝い", "食器を洗った"],
    ["お手伝い", "洗濯物を畳んだ"],
    ["お手伝い", "自分の部屋の片付けをした"],
    ["お手伝い", "ゴミ出しをした"],
    ["お手伝い", "お風呂を洗った"],
    ["生活", "朝自分で起きた"],
    ["生活", "スマホ／ゲームの時間を守った"],
  ];
  return tasks.map(([category, name], index) => ({
    id: `other-task-default-${index + 1}`,
    category,
    name,
    points: 10,
    createdAt: getDateAfterMinutes(now, index).toISOString(),
  }));
}

function getOtherTaskCategoryColorPresets() {
  return ["#2ecb89", "#40bdc4", "#49aee9", "#9b887f", "#222222", "#ef3739", "#ec5a91", "#f97772", "#ffc02e", "#a77ed8"];
}

function getOtherTaskCategories(child) {
  const defaults = getDefaultOtherTaskCategories();
  const customCategories = child?.otherTaskCategories || [];
  return [
    ...defaults,
    ...customCategories.filter((category) => !defaults.some((defaultCategory) => defaultCategory.name === category.name)),
  ];
}

function getDefaultOtherTaskCategory(name) {
  return getDefaultOtherTaskCategories().find((category) => category.name === name) || getDefaultOtherTaskCategories().at(-1);
}

function addOtherTaskCategory(childId, category) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      return {
        ...child,
        otherTaskCategories: [
          ...(child.otherTaskCategories || []),
          {
            id: `other-category-${Date.now()}`,
            name: category.name,
            backgroundColor: category.backgroundColor,
            textColor: category.textColor,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }),
  };
  saveAccount(nextParent);
}

function addOtherPointTask(childId, task) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      return {
        ...child,
        otherTasks: [
          ...(child.otherTasks || []),
          {
            id: `other-task-${Date.now()}`,
            category: task.category || "その他",
            name: task.name,
            points: Number(task.points || 0),
            createdAt: new Date().toISOString(),
          },
        ],
        ruleOtherTaskFormOpen: false,
      };
    }),
  };
  saveAccount(nextParent);
}

function updateOtherPointTask(childId, taskId, updates) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      return {
        ...child,
        otherTasks: (child.otherTasks || []).map((task) =>
          task.id === taskId
            ? {
                ...task,
                category: updates.category || "その他",
                name: updates.name,
                points: Number(updates.points || 0),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
        ruleOtherTaskFormOpen: false,
        ruleOtherTaskEditingId: "",
      };
    }),
  };
  saveAccount(nextParent);
}

function deleteOtherPointTask(childId, taskId) {
  const parent = loadAccount();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      return {
        ...child,
        otherTasks: (child.otherTasks || []).filter((task) => task.id !== taskId),
        ruleOtherTaskFormOpen: false,
        ruleOtherTaskEditingId: "",
      };
    }),
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
              rank: updates.rank,
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
            route: "/child/exchange",
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
      readAt: parentNotificationSource(notification) === "system" ? notification.readAt || now : notification.readAt,
    })),
  });
}

function updateNotificationReadState({ owner, childId, notificationId, read }) {
  const parent = loadAccount();
  if (!parent || !notificationId) {
    return;
  }

  const readAt = read ? new Date().toISOString() : null;
  const updateNotification = (notification) =>
    notification.id === notificationId
      ? {
          ...notification,
          readAt,
        }
      : notification;
  const nextParent = owner === "child"
    ? {
        ...parent,
        children: (parent.children || []).map((child) =>
          child.id === childId
            ? {
                ...child,
                notifications: (child.notifications || []).map(updateNotification),
              }
            : child,
        ),
      }
    : {
        ...parent,
        notifications: (parent.notifications || []).map(updateNotification),
      };
  saveAccount(nextParent);
}

function deleteNotification({ owner, childId, notificationId }) {
  const parent = loadAccount();
  if (!parent || !notificationId) {
    return;
  }

  const nextParent = owner === "child"
    ? {
        ...parent,
        children: (parent.children || []).map((child) =>
          child.id === childId
            ? {
                ...child,
                notifications: (child.notifications || []).filter((notification) => notification.id !== notificationId),
              }
            : child,
        ),
      }
    : {
        ...parent,
        notifications: (parent.notifications || []).filter((notification) => notification.id !== notificationId),
      };
  saveAccount(nextParent);
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
    app: "allowa-prototype",
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
  link.download = `allowa-prototype-${new Date().toISOString().slice(0, 10)}.json`;
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

function cancelParentAccount() {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CHILD_SESSION_KEY);
  if (localStorage.getItem(LAST_APP_MODE_KEY) === "parent" || localStorage.getItem(LAST_APP_MODE_KEY) === "child") {
    localStorage.removeItem(LAST_APP_MODE_KEY);
  }
  state.parent = null;
  state.route = "/";
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
  const existingNotifications = (parent.notifications || []).filter((notification) => !isDemoNotification(notification));
  const nextParent = {
    ...parent,
    children: [demoChild, ...otherChildren].slice(0, MAX_CHILDREN),
    notifications: [...createDemoParentNotifications(now), ...existingNotifications],
  };
  saveAccount(nextParent);
  return nextParent;
}

function isDemoNotification(notification) {
  return String(notification.type || "").startsWith("demo_");
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
  const demoBonusSettings = getDemoBonusSettings(now);

  return {
    id: childId,
    nickname: "Mana",
    loginId: "demo-mana",
    demoPassword: "mana1234",
    currentPoints: 1700,
    status: "active",
    subjects,
    pointRules: createDemoPointRules(),
    otherTasks: createDefaultOtherPointTasks(now),
    defaultOtherTasksSeededAt: now.toISOString(),
    redemptionUnit: 100,
    exchangeItems: DEFAULT_EXCHANGE_ITEM_SETTINGS.map((item) => ({ ...item })),
    applications: [englishApplication, mathApplication, japaneseApplication],
    redemptions: [pendingRedemption, completedRedemption],
    bonusSettings: demoBonusSettings,
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
    notifications: createDemoChildNotifications(now, approvedAt),
    createdAt: getDateAfterDays(now, -7).toISOString(),
  };
}

function getDemoBonusSettings(now) {
  return [
    {
      id: "bonus-setting-demo-birthday",
      type: "event",
      name: "誕生日",
      condition: "6月1日",
      conditionType: "annual_date",
      conditionDetails: { month: 6, day: 1 },
      points: 5000,
      status: "active",
      createdAt: getDateAfterDays(now, -5).toISOString(),
    },
    {
      id: "bonus-setting-demo-japanese-perfect",
      type: "achievement",
      name: "国語 テスト 100点以上 10回連続達成",
      condition: "国語 100点以上を10回連続達成",
      conditionType: "achievement_score",
      conditionDetails: {
        category: "test",
        metric: "score",
        mode: "streak",
        subjectId: "subject-demo-japanese",
        subjectName: "国語",
        score: 100,
        count: 10,
      },
      points: 100,
      status: "active",
      createdAt: getDateAfterDays(now, -3).toISOString(),
    },
  ];
}

function createDemoParentNotifications(now) {
  const demoDate = (minutesAgo) => getDateAfterMinutes(now, -minutesAgo).toISOString();
  const systemNotifications = [
    ["demo_ready", "デモデータを作成しました", "親子の申請・承認・おこづかい申請をすぐ確認できます。", "/parent", 1, null],
    ["demo_system_tip", "ポイント基準を確認できます", "科目ごとに点数基準や順位基準を設定できます。", "/parent/children/child-demo-mana/rules", 24, null],
    ["demo_system_notice", "無料トライアル中です", "期間中は親子の画面を自由に確認できます。", "/parent/billing", 75, demoDate(55)],
    ["demo_system_tip", "こどもログインを試せます", "デモこどもIDとパスワードでこども画面を確認できます。", "/parent/demo-guide", 150, demoDate(130)],
    ["demo_system_notice", "お知らせの見え方を確認できます", "未読と既読の切り替えを試せます。", "/parent/notifications", 260, null],
    ["demo_system_tip", "写真つき申請を確認できます", "申請詳細では、こどもが添付した写真を確認する想定です。", "/parent/applications", 440, demoDate(390)],
    ["demo_system_notice", "おこづかい申請を確認できます", "ポイントを家庭内のおこづかい判断に使う流れを確認できます。", "/parent/applications", 720, null],
    ["demo_system_tip", "親子で同じ履歴を見られます", "承認後のポイント履歴は親側とこども側で確認できます。", "/parent/children/child-demo-mana/points", 1500, demoDate(1450)],
    ["demo_system_notice", "プロフィール写真を設定できます", "こども詳細画面からプロフィール写真を変更できます。", "/parent/children/child-demo-mana", 2200, demoDate(2100)],
    ["demo_system_tip", "設定画面も確認できます", "クラウド同期やデモの使い方を設定から確認できます。", "/parent/settings", 3100, null],
  ];

  return systemNotifications
    .map(([type, title, message, route, days, readAt]) => createNotification({
      type,
      title,
      message,
      route,
      createdAt: demoDate(days),
      readAt,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function createDemoChildNotifications(now, approvedAt) {
  const demoDate = (minutesAgo) => getDateAfterMinutes(now, -minutesAgo).toISOString();
  const rows = [
    ["demo_child_application_approved", "申請が承認されました", "算数が承認され、900ptが増えました。", "/child/history", approvedAt, null],
    ["demo_child_redemption_completed", "おこづかいが支給されました", "500円のおこづかいが支給済みになりました。", "/child/exchange", now.toISOString(), null],
    ["demo_child_application_returned", "申請が戻されました", "国語の申請に、もう一度写真を追加してください。", "/child/history", demoDate(45), null],
    ["demo_child_application_pending", "申請を確認中です", "英語の申請を保護者が確認しています。", "/child/history", demoDate(100), demoDate(80)],
    ["demo_child_bonus_granted", "ボーナスが追加されました", "誕生月ボーナスとして300ptが増えました。", "/child/history", demoDate(180), demoDate(150)],
    ["demo_child_redemption_pending", "おこづかい申請中です", "500ptのおこづかい申請を保護者が確認しています。", "/child/exchange", demoDate(280), null],
    ["demo_child_application_approved", "申請が承認されました", "理科の申請が承認され、500ptが増えました。", "/child/history", demoDate(480), demoDate(430)],
    ["demo_child_system_tip", "写真を追加できます", "テストや成績の申請には写真を追加してください。", "/child/apply", demoDate(900), null],
    ["demo_child_system_tip", "ポイント履歴を確認できます", "何でポイントが増えたか履歴から確認できます。", "/child/history", demoDate(1500), demoDate(1400)],
    ["demo_child_system_notice", "デモこどもでログイン中です", "申請、履歴、おこづかい申請の流れを確認できます。", "/child", demoDate(2400), null],
  ];

  return rows.map(([type, title, message, route, createdAt, readAt]) => createNotification({
    type,
    title,
    message,
    route,
    createdAt,
    readAt,
  }));
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

function updatePointRuleForOtherSubjects(childId, sourceSubjectId, ruleType, settings, targetSubjectId = "__all__") {
  const parent = loadAccount();
  const now = new Date().toISOString();
  const nextParent = {
    ...parent,
    children: (parent.children || []).map((child) => {
      if (child.id !== childId) {
        return child;
      }

      const subjects = getActiveSubjects(child).filter((subject) =>
        subject.id !== sourceSubjectId && (targetSubjectId === "__all__" || subject.id === targetSubjectId),
      );
      const existingRules = child.pointRules || [];
      let nextRules = [...existingRules];
      subjects.forEach((subject) => {
        const existingRule = nextRules.find((rule) => rule.subjectId === subject.id && rule.ruleType === ruleType);
        const baseRule = getEffectivePointRule(child, subject.id, ruleType);
        const nextRule = {
          ...baseRule,
          ...existingRule,
          id: existingRule?.id || `rule-${Date.now()}-${subject.id}-${ruleType}`,
          subjectId: subject.id,
          ruleType,
          category: ruleType.startsWith("grade_") ? "grade" : "test",
          method: "tier",
          preset: "custom",
          settings: settings.map((setting) => ({ ...setting })),
          updatedAt: now,
        };
        nextRules = existingRule
          ? nextRules.map((rule) => (rule.id === existingRule.id ? nextRule : rule))
          : [nextRule, ...nextRules];
      });

      return {
        ...child,
        pointRules: nextRules,
      };
    }),
  };
  saveAccount(nextParent);
}

function updateSubjectPointRuleEnabled(childId, subjectId, ruleType, enabled) {
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
        preset: existingRule?.preset || "custom",
        enabled,
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

function createNotification({ type, title, message, route = "", createdAt = new Date().toISOString(), readAt = null }) {
  return {
    id: `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    message,
    route,
    createdAt,
    readAt,
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
    otherTasks: createDefaultOtherPointTasks(),
    defaultOtherTasksSeededAt: new Date().toISOString(),
    redemptionUnit: 100,
    exchangeItems: DEFAULT_EXCHANGE_ITEM_SETTINGS.map((item) => ({ ...item })),
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
        { condition: "100点", points: 100 },
        { condition: "90点以上", points: 80 },
        { condition: "70点以上", points: 50 },
        { condition: "50点以上", points: 20 },
        { condition: "50点未満", points: 5 },
      ],
    },
    {
      id: `rule-${Date.now()}-test50`,
      category: "test",
      ruleType: "test_50",
      method: "tier",
      preset: "normal",
      settings: [
        { condition: "50点", points: 50 },
        { condition: "30点以上", points: 30 },
        { condition: "30点未満", points: 5 },
      ],
    },
    {
      id: `rule-${Date.now()}-testrank`,
      category: "test",
      ruleType: "test_rank",
      method: "rank",
      preset: "normal",
      settings: [
        { condition: "1位", points: 3000 },
        { condition: "10位以内", points: 1000 },
        { condition: "50位以内", points: 500 },
        { condition: "50位未満", points: 100 },
      ],
    },
    {
      id: `rule-${Date.now()}-grade5`,
      category: "grade",
      ruleType: "grade_5",
      method: "tier",
      preset: "normal",
      settings: [
        { id: "evaluation-1", label: "A", points: 1000 },
        { id: "evaluation-2", label: "B", points: 500 },
        { id: "evaluation-3", label: "C", points: 100 },
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

function getDefaultPointRuleSettings(ruleType) {
  const rule = createDefaultPointRules().find((item) => item.ruleType === ruleType);
  return (rule?.settings || []).map((setting) => ({ ...setting }));
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
    subjectId: values.category === "other" ? "" : values.subject?.id || "",
    subjectName: values.category === "other" ? "" : values.subject?.name || "",
    testMethod: values.category === "test" ? values.testMethod || "score" : "",
    testFullScore: values.category === "test" ? values.testFullScore : null,
    score: values.category === "test" && (values.testMethod || "score") === "score" ? values.score : null,
    rank: values.category === "test" && values.testMethod === "rank" ? values.rank : null,
    gradeType: values.category === "grade" ? values.gradeType : "",
    gradeEvaluationId: values.category === "grade" ? values.gradeEvaluationId : "",
    gradeValue: values.category === "grade" ? gradeEvaluation?.label || "" : "",
    otherTaskId: values.category === "other" ? values.otherTaskId || "" : "",
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

function createProfilePhotoSourceFromFile(file) {
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
        resolve({
          name: file.name,
          dataUrl: String(reader.result || ""),
          sourceWidth: image.naturalWidth || image.width || 1,
          sourceHeight: image.naturalHeight || image.height || 1,
          positionX: 50,
          positionY: 50,
          scale: 1,
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
          dataUrl: createCompressedApplicationPhotoDataUrl(canvas),
        });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function createCompressedApplicationPhotoDataUrl(sourceCanvas) {
  let width = sourceCanvas.width;
  let height = sourceCanvas.height;
  let quality = APPLICATION_PHOTO_JPEG_QUALITY;
  let canvas = sourceCanvas;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (
    dataUrl.length > APPLICATION_PHOTO_MAX_DATA_URL_LENGTH &&
    (quality > APPLICATION_PHOTO_MIN_JPEG_QUALITY || Math.max(width, height) > APPLICATION_PHOTO_MIN_SIZE)
  ) {
    if (quality > APPLICATION_PHOTO_MIN_JPEG_QUALITY) {
      quality = Math.max(APPLICATION_PHOTO_MIN_JPEG_QUALITY, quality - 0.08);
    } else {
      const scale = Math.max(
        APPLICATION_PHOTO_MIN_SIZE / Math.max(width, height),
        0.82,
      );
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      canvas = resizeCanvas(canvas, width, height);
    }
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return dataUrl;
}

function resizeCanvas(sourceCanvas, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return sourceCanvas;
  }

  context.drawImage(sourceCanvas, 0, 0, width, height);
  return canvas;
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
    if (application.testMethod === "rank") {
      if (!application.rank || application.rank < 1) {
        return "順位を入力してください。";
      }
      return "";
    }

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
      ? values.testMethod === "rank"
        ? "test_rank"
        : values.testFullScore === 50
        ? "test_50"
        : "test_100"
      : values.gradeType;
  const rule = getEffectivePointRule(child, values.subject?.id || values.subjectId || "", ruleType);

  if (!rule) {
    return null;
  }

  if (values.category === "test") {
    if (values.testMethod === "rank") {
      const rank = Number(values.rank || 0);
      const normalizedRule = normalizeRankRule(rule);
      for (const setting of normalizedRule.settings) {
        const threshold = Number(setting.condition.match(/\d+/)?.[0] || 0);
        if (setting.condition.includes("未満") && rank > threshold) {
          return setting.points;
        }
        if (setting.condition.includes("以内") && rank <= threshold) {
          return setting.points;
        }
        if (!setting.condition.includes("以内") && !setting.condition.includes("未満") && rank === threshold) {
          return setting.points;
        }
      }
      return 0;
    }

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

function isPointRuleEnabled(child, subjectId, ruleType) {
  return getEffectivePointRule(child, subjectId, ruleType)?.enabled !== false;
}

function getSelectedRuleSubject(child, subjects) {
  return subjects.find((subject) => subject.id === child.ruleEditorSubjectId) || subjects[0] || null;
}

function getRuleFullScore(rule, fallbackFullScore) {
  const score = getRuleScore(rule?.settings?.[0]?.condition);
  return score > 0 ? score : fallbackFullScore;
}

function normalizeTestRule(rule, fullScore) {
  const fallback =
    fullScore === 50
      ? [
          { condition: "50点", points: 50 },
          { condition: "30点以上", points: 30 },
          { condition: "30点未満", points: 5 },
        ]
      : [
          { condition: "100点", points: 100 },
          { condition: "90点以上", points: 80 },
          { condition: "70点以上", points: 50 },
          { condition: "50点以上", points: 20 },
          { condition: "50点未満", points: 5 },
        ];
  const currentSettings = rule?.settings || [];
  return { ...rule, settings: normalizeSavedTestSettings(currentSettings.length ? currentSettings : fallback, fullScore) };
}

function normalizeRankRule(rule) {
  const fallback = [
    { condition: "1位", points: 3000 },
    { condition: "10位以内", points: 1000 },
    { condition: "50位以内", points: 500 },
    { condition: "50位未満", points: 100 },
  ];
  const currentSettings = rule?.settings || [];
  return { ...rule, settings: normalizeRankSettings(currentSettings.length ? currentSettings : fallback) };
}

function normalizeRankSettings(settings = []) {
  const fallback = [
    { condition: "1位", points: 3000 },
    { condition: "10位以内", points: 1000 },
    { condition: "50位以内", points: 500 },
    { condition: "50位未満", points: 100 },
  ];
  const source = settings.length >= 3 && !isLegacyRankSettings(settings) ? settings : fallback;
  const first = source[0] || fallback[0];
  const middle = source
    .slice(1, -1)
    .map((setting) => ({
      condition: `${getRuleRank(setting.condition)}位以内`,
      points: Number(setting.points ?? 0),
    }))
    .filter((setting) => getRuleRank(setting.condition) > 1)
    .sort((a, b) => getRuleRank(a.condition) - getRuleRank(b.condition));
  const normalizedMiddle = middle.length ? middle : fallback.slice(1, -1);
  const boundaryRank = normalizedMiddle.length ? Math.max(...normalizedMiddle.map((setting) => getRuleRank(setting.condition))) : 50;
  const last = source.at(-1) || fallback.at(-1);

  return [
    { condition: "1位", points: Number(first.points ?? fallback[0].points ?? 0) },
    ...normalizedMiddle,
    { condition: `${boundaryRank}位未満`, points: Number(last.points ?? fallback.at(-1)?.points ?? 0) },
  ];
}

function isLegacyRankSettings(settings = []) {
  if (settings.length !== 5) {
    return false;
  }

  const ranks = settings.map((setting) => getRuleRank(setting.condition));
  const points = settings.map((setting) => Number(setting.points || 0));
  return (
    ranks.join(",") === "1,10,30,100,100" ||
    points.join(",") === "100,80,50,20,5"
  );
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
  const labels = getDefaultGradeLabels(ruleType);
  const source = isLegacyGradeSettings(settings) ? [] : settings;
  const normalized = labels.map((label, index) => ({
    id: source[index]?.id || `evaluation-${index + 1}`,
    label: source[index]?.label || source[index]?.condition || label,
    points: source[index]?.points ?? getDefaultGradePoints(ruleType)[index] ?? 0,
  }));
  const customSettings = source
    .slice(labels.length)
    .map((setting, index) => ({
      id: setting.id || `custom-evaluation-${index + 1}`,
      label: setting.label || setting.condition || "",
      points: Number(setting.points || 0),
    }))
    .filter((setting) => setting.label);

  return [...normalized, ...customSettings];
}

function getDefaultGradeLabels(ruleType) {
  return {
    grade_5: ["A", "B", "C"],
    grade_3: ["A", "B", "C"],
    grade_2: ["A", "B"],
    grade_abc: ["A", "B", "C"],
  }[ruleType] || ["A", "B", "C"];
}

function getDefaultGradePoints(ruleType) {
  return {
    grade_5: [1000, 500, 100],
    grade_3: [1000, 500, 100],
    grade_2: [1000, 500],
    grade_abc: [1000, 500, 100],
  }[ruleType] || [1000, 500, 100];
}

function isLegacyGradeSettings(settings = []) {
  const labels = settings.map((setting) => String(setting.label || setting.condition || ""));
  const points = settings.map((setting) => Number(setting.points || 0));
  return (
    labels.join(",") === "5,4,3,2,1" ||
    labels.join(",") === "5,4,3" ||
    points.join(",") === "1000,700,300,100,50" ||
    points.join(",") === "1000,500,100,100,50"
  );
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

function getRuleRank(condition) {
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

function createRankCondition(rankValue, operatorValue) {
  const rank = Number(rankValue || 0);
  const operator = String(operatorValue || "以内");
  if (!rank) {
    return "";
  }
  return operator === "ー" ? `${rank}位` : `${rank}位${operator}`;
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

function getDateAfterMinutes(date, minutes) {
  const nextDate = new Date(date);
  nextDate.setMinutes(nextDate.getMinutes() + minutes);
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

function formatJapaneseDateWithWeekday(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
}

function formatMonthDayWithWeekday(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）`;
}

function notificationDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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
    if (application.testMethod === "rank") {
      return `${Number(application.rank || 0).toLocaleString()}位`;
    }

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

function applicationCardPointLabel(application) {
  const points = application.fixedPoints ?? application.suggestedPoints;
  return points == null ? "おまかせ" : `${points.toLocaleString()}<small>pt</small>`;
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
    "arrow-left-right": `
      <path d="M8 3 4 7l4 4"/>
      <path d="M4 7h16"/>
      <path d="m16 21 4-4-4-4"/>
      <path d="M20 17H4"/>
    `,
    "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
    "chevron-down": `<path d="m6 9 6 6 6-6"/>`,
    "move-right": `
      <path d="M18 8l4 4-4 4"/>
      <path d="M2 12h20"/>
    `,
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
    "user-round-plus": `
      <path d="M2 21a8 8 0 0 1 13.292-6"/>
      <circle cx="10" cy="8" r="5"/>
      <path d="M19 16v6"/>
      <path d="M22 19h-6"/>
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
    "file-check": `
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      <path d="m9 15 2 2 4-4"/>
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
    "list-check": `
      <path d="M11 18H3"/>
      <path d="m15 18 2 2 4-4"/>
      <path d="M16 12H3"/>
      <path d="M16 6H3"/>
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
    "trash-2": `
      <path d="M3 6h18"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
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

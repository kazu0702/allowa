(function () {
  const config = window.INCE_SUPABASE_CONFIG || {};
  const enabled = Boolean(config.url && config.anonKey && window.supabase?.createClient);

  window.INCE_CLOUD_STATE = {
    enabled,
    status: enabled ? "synced" : "local",
    lastSyncedAt: "",
    error: "",
  };
})();

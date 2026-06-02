(function () {
  document.addEventListener(
    "click",
    (event) => {
      const plusButton = event.target.closest(
        '.child-design-nav-item.primary[data-route="/child/apply"], .nav-item-primary[data-route="/child/apply"]',
      );
      if (!plusButton) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openChildApply();
    },
    true,
  );

  function openChildApply() {
    const route = "/child/apply";
    if (typeof window.studypayForceNavigate === "function") {
      window.studypayForceNavigate(route);
    } else if (typeof navigate === "function") {
      navigate(route);
    } else {
      location.hash = route;
    }

    [0, 120, 360].forEach((delay) => {
      window.setTimeout(ensureChildApplyRendered, delay);
    });
  }

  function ensureChildApplyRendered() {
    const route = location.hash.replace("#", "") || "/";
    if (route !== "/child/apply" || document.querySelector("#application-form")) {
      return;
    }

    if (typeof window.studypayForceNavigate === "function") {
      window.studypayForceNavigate(route);
    } else {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }
})();

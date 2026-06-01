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
    if (typeof navigate === "function") {
      navigate("/child/apply");
    } else {
      location.hash = "/child/apply";
    }

    [120, 360].forEach((delay) => {
      window.setTimeout(ensureChildApplyRendered, delay);
    });
  }

  function ensureChildApplyRendered() {
    const route = location.hash.replace("#", "") || "/";
    if (route !== "/child/apply" || document.querySelector("#application-form")) {
      return;
    }

    location.reload();
  }
})();

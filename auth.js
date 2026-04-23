function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    return;
  }

  modal.style.display = "block";
  document.getElementById("modalOverlay").style.display = "block";
}

  const DISCORD_CODE_APPROVER_NICKS = new Set(["axolotlflexer"]);

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    return;
  }

  modal.style.display = "none";
  if (!document.querySelector(".modal[style*='display: block']")) {
    document.getElementById("modalOverlay").style.display = "none";
  }
}

function closeAllModals() {
  document.getElementById("loginModal").style.display = "none";
  document.getElementById("registerModal").style.display = "none";

  document.getElementById("linkDiscordModal").style.display = "none";
  document.getElementById("modalOverlay").style.display = "none";
}

function setDiscordStatus(message, isSuccess = false) {
  const status = document.getElementById("linkDiscordError");
  if (!status) {
    return;
  }

  status.style.color = isSuccess ? "#9effc8" : "#ff9999";
  status.textContent = message;
}

function renderDiscordCode(data) {
  const codeBox = document.getElementById("discordCodeBox");
  if (!codeBox) {
    return;
  }

  codeBox.style.display = "block";
  codeBox.innerHTML = `Kod do ręcznej weryfikacji:<br><strong>${data.code}</strong><br>Ważny do: ${new Date(data.expiresAt).toLocaleString("pl-PL")}`;
}

function hideDiscordCode() {
  const codeBox = document.getElementById("discordCodeBox");
  if (codeBox) {
    codeBox.style.display = "none";
    codeBox.textContent = "";
  }
}

function setAuthState(data) {
  localStorage.setItem("authToken", data.token);
  localStorage.setItem("userNick", data.nick);
  localStorage.setItem("discordLinked", String(Boolean(data.discordLinked)));
  localStorage.setItem("requiresDiscordLink", String(Boolean(data.requiresDiscordLink)));
}

async function refreshSessionData() {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return;
  }

  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      logout();
      return;
    }

    const data = await res.json();
    localStorage.setItem("userNick", data.nick);
    localStorage.setItem("discordLinked", String(Boolean(data.discordLinked)));
    localStorage.setItem("requiresDiscordLink", String(Boolean(data.requiresDiscordLink)));
  } catch (error) {
    // Keep local session state if request fails.
  }
}

function readHashParams() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#")) {
    return new URLSearchParams();
  }

  return new URLSearchParams(hash.slice(1));
}

function clearHashParams() {
  if (!window.location.hash) {
    return;
  }

  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function logout() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("userNick");
  localStorage.removeItem("discordLinked");
  localStorage.removeItem("requiresDiscordLink");
  hideDiscordCode();
  updateAuthUI();
}

function updateAuthUI() {
  const token = localStorage.getItem("authToken");
  const nick = localStorage.getItem("userNick");
  const discordLinked = localStorage.getItem("discordLinked") === "true";
  const requiresDiscordLink = localStorage.getItem("requiresDiscordLink") === "true";

  const authButtons = document.querySelector(".nav-auth");
  const userProfile = document.getElementById("userProfile");
  const linkBtn = document.getElementById("btnLinkDiscord");
    const adminPanel = document.getElementById("discordAdminPanel");
    const isDiscordApprover = DISCORD_CODE_APPROVER_NICKS.has(String(nick || "").toLowerCase());

  if (token && nick) {
    authButtons.querySelector(".btn-login").style.display = "none";
    authButtons.querySelector(".btn-register").style.display = "none";
    userProfile.style.display = "flex";
    document.getElementById("userName").textContent = nick;
    document.getElementById("playerNick").value = nick;

    linkBtn.style.display = "inline-block";
    linkBtn.classList.remove("required");

    if (discordLinked) {
      linkBtn.textContent = "Discord połączony";
    } else {
      linkBtn.textContent = "Połącz Discord";
    }

      if (adminPanel) {
        adminPanel.style.display = isDiscordApprover ? "block" : "none";
      }
  } else {
    authButtons.querySelector(".btn-login").style.display = "block";
    authButtons.querySelector(".btn-register").style.display = "block";
    userProfile.style.display = "none";
    document.getElementById("playerNick").value = "";
      if (adminPanel) {
        adminPanel.style.display = "none";
      }
    closeAllModals();
  }
}

async function startDiscordOAuth() {
  const token = localStorage.getItem("authToken");
  hideDiscordCode();

  if (!token) {
    setDiscordStatus("Najpierw zaloguj się na konto.");
    return;
  }

  try {
    const configRes = await fetch("/api/auth/discord/config");
    const config = await configRes.json();

    if (config.oauthConfigured) {
      window.location.href = `/api/auth/discord/start?token=${encodeURIComponent(token)}`;
      return;
    }

    setDiscordStatus("OAuth Discord nie jest jeszcze skonfigurowany. Wygeneruj kod ręcznej weryfikacji poniżej.");
  } catch (error) {
    setDiscordStatus("Nie udało się sprawdzić konfiguracji OAuth. Spróbuj ponownie.");
  }
}

async function generateDiscordVerificationCode() {
  const token = localStorage.getItem("authToken");
  hideDiscordCode();

  if (!token) {
    setDiscordStatus("Najpierw zaloguj się na konto.");
    return;
  }

  try {
    const res = await fetch("/api/auth/discord/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const data = await res.json();
    if (!res.ok) {
      setDiscordStatus(data.error || "Nie udało się wygenerować kodu weryfikacji.");
      return;
    }

    setDiscordStatus("Kod wygenerowany. Przekaż go administracji Discord do ręcznej autoryzacji.", true);
    renderDiscordCode(data);
  } catch (error) {
    setDiscordStatus("Błąd sieci przy generowaniu kodu weryfikacji.");
  }
}

  async function approveDiscordVerificationCode() {
    const token = localStorage.getItem("authToken");
    const currentNick = localStorage.getItem("userNick");
    const targetNick = document.getElementById("verifyTargetNick").value.trim();
    const code = document.getElementById("verifyCode").value.trim().toUpperCase();
    const discordId = document.getElementById("verifyDiscordId").value.trim();
    const discordTag = document.getElementById("verifyDiscordTag").value.trim();

    if (!token) {
      setDiscordStatus("Najpierw zaloguj się na konto.");
      return;
    }

    if (!targetNick || !code || (!discordId && !discordTag)) {
      setDiscordStatus("Uzupełnij nick konta, kod oraz Discord ID lub nick Discord.");
      return;
    }

    try {
      const res = await fetch("/api/auth/discord/approve-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, targetNick, code, discordId, discordTag })
      });

      const data = await res.json();
      if (!res.ok) {
        setDiscordStatus(data.error || "Nie udało się zatwierdzić kodu.");
        return;
      }

      setDiscordStatus(`Zatwierdzono kod dla ${data.targetNick}.`, true);
      document.getElementById("verifyCode").value = "";
      document.getElementById("verifyDiscordId").value = "";

      if (String(currentNick || "").toLowerCase() === String(targetNick || "").toLowerCase()) {
        localStorage.setItem("discordLinked", "true");
        localStorage.setItem("requiresDiscordLink", "false");
        updateAuthUI();
      }
    } catch (error) {
      setDiscordStatus("Błąd sieci przy zatwierdzaniu kodu.");
    }
  }

// AUTH UI ACTIONS
document.getElementById("btnLogin").addEventListener("click", () => openModal("loginModal"));
document.getElementById("btnRegister").addEventListener("click", () => openModal("registerModal"));
document.getElementById("btnLogout").addEventListener("click", logout);
document.getElementById("btnLinkDiscord").addEventListener("click", () => {
  setDiscordStatus("");
  hideDiscordCode();
  openModal("linkDiscordModal");
});
document.getElementById("linkDiscordOauthBtn").addEventListener("click", startDiscordOAuth);
document.getElementById("generateDiscordCodeBtn").addEventListener("click", generateDiscordVerificationCode);
document.getElementById("approveDiscordCodeBtn").addEventListener("click", approveDiscordVerificationCode);

// MOBILE MENU TOGGLE
document.getElementById("navToggle").addEventListener("click", () => {
  const menu = document.getElementById("navMenu");
  if (menu) {
    menu.classList.toggle("active");
  }
});

// CLOSE MOBILE MENU ON NAV LINK CLICK
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    const menu = document.getElementById("navMenu");
    if (menu) {
      menu.classList.remove("active");
    }
  });
});

// CLOSE MOBILE MENU WHEN CLICKING OUTSIDE
document.addEventListener("click", (e) => {
  const menu = document.getElementById("navMenu");
  const navbar = document.querySelector(".navbar");

  if (menu && !navbar?.contains(e.target)) {
    menu.classList.remove("active");
  }
});

// LOGIN
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nick = document.getElementById("loginNick").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorDiv = document.getElementById("loginError");

  errorDiv.textContent = "";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorDiv.textContent = data.error || "Błąd logowania";
      return;
    }

    setAuthState(data);
    updateAuthUI();
    closeModal("loginModal");
    document.getElementById("loginForm").reset();
  } catch (error) {
    errorDiv.textContent = "Błąd sieci";
  }
});

// REGISTER
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nick = document.getElementById("regNick").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const passwordConfirm = document.getElementById("regPasswordConfirm").value;
  const errorDiv = document.getElementById("registerError");

  errorDiv.textContent = "";

  if (password !== passwordConfirm) {
    errorDiv.textContent = "Hasła nie są identyczne";
    return;
  }

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick, email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorDiv.textContent = data.error || "Błąd rejestracji";
      return;
    }

    setAuthState(data);
    updateAuthUI();
    closeModal("registerModal");
    document.getElementById("registerForm").reset();
  } catch (error) {
    errorDiv.textContent = "Błąd sieci";
  }
});

window.addEventListener("load", async () => {
  const hashParams = readHashParams();
  const linkedStatus = hashParams.get("discord-linked");
  const linkedError = hashParams.get("error");

  await refreshSessionData();
  updateAuthUI();

  if (linkedStatus === "1") {
    setDiscordStatus("Discord został poprawnie połączony.", true);
    closeModal("linkDiscordModal");
  } else if (linkedStatus === "0") {
    setDiscordStatus(`Nie udało się połączyć Discorda (${linkedError || "unknown_error"}).`);
    openModal("linkDiscordModal");
  }

  clearHashParams();
});

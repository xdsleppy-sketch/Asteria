const cart = new Map();

const cartList = document.getElementById("cartList");
const totalPrice = document.getElementById("totalPrice");
const checkoutBtn = document.getElementById("checkoutBtn");
const buyButtons = document.querySelectorAll(".buy-btn");
const playerNickInput = document.getElementById("playerNick");
const contactEmailInput = document.getElementById("contactEmail");
const orderStatus = document.getElementById("orderStatus");
const reviewsList = document.getElementById("reviewsList");
const reviewsEmpty = document.getElementById("reviewsEmpty");
const reviewGate = document.getElementById("reviewGate");
const forcedReviewOrderIdInput = document.getElementById("forcedReviewOrderId");
const forcedReviewNickInput = document.getElementById("forcedReviewNick");
const forcedReviewTextInput = document.getElementById("forcedReviewText");
const forcedReviewSubmitBtn = document.getElementById("forcedReviewSubmitBtn");
const forcedReviewStatus = document.getElementById("forcedReviewStatus");
const TIPPLY_CHECKOUT_URL = "https://tipply.pl";
const PENDING_REVIEW_ORDER_KEY = "pendingReviewOrderId";
const PENDING_REVIEW_NICK_KEY = "pendingReviewNick";

function formatPrice(value) {
  return `${value} zł`;
}

function setStatus(message, type = "") {
  orderStatus.textContent = message;
  orderStatus.classList.remove("ok", "err");

  if (type) {
    orderStatus.classList.add(type);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReviews(reviews) {
  if (!reviewsList || !reviewsEmpty) {
    return;
  }

  if (!Array.isArray(reviews) || reviews.length === 0) {
    reviewsList.innerHTML = "";
    reviewsEmpty.style.display = "block";
    return;
  }

  reviewsEmpty.style.display = "none";
  reviewsList.innerHTML = reviews
    .map((review) => {
      const author = escapeHtml(review?.playerNick || "Gracz");
      const text = escapeHtml(review?.reviewText || "");
      const date = new Date(review?.createdAt || Date.now()).toLocaleDateString("pl-PL");

      return `
        <article class="review-item">
          <div class="review-header">
            <span class="review-author">${author}</span>
            <span>${date}</span>
          </div>
          <p class="review-text">${text}</p>
        </article>
      `;
    })
    .join("");
}

function loadReviews() {
  if (!reviewsList || !reviewsEmpty) {
    return;
  }

  fetch("/api/reviews")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Nie udało się pobrać opinii.");
      }
      return response.json();
    })
    .then((data) => {
      renderReviews(data?.reviews || []);
    })
    .catch(() => {
      renderReviews([]);
    });
}

function openForcedReviewGate(orderId, nick) {
  if (!reviewGate || !forcedReviewOrderIdInput || !forcedReviewNickInput) {
    return;
  }

  forcedReviewOrderIdInput.value = orderId;
  forcedReviewNickInput.value = nick;
  if (forcedReviewTextInput) {
    forcedReviewTextInput.value = "";
  }
  if (forcedReviewStatus) {
    forcedReviewStatus.textContent = "";
  }

  reviewGate.style.display = "grid";
  reviewGate.setAttribute("aria-hidden", "false");
}

function closeForcedReviewGate() {
  if (!reviewGate) {
    return;
  }

  reviewGate.style.display = "none";
  reviewGate.setAttribute("aria-hidden", "true");
}

function bootstrapForcedReviewGate() {
  const orderId = localStorage.getItem(PENDING_REVIEW_ORDER_KEY) || "";
  const nick = localStorage.getItem(PENDING_REVIEW_NICK_KEY) || "";
  if (!orderId || !nick) {
    closeForcedReviewGate();
    return;
  }

  openForcedReviewGate(orderId, nick);
}

function validateForm() {
  const nick = playerNickInput.value.trim();
  const mail = contactEmailInput.value.trim();

  if (nick.length < 3) {
    return "Nick musi mieć min. 3 znaki.";
  }

  if (mail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return "Podaj poprawny e-mail albo zostaw pole puste.";
  }

  return "";
}

function renderCart() {
  const entries = [...cart.values()];

  if (entries.length === 0) {
    cartList.innerHTML = '<li class="empty">Koszyk jest pusty.</li>';
    totalPrice.textContent = formatPrice(0);
    checkoutBtn.disabled = true;
    return;
  }

  let total = 0;
  cartList.innerHTML = "";

  for (const item of entries) {
    const row = document.createElement("li");
    const subtotal = item.price * item.qty;
    total += subtotal;

    row.innerHTML = `
      <div class="item-name">${item.name}</div>
      <div class="item-meta">x${item.qty} • ${formatPrice(subtotal)}</div>
    `;

    cartList.appendChild(row);
  }

  totalPrice.textContent = formatPrice(total);
  checkoutBtn.disabled = false;
}

for (const button of buyButtons) {
  button.addEventListener("click", () => {
    const name = button.dataset.name;
    const price = Number(button.dataset.price);

    if (!cart.has(name)) {
      cart.set(name, { name, price, qty: 1 });
    } else {
      const item = cart.get(name);
      item.qty += 1;
      cart.set(name, item);
    }

    button.textContent = "Dodano!";
    setTimeout(() => {
      button.textContent = "Dodaj do koszyka";
    }, 500);

    renderCart();
  });
}

checkoutBtn.addEventListener("click", () => {
  const validationError = validateForm();

  if (validationError) {
    setStatus(validationError, "err");
    return;
  }

  const payload = {
    playerNick: playerNickInput.value.trim(),
    contactEmail: contactEmailInput.value.trim(),
    paymentMethod: "Tipply",
    cart: [...cart.values()].map((item) => ({
      name: item.name,
      price: item.price,
      qty: item.qty
    }))
  };

  checkoutBtn.disabled = true;
  setStatus("Zapisywanie zamówienia...", "");

  fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
    .then(async (response) => {
      const data = await response.json();

      if (!response.ok) {
        throw {
          message: data.error || "Nie udało się zapisać zamówienia.",
          pendingReviewOrderId: data.pendingReviewOrderId || "",
          pendingReviewNick: data.pendingReviewNick || ""
        };
      }

      cart.clear();
      renderCart();

      localStorage.setItem(PENDING_REVIEW_ORDER_KEY, String(data.orderId || ""));
      localStorage.setItem(PENDING_REVIEW_NICK_KEY, playerNickInput.value.trim());

      setStatus(`Zamówienie ${data.orderId} zapisane. Przekierowuję do Tipply...`, "ok");
      setTimeout(() => {
        window.location.href = TIPPLY_CHECKOUT_URL;
      }, 300);
    })
    .catch((error) => {
      const message = error?.message || "Nie udało się zapisać zamówienia.";
      setStatus(message, "err");

      if (error?.pendingReviewOrderId) {
        const pendingOrderId = String(error.pendingReviewOrderId);
        const pendingNick = String(error.pendingReviewNick || playerNickInput.value.trim());
        localStorage.setItem(PENDING_REVIEW_ORDER_KEY, pendingOrderId);
        localStorage.setItem(PENDING_REVIEW_NICK_KEY, pendingNick);
        openForcedReviewGate(pendingOrderId, pendingNick);
      }

      if (cart.size > 0) {
        checkoutBtn.disabled = false;
      }
    });
});

if (forcedReviewSubmitBtn) {
  forcedReviewSubmitBtn.addEventListener("click", () => {
    const orderId = (localStorage.getItem(PENDING_REVIEW_ORDER_KEY) || "").trim();
    const nick = (localStorage.getItem(PENDING_REVIEW_NICK_KEY) || "").trim();
    const text = forcedReviewTextInput?.value.trim() || "";

    if (!orderId || !nick || text.length < 8) {
      if (forcedReviewStatus) {
        forcedReviewStatus.textContent = "Napisz opinię min. 8 znaków.";
      }
      return;
    }

    forcedReviewSubmitBtn.disabled = true;
    if (forcedReviewStatus) {
      forcedReviewStatus.textContent = "Zapisywanie opinii...";
    }

    fetch(`/api/orders/${encodeURIComponent(orderId)}/review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playerNick: nick,
        reviewText: text
      })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Nie udało się zapisać opinii.");
        }

        localStorage.removeItem(PENDING_REVIEW_ORDER_KEY);
        localStorage.removeItem(PENDING_REVIEW_NICK_KEY);
        closeForcedReviewGate();

        if (forcedReviewStatus) {
          forcedReviewStatus.textContent = "";
        }
        setStatus("Dzięki za opinię. Możesz teraz normalnie robić kolejne zakupy.", "ok");
      })
      .catch((error) => {
        if (forcedReviewStatus) {
          forcedReviewStatus.textContent = error.message;
        }
      })
      .finally(() => {
        forcedReviewSubmitBtn.disabled = false;
      });
  });
}

renderCart();
loadReviews();
bootstrapForcedReviewGate();

const toggleRulesBtn = document.getElementById("toggleRulesBtn");
const rulesMore = document.getElementById("rulesMore");
const rulesContent = document.querySelector("#rules .rules-content");

if (toggleRulesBtn && rulesMore && rulesContent) {
  rulesMore.style.maxHeight = "0px";

  // Include ALL h3/li/rules-note from the entire rules-content (both visible + hidden parts)
  const typingTargets = Array.from(rulesContent.querySelectorAll("h3, li, .rules-note"));
  const originalText = new Map();
  const typingTimers = [];

  typingTargets.forEach((element) => {
    originalText.set(element, element.textContent);
  });

  const clearTypingTimers = () => {
    while (typingTimers.length > 0) {
      clearTimeout(typingTimers.pop());
    }
  };

  const restoreAllText = () => {
    typingTargets.forEach((element) => {
      element.textContent = originalText.get(element) || "";
      element.classList.remove("typing-target", "typing-done");
    });
  };

  const typeTextWithMixedSpeed = (element, text, startDelay) => {
    let elapsed = startDelay;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const timer = setTimeout(() => {
        element.textContent += char;
        rulesMore.style.maxHeight = `${rulesMore.scrollHeight + 2000}px`;
      }, elapsed);
      typingTimers.push(timer);

      const mixedStep = i % 10 === 0 ? 30 : i % 4 === 0 ? 15 : 8;
      elapsed += mixedStep;
    }

    const doneTimer = setTimeout(() => {
      element.classList.add("typing-done");
    }, elapsed + 20);
    typingTimers.push(doneTimer);

    return elapsed + 40;
  };

  const runTypewriterAnimation = () => {
    clearTypingTimers();

    // Clear ALL targets (including Postanowienia ogólne)
    typingTargets.forEach((element) => {
      element.textContent = "";
      element.classList.add("typing-target");
      element.classList.remove("typing-done");
    });

    let delay = 60;
    typingTargets.forEach((element, index) => {
      const text = originalText.get(element) || "";
      if (!text) return;
      delay += index % 2 === 0 ? 50 : 30;
      delay = typeTextWithMixedSpeed(element, text, delay);
    });
  };

  toggleRulesBtn.addEventListener("click", () => {
    const isExpanded = rulesMore.classList.contains("expanded");

    if (isExpanded) {
      clearTypingTimers();
      rulesMore.style.maxHeight = `${rulesMore.scrollHeight}px`;
      requestAnimationFrame(() => {
        rulesMore.style.maxHeight = "0px";
      });
      rulesMore.classList.remove("expanded");
      rulesMore.setAttribute("aria-hidden", "true");
      restoreAllText();
      toggleRulesBtn.textContent = "Pokaż więcej";
      toggleRulesBtn.setAttribute("aria-expanded", "false");
      return;
    }

    // Expand rulesMore first so hidden elements become measurable
    rulesMore.classList.add("expanded");
    rulesMore.setAttribute("aria-hidden", "false");
    rulesMore.style.maxHeight = `${rulesMore.scrollHeight + 2000}px`;
    toggleRulesBtn.textContent = "Pokaż mniej";
    toggleRulesBtn.setAttribute("aria-expanded", "true");

    runTypewriterAnimation();
  });

  window.addEventListener("resize", () => {
    if (rulesMore.classList.contains("expanded")) {
      rulesMore.style.maxHeight = `${rulesMore.scrollHeight + 2000}px`;
    }
  });
}

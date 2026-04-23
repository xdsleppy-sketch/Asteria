const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/api/auth/discord/callback`;
const DISCORD_OAUTH_SCOPES = "identify";
const discordOauthStateMap = new Map();
const DISCORD_CODE_APPROVER_NICKS = new Set(["axolotlflexer"]);
const ADMIN_NICKS = new Set([
  "axolotlflexer",
  "_kvrsik",
  "_kvrss",
  "rolnikbombiarz",
  "olekgg5",
  "1337r4nd0m3k"
]);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// INIT
async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ORDERS_FILE);
  } catch {
    await fs.writeFile(ORDERS_FILE, "[]", "utf8");
  }
  try {
    await fs.access(ACCOUNTS_FILE);
  } catch {
    await fs.writeFile(ACCOUNTS_FILE, "[]", "utf8");
  }
}

function sanitizeText(value, maxLength = 64) {
  return String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, maxLength);
}

function sanitizeDiscordId(value) {
  const id = String(value || "").trim();
  if (!/^\d{17,20}$/.test(id)) {
    return "";
  }
  return id;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "salt_asteriamc").digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getTokenFromRequest(req) {
  const authHeader = String(req.headers?.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  return sanitizeText(req.body?.token, 128);
}

function isDiscordLinked(account) {
  // Linked can be OAuth-based (discordId) or manually verified via code.
  return Boolean(account.discordId || account.discordManualVerifiedAt);
}

function makeDiscordTag(discordUser) {
  if (!discordUser) {
    return null;
  }

  const username = sanitizeText(discordUser.username, 32);
  const discriminator = sanitizeText(discordUser.discriminator, 8);
  if (username && discriminator && discriminator !== "0") {
    return `${username}#${discriminator}`;
  }

  return username || null;
}

function buildDiscordAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: DISCORD_REDIRECT_URI,
    scope: DISCORD_OAUTH_SCOPES,
    state,
    prompt: "consent"
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

function makeDiscordVerificationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

// AUTH ROUTES
app.post("/api/auth/register", async (req, res) => {
  try {
    const nick = sanitizeText(req.body?.nick, 16);
    const email = sanitizeText(req.body?.email, 80);
    const password = req.body?.password || "";

    if (!nick || nick.length < 3) {
      return res.status(400).json({ error: "Nick musi mieć min. 3 znaki." });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Podaj poprawny e-mail." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Hasło musi mieć min. 6 znaków." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);

    if (accounts.some((a) => a.nick.toLowerCase() === nick.toLowerCase())) {
      return res.status(409).json({ error: "Nick już istnieje." });
    }

    if (accounts.some((a) => a.email === email)) {
      return res.status(409).json({ error: "E-mail już zarejestrowany." });
    }

    const token = generateToken();
    const account = {
      id: crypto.randomUUID(),
      nick,
      email,
      passwordHash: hashPassword(password),
      discordId: null,
      discordUsername: null,
      discordGlobalName: null,
      discordTag: null,
      discordLinkedAt: null,
      token,
      createdAt: new Date().toISOString()
    };

    accounts.push(account);
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");

    return res.status(201).json({
      message: "Konto założone!",
      token,
      nick
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const nick = sanitizeText(req.body?.nick, 16);
    const password = req.body?.password || "";

    if (!nick || !password) {
      return res.status(400).json({ error: "Podaj nick i hasło." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);

    const account = accounts.find((a) => a.nick.toLowerCase() === nick.toLowerCase());

    if (!account || account.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: "Błędny nick lub hasło." });
    }

    const token = generateToken();
    account.token = token;
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");

    const discordLinked = isDiscordLinked(account);

    return res.status(200).json({
      message: "Zalogowano!",
      token,
      nick: account.nick,
      discordLinked,
      requiresDiscordLink: false
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: "Brak tokenu." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);
    const account = accounts.find((a) => a.token === token);

    if (!account) {
      return res.status(401).json({ error: "Nieprawidłowa sesja." });
    }

    const discordLinked = isDiscordLinked(account);

    return res.status(200).json({
      nick: account.nick,
      discordLinked,
      requiresDiscordLink: false,
      discordId: account.discordId || null,
      discordUsername: account.discordUsername || null,
      discordGlobalName: account.discordGlobalName || null,
      discordTag: account.discordTag || null
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera." });
  }
});

app.get("/api/auth/discord/config", (req, res) => {
  return res.status(200).json({
    oauthConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
    redirectUri: DISCORD_REDIRECT_URI
  });
});

app.post("/api/auth/discord/request-code", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: "Brak tokenu." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);
    const account = accounts.find((a) => a.token === token);

    if (!account) {
      return res.status(401).json({ error: "Nieprawidłowa sesja." });
    }

    if (!ADMIN_NICKS.has(account.nick.toLowerCase())) {
      return res.status(403).json({ error: "Kod weryfikacji Discord jest dostępny tylko dla administracji." });
    }

    if (isDiscordLinked(account)) {
      return res.status(409).json({ error: "To konto ma już podpięty Discord." });
    }

    const code = makeDiscordVerificationCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    account.discordVerificationCode = code;
    account.discordVerificationExpiresAt = expiresAt;

    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");

    return res.status(200).json({
      message: "Wygenerowano kod weryfikacji Discord.",
      code,
      expiresAt,
      instructions: "Przekaż kod administracji Discord do ręcznej autoryzacji."
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera podczas generowania kodu." });
  }
});

app.post("/api/auth/discord/approve-code", async (req, res) => {
  try {
    const approverToken = getTokenFromRequest(req);
    const targetNick = sanitizeText(req.body?.targetNick, 16);
    const code = sanitizeText(req.body?.code, 16).toUpperCase();
    const discordTag = sanitizeText(req.body?.discordTag, 40);
    const discordId = sanitizeDiscordId(req.body?.discordId);

    if (!approverToken) {
      return res.status(401).json({ error: "Brak tokenu." });
    }

    if (!targetNick || !code || (!discordTag && !discordId)) {
      return res.status(400).json({ error: "Podaj targetNick, code oraz discordId lub discordTag." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);

    const approver = accounts.find((a) => a.token === approverToken);
    if (!approver) {
      return res.status(401).json({ error: "Nieprawidłowa sesja." });
    }

    if (!DISCORD_CODE_APPROVER_NICKS.has(String(approver.nick || "").toLowerCase())) {
      return res.status(403).json({ error: "Brak uprawnień do zatwierdzania kodów." });
    }

    const target = accounts.find((a) => String(a.nick || "").toLowerCase() === targetNick.toLowerCase());
    if (!target) {
      return res.status(404).json({ error: "Nie znaleziono konta docelowego." });
    }

    if (!ADMIN_NICKS.has(String(target.nick || "").toLowerCase())) {
      return res.status(403).json({ error: "Ręczna weryfikacja kodem jest tylko dla administracji." });
    }

    const targetCode = String(target.discordVerificationCode || "").toUpperCase();
    if (!targetCode) {
      return res.status(409).json({ error: "To konto nie ma aktywnego kodu weryfikacji." });
    }

    if (targetCode !== code) {
      return res.status(400).json({ error: "Kod weryfikacji jest niepoprawny." });
    }

    const expiresAtMs = Date.parse(String(target.discordVerificationExpiresAt || ""));
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return res.status(410).json({ error: "Kod weryfikacji wygasł. Wygeneruj nowy." });
    }

    if (discordId) {
      const duplicateDiscord = accounts.some(
        (a) => a.id !== target.id && String(a.discordId || "") === discordId
      );
      if (duplicateDiscord) {
        return res.status(409).json({ error: "To Discord ID jest już przypisane do innego konta." });
      }
    }

    target.discordId = discordId || target.discordId || `manual_${Date.now()}`;
    target.discordTag = discordTag || target.discordTag || null;
    target.discordManualVerifiedAt = new Date().toISOString();
    target.discordManualVerifiedBy = approver.nick;
    target.discordLinkedAt = target.discordManualVerifiedAt;
    delete target.discordVerificationCode;
    delete target.discordVerificationExpiresAt;

    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");

    return res.status(200).json({
      message: "Kod został zatwierdzony. Konto Discord podpięte ręcznie.",
      targetNick: target.nick,
      discordId: target.discordId,
      discordTag: target.discordTag,
      verifiedBy: approver.nick,
      discordLinked: true,
      requiresDiscordLink: false
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera podczas zatwierdzania kodu." });
  }
});

app.get("/api/auth/discord/start", async (req, res) => {
  try {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      return res.redirect("/#discord-linked=0&error=oauth_not_configured");
    }

    const token = sanitizeText(req.query?.token, 128);
    if (!token) {
      return res.status(401).send("Brak tokenu sesji.");
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);
    const account = accounts.find((a) => a.token === token);

    if (!account) {
      return res.status(401).send("Nieprawidłowa sesja.");
    }

    const state = crypto.randomBytes(24).toString("hex");
    discordOauthStateMap.set(state, {
      accountId: account.id,
      createdAt: Date.now()
    });

    return res.redirect(buildDiscordAuthorizeUrl(state));
  } catch (error) {
    return res.status(500).send("Błąd podczas inicjalizacji autoryzacji Discord.");
  }
});

app.get("/api/auth/discord/callback", async (req, res) => {
  try {
    const code = sanitizeText(req.query?.code, 1200);
    const state = sanitizeText(req.query?.state, 120);

    if (!code || !state) {
      return res.redirect("/#discord-linked=0&error=missing_code");
    }

    const pending = discordOauthStateMap.get(state);
    discordOauthStateMap.delete(state);

    if (!pending) {
      return res.redirect("/#discord-linked=0&error=invalid_state");
    }

    if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.redirect("/#discord-linked=0&error=state_expired");
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      return res.redirect("/#discord-linked=0&error=oauth_not_configured");
    }

    const tokenBody = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT_URI
    });

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenBody.toString()
    });

    if (!tokenResponse.ok) {
      return res.redirect("/#discord-linked=0&error=token_exchange_failed");
    }

    const tokenJson = await tokenResponse.json();
    const accessToken = sanitizeText(tokenJson.access_token, 4000);
    if (!accessToken) {
      return res.redirect("/#discord-linked=0&error=missing_access_token");
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      return res.redirect("/#discord-linked=0&error=user_fetch_failed");
    }

    const discordUser = await userResponse.json();
    const discordId = sanitizeText(discordUser.id, 40);
    if (!discordId) {
      return res.redirect("/#discord-linked=0&error=missing_discord_id");
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);
    const account = accounts.find((a) => a.id === pending.accountId);

    if (!account) {
      return res.redirect("/#discord-linked=0&error=account_not_found");
    }

    const duplicateDiscord = accounts.some(
      (a) => a.id !== account.id && String(a.discordId || "") === discordId
    );
    if (duplicateDiscord) {
      return res.redirect("/#discord-linked=0&error=discord_already_linked");
    }

    account.discordId = discordId;
    account.discordUsername = sanitizeText(discordUser.username, 40) || null;
    account.discordGlobalName = sanitizeText(discordUser.global_name, 80) || null;
    account.discordTag = makeDiscordTag(discordUser);
    account.discordLinkedAt = new Date().toISOString();
    account.discordManualVerifiedAt = null;
    account.discordManualVerifiedBy = null;
    delete account.discordVerificationCode;
    delete account.discordVerificationExpiresAt;

    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");

    return res.redirect("/#discord-linked=1");
  } catch (error) {
    return res.redirect("/#discord-linked=0&error=callback_exception");
  }
});

app.post("/api/auth/link-discord", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ error: "Brak tokenu." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(raw);
    const account = accounts.find((a) => a.token === token);

    if (!account) {
      return res.status(401).json({ error: "Nieprawidłowa sesja." });
    }

    return res.status(400).json({
      error: "Połączenie Discorda odbywa się przez autoryzację OAuth.",
      oauthUrl: `/api/auth/discord/start?token=${encodeURIComponent(account.token)}`
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera." });
  }
});

// ORDERS
app.post("/api/orders", async (req, res) => {
  try {
    const playerNick = sanitizeText(req.body?.playerNick, 16);
    const contactEmail = sanitizeText(req.body?.contactEmail, 80);
    const paymentMethod = sanitizeText(req.body?.paymentMethod || "Tipply", 24);
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];

    if (!playerNick || playerNick.length < 3) {
      return res.status(400).json({ error: "Podaj poprawny nick gracza (min. 3 znaki)." });
    }

    if (contactEmail && !isValidEmail(contactEmail)) {
      return res.status(400).json({ error: "Podaj poprawny adres e-mail lub zostaw pole puste." });
    }

    if (!["Tipply"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Niepoprawna metoda płatności." });
    }

    if (cart.length === 0) {
      return res.status(400).json({ error: "Koszyk jest pusty." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ORDERS_FILE, "utf8");
    const orders = JSON.parse(raw);

    const pendingReviewOrder = orders.find((item) => {
      const sameNick = String(item?.playerNick || "").toLowerCase() === playerNick.toLowerCase();
      const hasReview = typeof item?.reviewText === "string" && item.reviewText.trim().length >= 8;
      return sameNick && !hasReview;
    });

    if (pendingReviewOrder) {
      return res.status(409).json({
        error: "Najpierw dodaj opinię do poprzedniego zakupu.",
        pendingReviewOrderId: pendingReviewOrder.id,
        pendingReviewNick: pendingReviewOrder.playerNick
      });
    }

    const normalizedCart = [];

    for (const item of cart) {
      const name = sanitizeText(item?.name, 120);
      const price = Number(item?.price);
      const qty = Number(item?.qty);

      if (!name || !Number.isFinite(price) || !Number.isInteger(qty) || qty <= 0 || price <= 0) {
        return res.status(400).json({ error: "Koszyk zawiera nieprawidłowe dane." });
      }

      normalizedCart.push({ name, price, qty, subtotal: price * qty });
    }

    const total = normalizedCart.reduce((sum, item) => sum + item.subtotal, 0);

    const order = {
      id: `AST-${Date.now()}-${crypto.randomInt(1000, 9999)}`,
      createdAt: new Date().toISOString(),
      playerNick,
      contactEmail,
      paymentMethod,
      status: "pending",
      total,
      cart: normalizedCart
    };

    orders.push(order);
    await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");

    return res.status(201).json({
      message: "Zamówienie zostało zapisane.",
      orderId: order.id,
      total: order.total
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera podczas zapisu zamówienia." });
  }
});

app.post("/api/orders/:orderId/review", async (req, res) => {
  try {
    const orderId = sanitizeText(req.params?.orderId, 64);
    const playerNick = sanitizeText(req.body?.playerNick, 16);
    const reviewText = sanitizeText(req.body?.reviewText, 220);

    if (!orderId) {
      return res.status(400).json({ error: "Brak orderId." });
    }

    if (!playerNick || playerNick.length < 3) {
      return res.status(400).json({ error: "Podaj poprawny nick gracza." });
    }

    if (!reviewText || reviewText.length < 8) {
      return res.status(400).json({ error: "Opinia musi mieć min. 8 znaków." });
    }

    await ensureDataFiles();
    const raw = await fs.readFile(ORDERS_FILE, "utf8");
    const orders = JSON.parse(raw);

    const order = orders.find((item) => String(item.id || "") === orderId);
    if (!order) {
      return res.status(404).json({ error: "Nie znaleziono zamówienia." });
    }

    if (String(order.playerNick || "").toLowerCase() !== playerNick.toLowerCase()) {
      return res.status(403).json({ error: "Nick nie pasuje do zamówienia." });
    }

    order.reviewText = reviewText;
    order.reviewCreatedAt = new Date().toISOString();

    await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");

    return res.status(200).json({
      message: "Opinia została zapisana.",
      orderId: order.id,
      playerNick: order.playerNick
    });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera podczas zapisu opinii." });
  }
});

app.get("/api/reviews", async (req, res) => {
  try {
    await ensureDataFiles();
    const raw = await fs.readFile(ORDERS_FILE, "utf8");
    const orders = JSON.parse(raw);

    const reviews = orders
      .filter((order) => typeof order?.reviewText === "string" && order.reviewText.trim().length >= 8)
      .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
      .slice(0, 8)
      .map((order) => ({
        playerNick: sanitizeText(order.playerNick, 16) || "Gracz",
        reviewText: sanitizeText(order.reviewText, 220),
        createdAt: order.createdAt || new Date().toISOString()
      }));

    return res.status(200).json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: "Błąd serwera podczas pobierania opinii." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

async function startServer(preferredPort) {
  await ensureDataFiles();

  const maxAttempts = 10;
  const tryListen = (port, attempt) => {
    const server = app.listen(port, () => {
      console.log(`AsteriaMC Item Shop dziala: http://localhost:${port}`);
    });

    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE" && attempt < maxAttempts) {
        const nextPort = port + 1;
        console.warn(`Port ${port} jest zajety, probuje port ${nextPort}...`);
        tryListen(nextPort, attempt + 1);
        return;
      }

      console.error("Nie udalo sie uruchomic serwera:", error.message);
      process.exit(1);
    });
  };

  tryListen(Number(preferredPort) || 3000, 0);
}

startServer(PORT);

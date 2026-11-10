// Erişim şifresi ve kullanım sınırları.
// Uygulama internette tek bir API anahtarıyla paylaşıldığında kotanın
// herkese adil dağılmasını ve yabancıların kotayı harcamamasını sağlar.
// Sayaçlar bellekte tutulur; sunucu yeniden başlarsa sıfırlanır.

import { timingSafeEqual, createHash } from "node:crypto";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const limits = {
  perUser: numberFromEnv("DAILY_AI_LIMIT_PER_USER", 15),
  total: numberFromEnv("DAILY_AI_LIMIT_TOTAL", 200),
  requestsPerMinute: numberFromEnv("AI_REQUESTS_PER_MINUTE", 8),
};

// ---------- Erişim şifresi ----------

export function accessRequired() {
  return Boolean(process.env.ACCESS_CODE);
}

function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

export function isValidCode(code) {
  if (!accessRequired()) return true;
  return timingSafeEqual(digest(code), digest(process.env.ACCESS_CODE));
}

export function requireAccess(request, response, next) {
  if (isValidCode(request.get("x-access-code"))) return next();
  return response.status(401).json({
    error: "Bu uygulamayı kullanmak için giriş şifresi gerekiyor.",
    code: "ACCESS_REQUIRED",
  });
}

// ---------- Basit istek sınırlayıcı (IP başına) ----------

export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) {
      const fresh = times.filter((time) => now - time < windowMs);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs).unref();
  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip ?? "unknown";
    const times = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (times.length >= max) {
      response.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return response.status(429).json({ error: message });
    }
    times.push(now);
    hits.set(key, times);
    return next();
  };
}

// ---------- Günlük AI kotası ----------

// Gemini ücretsiz kotası Pasifik saatiyle gece yarısı yenilenir; sayaçları da aynı güne göre tutuyoruz.
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

export function nextResetText() {
  const now = new Date();
  const today = dayKey(now);
  // Bir sonraki Pasifik gece yarısını dakikalık adımlarla bulmak yerine saat saat ilerle.
  let probe = new Date(now);
  probe.setUTCMinutes(0, 0, 0);
  while (dayKey(probe) === today) probe = new Date(probe.getTime() + 60 * 60 * 1000);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit",
  }).format(probe);
}

let usageDay = dayKey();
let totalUsed = 0;
const userUsed = new Map();

function rollDay() {
  const today = dayKey();
  if (today !== usageDay) {
    usageDay = today;
    totalUsed = 0;
    userUsed.clear();
  }
}

export function clientKey(request) {
  const id = request.get("x-client-id");
  if (id && /^[\w-]{8,64}$/.test(id)) return `client:${id}`;
  return `ip:${request.ip ?? "unknown"}`;
}

export function usageFor(key) {
  rollDay();
  const used = userUsed.get(key) ?? 0;
  const remainingUser = limits.perUser > 0 ? Math.max(0, limits.perUser - used) : Infinity;
  const remainingTotal = limits.total > 0 ? Math.max(0, limits.total - totalUsed) : Infinity;
  return {
    limit: limits.perUser || null,
    remaining: Number.isFinite(remainingUser) ? Math.min(remainingUser, remainingTotal) : (Number.isFinite(remainingTotal) ? remainingTotal : null),
    userExhausted: remainingUser <= 0,
    totalExhausted: remainingTotal <= 0,
    resetsAt: nextResetText(),
  };
}

export function recordUse(key) {
  rollDay();
  totalUsed += 1;
  userUsed.set(key, (userUsed.get(key) ?? 0) + 1);
}

// ---------- Dakikalık AI istek sınırı (tüm kullanıcılar için ortak) ----------

const recentAiRequests = [];

function pruneRecent(now) {
  while (recentAiRequests.length && now - recentAiRequests[0] >= 60_000) recentAiRequests.shift();
}

// n adet AI isteği için yer açılana kadar bekler (en fazla maxWaitMs). Yer açılmazsa false döner.
export async function acquireAiSlots(n, maxWaitMs = 30_000) {
  if (!limits.requestsPerMinute) return true;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const now = Date.now();
    pruneRecent(now);
    if (recentAiRequests.length + n <= limits.requestsPerMinute) {
      for (let i = 0; i < n; i += 1) recentAiRequests.push(now);
      return true;
    }
    if (now >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

import "dotenv/config";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalAnalysis, detectLanguage } from "./summarizer.js";
import { AIBusyError, AIConfigError, AIQuotaError, REQUESTS_PER_ANALYSIS, analyzeWithAI, getFallbackModel, getModel, getProvider, transcribeAudio } from "./ai.js";
import {
  acquireAiSlots, accessRequired, clientKey, isValidCode, limits, rateLimit, recordUse, requireAccess, usageFor,
} from "./access.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));
const maxFileSize = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize, files: 1 },
});

// Render gibi platformlar bir proxy arkasında çalışır; gerçek kullanıcı IP'sini almak için gerekli.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public")));

function cleanText(text) {
  return String(text ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocument(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    return { text: cleanText(file.buffer.toString("utf8")), highlights: [] };
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: cleanText(result.value), highlights: [] };
  }
  if (extension === ".pdf") {
    const document = await pdfjs.getDocument({
      data: new Uint8Array(file.buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      // Yazı tipi ayrıştırma uyarılarını ("TT: undefined function" vb.) gizle; yalnızca hataları göster.
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
    const pageTexts = [];
    const pages = [];
    const highlights = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let line = null;
      let lastY = null;
      let lastEnd = null;
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        const x = item.transform?.[4] ?? 0;
        const y = item.transform?.[5] ?? 0;
        const size = Math.abs(item.transform?.[3] ?? item.height ?? 0) || item.height || 0;
        const sameLine = line && lastY !== null && Math.abs(y - lastY) <= Math.max(2, size * 0.5);
        if (!sameLine) {
          if (line && line.text.trim()) lines.push(line);
          line = { text: "", size: 0 };
          lastEnd = null;
        }
        if (item.str) {
          const gap = lastEnd === null ? 0 : x - lastEnd;
          const needsSpace = line.text && !line.text.endsWith(" ") && !item.str.startsWith(" ") && gap > size * 0.12;
          line.text += (needsSpace ? " " : "") + item.str;
          line.size = Math.max(line.size, size);
          lastEnd = x + (item.width ?? 0);
          lastY = y;
        }
        if (item.hasEOL) {
          if (line.text.trim()) lines.push(line);
          line = null;
          lastY = null;
        }
      }
      if (line && line.text.trim()) lines.push(line);
      const cleanLines = lines.map((entry) => ({ text: entry.text.replace(/\s+/g, " ").trim(), size: Math.round(entry.size * 10) / 10 })).filter((entry) => entry.text);
      pages.push({ page: pageNumber, lines: cleanLines });
      const pageText = cleanLines.map((entry) => entry.text).join("\n");
      pageTexts.push(`[Sayfa ${pageNumber}]\n${pageText}`);
      const operators = await page.getOperatorList();
      const textOperators = new Set([
        pdfjs.OPS.showText,
        pdfjs.OPS.showSpacedText,
        pdfjs.OPS.nextLineShowText,
        pdfjs.OPS.nextLineSetSpacingShowText,
      ]);
      let nonBlackFill = false;
      let coloredTextFound = false;
      for (let index = 0; index < operators.fnArray.length; index += 1) {
        const operator = operators.fnArray[index];
        if (operator === pdfjs.OPS.setFillRGBColor) {
          // Siyah ve gri tonları (ör. altbilgi) renkli sayma; yalnızca belirgin renkleri işaretle.
          const args = operators.argsArray[index] ?? [];
          let channels;
          if (typeof args[0] === "string" && /^#[\da-f]{6}$/i.test(args[0])) {
            channels = [1, 3, 5].map((offset) => Number.parseInt(args[0].slice(offset, offset + 2), 16) / 255);
          } else if (typeof args[0] === "string") {
            channels = (args[0].match(/[\d.]+/g) ?? []).map((channel) => Number(channel) / 255);
          } else {
            channels = args.map(Number);
          }
          nonBlackFill = channels.length >= 3 && Math.max(...channels) - Math.min(...channels) > 0.18;
        } else if (nonBlackFill && textOperators.has(operator)) {
          coloredTextFound = true;
        }
      }
      if (coloredTextFound) {
        highlights.push({
          kind: "colored",
          text: pageText.replace(/[\uE000-\uF8FF]/gu, "•").replace(/\s+/g, " ").slice(0, 240) || "Renkli metin bulunan sayfa",
          page: pageNumber,
          note: "Sayfada siyah dışı metin rengi tespit edildi; PDF renk işleçleri etkilenmiş sözcükleri tek tek belirleyemiyor.",
        });
      }
      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        const subtype = annotation.subtype?.toLowerCase();
        if (!["highlight", "underline", "strikeout", "squiggly"].includes(subtype)) {
          continue;
        }
        const selected = (
          annotation.overlaidText ??
          annotation.contentsObj?.str ??
          annotation.contents ??
          ""
        ).trim();
        highlights.push({
          kind: subtype === "highlight" ? "highlight" : "underline",
          text: selected || (annotation.title || "PDF işaretlemesi"),
          page: pageNumber,
          note: selected
            ? "PDF içindeki işaretleme açıklaması."
            : `${pageNumber}. sayfada biçimlendirilmiş bir işaretleme bulundu.`,
        });
      }
    }
    return { text: cleanText(pageTexts.join("\n\n")), highlights, pages };
  }
  const unsupported = new Error("Desteklenmeyen dosya türü. PDF, TXT, MD veya DOCX yükleyin.");
  unsupported.status = 400;
  throw unsupported;
}

const providerLabel = { gemini: "Google Gemini", openai: "OpenAI" };

// AI hatasını kullanıcıya gösterilecek kısa ve anlaşılır bir mesaja çevirir.
function friendlyAiError(error, tr) {
  if (error instanceof AIBusyError) {
    return tr
      ? "Google Gemini şu an çok yoğun (Google tarafında geçici bir sorun, yedek model de denendi). Birkaç dakika sonra tekrar oluşturmayı dene."
      : "Google Gemini is overloaded right now (a temporary problem on Google's side). Try again in a few minutes.";
  }
  if (error instanceof AIQuotaError) {
    return tr
      ? "AI kotası şu an dolu (Google'ın ücretsiz sınırı). Biraz sonra tekrar deneyebilirsin."
      : "The AI quota is currently full. Try again later.";
  }
  if (error instanceof AIConfigError) {
    return tr
      ? `AI ayarlarında bir sorun var: ${error.message} .env dosyasını kontrol et.`
      : `There is a problem with the AI settings: ${error.message}`;
  }
  return tr ? "AI analizi tamamlanamadı." : "AI analysis could not be completed.";
}

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 12,
  message: "Çok fazla istek gönderildi. Bir dakika bekleyip tekrar deneyin.",
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.",
});

function publicUsage(request) {
  if (!getProvider()) return null;
  const usage = usageFor(clientKey(request));
  return { limit: usage.limit, remaining: usage.remaining, resetsAt: usage.resetsAt };
}

app.get("/api/health", (request, response) => {
  const provider = getProvider();
  response.json({
    status: "ok",
    aiConfigured: Boolean(provider),
    provider,
    providerLabel: providerLabel[provider] ?? null,
    model: getModel(),
    accessRequired: accessRequired(),
    accessValid: isValidCode(request.get("x-access-code")),
    usage: isValidCode(request.get("x-access-code")) ? publicUsage(request) : null,
  });
});

app.post("/api/verify-access", loginLimiter, (request, response) => {
  if (!accessRequired() || isValidCode(request.body?.code)) {
    return response.json({ ok: true });
  }
  return response.status(401).json({ error: "Şifre hatalı." });
});

// AI ile mi yoksa yerel olarak mı analiz edileceğine karar verir; kota dolduysa nedenini döndürür.
async function chooseAnalysisMode(request, language) {
  const tr = language === "tr";
  if (!getProvider()) return { mode: "local" };
  const key = clientKey(request);
  const usage = usageFor(key);
  if (usage.userExhausted) {
    return {
      mode: "local",
      reason: tr
        ? `Bugünkü ${limits.perUser} AI analiz hakkın doldu; yerel analiz gösteriliyor. Yenilenme saati: ${usage.resetsAt}.`
        : `You have used today's ${limits.perUser} AI analyses; showing local analysis. Resets at ${usage.resetsAt} (Istanbul time).`,
    };
  }
  if (usage.totalExhausted) {
    return {
      mode: "local",
      reason: tr
        ? `Uygulamanın bugünkü toplam AI kotası doldu; yerel analiz gösteriliyor. Yenilenme saati: ${usage.resetsAt}.`
        : `Today's shared AI quota is used up; showing local analysis. Resets at ${usage.resetsAt} (Istanbul time).`,
    };
  }
  const slots = await acquireAiSlots(REQUESTS_PER_ANALYSIS);
  if (!slots) {
    return {
      mode: "local",
      reason: tr
        ? "Şu an çok fazla kişi aynı anda AI kullanıyor; yerel analiz gösteriliyor. Bir dakika sonra tekrar deneyebilirsin."
        : "Too many people are using AI right now; showing local analysis. Try again in a minute.",
    };
  }
  return { mode: "ai", key };
}

app.post("/api/analyze", apiLimiter, requireAccess, upload.single("file"), async (request, response, next) => {
  try {
    const language = request.body.language;
    if (!["tr", "en"].includes(language)) {
      return response.status(400).json({ error: "İşleme başlamadan önce Türkçe veya İngilizce seçin." });
    }
    let text = cleanText(request.body.text);
    let highlights = [];
    let pages = null;
    if (request.file) {
      const document = await extractDocument(request.file);
      text = document.text;
      highlights = document.highlights;
      pages = document.pages ?? null;
    }
    if (text.length < 30) {
      return response.status(400).json({ error: "Analiz için en az 30 karakterlik metin veya metin içeren bir belge sağlayın." });
    }
    if (text.length > 90_000) {
      text = text.slice(0, 90_000);
    }
    const tr = language === "tr";
    const decision = await chooseAnalysisMode(request, language);
    let result;
    if (decision.mode === "ai") {
      try {
        result = await analyzeWithAI(text, language, highlights);
        recordUse(decision.key);
      } catch (error) {
        console.error("AI analizi başarısız, yerel analize geçiliyor:", error.message);
        result = buildLocalAnalysis({ text, pages, language });
        const sameLanguage = detectLanguage(text) === language;
        const languageNote = sameLanguage ? "" : (tr
          ? " Yerel analiz çeviri yapamadığı için özet maddeleri kaynağın dilinde kaldı."
          : " Local analysis cannot translate, so the summary stays in the source language.");
        result.notice = `${friendlyAiError(error, tr)} ${tr ? "Şimdilik yerel analiz gösteriliyor." : "Showing local analysis for now."}${languageNote}`;
      }
    } else {
      result = buildLocalAnalysis({ text, pages, language });
      if (decision.reason) result.notice = decision.reason;
    }
    result.highlights = [...highlights, ...(result.highlights ?? [])];
    result.usage = publicUsage(request);
    return response.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/transcribe", apiLimiter, requireAccess, upload.single("audio"), async (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).json({ error: "Lütfen bir ses dosyası seçin." });
    }
    if (!getProvider()) {
      return response.status(503).json({
        error: "Ses dosyasını yazıya çevirmek için AI anahtarı gerekiyor. Bunun yerine Chrome/Edge'deki canlı dikteyi kullanabilirsin.",
      });
    }
    const allowed = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/flac"]);
    if (!allowed.has(request.file.mimetype) && !/\.(mp3|mp4|m4a|aac|wav|webm|ogg|flac)$/i.test(request.file.originalname)) {
      return response.status(400).json({ error: "Desteklenmeyen ses biçimi. MP3, M4A, WAV, WEBM veya OGG deneyin." });
    }
    const key = clientKey(request);
    const usage = usageFor(key);
    if (usage.userExhausted || usage.totalExhausted) {
      return response.status(429).json({
        error: `Bugünkü AI hakkı doldu; ses dosyası çevrilemiyor. Yenilenme saati: ${usage.resetsAt}. Bu arada canlı dikteyi kullanabilirsin.`,
      });
    }
    if (!(await acquireAiSlots(1))) {
      return response.status(429).json({ error: "Şu an çok yoğun. Bir dakika sonra tekrar dene." });
    }
    let transcript;
    try {
      transcript = await transcribeAudio(request.file);
    } catch (error) {
      if (error instanceof AIQuotaError || error instanceof AIBusyError || error instanceof AIConfigError) {
        console.error("Ses transkripsiyonu başarısız:", error.message);
        return response.status(error instanceof AIQuotaError ? 429 : 503).json({
          error: `${friendlyAiError(error, true)} Bu arada canlı dikteyi kullanabilirsin.`,
        });
      }
      throw error;
    }
    recordUse(key);
    return response.json({ text: cleanText(transcript), usage: publicUsage(request) });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return response.status(413).json({ error: "Dosya boyutu 15 MB sınırını aşıyor." });
  }
  const status = error.status >= 400 && error.status < 600 ? error.status : 500;
  console.error(error);
  return response.status(status).json({
    error: status === 500 ? "İşlem tamamlanamadı. Sunucu günlüklerini kontrol edin." : error.message,
  });
});

app.listen(port, () => {
  const provider = getProvider();
  console.log(`Not Asist listening at http://localhost:${port}`);
  console.log(`AI: ${provider ? `${provider} (${getModel()}${provider === "gemini" && getFallbackModel() ? `, yedek: ${getFallbackModel()}` : ""})` : "kapalı, yerel analiz"} · Şifre: ${accessRequired() ? "açık" : "kapalı"} · Kişi başı günlük AI: ${limits.perUser || "sınırsız"} · Toplam günlük AI: ${limits.total || "sınırsız"}`);
});

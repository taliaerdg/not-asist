// Yerel (API anahtarı gerektirmeyen) özetleme motoru.
// Belgeyi başlıklara/bölümlere ayırır, her cümleyi/maddeyi puanlar ve
// bölüm bölüm, sınav odaklı bir özet çıkarır.

const STOP_WORDS = new Set(
  `acaba ama ancak artık asla aslında az bazı bazen belki ben beri biri birkaç birçok bile bir
   birlikte biz bu buna bunda bundan bunlar bunları bunların bunu bunun burada böyle böylece bütün
   çok çünkü da daha dahi de değil diğer diye dolayı en fakat gibi göre hem hep hepsi her
   herhangi herkes hiç için ile ise işte kadar karşı kez kendi kendine ki kim mı mi mu mü
   nasıl ne neden nerede niçin niye o olan olarak oldu olduğu olduğunu olmak olması olur onlar
   onun ona ondan onu öyle sadece sanki şey şu şunu tüm üzere var veya ve ya yani yine yok
   zaten sonra önce aynı ayrıca eğer bile olan olarak olabilir olacak olmayan şekilde şeklinde
   tarafından arasında içinde üzerinde altında kadar gibi göre sonucu sonra yapılır yapılan
   the and for that this from with are was were have has had not but their they them then
   than into about which when where what how why can could should would will its these those
   also more most such some any each both between through during using used use been being
   there here only other over under very may might must shall you your our his her she him
   all one two out own same so too just does did doing done get got make made many much
   upon per via etc while within without because however therefore thus example e.g i.e
   denir verilir adı olur gerekir kullanılır çalışır yapar eder edilir sağlar bulunur şimdi bugün
   geçelim konuşacağız bakalım görelim ayrıca nokta`
    .split(/\s+/)
    .filter(Boolean),
);

const TR_SUFFIXES = [
  "lerinden", "larından", "lerinin", "larının", "lerine", "larına", "lerini", "larını",
  "lerde", "larda", "lerden", "lardan", "leri", "ları", "ler", "lar", "nin", "nın", "nun",
  "nün", "dir", "dır", "dur", "dür", "tir", "tır", "den", "dan", "ten", "tan", "de", "da",
  "te", "ta", "si", "sı", "su", "sü", "in", "ın", "un", "ün", "ye", "ya", "yi", "yı", "yu", "yü",
];

const CUES = {
  definition: [
    /\b(is|are) (defined|called|known) as\b/i, /\brefers? to\b/i, /\bmeans\b/i, /\bis an? \b/i,
    /\btanım(ı|lanır|lanmaktadır)?\b/i, /\bdenir\b/i, /\badı verilir\b/i, /\bdemektir\b/i,
    /\banlamına gelir\b/i, /\bolarak adlandırılır\b/i, /\bdefinition\b/i,
    /(^|\s)bir\s+[\p{L}\s-]{2,50}(dır|dir|dur|dür|tır|tir|tur|tür)\.?$/u,
  ],
  emphasis: [
    /\bimportant\b/i, /\bkey\b/i, /\bnote\b/i, /\bremember\b/i, /\bcritical\b/i, /\bessential\b/i,
    /\bmust\b/i, /\balways\b/i, /\bnever\b/i, /\bönemli\b/i, /\bdikkat\b/i, /\bunutma/i,
    /\bmutlaka\b/i, /\bkritik\b/i, /\btemel\b/i, /\basla\b/i, /\bher zaman\b/i, /\bzorunlu\b/i,
  ],
  comparison: [
    /\bdifferen(t|ce)\b/i, /\bcompared?\b/i, /\bwhereas\b/i, /\bunlike\b/i, /\bvs\.?\b/i,
    /\bversus\b/i, /\bfark(ı|lı|ları)?\b/i, /\bkarşın\b/i, /\baksine\b/i, /\bise\b/i,
    /\badvantage/i, /\bdisadvantage/i, /\bavantaj/i, /\bdezavantaj/i, /\bpros\b/i, /\bcons\b/i,
  ],
  structure: [
    /\btypes? of\b/i, /\bkinds? of\b/i, /\bsteps?\b/i, /\bphases?\b/i, /\bstages?\b/i,
    /\bcomponents?\b/i, /\bconsists? of\b/i, /\btürleri\b/i, /\bçeşit/i, /\başama/i, /\badım/i,
    /\bbileşen/i, /\boluşur\b/i, /\bilke/i, /\bprinciples?\b/i, /\bproperties\b/i, /\bözellik/i,
  ],
  causal: [
    /\bbecause\b/i, /\btherefore\b/i, /\bresults? in\b/i, /\bleads? to\b/i, /\bcauses?\b/i,
    /\bnedeniyle\b/i, /\bbu yüzden\b/i, /\bsonucunda\b/i, /\bneden olur\b/i, /\bsağlar\b/i,
  ],
};

// PDF'lerde Wingdings/Symbol yazı tipiyle çizilen madde işaretleri Unicode "özel kullanım alanı"
// (U+E000–U+F8FF) karakterleri olarak gelir; bunları da madde işareti sayıyoruz.
const BULLET_CHARS = "\\uE000-\\uF8FF•●○◦▪■□►▶➢➤✓✔❖◆◇";
const BULLET = new RegExp(`^\\s*(?:[${BULLET_CHARS}\\-–—*·]|\\(?[0-9]{1,2}[.)]|\\(?[a-zA-Z][.)](?=\\s))\\s*`, "u");
const INLINE_BULLET = new RegExp(`(?!^)\\s*[${BULLET_CHARS}]\\s*`, "gu");

// "u s e r s p a c e" gibi harf aralıklı yazılmış metni birleştirir.
function fixLetterSpacing(text) {
  return text.replace(/(^|\s)((?:\p{L} ){3,}\p{L})(?=\s|$|[.,;:!?)])/gu, (_, lead, run) => lead + run.replace(/ /g, ""));
}

// Bir satırdaki birden fazla maddeyi ayrı satırlara böler, özel karakterleri temizler.
function expandLine(line) {
  const text = fixLetterSpacing(String(line.text ?? ""))
    .replace(/^\s*[\uE000-\uF8FF]\s*/u, "• ")
    .replace(INLINE_BULLET, "\n• ")
    .replace(/[\uE000-\uF8FF]/gu, "");
  return text.split("\n").map((piece) => ({ ...line, text: piece }));
}

function normalizeSpace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return value.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
}

function lowerAny(value, isTurkish) {
  return isTurkish ? lower(value) : value.toLowerCase();
}

export function detectLanguage(text) {
  const sample = text.slice(0, 20000);
  const trChars = (sample.match(/[çğıöşüÇĞİÖŞÜ]/g) ?? []).length;
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  const trHits = words.filter((w) => ["ve", "bir", "bu", "için", "ile", "olarak", "da", "de", "olan"].includes(w)).length;
  const enHits = words.filter((w) => ["the", "and", "of", "is", "to", "in", "that", "for", "are"].includes(w)).length;
  return trChars / Math.max(words.length, 1) > 0.05 || trHits > enHits ? "tr" : "en";
}

function stem(token, isTurkish) {
  let word = token.replace(/['’].*$/, "");
  if (isTurkish) {
    let changed = true;
    while (changed && word.length > 5) {
      changed = false;
      for (const suffix of TR_SUFFIXES) {
        if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
          word = word.slice(0, -suffix.length);
          changed = true;
          break;
        }
      }
    }
  } else if (word.length > 4) {
    word = word.replace(/(ies)$/, "y").replace(/(sses)$/, "ss").replace(/([^s])s$/, "$1");
  }
  return word;
}

function tokenize(text, isTurkish) {
  const tokens = [];
  for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const surface = raw.replace(/['’].*$/, "");
    const word = lowerAny(surface, isTurkish);
    if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    tokens.push({ key: stem(word, isTurkish), surface });
  }
  return tokens;
}

function splitSentences(text) {
  return normalizeSpace(text)
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isTerminal(line) {
  return /[.!?:;]["”')]?$/.test(line);
}

// ---------- Belge yapısını çıkarma ----------

function stripRepeatedLines(pages) {
  if (pages.length < 4) return pages;
  const counts = new Map();
  for (const page of pages) {
    const seen = new Set();
    for (const line of page.lines) {
      const key = lower(line.text).replace(/\d+/g, "#").trim();
      if (key.length > 0 && !seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const limit = Math.max(3, pages.length * 0.4);
  return pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      const key = lower(line.text).replace(/\d+/g, "#").trim();
      return (counts.get(key) ?? 0) < limit;
    }),
  }));
}

function isJunkLine(text) {
  const t = text.trim();
  return (
    t.length === 0 ||
    /^(\d+|page \d+|sayfa \d+|slide \d+|\d+\s*\/\s*\d+)$/i.test(t) ||
    /^[\W_]+$/u.test(t)
  );
}

function cleanTitle(title) {
  return normalizeSpace(fixLetterSpacing(String(title ?? "")).replace(/[\uE000-\uF8FF•●▪■►➢]/gu, " "))
    .replace(/\s*[(\[]?\s*(cont(inued)?|devam(ı)?)\.?\s*[)\]]?\s*$/i, "")
    .replace(/\s*[-–—:]\s*\d+\s*$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[:.]$/, "");
}

// Satırları anlamlı birimlere (madde / paragraf) birleştir.
function linesToUnits(rawLines) {
  const lines = rawLines.flatMap(expandLine);
  const units = [];
  let current = null;
  const lengths = lines.map((l) => l.text.length).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length * 0.75)] ?? 80;
  let previous = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (isJunkLine(text)) continue;
    const bullet = BULLET.test(text);
    const body = text.replace(BULLET, "").trim();
    if (!body) continue;
    const startsLower = /^[\p{Ll}(,]/u.test(body);
    const previousEnded = !current || isTerminal(current.text);
    const previousShort = previous && previous.length < typical * 0.6;
    const newUnit = !current || bullet || (!startsLower && (previousEnded || previousShort));
    if (newUnit) {
      current = { text: body, bullet };
      units.push(current);
    } else {
      current.text = current.text.endsWith("-") ? current.text.slice(0, -1) + body : `${current.text} ${body}`;
    }
    previous = text;
  }
  // Çok uzun paragrafları cümlelere böl.
  const result = [];
  for (const unit of units) {
    if (unit.text.length > 320) {
      for (const sentence of splitSentences(unit.text)) result.push({ text: sentence, bullet: false });
    } else {
      result.push(unit);
    }
  }
  return result.filter((u) => u.text.length >= 3);
}

function looksLikeHeading(line, next) {
  const t = line.trim();
  if (!t || t.length > 90 || isTerminal(t) && !t.endsWith(":")) return false;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (/^(\d+(\.\d+)*[.)]?|[IVX]+\.)\s+\p{Lu}/u.test(t) && t.split(/\s+/).length <= 10) return true;
  if (t === t.toLocaleUpperCase("tr") && /\p{L}{3}/u.test(t) && t.split(/\s+/).length <= 8) return true;
  const words = t.split(/\s+/).length;
  return Boolean(next) && words <= 8 && /^\p{Lu}/u.test(t) && !BULLET.test(t) && next.trim().length > t.length;
}

function sectionsFromPages(pages) {
  const cleaned = stripRepeatedLines(pages);
  const sections = [];
  for (const page of cleaned) {
    const lines = page.lines.filter((l) => !isJunkLine(l.text));
    if (lines.length === 0) continue;
    const sizes = lines.map((l) => l.size || 0).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 0;
    let titleIndex = -1;
    for (let i = 0; i < Math.min(3, lines.length); i += 1) {
      const line = lines[i];
      if (line.text.length <= 100 && median > 0 && line.size >= median * 1.15) {
        titleIndex = i;
        break;
      }
    }
    if (titleIndex === -1 && lines.length > 1 && lines[0].text.length <= 70 && !isTerminal(lines[0].text) && !BULLET.test(lines[0].text)) {
      titleIndex = 0;
    }
    const title = titleIndex >= 0 ? cleanTitle(lines[titleIndex].text) : "";
    const units = linesToUnits(lines.filter((_, i) => i !== titleIndex));
    const last = sections.at(-1);
    if (last && title && lower(last.title) === lower(title)) {
      last.units.push(...units);
      last.pageEnd = page.page;
    } else if (last && !title && last.units.length < 4) {
      last.units.push(...units);
      last.pageEnd = page.page;
    } else {
      sections.push({ title, units, pageStart: page.page, pageEnd: page.page });
    }
  }
  return sections.filter((s) => s.units.length > 0 || s.title);
}

function sectionsFromText(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = { title: "", lines: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines.slice(i + 1).find((l) => l.trim());
    const prevBlank = i === 0 || !lines[i - 1].trim();
    if (prevBlank && looksLikeHeading(line, next)) {
      if (current.lines.length || current.title) sections.push(current);
      current = { title: cleanTitle(line.replace(/^#{1,6}\s+/, "")), lines: [] };
    } else if (line.trim()) {
      current.lines.push({ text: line });
    } else if (current.lines.length && current.lines.at(-1).text !== "") {
      current.lines.push({ text: "" });
    }
  }
  if (current.lines.length || current.title) sections.push(current);
  return sections.map((s) => {
    // Boş satırlar paragraf sınırıdır.
    const paragraphs = [];
    let buffer = [];
    for (const l of s.lines) {
      if (l.text === "") {
        if (buffer.length) paragraphs.push(buffer);
        buffer = [];
      } else buffer.push(l);
    }
    if (buffer.length) paragraphs.push(buffer);
    return { title: s.title, units: paragraphs.flatMap((p) => linesToUnits(p)) };
  });
}

// Başlığı olmayan uzun metinleri (ör. transkript) konu bloklarına böl.
function chunkUntitled(sections, isTurkish) {
  const result = [];
  for (const section of sections) {
    if (section.title || section.units.length <= 10) {
      result.push(section);
      continue;
    }
    const size = section.units.length > 40 ? 10 : 8;
    for (let i = 0; i < section.units.length; i += size) {
      result.push({ title: "", units: section.units.slice(i, i + size), auto: true, isTurkish });
    }
  }
  return result;
}

// ---------- Puanlama ----------

function cueTypes(text) {
  return Object.entries(CUES)
    .filter(([, patterns]) => patterns.some((p) => p.test(text)))
    .map(([type]) => type);
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const inter = [...setA].filter((x) => setB.has(x)).length;
  return inter / Math.max(1, setA.size + setB.size - inter);
}

function scoreUnits(sections, isTurkish) {
  const termCounts = new Map();
  const sectionFreq = new Map();
  const surfaces = new Map();
  for (const section of sections) {
    const inSection = new Set();
    for (const unit of section.units) {
      unit.tokens = tokenize(unit.text, isTurkish);
      for (const token of unit.tokens) {
        termCounts.set(token.key, (termCounts.get(token.key) ?? 0) + 1);
        inSection.add(token.key);
        const forms = surfaces.get(token.key) ?? new Map();
        forms.set(token.surface, (forms.get(token.surface) ?? 0) + 1);
        surfaces.set(token.key, forms);
      }
    }
    for (const key of inSection) sectionFreq.set(key, (sectionFreq.get(key) ?? 0) + 1);
  }
  const sectionCount = Math.max(1, sections.length);
  for (const section of sections) {
    const titleKeys = new Set(tokenize(section.title || "", isTurkish).map((t) => t.key));
    const localCounts = new Map();
    for (const unit of section.units) for (const t of unit.tokens) localCounts.set(t.key, (localCounts.get(t.key) ?? 0) + 1);
    section.units.forEach((unit, index) => {
      const keys = unit.tokens.map((t) => t.key);
      const unique = [...new Set(keys)];
      let weight = 0;
      for (const key of unique) {
        const global = termCounts.get(key) ?? 1;
        const idf = Math.log(1 + sectionCount / (sectionFreq.get(key) ?? 1));
        weight += Math.log(1 + global) * (0.6 + idf) + Math.log(1 + (localCounts.get(key) ?? 0));
        if (titleKeys.has(key)) weight += 2;
      }
      const words = unit.text.split(/\s+/).length;
      let score = weight / Math.sqrt(Math.max(unique.length, 1));
      unit.cues = cueTypes(unit.text);
      if (unit.cues.includes("definition")) score += 4;
      if (unit.cues.includes("emphasis")) score += 3;
      if (unit.cues.includes("comparison")) score += 2;
      if (unit.cues.includes("structure")) score += 1.5;
      if (unit.cues.includes("causal")) score += 1;
      if (/\d/.test(unit.text) && /%|\d{2,}|=|≈|×/.test(unit.text)) score += 1;
      if (index === 0) score += 0.8;
      if (words < 4) score -= 3;
      else if (words < 7) score -= 1;
      if (words > 70) score -= 1.5;
      unit.score = score;
      unit.words = words;
    });
  }
  const bestSurface = (key) => {
    const forms = surfaces.get(key);
    if (!forms) return key;
    return [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  };
  return { termCounts, bestSurface };
}

// ---------- Sözlük ----------

function buildGlossary(sections, termCounts, bestSurface, isTurkish, limit = 12) {
  const units = sections.flatMap((s) => s.units);
  const entries = [];
  const used = new Set();
  const badTerm = /^(önemli|dikkat|not|uyarı|örnek|örneğin|hatırlatma|ipucu|important|note|example|warning|remember|tip|key point|summary|özet|soru|question|answer|cevap)$/i;
  const valid = (term) => {
    const cleanTerm = normalizeSpace(term).replace(/^(the|a|an)\s+/i, "").replace(/[,:;.]+$/, "");
    const key = lowerAny(cleanTerm, isTurkish);
    const words = cleanTerm.split(/\s+/);
    if (!cleanTerm || cleanTerm.length < 2 || words.length > 5 || used.has(key) || STOP_WORDS.has(key)) return null;
    if (/^\d/.test(cleanTerm) || badTerm.test(cleanTerm)) return null;
    const baseWords = cleanTerm.replace(/\s*\(.*\)\s*$/, "").split(/\s+/);
    const lastWord = lowerAny(baseWords.at(-1) ?? "", isTurkish);
    if (isTurkish || /[çğıöşü]/i.test(cleanTerm)) {
      if (/(yor|dır|dir|dur|dür|tır|tir|tur|tür|maz|mez)$/.test(lastWord)) return null;
      if (baseWords.length > 1 && /(ır|ir|ur|ür|ar|er)$/.test(lastWord)) return null;
    }
    return { cleanTerm, key };
  };
  const add = (term, definition) => {
    const ok = valid(term);
    if (!ok) return false;
    used.add(ok.key);
    entries.push({ term: ok.cleanTerm, definition: normalizeSpace(definition).slice(0, 360) });
    return true;
  };

  // Öncelikli adaylar: gerçek tanım kalıpları.
  const strong = [];
  const medium = [];
  for (const unit of units) {
    const text = unit.text;
    let m;
    if ((m = text.match(/^(?:an?\s+|the\s+)?([\p{L}][\p{L}\p{N}\- ]{1,50}?)\s+(?:is|are)\s+(?:defined as|called|known as|an?|the)\s+(.{10,})/iu)) && m[1].split(/\s+/).length <= 4) {
      strong.push([m[1], text]);
    } else if ((m = text.match(/^([\p{L}][\p{L}\p{N}\- ]{1,50}?)\s+(?:refers? to|means)\s+(.{10,})/iu)) && m[1].split(/\s+/).length <= 4) {
      strong.push([m[1], text]);
    } else if ((m = text.match(/^([\p{L}][\p{L}\p{N}\- ]{1,50}?),\s+.{8,}\s+(?:olarak tanımlanır|olarak adlandırılır|demektir|anlamına gelir)/u)) && m[1].split(/\s+/).length <= 4) {
      strong.push([m[1], text]);
    } else if ((m = text.match(/([\p{L}-]{3,40})\s+(?:denir|adı verilir)\s*[.!]?$/u))) {
      strong.push([m[1], text]);
    } else if ((m = text.match(/^([\p{L}][\p{L}\p{N}\- /()]{1,40}?)\s*[:–—]\s+(.{12,})$/u)) && m[1].split(/\s+/).length <= 3) {
      medium.push([m[1], text]);
    }
    for (const match of text.matchAll(/((?:\p{Lu}[\p{L}]+[\s-]+){1,5})\((\p{Lu}{2,8})\)/gu)) {
      strong.push([`${match[2]} (${normalizeSpace(match[1])})`, text]);
    }
    // Türkçe terim + parantez içinde İngilizce karşılık: "bağlam değiştirme (context switch)"
    for (const match of text.matchAll(/((?:[\p{L}]+\s){0,1}[\p{L}]{3,})\s\(([a-z][a-z -]{2,30})\)/gu)) {
      const words = match[1].split(/\s+/).filter((w) => !STOP_WORDS.has(lowerAny(w, isTurkish)));
      if (words.length) medium.push([`${words.join(" ")} (${match[2]})`, text]);
    }
  }
  for (const [term, def] of strong) add(term, def);
  for (const [term, def] of medium) {
    if (entries.length >= limit) break;
    add(term, def);
  }

  // Sık geçen ikili terimler (bigram) ve tekil terimler.
  const bigrams = new Map();
  for (const unit of units) {
    const tokens = unit.tokens ?? [];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const key = `${tokens[i].key} ${tokens[i + 1].key}`;
      const surface = `${tokens[i].surface} ${tokens[i + 1].surface}`;
      if (!unit.text.includes(surface)) continue;
      const item = bigrams.get(key) ?? { count: 0, surface };
      item.count += 1;
      bigrams.set(key, item);
    }
  }
  const generic = /^(system|systems|application|example|thing|things|way|ways|part|parts|number|time|times|case|cases|type|types|point|level|value|values|result|results|problem|form|sistem|uygulama|örnek|şekil|durum|tür|zaman|sonuç|değer|kısım|parça|bilgi)$/i;
  const weakEnglish = /(ed|ly|ing|ous|ful|ive|able|ible)$/i;
  const candidates = [
    ...[...bigrams.values()]
      .filter((b) => b.count >= 3 || (b.count >= 2 && sections.some((sec) => lowerAny(sec.title || "", isTurkish).includes(lowerAny(b.surface, isTurkish)))))
      .map((b) => ({ term: b.surface, score: b.count * 2.5 })),
    ...[...termCounts.entries()]
      .filter(([key, c]) => c >= 3 && key.length >= 4)
      .map(([key, c]) => ({ term: bestSurface(key), score: c }))
      .filter((c) => !generic.test(c.term) && (isTurkish || !weakEnglish.test(c.term))),
  ].sort((a, b) => b.score - a.score);
  const frequencyLimit = Math.min(limit, Math.max(entries.length + 4, 8));

  for (const candidate of candidates) {
    if (entries.length >= frequencyLimit) break;
    const lowerTerm = lowerAny(candidate.term, isTurkish);
    if ([...used].some((u) => u.includes(lowerTerm) || lowerTerm.includes(u))) continue;
    const contexts = units
      .filter((u) => lowerAny(u.text, isTurkish).includes(lowerTerm) && u.words >= 6 && u.words <= 60)
      .sort((a, b) => {
        const posA = lowerAny(a.text, isTurkish).indexOf(lowerTerm);
        const posB = lowerAny(b.text, isTurkish).indexOf(lowerTerm);
        const wholeStart = (unit) => new RegExp(`^${lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(lowerAny(unit.text, isTurkish));
        const rank = (unit, pos) => (unit.cues.includes("definition") ? 2 : 0) + (pos === 0 ? 1 : 0) + (wholeStart(unit) ? 2 : 0);
        return rank(b, posB) - rank(a, posA) || posA - posB || b.score - a.score;
      });
    if (!contexts.length) continue;
    add(candidate.term, contexts[0].text);
  }
  return entries.map((entry) => ({
    term: entry.term.charAt(0).toLocaleUpperCase(isTurkish ? "tr" : "en") + entry.term.slice(1),
    definition: entry.definition,
  }));
}

// ---------- Soru üretimi ----------

function swapTerm(sentence, glossary, isTurkish) {
  const terms = glossary
    .map((g) => g.term.replace(/\s*\(.*\)$/, ""))
    .filter((t) => t.length >= 3 && t.split(/\s+/).length <= 3);
  for (const term of terms) {
    const pattern = new RegExp(`(^|[^\\p{L}])(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[^\\p{L}]|$)`, "iu");
    if (!pattern.test(sentence) || new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i").test(sentence)) continue;
    const replacement = terms.find((t) => t !== term && !lowerAny(sentence, isTurkish).includes(lowerAny(t, isTurkish)));
    if (!replacement) continue;
    const text = sentence.replace(pattern, (_, before, found) => {
      const lowerStart = /^\p{Ll}/u.test(found) && before !== "" && !/^\p{Lu}{2}/u.test(replacement);
      const word = lowerStart ? lowerAny(replacement.charAt(0), isTurkish) + replacement.slice(1) : replacement;
      return `${before}${word}`;
    });
    return { text, original: term, replacement };
  }
  return null;
}

function buildQuestions(sections, ranked, glossary, isTurkish) {
  const questions = [];
  const t = (tr, en) => (isTurkish ? tr : en);
  const topSections = [...sections]
    .filter((s) => s.title && s.selected?.length)
    .sort((a, b) => b.selected.reduce((x, u) => x + u.score, 0) - a.selected.reduce((x, u) => x + u.score, 0))
    .slice(0, 2);
  for (const section of topSections) {
    questions.push({
      type: "open",
      question: t(`“${section.title}” konusunu temel noktalarıyla açıklayın.`, `Explain “${section.title}” and its key points.`),
      answer: section.selected.slice(0, 4).map((u) => u.text).join(" "),
      explanation: t("Model cevap, bu bölümün özetindeki en önemli maddelerden oluşturuldu.", "The model answer is built from the most important points of this section."),
    });
  }
  if (!questions.length && ranked.length) {
    questions.push({
      type: "open",
      question: t("Metnin ana fikrini ve onu destekleyen önemli noktaları açıklayın.", "Explain the main idea of the text and the points that support it."),
      answer: ranked.slice(0, 3).map((u) => u.text).join(" "),
      explanation: t("Model cevap metnin en önemli cümlelerinden oluşturuldu.", "The model answer is built from the most important sentences."),
    });
  }

  const statementPool = ranked.filter((u) => u.words >= 7 && u.words <= 45 && !u.text.endsWith(":"));
  const falseCandidates = [];
  for (const unit of statementPool) {
    const swapped = swapTerm(unit.text, glossary, isTurkish);
    if (swapped) falseCandidates.push({ unit, ...swapped });
    if (falseCandidates.length >= 4) break;
  }

  const trueOnes = statementPool.filter((u) => !falseCandidates.some((f) => f.unit === u));
  if (trueOnes[0]) {
    questions.push({ type: "true_false", question: trueOnes[0].text, answer: true, explanation: t("Bu ifade kaynakta aynen yer alıyor.", "This statement appears in the source.") });
  }
  if (falseCandidates[0]) {
    questions.push({
      type: "true_false",
      question: falseCandidates[0].text,
      answer: false,
      explanation: t(`Yanlış: ifadede “${falseCandidates[0].original}” yerine “${falseCandidates[0].replacement}” yazıldı. Doğrusu: ${falseCandidates[0].unit.text}`,
        `False: “${falseCandidates[0].original}” was replaced with “${falseCandidates[0].replacement}”. Correct: ${falseCandidates[0].unit.text}`),
    });
  } else if (trueOnes[1]) {
    questions.push({ type: "true_false", question: trueOnes[1].text, answer: true, explanation: t("Bu ifade kaynakta yer alıyor.", "This statement appears in the source.") });
  }

  const trueStatements = trueOnes.slice(1, 4);
  const falseStatements = falseCandidates.slice(1, 3);
  if (trueStatements.length === 3 && falseStatements.length === 2) {
    const options = [
      ...trueStatements.map((u) => ({ text: u.text, correct: true })),
      ...falseStatements.map((f) => ({ text: f.text, correct: false })),
    ];
    // Deterministik karıştırma
    options.sort((a, b) => a.text.length % 3 - b.text.length % 3 || a.text.localeCompare(b.text));
    questions.push({
      type: "multiple_select",
      question: t("Aşağıdaki ifadelerden hangileri doğrudur? (3 doğru seçenek var)", "Which of the following statements are true? (3 correct options)"),
      options: options.map((o, i) => ({ id: `option-${i + 1}`, text: o.text })),
      correctAnswers: options.map((o, i) => (o.correct ? `option-${i + 1}` : null)).filter(Boolean),
      explanation: t(`Yanlış seçeneklerde terimler değiştirildi: ${falseStatements.map((f) => `“${f.replacement}” → “${f.original}”`).join(", ")}.`,
        `In the false options, terms were swapped: ${falseStatements.map((f) => `“${f.replacement}” → “${f.original}”`).join(", ")}.`),
    });
  } else if (glossary.length >= 3) {
    const distractorPool = t("fotosentez,teleskop,yer çekimi,seramik,volkan", "photosynthesis,telescope,gravity,ceramics,volcano").split(",");
    const allText = lower(sections.flatMap((s) => s.units.map((u) => u.text)).join(" "));
    const distractors = distractorPool.filter((d) => !allText.includes(d)).slice(0, 2);
    const correct = glossary.slice(0, 3).map((g) => g.term);
    const options = [...correct, ...distractors];
    questions.push({
      type: "multiple_select",
      question: t("Aşağıdaki kavramlardan hangileri kaynakta ele alınıyor? (3 doğru seçenek var)", "Which of these concepts are covered in the source? (3 correct options)"),
      options: options.map((o, i) => ({ id: `option-${i + 1}`, text: o })),
      correctAnswers: correct.map((_, i) => `option-${i + 1}`),
      explanation: t("Doğru seçenekler kaynaktaki anahtar kavramlardır.", "The correct options are key concepts from the source."),
    });
  }
  return questions;
}

// ---------- Ana fonksiyon ----------

export function buildLocalAnalysis({ text, pages, language }) {
  const isTurkish = language === "tr";
  const sourceLanguage = detectLanguage(text);
  const sourceTurkish = sourceLanguage === "tr";
  const t = (tr, en) => (isTurkish ? tr : en);

  let sections = pages?.length ? sectionsFromPages(pages) : sectionsFromText(text);
  if (!sections.some((s) => s.units.length)) {
    sections = [{ title: "", units: splitSentences(text).map((s) => ({ text: s, bullet: false })) }];
  }
  sections = chunkUntitled(sections, isTurkish).filter((s) => s.units.length);
  // Kapak / boş slaytları at (ör. ders adı, hoca adı, hafta bilgisi).
  const substantial = sections.filter((s) => s.units.reduce((sum, u) => sum + u.text.split(/\s+/).length, 0) >= 10 || s.units.some((u) => cueTypes(u.text).length));
  if (substantial.length) sections = substantial;

  const { termCounts, bestSurface } = scoreUnits(sections, sourceTurkish);
  const allUnits = sections.flatMap((s) => s.units);
  const avgLength = allUnits.reduce((sum, u) => sum + u.text.length, 0) / Math.max(allUnits.length, 1);
  const slideLike = avgLength < 130;

  // Toplam madde bütçesi: metin uzadıkça artar ama okunabilir kalır.
  const budget = Math.min(180, Math.max(12, Math.round(allUnits.length * (slideLike ? 0.85 : 0.45))));
  const ratio = Math.min(1, budget / Math.max(allUnits.length, 1));
  const keyThreshold = [...allUnits].map((u) => u.score).sort((a, b) => b - a)[Math.floor(allUnits.length * 0.2)] ?? Infinity;

  sections.forEach((section, index) => {
    const n = section.units.length;
    const maxPerSection = slideLike ? 10 : 7;
    const k = Math.max(1, Math.min(maxPerSection, Math.ceil(n * ratio)));
    const candidates = section.units.filter((u) => u.words >= 3);
    const chosen = [];
    for (const unit of [...candidates].sort((a, b) => b.score - a.score)) {
      if (chosen.length >= k) break;
      const keys = unit.tokens.map((x) => x.key);
      if (chosen.some((c) => jaccard(c.tokens.map((x) => x.key), keys) > 0.65)) continue;
      chosen.push(unit);
    }
    section.selected = section.units.filter((u) => chosen.includes(u));
    if (!section.title) {
      const counts = new Map();
      for (const u of section.units) for (const tk of u.tokens) counts.set(tk.key, (counts.get(tk.key) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([key]) => bestSurface(key));
      section.title = top.length
        ? `${t("Bölüm", "Part")} ${index + 1}: ${top.map((w, i) => (i === 0 ? w.charAt(0).toLocaleUpperCase(isTurkish ? "tr" : "en") + w.slice(1) : w)).join(", ")}`
        : `${t("Bölüm", "Part")} ${index + 1}`;
      section.autoTitle = true;
    }
  });

  const summary = sections
    .filter((s) => s.selected.length)
    .map((s) => ({
      heading: s.title,
      page: s.pageStart ? (s.pageEnd && s.pageEnd !== s.pageStart ? `${s.pageStart}-${s.pageEnd}` : `${s.pageStart}`) : undefined,
      text: "",
      points: s.selected.map((u) => ({ text: u.text, important: u.score >= keyThreshold && u.words >= 5 })),
    }));

  const ranked = [...allUnits].filter((u) => u.words >= 5).sort((a, b) => b.score - a.score);

  // Genel bakış: farklı bölümlerden en güçlü cümleler, belge sırasıyla.
  const overviewUnits = [];
  const usedSections = new Set();
  for (const unit of ranked) {
    const owner = sections.find((s) => s.units.includes(unit));
    if (usedSections.has(owner) || unit.words > 50) continue;
    usedSections.add(owner);
    overviewUnits.push(unit);
    if (overviewUnits.length >= 4) break;
  }
  overviewUnits.sort((a, b) => allUnits.indexOf(a) - allUnits.indexOf(b));

  const reasonLabel = {
    definition: t("Tanım içeriyor; tanımlar sınavlarda sıkça sorulur.", "Contains a definition; definitions are frequently asked."),
    emphasis: t("Kaynakta vurgulanan bir ifade (önemli, dikkat, mutlaka vb.).", "Emphasized in the source (important, note, must, etc.)."),
    comparison: t("Karşılaştırma / fark içeriyor; klasik sınav sorusu.", "Contains a comparison or difference; a classic exam question."),
    structure: t("Tür, aşama veya bileşen sıralıyor; listeleme sorusu olabilir.", "Lists types, steps or components; likely a listing question."),
    causal: t("Neden-sonuç ilişkisi kuruyor.", "Describes a cause-effect relationship."),
  };
  const examPoints = ranked
    .filter((u) => u.cues.length && u.words >= 6 && u.words <= 70)
    .slice(0, 10)
    .map((u) => {
      const owner = sections.find((s) => s.units.includes(u));
      const cue = ["definition", "emphasis", "comparison", "structure", "causal"].find((c) => u.cues.includes(c));
      return { text: u.text, reason: `${reasonLabel[cue]}${owner?.title && !owner.autoTitle ? ` · ${owner.title}` : ""}` };
    });
  if (examPoints.length < 4) {
    for (const u of ranked) {
      if (examPoints.length >= 6) break;
      if (examPoints.some((e) => e.text === u.text)) continue;
      examPoints.push({ text: u.text, reason: t("Belgedeki anahtar kavramları en yoğun içeren ifadelerden biri.", "One of the statements densest in key concepts.") });
    }
  }

  const glossary = buildGlossary(sections, termCounts, bestSurface, sourceTurkish);
  const questions = buildQuestions(sections, ranked, glossary, isTurkish);

  const languageNote = sourceLanguage !== language
    ? t(" Kaynak İngilizce olduğu için özet maddeleri kaynak dilinde kaldı; Türkçeye çeviri için AI anahtarı gerekir.",
      " The source is in Turkish, so summary points stay in the source language; translation needs an AI key.")
    : "";

  return {
    language,
    provider: "local",
    overview: overviewUnits
      .map((u) => (isTerminal(u.text) ? u.text.replace(/[:;]$/, ".") : `${u.text}.`))
      .map((sentence) => sentence.charAt(0).toLocaleUpperCase(sourceTurkish ? "tr" : "en") + sentence.slice(1))
      .join(" "),
    summary,
    glossary,
    highlights: [],
    examPoints,
    questions,
    notice: t(
      `Yerel analiz: ${sections.length} bölüm, ${allUnits.length} ifade incelendi; ★ işaretli maddeler en kritik olanlar. Daha akıcı, kendi cümleleriyle yazılmış özet ve terimlerin İngilizce karşılıkları için .env dosyasına ücretsiz bir GEMINI_API_KEY ekleyin.${languageNote}`,
      `Local analysis: ${sections.length} sections and ${allUnits.length} statements reviewed; ★ marks the most critical points. Add a free GEMINI_API_KEY to .env for fluent, rewritten summaries.${languageNote}`,
    ),
  };
}

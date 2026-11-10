const form = document.querySelector("#analysis-form");
const fileInput = document.querySelector("#file-input");
const sourceText = document.querySelector("#source-text");
const transcriptText = document.querySelector("#transcript-text");
const languageHint = document.querySelector("#language-hint");
const resultsSection = document.querySelector("#results");
const errorBanner = document.querySelector("#error-banner");
const generateButton = document.querySelector("#generate-button");
const documentPanel = document.querySelector("#document-panel");
const audioPanel = document.querySelector("#audio-panel");
const characterCount = document.querySelector("#character-count");
const transcriptCount = document.querySelector("#transcript-count");

// ---------- Tarayıcı depolama, kullanıcı kimliği ve şifre ----------

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* depolama kapalı olabilir */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* depolama kapalı olabilir */ }
  },
};

function getClientId() {
  let id = storage.get("not-asist-client");
  if (!id || !/^[\w-]{8,64}$/.test(id)) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    storage.set("not-asist-client", id);
  }
  return id;
}

const clientId = getClientId();
let accessCode = storage.get("not-asist-access") ?? "";
let serverInfo = null;

class AccessError extends Error {}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("x-client-id", clientId);
  if (accessCode) headers.set("x-access-code", accessCode);
  const response = await fetch(url, { ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = { error: "Sunucudan beklenmeyen bir yanıt geldi." };
  }
  if (response.status === 401 && data.code === "ACCESS_REQUIRED") {
    storage.remove("not-asist-access");
    accessCode = "";
    showLockScreen("Şifren geçersiz ya da değişmiş. Lütfen tekrar gir.");
    throw new AccessError(data.error);
  }
  if (!response.ok) throw new Error(data.error || "İstek başarısız oldu.");
  return data;
}

function updateUsage(usage) {
  const badge = document.querySelector("#usage-badge");
  if (!usage || usage.remaining === null || usage.remaining === undefined || !usage.limit) {
    badge.classList.add("hidden");
    return;
  }
  badge.textContent = `AI hakkı: ${usage.remaining}/${usage.limit}`;
  badge.title = `Bugün kalan AI analiz hakkın. Yenilenme saati: ${usage.resetsAt}`;
  badge.classList.toggle("low", usage.remaining <= 3);
  badge.classList.remove("hidden");
}

function showLockScreen(message = "") {
  const lock = document.querySelector("#lock-screen");
  const error = document.querySelector("#lock-error");
  error.textContent = message;
  error.classList.toggle("hidden", !message);
  lock.classList.remove("hidden");
  document.querySelector("#lock-input").focus();
}

document.querySelector("#lock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#lock-input");
  const button = event.currentTarget.querySelector("button");
  const error = document.querySelector("#lock-error");
  button.disabled = true;
  try {
    const response = await fetch("/api/verify-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: input.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Şifre hatalı.");
    accessCode = input.value;
    storage.set("not-asist-access", accessCode);
    input.value = "";
    document.querySelector("#lock-screen").classList.add("hidden");
    loadServerInfo();
  } catch (problem) {
    error.textContent = problem.message;
    error.classList.remove("hidden");
    input.select();
  } finally {
    button.disabled = false;
  }
});

let selectedAudio = null;
let currentAnalysis = null;
let recognition = null;
let quizCorrect = 0;
let quizAnswered = 0;

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
  errorBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateCount(element, value) {
  element.textContent = `${value.length.toLocaleString("tr-TR")} karakter`;
}

sourceText.addEventListener("input", () => updateCount(characterCount, sourceText.value));
transcriptText.addEventListener("input", () => updateCount(transcriptCount, transcriptText.value));

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  document.querySelector("#file-name").textContent = file.name;
  document.querySelector("#selected-file").classList.remove("hidden");
  document.querySelector("#dropzone").classList.add("hidden");
});

document.querySelector("#remove-file").addEventListener("click", () => {
  fileInput.value = "";
  document.querySelector("#selected-file").classList.add("hidden");
  document.querySelector("#dropzone").classList.remove("hidden");
});

const dropzone = document.querySelector("#dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag-over");
  });
}
dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (!file) return;
  const allowed = /\.(pdf|txt|md|docx)$/i.test(file.name);
  if (!allowed) {
    showError("Bu dosya türü desteklenmiyor. PDF, DOCX, TXT veya MD dosyası seçin.");
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change"));
});

document.querySelector("#document-tab").addEventListener("click", () => {
  document.querySelector("#document-tab").classList.add("selected");
  document.querySelector("#audio-tab").classList.remove("selected");
  document.querySelector("#document-tab").setAttribute("aria-selected", "true");
  document.querySelector("#audio-tab").setAttribute("aria-selected", "false");
  documentPanel.classList.remove("hidden");
  audioPanel.classList.add("hidden");
  errorBanner.classList.add("hidden");
});

document.querySelector("#audio-tab").addEventListener("click", () => {
  document.querySelector("#audio-tab").classList.add("selected");
  document.querySelector("#document-tab").classList.remove("selected");
  document.querySelector("#audio-tab").setAttribute("aria-selected", "true");
  document.querySelector("#document-tab").setAttribute("aria-selected", "false");
  audioPanel.classList.remove("hidden");
  documentPanel.classList.add("hidden");
  errorBanner.classList.add("hidden");
});

document.querySelector("#audio-input").addEventListener("change", (event) => {
  selectedAudio = event.target.files?.[0] ?? null;
  if (!selectedAudio) return;
  document.querySelector("#audio-name").textContent = selectedAudio.name;
  document.querySelector("#selected-audio").classList.remove("hidden");
});

document.querySelector("#remove-audio").addEventListener("click", () => {
  selectedAudio = null;
  document.querySelector("#audio-input").value = "";
  document.querySelector("#selected-audio").classList.add("hidden");
});

document.querySelector("#record-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  if (recognition) {
    recognition.stop();
    recognition = null;
    button.classList.remove("recording");
    button.innerHTML = '<span class="record-dot"></span> Kaydı başlat';
    document.querySelector("#live-transcript").classList.add("hidden");
    return;
  }
  const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Tarayıcınız canlı dikteyi desteklemiyor. Ses dosyası yükleyin veya Chrome/Edge kullanın.");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = document.querySelector('input[name="language"]:checked')?.value === "en" ? "en-US" : "tr-TR";
  recognition.onresult = (event) => {
    const finalText = Array.from(event.results)
      .filter((result) => result.isFinal)
      .map((result) => result[0].transcript)
      .join(" ");
    const interimText = Array.from(event.results)
      .filter((result) => !result.isFinal)
      .map((result) => result[0].transcript)
      .join(" ");
    transcriptText.value = finalText;
    if (interimText) transcriptText.placeholder = `Dinleniyor: ${interimText}`;
    updateCount(transcriptCount, transcriptText.value);
  };
  recognition.onerror = (event) => showError(`Canlı dikte hatası: ${event.error}. Mikrofon iznini ve bağlantınızı kontrol edin.`);
  recognition.onend = () => {
    if (recognition) {
      recognition = null;
      button.classList.remove("recording");
      button.innerHTML = '<span class="record-dot"></span> Kaydı başlat';
      document.querySelector("#live-transcript").classList.add("hidden");
    }
  };
  recognition.start();
  button.classList.add("recording");
  button.innerHTML = '<span class="record-dot"></span> Kaydı durdur';
  document.querySelector("#live-transcript").classList.remove("hidden");
  transcriptText.placeholder = "Konuşman burada görünecek...";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBanner.classList.add("hidden");
  const language = form.querySelector('input[name="language"]:checked')?.value;
  if (!language) {
    languageHint.textContent = "Devam etmek için Türkçe veya İngilizce seçmelisin.";
    languageHint.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  languageHint.textContent = language === "tr"
    ? "Teknik ve akademik terimlerin yanında İngilizce karşılıkları da gösterilecek."
    : "Your study guide and learning materials will be prepared in English.";

  const audioMode = audioPanel.classList.contains("hidden") === false;
  let text = audioMode ? transcriptText.value.trim() : sourceText.value.trim();
  if (audioMode && selectedAudio) {
    generateButton.disabled = true;
    generateButton.innerHTML = "<span>◌</span> Ses yazıya dönüştürülüyor…";
    try {
      const transcription = new FormData();
      transcription.append("audio", selectedAudio);
      const data = await apiFetch("/api/transcribe", { method: "POST", body: transcription });
      updateUsage(data.usage);
      text = data.text.trim();
      transcriptText.value = text;
      updateCount(transcriptCount, text);
    } catch (error) {
      if (!(error instanceof AccessError)) showError(error.message);
      resetGenerateButton();
      return;
    }
  }

  const selectedFile = audioMode ? null : fileInput.files?.[0];
  if (!text && !selectedFile) {
    showError(audioMode ? "Bir ses kaydı yükle veya transkripti yaz." : "Bir belge yükle veya analiz etmek istediğin metni ekle.");
    return;
  }
  generateButton.disabled = true;
  generateButton.innerHTML = "<span>◌</span> Çalışma rehberin hazırlanıyor…";
  const payload = new FormData();
  payload.append("language", language);
  if (selectedFile) payload.append("file", selectedFile);
  else payload.append("text", text);
  try {
    const data = await apiFetch("/api/analyze", { method: "POST", body: payload });
    updateUsage(data.usage);
    currentAnalysis = data;
    renderAnalysis(data);
    resetGenerateButton();
  } catch (error) {
    if (!(error instanceof AccessError)) {
      showError(error.message === "Failed to fetch"
        ? "Sunucuya bağlanılamadı. İnternet bağlantını kontrol et; sunucu uykudaysa uyanması bir dakika sürebilir."
        : error.message || "Analiz tamamlanamadı.");
    }
    resetGenerateButton();
  }
});

function resetGenerateButton() {
  generateButton.disabled = false;
  generateButton.innerHTML = '<span>✳</span> Çalışma rehberimi oluştur <span class="button-arrow">↗</span>';
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderAnalysis(data) {
  const isTurkish = data.language === "tr";
  const overview = data.overview
    ? `<div class="summary-overview"><strong>${isTurkish ? "Genel bakış: " : "Overview: "}</strong>${escapeHtml(data.overview)}</div>`
    : "";
  const sections = (data.summary ?? []).map((item) => {
    const page = item.page ? `<span class="summary-page">${isTurkish ? "s." : "p."} ${escapeHtml(item.page)}</span>` : "";
    const intro = item.text ? `<p>${escapeHtml(item.text)}</p>` : "";
    const points = (item.points ?? []).filter((point) => point && (point.text ?? point));
    const list = points.length
      ? `<ul>${points.map((point) => {
          const text = typeof point === "string" ? point : point.text;
          return `<li${point.important ? ' class="key-point"' : ""}>${escapeHtml(text)}</li>`;
        }).join("")}</ul>`
      : "";
    return `<article class="summary-block"><h3>${escapeHtml(item.heading)}${page}</h3>${intro}${list}</article>`;
  }).join("");
  document.querySelector("#summary-content").innerHTML = sections
    ? overview + sections
    : '<p class="empty-state">Özet oluşturulamadı.</p>';

  const highlights = data.highlights ?? [];
  document.querySelector("#highlight-count").textContent = `${highlights.length} İŞARETLEME`;
  document.querySelector("#highlights-content").innerHTML = highlights.length
    ? highlights.map((item) => `<div class="highlight-item">${escapeHtml(item.text)}<small>${escapeHtml(item.kind)}${item.page ? ` · ${item.page}. sayfa` : ""}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small></div>`).join("")
    : `<p class="empty-state">${isTurkish ? "Belgede PDF vurgulama/altını çizme açıklaması bulunamadı. TXT/DOCX biçimleri yazı biçimlendirmesi içermediğinden bu bölüm belge işaretlemelerini gösterir." : "No PDF highlight or underline annotations were detected. This section shows document annotations; TXT/DOCX formatting is not included."}</p>`;

  document.querySelector("#exam-content").innerHTML = (data.examPoints ?? [])
    .map((point) => `<article class="exam-item"><p>${escapeHtml(point.text)}</p><small>↗ ${escapeHtml(point.reason)}</small></article>`)
    .join("") || '<p class="empty-state">Kritik nokta bulunamadı.</p>';

  document.querySelector("#glossary-content").innerHTML = (data.glossary ?? [])
    .map((item) => `<article class="glossary-item"><h3>${escapeHtml(item.term)}</h3><p>${escapeHtml(item.definition)}</p></article>`)
    .join("") || '<p class="empty-state">Terim bulunamadı.</p>';

  quizCorrect = 0;
  quizAnswered = 0;
  renderQuestions(data.questions ?? []);
  const label = { gemini: "Google Gemini", openai: "OpenAI" }[data.provider];
  document.querySelector("#result-notice").textContent = data.notice
    || (label ? (isTurkish ? `${label} ile hazırlandı.` : `Prepared with ${label}.`) : (isTurkish ? "Yerel analiz" : "Local analysis"));
  resultsSection.classList.remove("hidden");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderQuestions(questions) {
  const labels = {
    open: "AÇIK UÇLU",
    true_false: "DOĞRU / YANLIŞ",
    multiple_select: "BİRDEN FAZLA SEÇİM",
    multiple_choice: "ÇOKTAN SEÇMELİ",
  };
  document.querySelector("#quiz-content").innerHTML = questions.map((question, index) => {
    const options = (question.options ?? []).map((option) => {
      const id = typeof option === "string" ? option : option.id;
      const text = typeof option === "string" ? option : option.text;
      return `<label class="question-option"><input type="${question.type === "multiple_select" ? "checkbox" : "radio"}" name="question-${index}" value="${escapeHtml(id)}" /><span>${escapeHtml(text)}</span></label>`;
    }).join("");
    const answerInput = question.type === "open"
      ? `<textarea class="answer-text" placeholder="${currentAnalysis.language === "tr" ? "Yanıtını kendi cümlelerinle yaz..." : "Write your answer in your own words..."}"></textarea>`
      : question.type === "true_false"
        ? `<div class="question-options"><label class="question-option"><input type="radio" name="question-${index}" value="true" /><span>${currentAnalysis.language === "tr" ? "Doğru" : "True"}</span></label><label class="question-option"><input type="radio" name="question-${index}" value="false" /><span>${currentAnalysis.language === "tr" ? "Yanlış" : "False"}</span></label></div>`
        : `<div class="question-options">${options}</div>`;
    const actionLabel = currentAnalysis.language === "tr" ? "Yanıtı kontrol et" : "Check answer";
    return `<article class="quiz-card" data-question="${index}"><div class="question-type">${labels[question.type] ?? "SORU"} · ${String(index + 1).padStart(2, "0")}</div><p class="question-text">${escapeHtml(question.question)}</p>${answerInput}<button class="check-answer" type="button">${actionLabel}</button><div class="answer-feedback hidden"></div><template>${escapeHtml(JSON.stringify(question))}</template></article>`;
  }).join("");
  document.querySelector("#quiz-progress").textContent = currentAnalysis.language === "tr"
    ? `0 / ${questions.length} yanıtlandı · 0 doğru`
    : `0 / ${questions.length} answered · 0 correct`;
  document.querySelectorAll(".check-answer").forEach((button) => {
    button.addEventListener("click", () => checkAnswer(button.closest(".quiz-card")));
  });
}

function checkAnswer(card) {
  const question = JSON.parse(card.querySelector("template").content.textContent);
  const feedback = card.querySelector(".answer-feedback");
  if (!feedback.classList.contains("hidden")) return;
  const inputs = Array.from(card.querySelectorAll("input:checked"));
  let correct = false;
  let scoreable = true;
  let message = "";
  if (question.type === "open") {
    const response = card.querySelector(".answer-text").value.trim();
    if (response.length < 15) {
      feedback.textContent = currentAnalysis.language === "tr" ? "Bir yanıt yaz; sonra tekrar kontrol et." : "Write an answer before checking.";
      feedback.classList.remove("hidden");
      feedback.classList.add("incorrect");
      return;
    }
    scoreable = false;
    message = `${currentAnalysis.language === "tr" ? "Yanıtını örnekle karşılaştır" : "Compare your answer with the example"}: ${question.answer}`;
  } else if (question.type === "true_false") {
    if (!inputs.length) {
      feedback.textContent = currentAnalysis.language === "tr" ? "Devam etmeden önce bir seçenek belirle." : "Choose an option before continuing.";
      feedback.classList.remove("hidden");
      feedback.classList.add("incorrect");
      return;
    }
    correct = inputs[0].value === String(question.answer);
    message = `${question.explanation ?? ""}${question.answerExplanation ? ` ${question.answerExplanation}` : ""}`;
  } else {
    if (!inputs.length) {
      feedback.textContent = currentAnalysis.language === "tr" ? "En az bir seçenek belirle." : "Select at least one option.";
      feedback.classList.remove("hidden");
      feedback.classList.add("incorrect");
      return;
    }
    const expected = question.correctAnswers ?? [];
    const selected = inputs.map((input) => input.value);
    correct = expected.length === selected.length && expected.every((value) => selected.includes(value));
    const answerText = (question.options ?? [])
      .filter((option) => expected.includes(typeof option === "string" ? option : option.id))
      .map((option) => typeof option === "string" ? option : option.text)
      .join(", ");
    message = `${question.explanation ?? ""}${answerText ? ` ${currentAnalysis.language === "tr" ? "Doğru yanıtlar" : "Correct answers"}: ${answerText}` : ""}`;
  }
  quizAnswered += 1;
  if (correct && scoreable) quizCorrect += 1;
  const prefix = question.type === "open"
    ? (currentAnalysis.language === "tr" ? "Yanıtın kaydedildi. " : "Answer saved. ")
    : correct
      ? (currentAnalysis.language === "tr" ? "Doğru! " : "Correct! ")
      : (currentAnalysis.language === "tr" ? "Gözden geçir. " : "Review. ");
  feedback.textContent = `${prefix}${message}`;
  feedback.classList.toggle("incorrect", scoreable && !correct);
  feedback.classList.remove("hidden");
  card.querySelectorAll("input, textarea, button.check-answer").forEach((element) => { element.disabled = true; });
  document.querySelector("#quiz-progress").textContent = currentAnalysis.language === "tr"
    ? `${quizAnswered} / ${currentAnalysis.questions.length} yanıtlandı · ${quizCorrect} doğru`
    : `${quizAnswered} / ${currentAnalysis.questions.length} answered · ${quizCorrect} correct`;
}

document.querySelectorAll(".result-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".result-tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".result-panel").forEach((panel) => panel.classList.add("hidden"));
    button.classList.add("active");
    const panel = document.getElementById(button.dataset.panel);
    panel.classList.remove("hidden");
  });
});

document.querySelector("#theme-toggle").addEventListener("click", (event) => {
  const isLight = document.body.classList.toggle("light-theme");
  document.documentElement.style.colorScheme = isLight ? "light" : "dark";
  event.currentTarget.setAttribute("aria-label", isLight ? "Koyu temaya geç" : "Açık temaya geç");
  event.currentTarget.textContent = isLight ? "☾" : "☼";
  storage.set("not-asist-theme", isLight ? "light" : "dark");
});
if (storage.get("not-asist-theme") === "light") {
  document.body.classList.add("light-theme");
  document.documentElement.style.colorScheme = "light";
  document.querySelector("#theme-toggle").textContent = "☾";
  document.querySelector("#theme-toggle").setAttribute("aria-label", "Koyu temaya geç");
}

document.querySelector("#download-button").addEventListener("click", () => {
  if (!currentAnalysis) return;
  const lines = [
    "# " + (currentAnalysis.language === "tr" ? "Çalışma Rehberi" : "Study Guide"),
    "",
    "## " + (currentAnalysis.language === "tr" ? "Özet" : "Summary"),
    ...(currentAnalysis.overview ? [currentAnalysis.overview, ""] : []),
    ...currentAnalysis.summary.flatMap((item) => [
      `### ${item.heading}${item.page ? ` (${currentAnalysis.language === "tr" ? "s." : "p."} ${item.page})` : ""}`,
      ...(item.text ? [item.text] : []),
      ...(item.points ?? []).map((point) => `- ${typeof point === "string" ? point : point.text}${point.important ? " ★" : ""}`),
      "",
    ]),
    "## " + (currentAnalysis.language === "tr" ? "Kavram Sözlüğü" : "Glossary"),
    ...currentAnalysis.glossary.flatMap((item) => [`- **${item.term}:** ${item.definition}`]),
    "",
    "## " + (currentAnalysis.language === "tr" ? "Önemli Vurgular" : "Highlights"),
    ...(currentAnalysis.highlights.length ? currentAnalysis.highlights.map((item) => `- ${item.text}`) : ["- " + (currentAnalysis.language === "tr" ? "Belge işaretlemesi bulunamadı." : "No document annotations found.")]),
    "",
    "## " + (currentAnalysis.language === "tr" ? "Sınav Noktaları" : "Exam Points"),
    ...currentAnalysis.examPoints.map((item) => `- ${item.text} (${item.reason})`),
    "",
    "## " + (currentAnalysis.language === "tr" ? "Örnek Sorular" : "Practice Questions"),
    ...currentAnalysis.questions.flatMap((item) => [`- ${item.question}`, `${currentAnalysis.language === "tr" ? "Yanıt" : "Answer"}: ${Array.isArray(item.correctAnswers) ? item.correctAnswers.join(", ") : item.answer}`]),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "not-asist-calisma-rehberi.md";
  link.click();
  URL.revokeObjectURL(url);
});

for (const link of document.querySelectorAll('.primary-nav a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    if (target) target.scrollIntoView({ behavior: "smooth" });
    if (link.getAttribute("href") === "#quiz-section") {
      document.querySelector('[data-panel="quiz-section"]').click();
    }
  });
}

async function loadServerInfo() {
  const status = document.querySelector("#provider-status");
  try {
    serverInfo = await apiFetch("/api/health");
    status.textContent = serverInfo.aiConfigured ? `AI analizi etkin · ${serverInfo.providerLabel}` : "Yerel analiz hazır";
    document.querySelector("#privacy-text").textContent = serverInfo.aiConfigured
      ? `Dosyalar kaydedilmez; AI analizi için ${serverInfo.providerLabel}'ye gönderilir.`
      : "Dosyalar kaydedilmez ve hiçbir yere gönderilmez.";
    updateUsage(serverInfo.usage);
    if (serverInfo.accessRequired && !serverInfo.accessValid) {
      const hadCode = Boolean(accessCode);
      storage.remove("not-asist-access");
      accessCode = "";
      showLockScreen(hadCode ? "Giriş şifresi değişmiş. Lütfen yeni şifreyi gir." : "");
    }
  } catch (error) {
    console.error("Health check failed:", error);
    status.textContent = "Sunucu bağlantısı yok";
  }
}

loadServerInfo();

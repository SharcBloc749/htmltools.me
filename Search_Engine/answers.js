/* Small, explicit-pattern instant answers + ambient Gemini-style AI sidebar for HTMLTools Search. */
(function () {
  if (window.__HT_INSTANT_ANSWERS_READY) return;
  window.__HT_INSTANT_ANSWERS_READY = true;

  var input = document.getElementById("q");
  var card = document.getElementById("answerCard");
  if (!input || !card) return;

  var requestId = 0;
  var debounceId = 0;
  var activeController = null;
  var timerId = null;

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function hide() {
    card.hidden = true;
    card.replaceChildren();
  }
  function stopTimer() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
  }
  function fmtNumber(n) {
    if (!Number.isFinite(n)) return "";
    if (Math.abs(n) < 1e-10 && n !== 0) return n.toExponential(5);
    return Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 8 });
  }
  function render(answer) {
    card.hidden = false;
    card.replaceChildren();
    card.appendChild(node("p", "answer-title", answer.title));
    var value = node("div", "answer-value");
    if (answer.swatch) {
      var swatch = node("span", "color-swatch");
      swatch.style.backgroundColor = answer.swatch;
      value.appendChild(swatch);
    }
    value.appendChild(document.createTextNode(answer.value));
    card.appendChild(value);
    if (answer.note) {
      var note = node("p", "answer-note");
      if (typeof answer.note === "string") note.textContent = answer.note;
      else note.appendChild(answer.note);
      card.appendChild(note);
    }
    if (answer.timerSeconds !== undefined) {
      var actions = node("div", "answer-actions");
      var button = node("button", "answer-action", "Start timer");
      button.type = "button";
      var display = value;
      var total = answer.timerSeconds;
      button.addEventListener("click", function () {
        stopTimer();
        var end = Date.now() + total * 1000;
        button.disabled = true;
        button.textContent = "Running…";
        function tick() {
          var remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
          display.textContent = formatTime(remaining);
          if (remaining <= 0) {
            stopTimer();
            button.disabled = false;
            button.textContent = "Start again";
            display.textContent = "Time's up!";
            try { if ("Notification" in window && Notification.permission === "granted") new Notification("HTMLTools timer", { body: "Time's up!" }); } catch (err) {}
          }
        }
        tick();
        timerId = window.setInterval(tick, 250);
      });
      actions.appendChild(button);
      card.appendChild(actions);
      return;
    }
    if (answer.copy) {
      var actions2 = node("div", "answer-actions");
      var copy = node("button", "answer-action", "Copy");
      copy.type = "button";
      copy.addEventListener("click", function () {
        if (!navigator.clipboard || !navigator.clipboard.writeText) { copy.textContent = "Copy unavailable"; return; }
        navigator.clipboard.writeText(answer.value).then(function () { copy.textContent = "Copied"; }, function () { copy.textContent = "Copy blocked"; });
      });
      actions2.appendChild(copy);
      card.appendChild(actions2);
    }
  }
  function formatTime(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }

  function calculate(source) {
    var s = source.replace(/[×✕]/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*").replace(/[÷]/g, "/").replace(/[−–]/g, "-").trim();
    var pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)$/i);
    if (pct) return Number(pct[1]) * Number(pct[2]) / 100;
    if (!/^[\d\s()+\-*/^%.]+$/.test(s)) return null;
    var tokens = s.match(/\d+(?:\.\d*)?(?:e[+\-]?\d+)?|[()+\-*/^%]/gi) || [];
    if (tokens.join("").toLowerCase() !== s.replace(/\s+/g, "").toLowerCase()) return null;
    var i = 0;
    function primary() {
      if (tokens[i] === "+" || tokens[i] === "-") { var sign = tokens[i++] === "-" ? -1 : 1; return sign * primary(); }
      if (tokens[i] === "(") { i++; var v = sum(); if (tokens[i++] !== ")") throw new Error("paren"); return v; }
      var t = tokens[i++];
      if (t === undefined || !/^\d/i.test(t)) throw new Error("number");
      return Number(t);
    }
    function power() { var a = primary(); if (tokens[i] === "^") { i++; a = Math.pow(a, power()); } return a; }
    function product() {
      var a = power();
      while (["*", "/", "%"].indexOf(tokens[i]) >= 0) {
        var op = tokens[i++], b = power();
        if ((op === "/" || op === "%") && b === 0) throw new Error("zero");
        a = op === "*" ? a * b : op === "/" ? a / b : a % b;
      }
      return a;
    }
    function sum() {
      var a = product();
      while (tokens[i] === "+" || tokens[i] === "-") { var op = tokens[i++], b = product(); a = op === "+" ? a + b : a - b; }
      return a;
    }
    try {
      if (!tokens.length) return null;
      var result = sum();
      if (i !== tokens.length || !Number.isFinite(result) || Math.abs(result) > 1e100) return null;
      return result;
    } catch (err) { return null; }
  }

  var unitGroups = {
    distance: { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000, cm: .01, mm: .001, mi: 1609.344, mile: 1609.344, miles: 1609.344, ft: .3048, foot: .3048, feet: .3048, in: .0254, inch: .0254, inches: .0254, yd: .9144, yard: .9144, yards: .9144 },
    mass: { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237, oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125 },
    time: { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400 },
    volume: { ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, tsp: 4.92892159, tbsp: 14.7867648, cup: 236.588237, cups: 236.588237, gal: 3785.41178, gallon: 3785.41178, gallons: 3785.41178 }
  };
  function unitAnswer(q) {
    var m = q.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]+)\s+(?:in|to)\s+([a-z]+)$/i);
    if (!m) return null;
    var amount = Number(m[1]), from = m[2].toLowerCase(), to = m[3].toLowerCase();
    if ((from === "c" || from === "°c" || from === "celsius" || from === "f" || from === "°f" || from === "fahrenheit" || from === "k" || from === "kelvin") &&
        (to === "c" || to === "°c" || to === "celsius" || to === "f" || to === "°f" || to === "fahrenheit" || to === "k" || to === "kelvin")) {
      function celsius(v, u) { return (u === "f" || u === "°f" || u === "fahrenheit") ? (v - 32) * 5 / 9 : (u === "k" || u === "kelvin") ? v - 273.15 : v; }
      function fromC(v, u) { return (u === "f" || u === "°f" || u === "fahrenheit") ? v * 9 / 5 + 32 : (u === "k" || u === "kelvin") ? v + 273.15 : v; }
      var v = fromC(celsius(amount, from), to);
      return { title: "Temperature conversion", value: fmtNumber(amount) + "° " + from.toUpperCase() + " = " + fmtNumber(v) + "° " + to.toUpperCase(), copy: true };
    }
    for (var group in unitGroups) {
      var units = unitGroups[group];
      if (units[from] !== undefined && units[to] !== undefined) {
        var result = amount * units[from] / units[to];
        return { title: "Unit conversion", value: fmtNumber(amount) + " " + from + " = " + fmtNumber(result) + " " + to, copy: true };
      }
    }
    return null;
  }

  function localAnswer(q) {
    var m;
    if ((m = q.match(/^(?:calc(?:ulate)?\s+)?(.+)$/i))) {
      var exp = m[1].trim();
      var result = calculate(exp);
      if (result !== null && (/^calc(?:ulate)?\s/i.test(q) || /[+*/^()%×÷]/.test(exp) || /\d\s*-\s*\d/.test(exp))) {
        return { title: "Calculator", value: fmtNumber(result), copy: true };
      }
    }
    if ((m = q.match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s+([a-z]{3})\s+(?:to|in)\s+([a-z]{3})$/i))) {
      var currencyAmount = Number(m[1].replace(/,/g, ""));
      var fromCurrency = m[2].toUpperCase(), toCurrency = m[3].toUpperCase();
      if (Number.isFinite(currencyAmount)) {
        if (fromCurrency === toCurrency) return { title: "Currency conversion", value: fmtNumber(currencyAmount) + " " + fromCurrency + " = " + fmtNumber(currencyAmount) + " " + toCurrency, copy: true };
        return { title: "Currency conversion", value: "Checking the latest rate…", remote: "currency", amount: currencyAmount, from: fromCurrency, to: toCurrency };
      }
    }
    var converted = unitAnswer(q);
    if (converted) return converted;

    if ((m = q.match(/^timer\s+(?:(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?))$/i))) {
      var amount = Number(m[1]), unit = m[2].toLowerCase();
      var seconds = amount * (/^(m|min|mins|minute|minutes)$/.test(unit) ? 60 : /^(h|hr|hrs|hour|hours)$/.test(unit) ? 3600 : 1);
      if (seconds > 0 && seconds <= 86400) return { title: "Timer", value: formatTime(Math.ceil(seconds)), timerSeconds: Math.ceil(seconds) };
    }
    if (/^(?:flip\s+a\s+coin|coin\s+flip|toss\s+a\s+coin)$/i.test(q)) return { title: "Coin flip", value: Math.random() < .5 ? "Heads" : "Tails" };
    if ((m = q.match(/^(?:roll\s+)?d(\d{1,4})$/i)) && Number(m[1]) >= 2) return { title: "Dice roll", value: String(1 + Math.floor(Math.random() * Math.min(10000, Number(m[1])) ) ) };
    if (/^(?:uuid|generate\s+uuid)$/i.test(q)) {
      var uuid = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
      return { title: "Random UUID", value: uuid, copy: true };
    }
    if ((m = q.match(/^password\s+(\d{1,3})$/i)) && Number(m[1]) >= 8 && Number(m[1]) <= 128) {
      var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_";
      var bytes = new Uint32Array(Number(m[1]));
      if (crypto && crypto.getRandomValues) crypto.getRandomValues(bytes); else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 4294967296;
      var password = Array.prototype.map.call(bytes, function (b) { return alphabet[b % alphabet.length]; }).join("");
      return { title: "Random password", value: password, copy: true };
    }
    if ((m = q.match(/^(?:color\s+)?#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
      var hex = "#" + m[1].toUpperCase();
      var full = m[1].length === 3 ? m[1].split("").map(function (c) { return c + c; }).join("") : m[1];
      var r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
      return { title: "Color", value: hex + "  ·  rgb(" + r + ", " + g + ", " + b + ")", swatch: hex, copy: true };
    }
    if ((m = q.match(/^(url|base64)\s+(encode|decode)\s+([\s\S]+)$/i))) {
      try {
        var kind = m[1].toLowerCase(), direction = m[2].toLowerCase(), text = m[3];
        var output;
        if (kind === "url") output = direction === "encode" ? encodeURIComponent(text) : decodeURIComponent(text);
        else if (direction === "encode") {
          var bytes2 = new TextEncoder().encode(text), binary = "";
          bytes2.forEach(function (byte) { binary += String.fromCharCode(byte); });
          output = btoa(binary);
        } else {
          var raw = atob(text), data = new Uint8Array(raw.length);
          for (var j = 0; j < raw.length; j++) data[j] = raw.charCodeAt(j);
          output = new TextDecoder().decode(data);
        }
        return { title: kind.toUpperCase() + " " + direction, value: output, copy: true };
      } catch (err) { return { title: "Encoding error", value: "That input is not valid for this operation." }; }
    }
    if (/^my\s+ip$/i.test(q)) return { title: "Public IP address", value: "Looking up…", remote: "ip" };
    if ((m = q.match(/^weather\s+(?:in\s+)?(.+)$/i))) return { title: "Weather", value: "Looking up " + m[1] + "…", remote: "weather", place: m[1] };
    if ((m = q.match(/^time\s+in\s+(.+)$/i))) return { title: "Local time", value: "Looking up " + m[1] + "…", remote: "time", place: m[1] };
    if ((m = q.match(/^define\s+([a-z][a-z' -]{0,60})$/i))) return { title: "Definition: " + m[1], value: "Looking it up…", remote: "define", word: m[1].trim() };
    return null;
  }

  function fetchJson(url, signal) {
    return fetch(url, { signal: signal, headers: { Accept: "application/json" } }).then(function (response) {
      if (!response.ok) throw new Error("Request failed");
      return response.json();
    });
  }
  function geocode(place, signal) {
    return fetchJson("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(place) + "&count=5&language=en&format=json", signal).then(function (data) {
      if (!data.results || !data.results.length) throw new Error("Place not found");
      return data.results[0];
    });
  }
  function weatherCode(code) {
    var labels = { 0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy thunderstorm" };
    return labels[code] || "Current conditions";
  }
  function remoteRequest(answer, signal) {
    if (answer.remote === "ip") {
      return fetchJson("https://api.ipify.org?format=json", signal).then(function (data) { return { title: "Public IP address", value: data.ip, copy: true }; });
    }
    if (answer.remote === "currency") {
      var url = "https://api.frankfurter.dev/v1/latest?base=" + encodeURIComponent(answer.from) + "&symbols=" + encodeURIComponent(answer.to);
      return fetchJson(url, signal).then(function (data) {
        var rate = data.rates && data.rates[answer.to];
        if (!Number.isFinite(rate)) throw new Error("Rate unavailable");
        return { title: "Currency conversion", value: fmtNumber(answer.amount) + " " + answer.from + " ≈ " + fmtNumber(answer.amount * rate) + " " + answer.to, note: "Exchange rate for " + data.date + " · Frankfurter", copy: true };
      });
    }
    if (answer.remote === "time") {
      return geocode(answer.place, signal).then(function (place) {
        var time = new Intl.DateTimeFormat(undefined, { timeZone: place.timezone, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date());
        return { title: "Time in " + place.name + (place.country ? ", " + place.country : ""), value: time + "\n" + place.timezone };
      });
    }
    if (answer.remote === "weather") {
      return geocode(answer.place, signal).then(function (place) {
        var url = "https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1";
        return fetchJson(url, signal).then(function (data) {
          var c = data.current, d = data.daily;
          var loc = place.name + (place.admin1 ? ", " + place.admin1 : "") + (place.country ? ", " + place.country : "");
          var value = fmtNumber(c.temperature_2m) + "°C · " + weatherCode(c.weather_code) + "\nFeels like " + fmtNumber(c.apparent_temperature) + "°C · Wind " + fmtNumber(c.wind_speed_10m) + " km/h\nToday: " + fmtNumber(d.temperature_2m_min[0]) + "° to " + fmtNumber(d.temperature_2m_max[0]) + "°C";
          var attribution = document.createElement("a"); attribution.href = "https://open-meteo.com/"; attribution.target = "_blank"; attribution.rel = "noopener"; attribution.textContent = "Weather data by Open-Meteo.com";
          return { title: "Weather · " + loc, value: value, note: attribution };
        });
      });
    }
    if (answer.remote === "define") {
      return fetchJson("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(answer.word), signal).then(function (data) {
        var entries = [];
        Object.keys(data || {}).forEach(function (lang) {
          if (!Array.isArray(data[lang])) return;
          data[lang].forEach(function (part) {
            var defs = part.definitions || [];
            defs.forEach(function (def) { if (def.definition) entries.push((part.partOfSpeech ? part.partOfSpeech + ": " : "") + def.definition.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); });
          });
        });
        if (!entries.length) throw new Error("No definition found");
        return { title: "Definition: " + answer.word, value: entries.slice(0, 3).join("\n"), note: "Source: Wiktionary", copy: true };
      });
    }
    return Promise.reject(new Error("Unknown answer"));
  }

  function run() {
    var q = (input.value || "").replace(/\s+/g, " ").trim();
    var id = ++requestId;
    stopTimer();
    if (activeController) activeController.abort();
    if (!q) { hide(); return; }
    var answer = localAnswer(q);
    if (!answer) { hide(); return; }
    if (!answer.remote) { render(answer); return; }
    render(answer);
    activeController = new AbortController();
    var controller = activeController;
    var timeout = window.setTimeout(function () { controller.abort(); }, 9000);
    remoteRequest(answer, controller.signal).then(function (result) {
      if (id === requestId) render(result);
    }).catch(function () {
      if (id === requestId) render({ title: answer.title, value: "Couldn't load this answer. Try the web search below." });
    }).finally(function () { window.clearTimeout(timeout); });
  }
  input.addEventListener("input", function () {
    window.clearTimeout(debounceId);
    if (activeController) activeController.abort();
    debounceId = window.setTimeout(run, 220);
  });
  run();
})();

/* Ambient, Gemini-style streaming AI Overview sidebar */
(function () {
  if (window.__HT_AI_OVERVIEW_READY) return;
  window.__HT_AI_OVERVIEW_READY = true;

  var input = document.getElementById("q");
  var panel = document.getElementById("aiPanel");
  if (!input || !panel) return;

  var endpoint = "https://htmltools-me-search-engine.bozhetarnikmatthew.workers.dev/answer";
  var transcript = document.getElementById("aiTranscript");
  var status = document.getElementById("aiStatus");
  var modelBadge = document.getElementById("aiModel");
  var autoToggle = document.getElementById("aiAutoToggle");
  var askCurrent = document.getElementById("aiAskCurrent");
  var manualBar = document.getElementById("aiManualBar");
  var followForm = document.getElementById("aiFollowForm");
  var followup = document.getElementById("aiFollowup");
  var extendedToggle = document.getElementById("aiExtended");
  var sendButton = document.getElementById("aiSend");

  var chat = [];
  var debounce = 0;
  var sequence = 0;
  var activeController = null;
  var activeAuto = false;
  var answerCache = new Map();

  try { autoToggle.checked = localStorage.getItem("hts.ai.auto") !== "off"; } catch (err) { autoToggle.checked = true; }

  /* Show "Answer this search" ONLY when Auto-answer is OFF */
  function syncAutoVisibility() {
    var isAuto = !!autoToggle.checked;
    if (askCurrent) {
      askCurrent.hidden = isAuto;
      askCurrent.style.display = isAuto ? "none" : "";
    }
    if (manualBar) {
      manualBar.hidden = isAuto;
      manualBar.style.display = isAuto ? "none" : "";
    }
    panel.classList.toggle("auto-on", isAuto);
    panel.classList.toggle("auto-off", !isAuto);
  }

  function setStatus(text) {
    if (!status) return;
    status.textContent = text || "";
    status.hidden = !text;
  }

  function clearTranscript() {
    transcript.replaceChildren();
    var empty = document.createElement("p");
    empty.className = "ai-empty";
    empty.textContent = autoToggle.checked
      ? "Ask anything in the search bar for an instant AI overview."
      : "Auto-answer is off. Click “Answer this search” when you want an AI overview.";
    transcript.appendChild(empty);
  }

  function scrollBottom() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function addUser(text, isFollowup) {
    /* Only show chat bubbles for follow-up questions; initial search query is already in the main hero */
    if (!isFollowup) return;
    var bubble = document.createElement("div");
    bubble.className = "ai-user-bubble";
    bubble.textContent = text;
    transcript.appendChild(bubble);
    scrollBottom();
  }

  /* Gemini-style shimmer skeleton lines while thinking */
  function createThinkingSkeleton(isExtended) {
    var wrap = document.createElement("div");
    wrap.className = "ai-thinking";
    wrap.setAttribute("aria-label", "AI is thinking");

    var head = document.createElement("div");
    head.className = "ai-thinking-head";
    var icon = document.createElement("span");
    icon.className = "ai-thinking-spark";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";
    var label = document.createElement("span");
    label.className = "ai-thinking-label";
    label.textContent = isExtended ? "Thinking deeply…" : "Thinking…";
    head.appendChild(icon);
    head.appendChild(label);
    wrap.appendChild(head);

    var lines = document.createElement("div");
    lines.className = "ai-skeleton-group";
    ["w-94", "w-82", "w-60", "w-76", "w-48"].forEach(function (cls, idx) {
      var bar = document.createElement("span");
      bar.className = "ai-skeleton-line " + cls + (idx >= 3 ? " sub" : "");
      bar.style.animationDelay = (idx * 90) + "ms";
      lines.appendChild(bar);
    });
    wrap.appendChild(lines);
    return wrap;
  }

  function makeAssistantTurn(isExtended) {
    var emptyEl = transcript.querySelector(".ai-empty");
    if (emptyEl) emptyEl.remove();

    var turn = document.createElement("div");
    turn.className = "ai-assistant-turn is-thinking";

    var skeleton = createThinkingSkeleton(isExtended);

    var content = document.createElement("div");
    content.className = "ai-turn-body";
    content.hidden = true;

    var highlight = document.createElement("div");
    highlight.className = "ai-answer-highlight";
    var direct = document.createElement("div");
    direct.className = "ai-direct";
    highlight.appendChild(direct);

    var details = document.createElement("div");
    details.className = "ai-details";
    details.hidden = true;

    var sources = document.createElement("div");
    sources.className = "ai-sources";
    sources.hidden = true;

    content.appendChild(highlight);
    content.appendChild(details);
    content.appendChild(sources);

    turn.appendChild(skeleton);
    turn.appendChild(content);
    transcript.appendChild(turn);
    scrollBottom();

    return {
      turn: turn,
      skeleton: skeleton,
      content: content,
      direct: direct,
      details: details,
      sources: sources,
      activeSources: []
    };
  }

  function paintSources(target, list) {
    var container = target.sources;
    container.replaceChildren();
    target.activeSources = list || [];
    var count = 0;
    (list || []).forEach(function (source, i) {
      if (!source || !source.url) return;
      try {
        var url = new URL(source.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") return;
        var a = document.createElement("a");
        a.className = "ai-source";
        a.href = url.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = (source.title || url.hostname) + " (" + url.hostname + ")";

        var num = document.createElement("span");
        num.className = "ai-source-num";
        num.textContent = String(source.n || i + 1);

        var host = document.createElement("span");
        host.className = "ai-source-title";
        host.textContent = source.title || url.hostname.replace(/^www\./, "");

        a.appendChild(num);
        a.appendChild(host);
        container.appendChild(a);
        count++;
      } catch (err) {}
    });
    container.hidden = count === 0;
  }

  /* Split model output reliably into { direct, details } even when DETAILS: has no newline before it */
  function splitAnswerAndDetails(rawText, finalChunk) {
    var cleaned = String(rawText || "").replace(/^\s*(?:\*\*?)?ANSWER(?:\*\*?)?\s*:\s*/i, "");
    var detailsMatch = cleaned.match(/\s*(?:\r?\n)*\s*(?:\*\*?)?DETAILS(?:\*\*?)?\s*:\s*/i);
    var direct = "";
    var details = "";

    if (detailsMatch && detailsMatch.index !== undefined) {
      direct = cleaned.slice(0, detailsMatch.index);
      details = cleaned.slice(detailsMatch.index + detailsMatch[0].length);
    } else {
      var nlIndex = cleaned.indexOf("\n");
      if (nlIndex >= 0) {
        direct = cleaned.slice(0, nlIndex);
        details = cleaned.slice(nlIndex + 1).replace(/^\s*(?:\*\*?)?DETAILS(?:\*\*?)?\s*:\s*/i, "");
      } else {
        direct = cleaned;
      }
    }

    /* While streaming, strip any partial trailing "D".."DETAILS" right after "]]" or sentence end */
    if (!finalChunk) {
      direct = direct.replace(/(?:\]\]|[.!?])\s*D(?:E(?:T(?:A(?:I(?:L(?:S)?)?)?)?)?)?$/i, function (m) {
        return m.slice(0, m.indexOf("]]") === 0 ? 2 : 1);
      });
    }

    return {
      direct: direct.trim(),
      details: details.trim()
    };
  }

  /* Automatically find a concise key phrase to highlight if the model forgot [[...]] and **...** */
  function applySmartFallbackHighlight(text) {
    if (!text || /\[\[[\s\S]*?\]\]|\*\*[^*]+\*\*/.test(text)) return text;
    /* Match patterns like "is approximately 15.6525.", "equals 42.", "= 15.6525" */
    var m = text.match(/^(.*?\b(?:is\s+approximately|is\s+about|is\s+roughly|equals|is\s+equal\s+to|are|is|was|were)\s+|.*?\s*[=≈]\s*)([^\s.,;:!?][^\n.;!?]{0,48}?)([.!?]?\s*)$/i);
    if (m && m[2] && m[2].trim().length <= 48) {
      return m[1] + "[[" + m[2].trim() + "]]" + (m[3] || "");
    }
    return text;
  }

  /* Append text with inline formatting: [[highlight]], **bold/highlight**, `code`, and [1] citations */
  function appendRichInline(container, text, options) {
    options = options || {};
    var promoteBoldToHighlight = !!options.promoteBoldToHighlight;
    var sources = options.sources || [];

    /* Normalize unclosed [[ while streaming so raw brackets never flash */
    var working = String(text || "");
    var lastOpen = working.lastIndexOf("[[");
    var lastClose = working.lastIndexOf("]]");
    if (lastOpen > lastClose) {
      if (options.finalChunk) {
        working = working.slice(0, lastOpen) + "[[" + working.slice(lastOpen + 2) + "]]";
      } else {
        var openSpan = working.slice(lastOpen + 2);
        working = working.slice(0, lastOpen) + (openSpan ? "[[" + openSpan + "]]" : "");
      }
    }

    var tokenRegex = /\[\[([\s\S]*?)\]\]|\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|\[(\d+)\]/g;
    var cursor = 0;
    var match;

    function cleanPlain(str) {
      return str.replace(/\[\[|\]\]/g, "");
    }

    while ((match = tokenRegex.exec(working))) {
      if (match.index > cursor) {
        var plain = cleanPlain(working.slice(cursor, match.index));
        if (plain) container.appendChild(document.createTextNode(plain));
      }
      if (match[1] !== undefined) {
        var hlText = cleanPlain(match[1]).trim();
        if (hlText) {
          var mark = document.createElement("mark");
          mark.className = "ai-inline-highlight";
          mark.textContent = hlText;
          container.appendChild(mark);
        }
      } else if (match[2] !== undefined) {
        var boldText = cleanPlain(match[2]).trim();
        if (boldText) {
          var bEl = document.createElement(promoteBoldToHighlight ? "mark" : "strong");
          bEl.className = promoteBoldToHighlight ? "ai-inline-highlight" : "ai-inline-bold";
          bEl.textContent = boldText;
          container.appendChild(bEl);
        }
      } else if (match[3] !== undefined) {
        var codeEl = document.createElement("code");
        codeEl.className = "ai-inline-code";
        codeEl.textContent = match[3];
        container.appendChild(codeEl);
      } else if (match[4] !== undefined) {
        var citeNum = Number(match[4]);
        var matchedSource = null;
        for (var s = 0; s < sources.length; s++) {
          if ((sources[s].n || s + 1) === citeNum) { matchedSource = sources[s]; break; }
        }
        if (matchedSource && matchedSource.url) {
          var citeLink = document.createElement("a");
          citeLink.className = "ai-cite";
          citeLink.href = matchedSource.url;
          citeLink.target = "_blank";
          citeLink.rel = "noopener noreferrer";
          citeLink.textContent = String(citeNum);
          citeLink.title = matchedSource.title || matchedSource.url;
          container.appendChild(citeLink);
        } else {
          var citeSpan = document.createElement("span");
          citeSpan.className = "ai-cite";
          citeSpan.textContent = String(citeNum);
          container.appendChild(citeSpan);
        }
      }
      cursor = tokenRegex.lastIndex;
    }

    if (cursor < working.length) {
      var tail = cleanPlain(working.slice(cursor));
      if (!options.finalChunk) {
        tail = tail.replace(/\[$/, "");
      }
      if (tail) container.appendChild(document.createTextNode(tail));
    }
  }

  function renderDetailsBlock(container, detailsText, sources, finalChunk) {
    container.replaceChildren();
    if (!detailsText) {
      container.hidden = true;
      return;
    }
    var lines = detailsText.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    lines.forEach(function (line) {
      var cleanLine = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
      if (!cleanLine) return;
      var row = document.createElement("div");
      row.className = "ai-detail-row";
      var dot = document.createElement("span");
      dot.className = "ai-detail-dot";
      dot.setAttribute("aria-hidden", "true");
      var textSpan = document.createElement("div");
      textSpan.className = "ai-detail-text";
      appendRichInline(textSpan, cleanLine, {
        promoteBoldToHighlight: false,
        sources: sources,
        finalChunk: finalChunk
      });
      row.appendChild(dot);
      row.appendChild(textSpan);
      container.appendChild(row);
    });
  }

  function renderAnswerText(target, full, finalChunk) {
    var parts = splitAnswerAndDetails(full, !!finalChunk);
    var directText = parts.direct;
    var detailsText = parts.details;

    if (!directText && !detailsText && !finalChunk) return;

    /* Reveal answer body and hide thinking skeleton smoothly */
    if (!target.skeleton.hidden) {
      target.skeleton.hidden = true;
      target.content.hidden = false;
      target.turn.classList.remove("is-thinking");
      target.turn.classList.add("is-ready");
    }

    if (finalChunk && directText) {
      directText = applySmartFallbackHighlight(directText);
    }

    target.direct.replaceChildren();
    appendRichInline(target.direct, directText || "…", {
      promoteBoldToHighlight: true,
      sources: target.activeSources,
      finalChunk: !!finalChunk
    });

    renderDetailsBlock(target.details, detailsText, target.activeSources, !!finalChunk);
    scrollBottom();
  }

  function parseEvent(block) {
    var data = block.split(/\r?\n/).filter(function (line) { return line.slice(0, 5) === "data:"; })
      .map(function (line) { return line.slice(5).trim(); }).join("\n");
    if (!data) return null;
    try { return JSON.parse(data); } catch (err) { return null; }
  }

  function abortActive() {
    sequence++;
    if (activeController) activeController.abort();
    activeController = null;
    activeAuto = false;
    sendButton.disabled = false;
    if (askCurrent) askCurrent.disabled = false;
  }

  function localAnswerIsVisible() {
    var local = document.getElementById("answerCard");
    return !!(local && !local.hidden && local.textContent.trim());
  }

  function currentQuery() {
    return (input.value || "").replace(/\s+/g, " ").trim();
  }

  function setIdleStatus() {
    setStatus("");
  }

  async function ask(messages, options) {
    options = options || {};
    abortActive();
    var thisSequence = sequence;
    var controller = new AbortController();
    activeController = controller;
    activeAuto = !!options.auto;

    var cacheKey = messages.length === 1
      ? (messages[0].content.toLowerCase() + "::" + (options.extended ? "ext" : "std"))
      : "";

    var target = makeAssistantTurn(!!options.extended);
    setStatus("");

    /* Instant hit from session cache */
    if (cacheKey && answerCache.has(cacheKey)) {
      var cached = answerCache.get(cacheKey);
      if (cached.model) modelBadge.textContent = cached.model;
      paintSources(target, cached.sources || []);
      renderAnswerText(target, cached.full, true);
      if (options.saveChat) chat.push({ role: "assistant", content: cached.full });
      activeController = null;
      activeAuto = false;
      return;
    }

    var full = "";
    var resolvedModel = "";
    var resolvedSources = [];
    sendButton.disabled = true;
    if (askCurrent) askCurrent.disabled = true;

    try {
      var response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify({
          messages: messages,
          extended: !!options.extended,
          search: options.search !== false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        var failure = await response.json().catch(function () { return {}; });
        throw new Error(failure.error || "AI request failed (" + response.status + ").");
      }
      if (!response.body) throw new Error("Streaming is unavailable in this browser.");

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      while (true) {
        var part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        var match;
        while ((match = buffer.match(/\r?\n\r?\n/))) {
          var eventText = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          var event = parseEvent(eventText);
          if (!event) continue;
          if (event.type === "meta") {
            resolvedModel = (event.model || "Gemma 4").replace(/\s+26B-A4B$/i, "");
            modelBadge.textContent = resolvedModel;
            modelBadge.title = event.modelId || event.model || "";
            resolvedSources = event.sources || [];
            paintSources(target, resolvedSources);
          } else if (event.type === "delta" && typeof event.text === "string") {
            full += event.text;
            renderAnswerText(target, full, false);
          } else if (event.type === "error") {
            throw new Error(event.message || "The answer stream stopped.");
          }
        }
        if (part.done) break;
        if (thisSequence !== sequence) { reader.cancel(); return; }
      }
      if (buffer.trim()) {
        var lastEvent = parseEvent(buffer);
        if (lastEvent && lastEvent.type === "delta" && typeof lastEvent.text === "string") full += lastEvent.text;
      }
      if (thisSequence !== sequence) return;
      renderAnswerText(target, full || "The model returned no answer. Try again.", true);
      setStatus("");
      if (options.saveChat && full) {
        chat.push({ role: "assistant", content: full });
        if (cacheKey && full.length > 5) {
          answerCache.set(cacheKey, { full: full, model: resolvedModel, sources: resolvedSources });
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (thisSequence !== sequence) return;
      target.skeleton.hidden = true;
      target.content.hidden = false;
      target.turn.classList.remove("is-thinking");
      target.direct.textContent = "Couldn’t load an AI overview right now.";
      target.details.hidden = false;
      target.details.textContent = err && err.message ? err.message : "Please try again in a moment.";
      setStatus("");
    } finally {
      if (thisSequence === sequence) {
        activeController = null;
        activeAuto = false;
        sendButton.disabled = false;
        if (askCurrent) askCurrent.disabled = false;
      }
    }
  }

  function autoAnswer() {
    var q = currentQuery();
    if (!autoToggle.checked || q.length < 3) { setIdleStatus(); return; }
    if (/^!\w+\b/.test(q) || (typeof matchShortcut === "function" && matchShortcut(q))) {
      clearTranscript();
      return;
    }
    if (/^(https?:\/\/|www\.)\S+$/i.test(q)) {
      clearTranscript();
      return;
    }
    if (localAnswerIsVisible()) {
      clearTranscript();
      return;
    }
    chat = [{ role: "user", content: q }];
    transcript.replaceChildren();
    addUser(q, false);
    ask(chat.slice(), { auto: true, search: true, extended: false, saveChat: true });
  }

  input.addEventListener("input", function () {
    window.clearTimeout(debounce);
    abortActive();
    chat = [];
    var q = currentQuery();
    if (!q || !autoToggle.checked) {
      clearTranscript();
      setIdleStatus();
      return;
    }
    debounce = window.setTimeout(autoAnswer, 250);
  });

  autoToggle.addEventListener("change", function () {
    try { localStorage.setItem("hts.ai.auto", autoToggle.checked ? "on" : "off"); } catch (err) {}
    syncAutoVisibility();
    if (!autoToggle.checked) {
      window.clearTimeout(debounce);
      if (activeAuto) abortActive();
      if (!chat.length) clearTranscript();
      setIdleStatus();
    } else if (currentQuery()) {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(autoAnswer, 120);
    } else {
      clearTranscript();
      setIdleStatus();
    }
  });

  if (askCurrent) {
    askCurrent.addEventListener("click", function () {
      var q = currentQuery();
      if (!q) {
        input.focus();
        setStatus("Type a search query first.");
        return;
      }
      chat = [{ role: "user", content: q }];
      transcript.replaceChildren();
      addUser(q, false);
      ask(chat.slice(), { auto: false, search: true, extended: extendedToggle.checked, saveChat: true });
    });
  }

  followup.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (typeof followForm.requestSubmit === "function") followForm.requestSubmit();
      else followForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  });

  followForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = (followup.value || "").trim();
    if (!text) return;
    if (!chat.length) {
      var q = currentQuery();
      if (q) chat.push({ role: "user", content: q });
    }
    chat.push({ role: "user", content: text });
    addUser(text, true);
    followup.value = "";
    ask(chat.slice(-10), { auto: false, search: true, extended: extendedToggle.checked, saveChat: true });
  });

  document.getElementById("aiMinimize").addEventListener("click", function () {
    panel.classList.add("minimized");
    document.body.classList.add("ai-minimized");
    document.getElementById("aiReopen").hidden = false;
  });
  document.getElementById("aiReopen").addEventListener("click", function () {
    panel.classList.remove("minimized");
    document.body.classList.remove("ai-minimized");
    document.getElementById("aiReopen").hidden = true;
  });

  syncAutoVisibility();
  clearTranscript();
  setIdleStatus();
  if (currentQuery() && autoToggle.checked) {
    debounce = window.setTimeout(autoAnswer, 50);
  }
})();

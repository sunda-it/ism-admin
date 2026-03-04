// ISM Manager – Admin Web App
// Reads/writes config.json in a GitHub repo via the GitHub Contents API.
// GitHub Personal Access Token is stored in localStorage (never transmitted elsewhere).

const GH_KEY = "ism_gh";   // localStorage key for GitHub credentials
const CFG_KEY = "ism_cfg"; // sessionStorage key for current working config

let gh = null;    // { token, repo, branch, path }
let config = null; // working copy of config object
let editCallback = null; // callback used by the generic edit modal

// ── GitHub API ────────────────────────────────────────────────────────────────

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${gh.repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${gh.repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${gh.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content: btoa(unescape(encodeURIComponent(content))), sha, branch: gh.branch }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(text, kind) {
  const el = document.getElementById("statusBar");
  el.className = "statusBar " + (kind || "");
  el.textContent = text || "";
  clearTimeout(setStatus._t);
  if (kind === "ok" && text) {
    setStatus._t = setTimeout(() => { el.textContent = ""; el.className = "statusBar"; }, 4000);
  }
}

// ── Connection ────────────────────────────────────────────────────────────────

function loadCredentials() {
  try { gh = JSON.parse(localStorage.getItem(GH_KEY)); } catch (e) { gh = null; }
  updateConnectionUI();
}

function saveCredentials() {
  localStorage.setItem(GH_KEY, JSON.stringify(gh));
}

function updateConnectionUI() {
  const status = document.getElementById("connStatus");
  const btnLoad = document.getElementById("btnLoad");
  const btnSave = document.getElementById("btnSave");
  if (gh?.token) {
    status.textContent = `Connected: ${gh.repo} (${gh.branch})`;
    status.className = "connStatus connected";
    btnLoad.disabled = false;
    btnSave.disabled = !config;
  } else {
    status.textContent = "Not connected to GitHub";
    status.className = "connStatus";
    btnLoad.disabled = true;
    btnSave.disabled = true;
  }
}

// ── Load / Save config ────────────────────────────────────────────────────────

async function loadConfig() {
  if (!gh) { setStatus("Connect to GitHub first.", "warn"); return; }
  setStatus("Loading config from GitHub…");
  try {
    const file = await ghGet(gh.path);
    const text = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
    config = JSON.parse(text);
    config._sha = file.sha; // stash SHA for the PUT later
    sessionStorage.setItem(CFG_KEY, JSON.stringify(config));
    renderAll();
    document.getElementById("btnSave").disabled = false;
    setStatus("Config loaded.", "ok");
  } catch (e) {
    setStatus("Load failed: " + e.message, "warn");
  }
}

async function saveConfig() {
  if (!gh || !config) return;
  setStatus("Saving to GitHub…");
  try {
    const clean = { ...config };
    delete clean._sha;
    const text = JSON.stringify(clean, null, 2);
    let sha = config._sha;
    let result;
    try {
      result = await ghPut(gh.path, text, sha, "Update ISM config via admin app");
    } catch (e) {
      if (!e.message.includes("409")) throw e;
      // SHA is stale — fetch the current SHA from GitHub and retry
      setStatus("Refreshing SHA and retrying…");
      const current = await ghGet(gh.path);
      result = await ghPut(gh.path, text, current.sha, "Update ISM config via admin app");
    }
    config._sha = result.content.sha;
    sessionStorage.setItem(CFG_KEY, JSON.stringify(config));
    setStatus("Saved to GitHub successfully.", "ok");
  } catch (e) {
    setStatus("Save failed: " + e.message, "warn");
  }
}

// ── Render all tabs ───────────────────────────────────────────────────────────

function renderAll() {
  renderClassifications();
  renderCaveats();
  renderAccessMarkers();
  renderDisclaimers();
  renderMarkingFormat();
  renderSecurity();
}

// ── Classifications ───────────────────────────────────────────────────────────

function renderClassifications() {
  const tbody = document.getElementById("classBody");
  tbody.innerHTML = "";
  (config.classifications || []).forEach((cls, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${cls.bil}</td>
      <td>${esc(cls.cls)}</td>
      <td><code>(${esc(cls.portionMark || "?")})</code></td>
      <td>${esc(cls.label)}</td>
      <td class="defCell">${esc(cls.def)}</td>
      <td><span class="colourSwatch" style="background:${esc(cls.colour)}"></span>${esc(cls.colour)}${cls.bgStyle && cls.bgStyle !== "white" ? ` <span class="hint">${esc(cls.bgStyle)}</span>` : ''}</td>
      <td>${cls.expiryYears ?? "None"}</td>
      <td><input type="checkbox" ${cls.skipDisclaimer ? "checked" : ""} data-i="${i}" class="chkSkip" /></td>
      <td style="white-space:nowrap">
        <button class="small secondary" data-i="${i}" data-action="editCls">Edit</button>
        <button class="small danger" data-i="${i}" data-action="delCls" style="margin-left:4px">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".chkSkip").forEach((cb) => {
    cb.addEventListener("change", () => {
      config.classifications[+cb.dataset.i].skipDisclaimer = cb.checked;
    });
  });
  tbody.querySelectorAll("[data-action='editCls']").forEach((btn) => {
    btn.addEventListener("click", () => openEditClassification(+btn.dataset.i));
  });
  tbody.querySelectorAll("[data-action='delCls']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this classification?")) return;
      config.classifications.splice(+btn.dataset.i, 1);
      renderClassifications();
    });
  });
}

function openEditClassification(i) {
  const cls = i === -1
    ? { bil: "", cls: "", label: "", def: "", colour: "#502B85", expiryYears: 7, skipDisclaimer: false, portionMark: "" }
    : { ...config.classifications[i] };

  document.getElementById("editModalTitle").textContent = i === -1 ? "Add Classification" : "Edit Classification";
  document.getElementById("editModalBody").innerHTML = `
    <div class="field"><label>BIL Number</label><input id="f_bil" type="number" min="0" value="${cls.bil}" /></div>
    <div class="field"><label>Classification (e.g. OFFICIAL: Sensitive)</label><input id="f_cls" type="text" value="${esc(cls.cls)}" /></div>
    <div class="field"><label>Portion mark abbreviation <span class="hint">Displayed as (X) inline in documents</span></label><input id="f_pm" type="text" maxlength="10" placeholder="e.g. OS" value="${esc(cls.portionMark || "")}" style="width:100px" /></div>
    <div class="field"><label>Select label (shown in dropdown)</label><input id="f_label" type="text" value="${esc(cls.label)}" /></div>
    <div class="field"><label>Definition</label><textarea id="f_def" rows="3">${esc(cls.def)}</textarea></div>
    <div class="field"><label>Colour</label><input id="f_colour" type="color" value="${cls.colour}" /></div>
    <div class="field"><label>Background style <span class="hint">(used by {{backgroundCss}} placeholder)</span></label>
      <select id="f_bgStyle">
        <option value="white"   ${(!cls.bgStyle || cls.bgStyle === "white")   ? "selected" : ""}>White</option>
        <option value="solid"   ${cls.bgStyle === "solid"   ? "selected" : ""}>Solid (classification colour)</option>
        <option value="pattern" ${cls.bgStyle === "pattern" ? "selected" : ""}>Pattern (white + classification colour)</option>
      </select></div>
    <div class="field"><label>Expiry years (leave blank for none)</label><input id="f_expiry" type="number" min="0" value="${cls.expiryYears ?? ""}" /></div>
    <div class="field"><label><input id="f_skip" type="checkbox" ${cls.skipDisclaimer ? "checked" : ""} /> Skip disclaimer for this classification</label></div>`;

  editCallback = () => {
    const updated = {
      bil: Number(document.getElementById("f_bil").value),
      cls: document.getElementById("f_cls").value.trim(),
      portionMark: document.getElementById("f_pm").value.trim().toUpperCase(),
      label: document.getElementById("f_label").value.trim(),
      def: document.getElementById("f_def").value.trim(),
      colour: document.getElementById("f_colour").value,
      bgStyle: document.getElementById("f_bgStyle").value,
      expiryYears: document.getElementById("f_expiry").value !== ""
        ? Number(document.getElementById("f_expiry").value) : null,
      skipDisclaimer: document.getElementById("f_skip").checked,
    };
    if (!updated.cls || updated.bil === "" || isNaN(updated.bil)) {
      setStatus("BIL number and Classification name are required.", "warn");
      return false;
    }
    if (i === -1) config.classifications.push(updated);
    else config.classifications[i] = updated;
    config.classifications.sort((a, b) => a.bil - b.bil);
    renderClassifications();
    return true;
  };
  showEditModal();
}

// ── Caveats ───────────────────────────────────────────────────────────────────

function renderCaveats() {
  const tbody = document.getElementById("caveatBody");
  tbody.innerHTML = "";
  (config.caveats || []).forEach((cav, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${esc(cav.type)}</strong></td>
      <td>${esc(cav.label)}</td>
      <td>${esc(cav.hint || "—")}</td>
      <td>${cav.maxLength ?? "—"}</td>
      <td>${cav.maxCount ?? "—"}</td>
      <td><code>${esc(cav.pattern || "—")}</code></td>
      <td>${cav.subOptions ? esc(cav.subOptions.join(", ")) : "—"}</td>
      <td>${cav.format ? `<code>${esc(cav.format)}</code>` : '<span class="hint">default</span>'}</td>
      <td style="white-space:nowrap">
        <button class="small secondary" data-i="${i}" data-action="editCav">Edit</button>
        <button class="small danger" data-i="${i}" data-action="delCav" style="margin-left:4px">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("[data-action='editCav']").forEach((btn) => {
    btn.addEventListener("click", () => openEditCaveat(+btn.dataset.i));
  });
  tbody.querySelectorAll("[data-action='delCav']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this caveat type?")) return;
      config.caveats.splice(+btn.dataset.i, 1);
      renderCaveats();
    });
  });
}

function openEditCaveat(i) {
  const cav = i === -1
    ? { type: "", label: "", hint: "", maxLength: null, maxCount: null, pattern: null, patternError: null, subOptions: null }
    : { ...config.caveats[i] };

  document.getElementById("editModalTitle").textContent = i === -1 ? "Add Caveat Type" : "Edit Caveat Type";
  document.getElementById("editModalBody").innerHTML = `
    <div class="field"><label>Type code (e.g. P, ORCON, SH)</label><input id="f_type" type="text" value="${esc(cav.type)}" /></div>
    <div class="field"><label>Label (shown in dropdown)</label><input id="f_clabel" type="text" value="${esc(cav.label)}" /></div>
    <div class="field"><label>Hint text</label><input id="f_hint" type="text" value="${esc(cav.hint || "")}" /></div>
    <div class="field"><label>Max length (leave blank for none)</label><input id="f_maxLen" type="number" min="1" value="${cav.maxLength ?? ""}" /></div>
    <div class="field"><label>Max count (leave blank for unlimited)</label><input id="f_maxCnt" type="number" min="1" value="${cav.maxCount ?? ""}" /></div>
    <div class="field"><label>Regex pattern (leave blank for none)</label><input id="f_pattern" type="text" value="${esc(cav.pattern || "")}" /></div>
    <div class="field"><label>Pattern error message</label><input id="f_patErr" type="text" value="${esc(cav.patternError || "")}" /></div>
    <div class="field"><label>Sub-options (comma-separated; use EXCLUSIVE-FOR for a named option)</label><input id="f_subs" type="text" value="${esc((cav.subOptions || []).join(", "))}" /></div>
    <div class="field"><label>Format string <span class="hint">leave blank for default <code>{{type}}:{{value}}</code></span></label>
      <input id="f_format" type="text" placeholder="{{type}}:{{value}}" value="${esc(cav.format || "")}" />
      <div class="hint" style="margin-top:4px">Placeholders: <code>{{type}}</code> type code &bull; <code>{{value}}</code> entered value &bull; <code>{{label}}</code> caveat label<br>Example: <code>{{value}} EYES ONLY</code> → <em>SGP EYES ONLY</em></div>
    </div>`;

  editCallback = () => {
    const subsRaw = document.getElementById("f_subs").value.trim();
    const updated = {
      type: document.getElementById("f_type").value.trim().toUpperCase(),
      label: document.getElementById("f_clabel").value.trim(),
      hint: document.getElementById("f_hint").value.trim(),
      maxLength: document.getElementById("f_maxLen").value !== "" ? Number(document.getElementById("f_maxLen").value) : null,
      maxCount: document.getElementById("f_maxCnt").value !== "" ? Number(document.getElementById("f_maxCnt").value) : null,
      pattern: document.getElementById("f_pattern").value.trim() || null,
      patternError: document.getElementById("f_patErr").value.trim() || null,
      subOptions: subsRaw ? subsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
      format: document.getElementById("f_format").value.trim() || null,
    };
    if (!updated.type || !updated.label) {
      setStatus("Type code and Label are required.", "warn");
      return false;
    }
    if (i === -1) config.caveats.push(updated);
    else config.caveats[i] = updated;
    renderCaveats();
    return true;
  };
  showEditModal();
}

// ── Access Markers ────────────────────────────────────────────────────────────

function renderAccessMarkers() {
  const list = document.getElementById("accessList");
  list.innerHTML = "";
  (config.accessMarkers || []).forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "markerRow";
    row.innerHTML = `<span>${esc(m)}</span>
      <button class="small danger" data-i="${i}" data-action="delMarker">Remove</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll("[data-action='delMarker']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this access marker?")) return;
      config.accessMarkers.splice(+btn.dataset.i, 1);
      renderAccessMarkers();
    });
  });
}

// ── Marking Formats ───────────────────────────────────────────────────────────

function renderMarkingFormat() {
  const fmt = config.markingFormat || {};
  const s = fmt.subject || {};
  const b = fmt.banner  || {};

  document.getElementById("fmtSecPrefix").value     = s.secPrefix    ?? "SEC=";
  document.getElementById("fmtCaveatPrefix").value  = s.caveatPrefix ?? "CAVEAT=";
  document.getElementById("fmtAccessPrefix").value  = s.accessPrefix ?? "ACCESS=";
  document.getElementById("fmtSubjExpires").checked = s.includeExpires ?? true;

  document.getElementById("fmtSeparator").value      = b.caveatSeparator ?? "//";
  document.getElementById("fmtAccessLabel").value    = b.accessLabel     ?? "Sensitive:";
  document.getElementById("fmtBannerExpires").checked = b.includeExpires ?? true;
  document.getElementById("fmtPosition").value       = b.position    || "top";
  document.getElementById("fmtAlignment").value      = b.alignment   || "center";
  document.getElementById("fmtFontSize").value       = b.fontSize    || "13px";
  document.getElementById("fmtBold").checked         = b.bold        ?? true;
  document.getElementById("fmtUseClsColour").checked = b.useClassificationColour ?? true;
  document.getElementById("fmtCustomColour").value   = b.customColour || "#111111";

  const hasBg = !!(b.backgroundColour);
  document.getElementById("fmtNoBg").checked  = !hasBg;
  document.getElementById("fmtBgColour").value = b.backgroundColour || "#ffffff";
  document.getElementById("fmtBgColour").disabled = !hasBg;

  document.getElementById("fmtHtmlTemplate").value = fmt.htmlBannerTemplate || "";

  updateFormatPreviews();
}

function collectMarkingFormat() {
  if (!config) return;
  const hasBg = !document.getElementById("fmtNoBg").checked;
  config.markingFormat = {
    subject: {
      secPrefix:      document.getElementById("fmtSecPrefix").value,
      caveatPrefix:   document.getElementById("fmtCaveatPrefix").value,
      accessPrefix:   document.getElementById("fmtAccessPrefix").value,
      includeExpires: document.getElementById("fmtSubjExpires").checked,
    },
    banner: {
      caveatSeparator:        document.getElementById("fmtSeparator").value,
      accessLabel:            document.getElementById("fmtAccessLabel").value,
      includeExpires:         document.getElementById("fmtBannerExpires").checked,
      position:               document.getElementById("fmtPosition").value,
      alignment:              document.getElementById("fmtAlignment").value,
      fontSize:               document.getElementById("fmtFontSize").value || "13px",
      bold:                   document.getElementById("fmtBold").checked,
      useClassificationColour: document.getElementById("fmtUseClsColour").checked,
      customColour:           document.getElementById("fmtCustomColour").value,
      backgroundColour:       hasBg ? document.getElementById("fmtBgColour").value : "",
    },
    htmlBannerTemplate: document.getElementById("fmtHtmlTemplate").value.trim() || null,
  };
}

function updateFormatPreviews() {
  // Build a sample model using the first classification
  const cls = (config?.classifications || [])[0] || { bil: 0, cls: "OFFICIAL: Sensitive", colour: "#502B85" };
  const sampleModel = {
    bil: cls.bil ?? 0, cls: cls.cls, colour: cls.colour,
    caveats: [{ type: "P", value: "ProjectName" }],
    access: ["Legal Privilege"],
    expires: "2033-03-04",
  };

  const s = {
    secPrefix:      document.getElementById("fmtSecPrefix").value,
    caveatPrefix:   document.getElementById("fmtCaveatPrefix").value,
    accessPrefix:   document.getElementById("fmtAccessPrefix").value,
    includeExpires: document.getElementById("fmtSubjExpires").checked,
  };
  const b = {
    caveatSeparator: document.getElementById("fmtSeparator").value,
    accessLabel:     document.getElementById("fmtAccessLabel").value,
    includeExpires:  document.getElementById("fmtBannerExpires").checked,
  };

  // Subject preview
  const sParts = [`${s.secPrefix}${sampleModel.cls}`];
  sampleModel.caveats.forEach(c => sParts.push(`${s.caveatPrefix}${c.type}:${c.value}`));
  sampleModel.access.forEach(a  => sParts.push(`${s.accessPrefix}${a}`));
  if (s.includeExpires) sParts.push(`EXPIRES=${sampleModel.expires}`, `DOWNTO=${sampleModel.cls}`);
  document.getElementById("previewSubject").textContent = `[${sParts.join(", ")}]`;

  // Plain text banner preview
  const sep = b.caveatSeparator || "//";
  const accLabel = b.accessLabel || "Sensitive:";
  let line1 = `[SEC=${sampleModel.cls}`;
  sampleModel.caveats.forEach(c => { line1 += `${sep}${c.type}:${c.value}`; });
  line1 += "]";
  const bLines = [line1, `[${accLabel} ${sampleModel.access.join("; ")}]`];
  if (b.includeExpires) bLines.push(`[EXPIRES=${sampleModel.expires}, DOWNTO=${sampleModel.cls}]`);
  document.getElementById("previewBanner").textContent = bLines.join("\n");

  // HTML banner template preview
  const caveatsHtml = sampleModel.caveats.map(c => `${sep}${esc(c.type)}:${esc(c.value)}`).join("");
  const accessHtml  = sampleModel.access.length ? `<br>${esc(accLabel)} ${sampleModel.access.map(esc).join("; ")}` : "";
  const expiresHtml = b.includeExpires && sampleModel.expires
    ? `<br>EXPIRES=${esc(sampleModel.expires)}, DOWNTO=${esc(sampleModel.cls)}` : "";

  const tmpl = document.getElementById("fmtHtmlTemplate").value.trim();
  let htmlOut;
  const bgStyle = cls.bgStyle || "white";
  const backgroundCss = bgStyle === "pattern"
    ? `repeating-linear-gradient(45deg, ${cls.colour}, ${cls.colour} 8px, #ffffff 8px, #ffffff 18px)`
    : bgStyle === "solid" ? cls.colour : "#ffffff";
  const textColour = getContrastTextColour(cls.colour);

  if (tmpl) {
    htmlOut = tmpl
      .replace(/\{\{cls\}\}/g, esc(cls.cls))
      .replace(/\{\{colour\}\}/g, esc(cls.colour))
      .replace(/\{\{bil\}\}/g, String(sampleModel.bil))
      .replace(/\{\{backgroundCss\}\}/g, backgroundCss)
      .replace(/\{\{textColour\}\}/g, textColour)
      .replace(/\{\{caveats\}\}/g, caveatsHtml)
      .replace(/\{\{accessLine\}\}/g, accessHtml)
      .replace(/\{\{expiresLine\}\}/g, expiresHtml);
  } else {
    const useClsColour = document.getElementById("fmtUseClsColour").checked;
    const colour = useClsColour ? cls.colour : document.getElementById("fmtCustomColour").value;
    const bold = document.getElementById("fmtBold").checked;
    const alignment = document.getElementById("fmtAlignment").value;
    const fontSize = document.getElementById("fmtFontSize").value || "13px";
    const hasBg2 = !document.getElementById("fmtNoBg").checked;
    const bgColour = hasBg2 ? backgroundCss : "";
    const styleProps = [
      `text-align:${alignment}`,
      bold ? "font-weight:700" : "font-weight:400",
      `font-size:${fontSize}`,
      "margin:0 0 12px 0",
      bgColour ? `background:${bgColour};padding:4px 8px;` : "",
    ].filter(Boolean).join(";");
    const header = `[${esc(cls.cls)}${caveatsHtml}${accessHtml}${expiresHtml}]`;
    htmlOut = `<div id="org-security-banner" style="${styleProps}"><span style="color:${esc(colour)};">${header}</span></div>`;
  }
  document.getElementById("previewHtmlBanner").innerHTML = htmlOut;
}

function wireFormatTab() {
  const liveFields = ["fmtSecPrefix","fmtCaveatPrefix","fmtAccessPrefix","fmtSubjExpires",
    "fmtSeparator","fmtAccessLabel","fmtBannerExpires","fmtPosition","fmtAlignment",
    "fmtFontSize","fmtBold","fmtUseClsColour","fmtCustomColour","fmtBgColour","fmtNoBg"];
  liveFields.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("change", updateFormatPreviews);
    if (el.type === "text") el.addEventListener("input", updateFormatPreviews);
  });
  document.getElementById("fmtNoBg").addEventListener("change", (e) => {
    document.getElementById("fmtBgColour").disabled = e.target.checked;
  });
  document.getElementById("fmtHtmlTemplate").addEventListener("input", updateFormatPreviews);
  document.getElementById("btnResetTemplate").addEventListener("click", () => {
    document.getElementById("fmtHtmlTemplate").value = "";
    updateFormatPreviews();
  });
}

// ── Disclaimers ───────────────────────────────────────────────────────────────

function renderDisclaimers() {
  document.getElementById("disclaimerDefault").value = config.disclaimers?.default || "";
  document.getElementById("disclaimerExplicit").value = config.disclaimers?.explicit || "";
  document.getElementById("ruleMinBil").value = config.explicitDisclaimerRules?.minBil ?? 3;
  document.getElementById("ruleIfCaveats").checked = config.explicitDisclaimerRules?.ifHasCaveats ?? true;
  document.getElementById("ruleIfAccess").checked = config.explicitDisclaimerRules?.ifHasAccess ?? true;
}

function collectDisclaimers() {
  if (!config) return;
  config.disclaimers = {
    default: document.getElementById("disclaimerDefault").value.trim(),
    explicit: document.getElementById("disclaimerExplicit").value.trim(),
  };
  config.explicitDisclaimerRules = {
    minBil: Number(document.getElementById("ruleMinBil").value),
    ifHasCaveats: document.getElementById("ruleIfCaveats").checked,
    ifHasAccess: document.getElementById("ruleIfAccess").checked,
  };
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function showEditModal() {
  document.getElementById("editOverlay").classList.remove("hidden");
}

function hideEditModal() {
  document.getElementById("editOverlay").classList.add("hidden");
  editCallback = null;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tabPane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

// ── Security ──────────────────────────────────────────────────────────────────

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderSecurity() {
  const sec = config.security || {};
  const hasToken = !!(sec.orgTokenHash);
  const el = document.getElementById("secTokenStatus");
  el.className = "secTokenStatus " + (hasToken ? "ok" : "");
  el.textContent = hasToken ? "Token is set \u2713" : "No token configured \u2014 extension is open access.";
  document.getElementById("secMessage").value = sec.restrictionMessage || "";
}

async function collectSecurity() {
  if (!config) return;
  if (!config.security) config.security = {};
  // If admin typed a token but didn't click Set Token, hash it now
  const plain = document.getElementById("secToken").value.trim();
  if (plain) {
    config.security.orgTokenHash = await sha256(plain);
    document.getElementById("secToken").value = "";
    renderSecurity();
  }
  config.security.restrictionMessage = document.getElementById("secMessage").value.trim();
}

function wireSecurityTab() {
  document.getElementById("btnSetToken").addEventListener("click", async () => {
    const plain = document.getElementById("secToken").value.trim();
    if (!plain) { setStatus("Enter a token first.", "warn"); return; }
    if (!config) { setStatus("Load a config first.", "warn"); return; }
    if (!config.security) config.security = {};
    config.security.orgTokenHash = await sha256(plain);
    config.security.restrictionMessage = document.getElementById("secMessage").value.trim();
    document.getElementById("secToken").value = "";
    renderSecurity();
    setStatus("Token set — click Save to GitHub to apply.", "ok");
  });

  document.getElementById("btnClearToken").addEventListener("click", () => {
    if (!confirm("Remove the organisation token? The extension will become open access.")) return;
    if (!config.security) config.security = {};
    config.security.orgTokenHash = "";
    renderSecurity();
    setStatus("Token cleared — click Save to GitHub to apply.", "ok");
  });
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initTabs();
  wireFormatTab();
  wireSecurityTab();
  loadCredentials();

  // Restore unsaved session work
  try {
    const cached = sessionStorage.getItem(CFG_KEY);
    if (cached && gh) { config = JSON.parse(cached); renderAll(); document.getElementById("btnSave").disabled = false; }
  } catch (e) {}

  // GitHub connect button
  document.getElementById("btnConnect").addEventListener("click", () => {
    if (gh) {
      document.getElementById("ghToken").value = gh.token;
      document.getElementById("ghRepo").value = gh.repo;
      document.getElementById("ghBranch").value = gh.branch;
      document.getElementById("ghPath").value = gh.path;
    }
    document.getElementById("modalOverlay").classList.remove("hidden");
  });

  document.getElementById("btnModalSave").addEventListener("click", () => {
    const token = document.getElementById("ghToken").value.trim();
    const repo = document.getElementById("ghRepo").value.trim();
    const branch = document.getElementById("ghBranch").value.trim();
    const path = document.getElementById("ghPath").value.trim();
    if (!token || !repo) { setStatus("Token and repository are required.", "warn"); return; }
    gh = { token, repo, branch, path };
    saveCredentials();
    updateConnectionUI();
    document.getElementById("modalOverlay").classList.add("hidden");
    setStatus("Connected.", "ok");
  });

  document.getElementById("btnModalCancel").addEventListener("click", () => {
    document.getElementById("modalOverlay").classList.add("hidden");
  });

  // Load / Save
  document.getElementById("btnLoad").addEventListener("click", loadConfig);
  document.getElementById("btnSave").addEventListener("click", async () => {
    collectDisclaimers();
    collectMarkingFormat();
    await collectSecurity();
    saveConfig();
  });

  // Add classification
  document.getElementById("btnAddClass").addEventListener("click", () => openEditClassification(-1));

  // Add caveat
  document.getElementById("btnAddCaveat").addEventListener("click", () => openEditCaveat(-1));

  // Add access marker
  document.getElementById("btnAddMarker").addEventListener("click", () => {
    const val = document.getElementById("newMarker").value.trim();
    if (!val) return;
    if (!config) { setStatus("Load a config first.", "warn"); return; }
    config.accessMarkers.push(val);
    document.getElementById("newMarker").value = "";
    renderAccessMarkers();
  });
  document.getElementById("newMarker").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnAddMarker").click();
  });

  // Edit modal
  document.getElementById("btnEditSave").addEventListener("click", () => {
    if (editCallback && editCallback() !== false) hideEditModal();
  });
  document.getElementById("btnEditCancel").addEventListener("click", hideEditModal);
  document.getElementById("editOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("editOverlay")) hideEditModal();
  });
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modalOverlay"))
      document.getElementById("modalOverlay").classList.add("hidden");
  });
}

document.addEventListener("DOMContentLoaded", init);

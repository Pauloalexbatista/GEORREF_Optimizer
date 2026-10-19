// Driver App PWA Logic

let driverData = JSON.parse(localStorage.getItem("geo_driver") || "null");
let localStops = JSON.parse(localStorage.getItem("geo_stops") || "[]");
let failureReasons = JSON.parse(localStorage.getItem("geo_reasons") || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("geo_offline_queue") || "[]");

let activeStopForReason = null;
let activeStopForPod = null;
let currentPodPhotoBase64 = null;
let currentFailPhotoBase64 = null;

// Signature Canvas State
let sigCanvas = null;
let sigCtx = null;
let isDrawing = false;
let sigHasStrokes = false;

// PWA Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/static/sw.js").catch(() => {});
}

// Redirect if not logged in
if (!driverData || !driverData.driver_id) {
  window.location.href = "/login";
}

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initSignaturePad();
  initPhotoHandlers();
  fetchDriverData();
  initNetworkListeners();
  startPeriodicSync();
  startGpsTracking();
});

function initUI() {
  document.getElementById("driver-name-display").textContent = driverData.name || "Motorista";
  document.getElementById("driver-route-display").textContent = driverData.route_id || "Sem Rota";
  document.getElementById("driver-vehicle-display").textContent = driverData.vehicle || "-";
  
  // Footer navigation
  document.getElementById("btn-nav-list").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  
  document.getElementById("btn-nav-sync").addEventListener("click", () => {
    syncOfflineQueue(true);
  });
  
  document.getElementById("btn-nav-summary").addEventListener("click", showSummaryModal);
  
  document.getElementById("btn-logout").addEventListener("click", () => {
    stopGpsTracking();
    localStorage.removeItem("geo_driver");
    window.location.href = "/login";
  });

  // Pausa/Almoço & Fecho do Dia (RGPD / CNPD)
  const btnToggleBreak = document.getElementById("btn-toggle-break");
  if (btnToggleBreak) {
    btnToggleBreak.addEventListener("click", toggleDriverBreak);
  }

  const btnCloseShift = document.getElementById("btn-close-shift");
  if (btnCloseShift) {
    btnCloseShift.addEventListener("click", closeDriverShift);
  }

  // Modal events (Motivo de Insucesso)
  document.getElementById("btn-cancel-reason").addEventListener("click", closeReasonModal);
  document.getElementById("btn-confirm-reason").addEventListener("click", confirmFailureReason);
  document.getElementById("btn-close-summary").addEventListener("click", () => {
    document.getElementById("summary-modal").classList.remove("active");
  });

  // Modal events (POD - Assinatura & Foto)
  const btnCancelPod = document.getElementById("btn-cancel-pod");
  if (btnCancelPod) btnCancelPod.addEventListener("click", closePodModal);

  const btnConfirmPod = document.getElementById("btn-confirm-pod");
  if (btnConfirmPod) btnConfirmPod.addEventListener("click", confirmPodCompletion);

  const btnClearSig = document.getElementById("btn-clear-sig");
  if (btnClearSig) btnClearSig.addEventListener("click", clearSignature);
}

// -------------------------------------------------------------
// Digital Signature Pad (Canvas Touch & Mouse)
// -------------------------------------------------------------
function initSignaturePad() {
  sigCanvas = document.getElementById("signature-canvas");
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext("2d");

  // Touch events (Mobile)
  sigCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = sigCanvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) * (sigCanvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (sigCanvas.height / rect.height);
    startDrawing(x, y);
  }, { passive: false });

  sigCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const touch = e.touches[0];
    const rect = sigCanvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) * (sigCanvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (sigCanvas.height / rect.height);
    drawStroke(x, y);
  }, { passive: false });

  sigCanvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopDrawing();
  }, { passive: false });

  sigCanvas.addEventListener("touchcancel", () => stopDrawing());

  // Mouse events (Desktop / Testing)
  sigCanvas.addEventListener("mousedown", (e) => {
    const rect = sigCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (sigCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (sigCanvas.height / rect.height);
    startDrawing(x, y);
  });

  sigCanvas.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;
    const rect = sigCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (sigCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (sigCanvas.height / rect.height);
    drawStroke(x, y);
  });

  sigCanvas.addEventListener("mouseup", () => stopDrawing());
  sigCanvas.addEventListener("mouseleave", () => stopDrawing());
}

function startDrawing(x, y) {
  isDrawing = true;
  sigHasStrokes = true;
  if (!sigCtx) return;
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "#0f172a";
  sigCtx.beginPath();
  sigCtx.moveTo(x, y);
}

function drawStroke(x, y) {
  if (!isDrawing || !sigCtx) return;
  sigCtx.lineTo(x, y);
  sigCtx.stroke();
}

function stopDrawing() {
  if (isDrawing && sigCtx) {
    sigCtx.closePath();
  }
  isDrawing = false;
}

function clearSignature() {
  if (!sigCanvas || !sigCtx) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigHasStrokes = false;
}

// -------------------------------------------------------------
// Image Compression & Photo Capture Handlers
// -------------------------------------------------------------
function compressImageFile(file, maxWidth = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return reject(new Error("Ficheiro inválido (não é imagem)"));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initPhotoHandlers() {
  // POD Photo
  const podTrigger = document.getElementById("btn-pod-photo-trigger");
  const podInput = document.getElementById("pod-photo-input");
  const podPreviewContainer = document.getElementById("pod-photo-preview-container");
  const podPreviewImg = document.getElementById("pod-photo-preview");
  const btnRemovePodPhoto = document.getElementById("btn-remove-pod-photo");

  if (podTrigger && podInput) {
    podTrigger.addEventListener("click", () => podInput.click());
    podInput.addEventListener("change", async (e) => {
      if (e.target.files && e.target.files[0]) {
        try {
          const base64 = await compressImageFile(e.target.files[0]);
          currentPodPhotoBase64 = base64;
          if (podPreviewImg) podPreviewImg.src = base64;
          if (podPreviewContainer) podPreviewContainer.style.display = "flex";
        } catch (err) {
          alert("Erro ao carregar a foto: " + err.message);
        }
      }
    });
  }

  if (btnRemovePodPhoto) {
    btnRemovePodPhoto.addEventListener("click", () => {
      currentPodPhotoBase64 = null;
      if (podInput) podInput.value = "";
      if (podPreviewContainer) podPreviewContainer.style.display = "none";
    });
  }

  // Failure Reason Photo
  const failTrigger = document.getElementById("btn-fail-photo-trigger");
  const failInput = document.getElementById("fail-photo-input");
  const failPreviewContainer = document.getElementById("fail-photo-preview-container");
  const failPreviewImg = document.getElementById("fail-photo-preview");
  const btnRemoveFailPhoto = document.getElementById("btn-remove-fail-photo");

  if (failTrigger && failInput) {
    failTrigger.addEventListener("click", () => failInput.click());
    failInput.addEventListener("change", async (e) => {
      if (e.target.files && e.target.files[0]) {
        try {
          const base64 = await compressImageFile(e.target.files[0]);
          currentFailPhotoBase64 = base64;
          if (failPreviewImg) failPreviewImg.src = base64;
          if (failPreviewContainer) failPreviewContainer.style.display = "flex";
        } catch (err) {
          alert("Erro ao carregar a foto: " + err.message);
        }
      }
    });
  }

  if (btnRemoveFailPhoto) {
    btnRemoveFailPhoto.addEventListener("click", () => {
      currentFailPhotoBase64 = null;
      if (failInput) failInput.value = "";
      if (failPreviewContainer) failPreviewContainer.style.display = "none";
    });
  }
}

// -------------------------------------------------------------
// Network & Sync Handlers
// -------------------------------------------------------------
function updateNetworkStatus(isOnline, isSyncing = false) {
  const badge = document.getElementById("network-status-badge");
  if (!badge) return;
  const text = badge.querySelector(".status-text");
  
  badge.className = "status-pill";
  if (isSyncing) {
    badge.classList.add("status-syncing");
    if (text) text.textContent = (typeof t === "function") ? t("status_syncing") : "A sincronizar...";
  } else if (isOnline) {
    badge.classList.add("status-online");
    if (text) text.textContent = (typeof t === "function") ? t("status_online") : "Online";
  } else {
    badge.classList.add("status-offline");
    if (text) text.textContent = (typeof t === "function") ? t("status_offline") : "Sem Rede";
  }
}

function initNetworkListeners() {
  updateNetworkStatus(navigator.onLine);
  window.addEventListener("online", () => {
    updateNetworkStatus(true);
    syncOfflineQueue();
  });
  window.addEventListener("offline", () => {
    updateNetworkStatus(false);
  });
}

async function fetchDriverData() {
  if (!navigator.onLine && localStops.length > 0) {
    renderStops(localStops);
    return;
  }
  
  try {
    updateNetworkStatus(true, true);
    const res = await fetch(`/api/driver/data?driver_id=${driverData.driver_id}`);
    if (res.ok) {
      const data = await res.json();
      driverData = { ...driverData, ...data.driver };
      localStops = data.stops || [];
      failureReasons = data.reasons || [];
      
      localStorage.setItem("geo_driver", JSON.stringify(driverData));
      localStorage.setItem("geo_stops", JSON.stringify(localStops));
      localStorage.setItem("geo_reasons", JSON.stringify(failureReasons));
      
      populateReasonSelect(failureReasons);
      renderStops(localStops);
    }
  } catch (err) {
    console.warn("Using offline cached data");
    renderStops(localStops);
  } finally {
    updateNetworkStatus(navigator.onLine);
  }
}

// -------------------------------------------------------------
// Stops List Rendering (With 4 Logistic Movements & Badges)
// -------------------------------------------------------------
function getOperationConfig(opType) {
  const op = String(opType || "D").toUpperCase().trim();
  switch (op) {
    case "P":
      return {
        code: "P",
        badgeClass: "badge-op-p",
        label: "♻️ Recolha Sucata",
        actionBtnText: "✓ Sucata Recolhida",
        actionBtnClass: "btn-warning",
        modalTitle: "Comprovativo de Recolha de Sucata"
      };
    case "FROM":
      return {
        code: "From",
        badgeClass: "badge-op-from",
        label: "🏪⤴️ Levantamento Loja",
        actionBtnText: "✓ Artigo Levantado",
        actionBtnClass: "btn-primary",
        modalTitle: "Comprovativo de Levantamento em Loja"
      };
    case "TO":
      return {
        code: "To",
        badgeClass: "badge-op-to",
        label: "🏠⤵️ Entrega de Loja",
        actionBtnText: "✓ Entregue ao Cliente",
        actionBtnClass: "btn-success",
        modalTitle: "Comprovativo de Entrega (POD - Loja)"
      };
    case "D":
    default:
      return {
        code: "D",
        badgeClass: "badge-op-d",
        label: "📦 Entrega",
        actionBtnText: "✓ Concluir Entrega",
        actionBtnClass: "btn-success",
        modalTitle: "Comprovativo de Entrega (POD)"
      };
  }
}

function renderStops(stops) {
  const container = document.getElementById("stops-list-container");
  if (!container) return;
  container.innerHTML = "";
  
  if (!stops || stops.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; padding:30px; color:var(--text-secondary)">Não existem tarefas atribuídas a esta rota hoje.</div>`;
    return;
  }
  
  stops.forEach((stop, index) => {
    const card = document.createElement("div");
    card.className = "card stop-card";
    card.id = `stop-${stop.id}`;
    
    let statusBadgeClass = "badge-pendente";
    let statusText = "Pendente";
    if (stop.status === "Entregue") {
      statusBadgeClass = "badge-entregue";
      statusText = "Concluído";
    } else if (stop.status === "Não Entregue") {
      statusBadgeClass = "badge-nao-entregue";
      statusText = "Não Concluído";
    }
    
    const opConfig = getOperationConfig(stop.operation_type);
    const fullAddress = `${stop.address || ""} ${stop.postal_code || ""} ${stop.city || ""}`.trim();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
    
    card.innerHTML = `
      <div class="card-header">
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <span class="client-seq">${stop.sequence || index + 1}</span>
          <div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
              <span class="badge-op ${opConfig.badgeClass}">${opConfig.label}</span>
              ${stop.par_id ? `<span class="badge-op" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">🔗 Par #${escapeHtml(stop.par_id)}</span>` : ""}
            </div>
            <div class="client-name">${escapeHtml(stop.client_name)}</div>
            <div class="client-address">${escapeHtml(fullAddress)}</div>
          </div>
        </div>
        <span class="badge-status ${statusBadgeClass}">${statusText}</span>
      </div>
      
      <div class="client-meta">
        ${stop.phone ? `<span class="meta-chip">📞 <a href="tel:${escapeHtml(stop.phone)}" style="color:inherit">${escapeHtml(stop.phone)}</a></span>` : ""}
        ${stop.packages ? `<span class="meta-chip">📦 ${stop.packages} volumes</span>` : ""}
        ${stop.weight ? `<span class="meta-chip">⚖️ ${stop.weight} kg</span>` : ""}
        ${stop.cod_amount > 0 ? `<span class="meta-chip" style="color:#b91c1c; font-weight:700">💰 Cobrar: ${Number(stop.cod_amount).toFixed(2)} €</span>` : ""}
        ${stop.seller ? `<span class="meta-chip">👤 ${escapeHtml(stop.seller)}</span>` : ""}
      </div>
      
      ${stop.notes ? `<div style="margin-top:10px; font-size:12px; color:var(--text-secondary); background:var(--bg-surface-alt); padding:6px 10px; border-radius:var(--radius-sm)"><strong>Instruções:</strong> ${escapeHtml(stop.notes)}</div>` : ""}
      
      ${stop.fail_reason ? `<div style="margin-top:8px; font-size:12px; color:#991b1b; background:#fee2e2; padding:6px 10px; border-radius:var(--radius-sm)"><strong>Motivo:</strong> ${escapeHtml(stop.fail_reason)}</div>` : ""}
      
      <!-- Indicador de Assinatura e Foto registados -->
      ${(stop.receiver_name || stop.signature_data || stop.photo_data) ? `
        <div style="margin-top:8px; font-size:11px; color:#15803d; background:#dcfce7; padding:6px 10px; border-radius:var(--radius-sm); display:flex; gap:12px; align-items:center;">
          ${stop.receiver_name ? `<span>✍️ <strong>${escapeHtml(stop.receiver_name)}</strong></span>` : ""}
          ${stop.signature_data ? `<span>📝 Assinatura Guardada</span>` : ""}
          ${stop.photo_data ? `<span>📸 Foto Anexada</span>` : ""}
        </div>
      ` : ""}

      <!-- Driver Feedback notes -->
      <div class="form-group" style="margin-top:12px; margin-bottom:8px;">
        <label class="form-label" style="font-size:11px;">Notas do Motorista (Observações):</label>
        <input type="text" class="form-input driver-notes-input" value="${escapeHtml(stop.driver_notes || "")}" placeholder="Ex: Deixado na receção com Sr. Silva..." style="font-size:12px; padding:6px 10px;">
      </div>
      
      <!-- Action buttons -->
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
        <a href="${mapsUrl}" target="_blank" class="btn btn-secondary btn-block" style="text-decoration:none; text-align:center;">
          📍 Navegar no Google Maps
        </a>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <button class="btn btn-success" onclick="openPodModal(${stop.id})" style="font-weight:600;">
            ${opConfig.actionBtnText}
          </button>
          <button class="btn btn-danger" onclick="handleOpenReasonModal(${stop.id})" style="font-weight:600;">
            ✗ Não Concluído
          </button>
        </div>
      </div>
    `;
    
    // Save driver notes on blur
    const notesInput = card.querySelector(".driver-notes-input");
    if (notesInput) {
      notesInput.addEventListener("blur", (e) => {
        stop.driver_notes = e.target.value;
        localStorage.setItem("geo_stops", JSON.stringify(localStops));
        queueUpdate(stop.id, stop.status, stop.fail_reason, stop.driver_notes, stop.signature_data, stop.receiver_name, stop.photo_data);
      });
    }
    
    container.appendChild(card);
  });
}

function populateReasonSelect(reasons) {
  const select = document.getElementById("select-fail-reason");
  if (!select) return;
  select.innerHTML = "";
  reasons.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    select.appendChild(opt);
  });
}

// -------------------------------------------------------------
// POD (Proof of Delivery) Modal & Confirmation
// -------------------------------------------------------------
function openPodModal(stopId) {
  const stop = localStops.find((s) => s.id === stopId);
  if (!stop) return;
  activeStopForPod = stopId;

  const opConfig = getOperationConfig(stop.operation_type);
  const modalTitle = document.getElementById("pod-modal-title");
  if (modalTitle) modalTitle.textContent = opConfig.modalTitle;

  const receiverInput = document.getElementById("pod-receiver-name");
  if (receiverInput) receiverInput.value = stop.receiver_name || "";

  // Reset signature
  clearSignature();

  // Reset photo preview
  currentPodPhotoBase64 = null;
  const podPhotoInput = document.getElementById("pod-photo-input");
  if (podPhotoInput) podPhotoInput.value = "";
  const podPhotoPreview = document.getElementById("pod-photo-preview-container");
  if (podPhotoPreview) podPhotoPreview.style.display = "none";

  const modal = document.getElementById("pod-modal");
  if (modal) modal.classList.add("active");
}

function closePodModal() {
  activeStopForPod = null;
  currentPodPhotoBase64 = null;
  clearSignature();
  const modal = document.getElementById("pod-modal");
  if (modal) modal.classList.remove("active");
}

function confirmPodCompletion() {
  if (!activeStopForPod) return;
  const stop = localStops.find((s) => s.id === activeStopForPod);
  if (!stop) return;

  const receiverName = (document.getElementById("pod-receiver-name")?.value || "").trim();
  const signatureData = sigHasStrokes && sigCanvas ? sigCanvas.toDataURL("image/png") : (stop.signature_data || null);
  const photoData = currentPodPhotoBase64 || stop.photo_data || null;

  stop.status = "Entregue";
  stop.fail_reason = "";
  stop.receiver_name = receiverName;
  stop.signature_data = signatureData;
  stop.photo_data = photoData;

  localStorage.setItem("geo_stops", JSON.stringify(localStops));
  renderStops(localStops);

  queueUpdate(
    stop.id,
    "Entregue",
    "",
    stop.driver_notes || "",
    signatureData,
    receiverName,
    photoData
  );

  closePodModal();
}

// -------------------------------------------------------------
// Failure Reason Modal
// -------------------------------------------------------------
function handleOpenReasonModal(stopId) {
  activeStopForReason = stopId;
  populateReasonSelect(failureReasons);
  
  // Reset photo preview for failure modal
  currentFailPhotoBase64 = null;
  const failInput = document.getElementById("fail-photo-input");
  if (failInput) failInput.value = "";
  const failPreview = document.getElementById("fail-photo-preview-container");
  if (failPreview) failPreview.style.display = "none";

  const modal = document.getElementById("reason-modal");
  if (modal) modal.classList.add("active");
}

function closeReasonModal() {
  activeStopForReason = null;
  currentFailPhotoBase64 = null;
  const modal = document.getElementById("reason-modal");
  if (modal) modal.classList.remove("active");
}

function confirmFailureReason() {
  if (!activeStopForReason) return;
  const select = document.getElementById("select-fail-reason");
  const selectedReason = select ? select.value : "Outro Motivo";
  
  const stop = localStops.find((s) => s.id === activeStopForReason);
  if (stop) {
    const photoData = currentFailPhotoBase64 || stop.photo_data || null;

    stop.status = "Não Entregue";
    stop.fail_reason = selectedReason;
    stop.photo_data = photoData;

    localStorage.setItem("geo_stops", JSON.stringify(localStops));
    renderStops(localStops);
    
    queueUpdate(
      stop.id,
      "Não Entregue",
      selectedReason,
      stop.driver_notes || "",
      stop.signature_data || null,
      stop.receiver_name || null,
      photoData
    );
  }
  closeReasonModal();
}

// -------------------------------------------------------------
// Offline Queue & Server Sync
// -------------------------------------------------------------
function queueUpdate(stopId, status, failReason, driverNotes, signatureData = null, receiverName = null, photoData = null) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      saveAndTriggerQueue(stopId, status, failReason, driverNotes, pos.coords.latitude, pos.coords.longitude, signatureData, receiverName, photoData);
    },
    () => {
      saveAndTriggerQueue(stopId, status, failReason, driverNotes, null, null, signatureData, receiverName, photoData);
    },
    { timeout: 3000 }
  );
}

function saveAndTriggerQueue(stopId, status, failReason, driverNotes, lat, lng, signatureData, receiverName, photoData) {
  const payload = {
    stop_id: stopId,
    status: status,
    fail_reason: failReason,
    driver_notes: driverNotes,
    driver_id: driverData.driver_id,
    lat: lat,
    lng: lng,
    signature_data: signatureData,
    receiver_name: receiverName,
    photo_data: photoData,
    queued_at: new Date().toISOString()
  };
  
  offlineQueue = offlineQueue.filter((q) => q.stop_id !== stopId);
  offlineQueue.push(payload);
  localStorage.setItem("geo_offline_queue", JSON.stringify(offlineQueue));
  
  syncOfflineQueue();
}

async function syncOfflineQueue(forceAlert = false) {
  if (!navigator.onLine || offlineQueue.length === 0) {
    if (forceAlert) alert("Sincronização concluída (0 pendentes).");
    return;
  }
  
  updateNetworkStatus(true, true);
  const remaining = [];
  
  for (const item of offlineQueue) {
    try {
      const res = await fetch("/api/driver/update_stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
      });
      if (!res.ok) remaining.push(item);
    } catch (e) {
      remaining.push(item);
    }
  }
  
  offlineQueue = remaining;
  localStorage.setItem("geo_offline_queue", JSON.stringify(offlineQueue));
  updateNetworkStatus(navigator.onLine);
  
  if (forceAlert) {
    if (offlineQueue.length === 0) {
      alert("Sincronização concluída com sucesso!");
    } else {
      alert(`Restam ${offlineQueue.length} alterações por sincronizar.`);
    }
  }
}

function startPeriodicSync() {
  // Sync offline queue every 5 minutes (300,000 ms)
  setInterval(() => {
    syncOfflineQueue();
  }, 300000);
}

// -------------------------------------------------------------
// Gestão de Rastreio GPS & Conformidade RGPD / CNPD
// -------------------------------------------------------------
let gpsIntervalId = null;
let isBreakActive = false;
let isShiftClosed = false;

function toggleDriverBreak() {
  if (isShiftClosed) return;
  isBreakActive = !isBreakActive;
  
  const btn = document.getElementById("btn-toggle-break");
  const pill = document.getElementById("shift-status-pill");
  const text = document.getElementById("shift-status-text");
  const indicator = document.getElementById("gps-status-indicator");
  const alertBox = document.getElementById("break-alert-box");

  if (isBreakActive) {
    stopGpsTracking();
    if (btn) btn.innerHTML = "▶️ Retomar Turno";
    if (pill) {
      pill.className = "status-pill status-break";
    }
    if (text) text.textContent = "Em Pausa / Almoço";
    if (indicator) indicator.textContent = "⏸️ GPS Suspenso (Período de Descanso)";
    if (alertBox) alertBox.style.display = "block";
  } else {
    if (btn) btn.innerHTML = "⏸️ Pausa / Almoço";
    if (pill) {
      pill.className = "status-pill status-online";
    }
    if (text) text.textContent = "Em Serviço";
    if (indicator) indicator.textContent = "📡 GPS Operacional Ativo (a cada 5m)";
    if (alertBox) alertBox.style.display = "none";
    startGpsTracking();
  }
}

function closeDriverShift() {
  if (isShiftClosed) return;
  if (!confirm("Tem a certeza que deseja concluir a rota e fechar o dia de trabalho?\n\nTodas as transmissões de GPS e monitorização serão desligadas.")) {
    return;
  }
  
  isShiftClosed = true;
  stopGpsTracking();

  const btnBreak = document.getElementById("btn-toggle-break");
  if (btnBreak) btnBreak.disabled = true;

  const pill = document.getElementById("shift-status-pill");
  if (pill) pill.className = "status-pill status-closed";

  const text = document.getElementById("shift-status-text");
  if (text) text.textContent = "Turno Concluído";

  const indicator = document.getElementById("gps-status-indicator");
  if (indicator) indicator.textContent = "🔒 GPS Desligado a 100% (Turno Encerrado)";

  const alertBox = document.getElementById("break-alert-box");
  if (alertBox) alertBox.style.display = "none";

  const btnClose = document.getElementById("btn-close-shift");
  if (btnClose) {
    btnClose.disabled = true;
    btnClose.textContent = "✓ Turno Encerrado com Sucesso";
    btnClose.className = "btn btn-secondary btn-block";
  }

  const summaryModal = document.getElementById("summary-modal");
  if (summaryModal) summaryModal.classList.remove("active");

  alert("Fecho do dia registado com sucesso.\nO rastreio GPS foi totalmente encerrado e destruído.");
}

function stopGpsTracking() {
  if (gpsIntervalId) {
    clearInterval(gpsIntervalId);
    gpsIntervalId = null;
  }
}

function startGpsTracking() {
  if (!("geolocation" in navigator)) return;
  if (isBreakActive || isShiftClosed) return;
  
  stopGpsTracking();

  function sendGpsPing() {
    if (isBreakActive || isShiftClosed) {
      stopGpsTracking();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (isBreakActive || isShiftClosed) return;
        try {
          await fetch("/api/driver/gps_ping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driver_id: driverData.driver_id,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude
            })
          });
        } catch (e) {}
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  
  sendGpsPing();
  gpsIntervalId = setInterval(sendGpsPing, 300000);
}

// -------------------------------------------------------------
// Summary Modal
// -------------------------------------------------------------
function showSummaryModal() {
  const total = localStops.length;
  const delivered = localStops.filter((s) => s.status === "Entregue").length;
  const failed = localStops.filter((s) => s.status === "Não Entregue").length;
  const pending = total - delivered - failed;
  const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
  
  const sumTotal = document.getElementById("sum-total");
  const sumDelivered = document.getElementById("sum-delivered");
  const sumFailed = document.getElementById("sum-failed");
  const sumPending = document.getElementById("sum-pending");
  const sumRate = document.getElementById("sum-rate");

  if (sumTotal) sumTotal.textContent = total;
  if (sumDelivered) sumDelivered.textContent = delivered;
  if (sumFailed) sumFailed.textContent = failed;
  if (sumPending) sumPending.textContent = pending;
  if (sumRate) sumRate.textContent = `${rate}%`;
  
  const summaryModal = document.getElementById("summary-modal");
  if (summaryModal) summaryModal.classList.add("active");
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

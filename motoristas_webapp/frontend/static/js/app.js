// Driver App PWA Logic

let driverData = JSON.parse(localStorage.getItem("geo_driver") || "null");
let localStops = JSON.parse(localStorage.getItem("geo_stops") || "[]");
let failureReasons = JSON.parse(localStorage.getItem("geo_reasons") || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("geo_offline_queue") || "[]");
let activeStopForReason = null;

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
    localStorage.removeItem("geo_driver");
    window.location.href = "/login";
  });

  // Modal events
  document.getElementById("btn-cancel-reason").addEventListener("click", closeReasonModal);
  document.getElementById("btn-confirm-reason").addEventListener("click", confirmFailureReason);
  document.getElementById("btn-close-summary").addEventListener("click", () => {
    document.getElementById("summary-modal").classList.remove("active");
  });
}

function updateNetworkStatus(isOnline, isSyncing = false) {
  const badge = document.getElementById("network-status-badge");
  const dot = badge.querySelector(".dot");
  const text = badge.querySelector(".status-text");
  
  badge.className = "status-pill";
  if (isSyncing) {
    badge.classList.add("status-syncing");
    text.textContent = t("status_syncing");
  } else if (isOnline) {
    badge.classList.add("status-online");
    text.textContent = t("status_online");
  } else {
    badge.classList.add("status-offline");
    text.textContent = t("status_offline");
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

function renderStops(stops) {
  const container = document.getElementById("stops-list-container");
  container.innerHTML = "";
  
  if (!stops || stops.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; padding:30px; color:var(--text-secondary)">Não existem clientes atribuídos a esta rota hoje.</div>`;
    return;
  }
  
  stops.forEach((stop, index) => {
    const card = document.createElement("div");
    card.className = "card stop-card";
    card.id = `stop-${stop.id}`;
    
    let statusBadgeClass = "badge-pendente";
    let statusTextKey = "status_pendente";
    if (stop.status === "Entregue") {
      statusBadgeClass = "badge-entregue";
      statusTextKey = "status_entregue";
    } else if (stop.status === "Não Entregue") {
      statusBadgeClass = "badge-nao-entregue";
      statusTextKey = "status_nao_entregue";
    }
    
    const fullAddress = `${stop.address || ""} ${stop.postal_code || ""} ${stop.city || ""}`.trim();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
    
    card.innerHTML = `
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="client-seq">${stop.sequence || index + 1}</span>
          <div>
            <div class="client-name">${escapeHtml(stop.client_name)}</div>
            <div class="client-address">${escapeHtml(fullAddress)}</div>
          </div>
        </div>
        <span class="badge-status ${statusBadgeClass}">${t(statusTextKey)}</span>
      </div>
      
      <div class="client-meta">
        ${stop.phone ? `<span class="meta-chip">📞 <a href="tel:${escapeHtml(stop.phone)}" style="color:inherit">${escapeHtml(stop.phone)}</a></span>` : ""}
        ${stop.packages ? `<span class="meta-chip">📦 ${stop.packages} bultos</span>` : ""}
        ${stop.weight ? `<span class="meta-chip">⚖️ ${stop.weight} kg</span>` : ""}
        ${stop.cod_amount > 0 ? `<span class="meta-chip" style="color:#b91c1c; font-weight:700">💰 Cobrar: ${Number(stop.cod_amount).toFixed(2)} €</span>` : ""}
        ${stop.seller ? `<span class="meta-chip">👤 ${escapeHtml(stop.seller)}</span>` : ""}
      </div>
      
      ${stop.notes ? `<div style="margin-top:10px; font-size:12px; color:var(--text-secondary); background:var(--bg-surface-alt); padding:6px 10px; border-radius:var(--radius-sm)"><strong>Instruções:</strong> ${escapeHtml(stop.notes)}</div>` : ""}
      
      ${stop.fail_reason ? `<div style="margin-top:8px; font-size:12px; color:#991b1b; background:#fee2e2; padding:6px 10px; border-radius:var(--radius-sm)"><strong>Motivo:</strong> ${escapeHtml(stop.fail_reason)}</div>` : ""}
      
      <!-- Driver Feedback notes -->
      <div class="form-group" style="margin-top:12px; margin-bottom:8px;">
        <label class="form-label" style="font-size:11px;">${t("driver_notes_label")}</label>
        <input type="text" class="form-input driver-notes-input" value="${escapeHtml(stop.driver_notes || "")}" placeholder="${t("driver_notes_placeholder")}" style="font-size:12px; padding:6px 10px;">
      </div>
      
      <!-- Action buttons -->
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
        <a href="${mapsUrl}" target="_blank" class="btn btn-secondary btn-block" style="text-decoration:none;">
          📍 ${t("btn_navigate_maps")}
        </a>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <button class="btn btn-success" onclick="handleMarkDelivered(${stop.id})">
            ✓ ${t("btn_mark_delivered")}
          </button>
          <button class="btn btn-danger" onclick="handleOpenReasonModal(${stop.id})">
            ✗ ${t("btn_mark_failed")}
          </button>
        </div>
      </div>
    `;
    
    // Save driver notes on blur
    const notesInput = card.querySelector(".driver-notes-input");
    notesInput.addEventListener("blur", (e) => {
      stop.driver_notes = e.target.value;
      localStorage.setItem("geo_stops", JSON.stringify(localStops));
      queueUpdate(stop.id, stop.status, stop.fail_reason, stop.driver_notes);
    });
    
    container.appendChild(card);
  });
}

function populateReasonSelect(reasons) {
  const select = document.getElementById("select-fail-reason");
  select.innerHTML = "";
  reasons.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    select.appendChild(opt);
  });
}

// Handling status updates
function handleMarkDelivered(stopId) {
  const stop = localStops.find((s) => s.id === stopId);
  if (!stop) return;
  
  stop.status = "Entregue";
  stop.fail_reason = "";
  localStorage.setItem("geo_stops", JSON.stringify(localStops));
  renderStops(localStops);
  
  queueUpdate(stopId, "Entregue", "", stop.driver_notes || "");
}

function handleOpenReasonModal(stopId) {
  activeStopForReason = stopId;
  populateReasonSelect(failureReasons);
  document.getElementById("reason-modal").classList.add("active");
}

function closeReasonModal() {
  activeStopForReason = null;
  document.getElementById("reason-modal").classList.remove("active");
}

function confirmFailureReason() {
  if (!activeStopForReason) return;
  const select = document.getElementById("select-fail-reason");
  const selectedReason = select.value;
  
  const stop = localStops.find((s) => s.id === activeStopForReason);
  if (stop) {
    stop.status = "Não Entregue";
    stop.fail_reason = selectedReason;
    localStorage.setItem("geo_stops", JSON.stringify(localStops));
    renderStops(localStops);
    
    queueUpdate(stop.id, "Não Entregue", selectedReason, stop.driver_notes || "");
  }
  closeReasonModal();
}

// Queue & Sync
function queueUpdate(stopId, status, failReason, driverNotes) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      saveAndTriggerQueue(stopId, status, failReason, driverNotes, pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      saveAndTriggerQueue(stopId, status, failReason, driverNotes, null, null);
    },
    { timeout: 3000 }
  );
}

function saveAndTriggerQueue(stopId, status, failReason, driverNotes, lat, lng) {
  const payload = {
    stop_id: stopId,
    status: status,
    fail_reason: failReason,
    driver_notes: driverNotes,
    driver_id: driverData.driver_id,
    lat: lat,
    lng: lng,
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

function startGpsTracking() {
  if (!("geolocation" in navigator)) return;
  
  function sendGpsPing() {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
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
  // Ping GPS every 5 minutes
  setInterval(sendGpsPing, 300000);
}

// Summary Modal
function showSummaryModal() {
  const total = localStops.length;
  const delivered = localStops.filter((s) => s.status === "Entregue").length;
  const failed = localStops.filter((s) => s.status === "Não Entregue").length;
  const pending = total - delivered - failed;
  const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
  
  document.getElementById("sum-total").textContent = total;
  document.getElementById("sum-delivered").textContent = delivered;
  document.getElementById("sum-failed").textContent = failed;
  document.getElementById("sum-pending").textContent = pending;
  document.getElementById("sum-rate").textContent = `${rate}%`;
  
  document.getElementById("summary-modal").classList.add("active");
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

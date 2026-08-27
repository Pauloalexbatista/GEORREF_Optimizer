let map = null;
let markersGroup = null;
let qrCodeObj = null;
let expandedRoutes = new Set();
let cachedRouteStops = {};

// Auth check
const managerRole = localStorage.getItem("geo_role");
if (managerRole !== "manager") {
  window.location.href = "/login";
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initDashboardEvents();
  fetchDashboardData();
  
  // Auto refresh every 10 seconds
  setInterval(fetchDashboardData, 10000);
});

function initMap() {
  if (typeof L === "undefined") return;
  
  // Center in Portugal
  map = L.map("map").setView([39.5, -8.0], 7);
  
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  
  markersGroup = L.layerGroup().addTo(map);
}

function initDashboardEvents() {
  // Logout
  document.getElementById("btn-logout-manager").addEventListener("click", () => {
    localStorage.removeItem("geo_role");
    window.location.href = "/login";
  });
  
  // QR Code Modal (Optimized for Mobile Phone Cameras)
  document.getElementById("btn-open-qr").addEventListener("click", () => {
    const qrContainer = document.getElementById("qrcode-container");
    const directLink = document.getElementById("qr-direct-link");
    const driverAppUrl = window.location.origin + "/login";
    
    directLink.innerHTML = `<a href="${driverAppUrl}" target="_blank" style="color:var(--brand-primary); font-weight:700; text-decoration:underline;">${driverAppUrl}</a>`;
    qrContainer.innerHTML = "";
    
    if (typeof QRCode !== "undefined") {
      qrCodeObj = new QRCode(qrContainer, {
        text: driverAppUrl,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(driverAppUrl)}" alt="QR Code">`;
    }
    
    document.getElementById("qr-modal").classList.add("active");
  });
  
  document.getElementById("btn-close-qr").addEventListener("click", () => {
    document.getElementById("qr-modal").classList.remove("active");
  });
  
  // Import Modal
  document.getElementById("btn-open-import").addEventListener("click", () => {
    document.getElementById("import-modal").classList.add("active");
  });
  document.getElementById("btn-close-import").addEventListener("click", () => {
    document.getElementById("import-modal").classList.remove("active");
  });
  
  // Import Form
  document.getElementById("import-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("excel-file-input");
    if (!fileInput.files || fileInput.files.length === 0) {
      alert("Por favor, selecione um ficheiro Excel (.xlsx)");
      return;
    }
    
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    
    const uploadBtn = document.getElementById("btn-upload-submit");
    uploadBtn.disabled = true;
    uploadBtn.textContent = "A processar...";
    
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Importação concluída com sucesso!\nRotas: ${data.summary.total_routes} | Clientes: ${data.summary.total_stops}`);
        document.getElementById("import-modal").classList.remove("active");
        cachedRouteStops = {};
        fetchDashboardData();
      } else {
        alert(data.detail || "Erro ao importar ficheiro.");
      }
    } catch (err) {
      alert("Erro de conexão ao importar.");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = t("btn_upload");
    }
  });
  
  // Export
  document.getElementById("btn-export-day").addEventListener("click", () => {
    window.location.href = "/api/export";
  });
  
  // Clear Day
  document.getElementById("btn-clear-day").addEventListener("click", async () => {
    if (confirm(t("confirm_clear_day"))) {
      try {
        const res = await fetch("/api/clear", { method: "POST" });
        if (res.ok) {
          alert("Sessão do dia limpa com sucesso!");
          cachedRouteStops = {};
          expandedRoutes.clear();
          fetchDashboardData();
        }
      } catch (err) {
        alert("Erro ao limpar sessão.");
      }
    }
  });

  // Assign Modal
  document.getElementById("btn-close-assign").addEventListener("click", () => {
    document.getElementById("assign-modal").classList.remove("active");
  });
  document.getElementById("btn-confirm-assign").addEventListener("click", confirmDriverAssignment);
}

async function fetchDashboardData() {
  try {
    const res = await fetch("/api/manager/dashboard");
    if (!res.ok) return;
    const data = await res.json();
    
    renderOverviewStats(data.totals);
    await renderRoutesTable(data.routes, data.drivers);
    renderMapMarkers(data.drivers);
    renderActivityFeed(data.activity);
  } catch (err) {
    console.error("Dashboard poll error:", err);
  }
}

function renderOverviewStats(totals) {
  const total = totals.total_stops || 0;
  const delivered = totals.entregues || 0;
  const failed = totals.falhadas || 0;
  const pending = totals.pendentes || 0;
  const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
  
  document.getElementById("stat-total-stops").textContent = total;
  document.getElementById("stat-delivered").textContent = delivered;
  document.getElementById("stat-failed").textContent = failed;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-rate").textContent = `${rate}%`;
}

async function toggleRouteExpand(routeId) {
  if (expandedRoutes.has(routeId)) {
    expandedRoutes.delete(routeId);
  } else {
    expandedRoutes.add(routeId);
    if (!cachedRouteStops[routeId]) {
      try {
        const res = await fetch(`/api/manager/route_details/${encodeURIComponent(routeId)}`);
        if (res.ok) {
          const data = await res.json();
          cachedRouteStops[routeId] = data.stops || [];
        }
      } catch (e) {
        console.error("Failed to load route details", e);
      }
    }
  }
  fetchDashboardData();
}

async function renderRoutesTable(routes, drivers) {
  const tbody = document.getElementById("routes-table-body");
  tbody.innerHTML = "";
  
  if (!routes || routes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-secondary)">Nenhuma rota importada para hoje. Importe um ficheiro Excel.</td></tr>`;
    return;
  }
  
  for (const r of routes) {
    const total = r.total || 0;
    const delivered = r.entregues || 0;
    const failed = r.falhadas || 0;
    const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
    const isExpanded = expandedRoutes.has(r.route_id);
    
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>
        <button class="btn-icon" style="min-width:24px; min-height:24px; font-size:11px; margin-right:6px;" onclick="event.stopPropagation(); toggleRouteExpand('${escapeHtml(r.route_id)}')">
          ${isExpanded ? "▼" : "▶"}
        </button>
        <strong>${escapeHtml(r.route_id)}</strong>
      </td>
      <td>${escapeHtml(r.driver_name || "Não Atribuído")}</td>
      <td>${escapeHtml(r.vehicle || "-")}</td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="flex:1; background:var(--bg-surface-alt); border-radius:4px; height:8px; overflow:hidden; border:1px solid var(--border-color)">
            <div style="width:${pct}%; background:#16a34a; height:100%"></div>
          </div>
          <span style="font-size:12px; font-weight:700">${delivered}/${total} (${pct}%)</span>
        </div>
      </td>
      <td><span class="badge-status ${failed > 0 ? 'badge-nao-entregue' : 'badge-pendente'}">${failed}</span></td>
      <td><span style="font-size:12px; color:var(--text-secondary)">${r.last_gps_time || "Sem sinal"}</span></td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary" style="min-height:30px; padding:3px 8px; font-size:11px;" onclick="event.stopPropagation(); toggleRouteExpand('${escapeHtml(r.route_id)}')">
            🔍 ${isExpanded ? "Ocultar" : "Detalhes"}
          </button>
          <button class="btn btn-primary" style="min-height:30px; padding:3px 8px; font-size:11px;" onclick="event.stopPropagation(); openAssignModal('${escapeHtml(r.route_id)}')">
            👤 Atribuir
          </button>
        </div>
      </td>
    `;
    
    tr.addEventListener("click", () => toggleRouteExpand(r.route_id));
    tbody.appendChild(tr);
    
    // If expanded, render child stops accordion
    if (isExpanded) {
      const stops = cachedRouteStops[r.route_id] || [];
      const trDetails = document.createElement("tr");
      trDetails.className = "route-details-row";
      
      let stopsRowsHtml = "";
      if (stops.length === 0) {
        stopsRowsHtml = `<tr><td colspan="7" style="text-align:center; padding:12px; font-size:12px; color:var(--text-secondary)">A carregar paragens...</td></tr>`;
      } else {
        stops.forEach((s) => {
          const isDelivered = s.status === "Entregue";
          const isFailed = s.status === "Não Entregue";
          const badgeClass = isDelivered ? "badge-entregue" : (isFailed ? "badge-nao-entregue" : "badge-pendente");
          
          stopsRowsHtml += `
            <tr style="background:var(--bg-surface); font-size:12px;">
              <td style="font-weight:700; width:40px; text-align:center;">#${s.sequence || "-"}</td>
              <td>
                <div style="font-weight:700; color:var(--text-primary);">${escapeHtml(s.client_name)}</div>
                <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(s.address || "")} ${escapeHtml(s.postal_code || "")}</div>
              </td>
              <td>${escapeHtml(s.phone || "-")}</td>
              <td>
                <div style="font-family:monospace; font-weight:600;">${s.window_start || "08:00"} - ${s.window_end || "18:00"}</div>
              </td>
              <td>
                ${s.actual_arrival_time ? `<span style="color:#16a34a; font-weight:700; font-family:monospace;">⏱️ ${s.actual_arrival_time}</span>` : `<span style="color:var(--text-muted); font-size:11px;">Aguardando</span>`}
              </td>
              <td>
                <span class="badge-status ${badgeClass}">${s.status}</span>
                ${s.fail_reason ? `<div style="font-size:10px; color:#dc2626; margin-top:2px;">${escapeHtml(s.fail_reason)}</div>` : ""}
              </td>
              <td>
                <div style="font-size:11px; color:var(--text-secondary);">${s.driver_notes ? `<em>"${escapeHtml(s.driver_notes)}"</em>` : "-"}</div>
              </td>
            </tr>
          `;
        });
      }
      
      trDetails.innerHTML = `
        <td colspan="7" style="padding: 12px 16px; background: var(--bg-surface-alt); border-bottom: 2px solid var(--border-color);">
          <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-sm);">
            <div style="padding: 8px 12px; background: var(--bg-surface-alt); border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; font-weight:700;">📦 Paragens da Rota: ${escapeHtml(r.route_id)} (${stops.length} clientes)</span>
              <span style="font-size:11px; color:var(--text-secondary);">Motorista: ${escapeHtml(r.driver_name || "Não Atribuído")} | Viatura: ${escapeHtml(r.vehicle || "-")}</span>
            </div>
            <table style="width:100%; border-collapse:collapse;" class="data-table">
              <thead>
                <tr style="font-size:11px; text-transform:uppercase; color:var(--text-muted); background:var(--bg-surface-alt);">
                  <th>#</th>
                  <th>Cliente & Morada</th>
                  <th>Contacto</th>
                  <th>Janela Horária</th>
                  <th>Picagem Real</th>
                  <th>Estado</th>
                  <th>Feedback do Motorista</th>
                </tr>
              </thead>
              <tbody>
                ${stopsRowsHtml}
              </tbody>
            </table>
          </div>
        </td>
      `;
      tbody.appendChild(trDetails);
    }
  }
}

function renderMapMarkers(drivers) {
  if (!map || !markersGroup) return;
  markersGroup.clearLayers();
  
  const bounds = [];
  
  drivers.forEach((d) => {
    if (d.last_lat && d.last_lng) {
      const marker = L.marker([d.last_lat, d.last_lng]);
      marker.bindPopup(`
        <div style="font-size:13px; font-family:sans-serif">
          <strong>🚚 ${escapeHtml(d.name)}</strong><br>
          <strong>Viatura:</strong> ${escapeHtml(d.vehicle || "-")}<br>
          <strong>Rota:</strong> ${escapeHtml(d.assigned_route_id || "N/A")}<br>
          <span style="color:#64748b; font-size:11px">Último sinal: ${d.last_gps_time || "-"}</span>
        </div>
      `);
      markersGroup.addLayer(marker);
      bounds.push([d.last_lat, d.last_lng]);
    }
  });
  
  if (bounds.length > 0 && map) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

function renderActivityFeed(activities) {
  const container = document.getElementById("activity-feed-container");
  container.innerHTML = "";
  
  if (!activities || activities.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-secondary); padding:16px;">Sem registos recentes.</div>`;
    return;
  }
  
  activities.forEach((act) => {
    const item = document.createElement("div");
    item.style.cssText = "border-bottom:1px solid var(--border-color); padding:8px 0; font-size:13px;";
    
    const isSuccess = act.new_status === "Entregue";
    const statusColor = isSuccess ? "#16a34a" : (act.new_status === "Não Entregue" ? "#dc2626" : "#64748b");
    
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700">${escapeHtml(act.client_name)} (${escapeHtml(act.route_id)})</span>
        <span style="color:var(--text-muted); font-size:11px">${act.timestamp}</span>
      </div>
      <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
        <span style="color:${statusColor}; font-weight:700;">● ${escapeHtml(act.new_status)}</span>
        ${act.reason ? `<span style="color:var(--text-secondary); font-size:12px;">(${escapeHtml(act.reason)})</span>` : ""}
        <span style="color:var(--text-secondary); font-size:11px;">- ${escapeHtml(act.driver_name || "Motorista")}</span>
      </div>
      ${act.notes ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:2px; font-style:italic">"${escapeHtml(act.notes)}"</div>` : ""}
    `;
    container.appendChild(item);
  });
}

// Assignment Modal Logic
let activeRouteForAssign = null;
async function openAssignModal(routeId) {
  activeRouteForAssign = routeId;
  document.getElementById("assign-route-name").textContent = routeId;
  
  const select = document.getElementById("select-assign-driver");
  select.innerHTML = "";
  
  const res = await fetch("/api/manager/dashboard");
  const data = await res.json();
  
  data.drivers.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.vehicle || "Sem viatura"})`;
    select.appendChild(opt);
  });
  
  document.getElementById("assign-modal").classList.add("active");
}

async function confirmDriverAssignment() {
  if (!activeRouteForAssign) return;
  const select = document.getElementById("select-assign-driver");
  const driverId = select.value;
  
  try {
    const res = await fetch("/api/manager/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver_id: parseInt(driverId),
        route_id: activeRouteForAssign
      })
    });
    if (res.ok) {
      document.getElementById("assign-modal").classList.remove("active");
      fetchDashboardData();
    }
  } catch (err) {
    alert("Erro ao atribuir motorista.");
  }
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

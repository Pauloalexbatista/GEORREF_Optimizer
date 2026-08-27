let map = null;
let markersGroup = null;
let qrCodeObj = null;

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
  
  // QR Code Modal
  document.getElementById("btn-open-qr").addEventListener("click", () => {
    const qrContainer = document.getElementById("qrcode-container");
    const directLink = document.getElementById("qr-direct-link");
    const driverAppUrl = window.location.origin + "/login";
    
    directLink.textContent = driverAppUrl;
    qrContainer.innerHTML = "";
    
    if (typeof QRCode !== "undefined") {
      qrCodeObj = new QRCode(qrContainer, {
        text: driverAppUrl,
        width: 180,
        height: 180,
        colorDark: "#1e293b",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(driverAppUrl)}" alt="QR Code">`;
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
    renderRoutesTable(data.routes, data.drivers);
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

function renderRoutesTable(routes, drivers) {
  const tbody = document.getElementById("routes-table-body");
  tbody.innerHTML = "";
  
  if (!routes || routes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-secondary)">Nenhuma rota importada para hoje. Importe um ficheiro Excel.</td></tr>`;
    return;
  }
  
  routes.forEach((r) => {
    const total = r.total || 0;
    const delivered = r.entregues || 0;
    const failed = r.falhadas || 0;
    const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.route_id)}</strong></td>
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
        <button class="btn btn-secondary" style="min-height:32px; padding:4px 10px; font-size:12px;" onclick="openAssignModal('${escapeHtml(r.route_id)}')">
          👤 ${t("btn_assign")}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
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

/**
 * Production: set `VITE_API_URL` (e.g. https://clinic-rota-server.onrender.com) so `/api/*` hits Render.
 * Local dev: leave unset — same-origin `/api/*` is proxied by Vite to the Node backend.
 */
const API_BASE = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return p;
  return `${API_BASE}${p}`;
}

function parseJsonBody(text) {
  if (!text) return null;
  const t = text.trimStart();
  if (
    t.startsWith("<!DOCTYPE") ||
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    (t.startsWith("<") && !t.startsWith("{") && !t.startsWith("["))
  ) {
    const err = new Error("API returned HTML instead of JSON.");
    err.isHtmlResponse = true;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from API");
  }
}

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = parseJsonBody(text);
  if (!res.ok) {
    const msg = data?.error || res.statusText;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  getSettings: () => request("/api/settings"),
  putSettings: (body) => request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),

  getStaff: () => request("/api/staff"),
  createStaff: (body) => request("/api/staff", { method: "POST", body: JSON.stringify(body) }),
  updateStaff: (id, body) => request(`/api/staff/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteStaff: (id) => request(`/api/staff/${id}`, { method: "DELETE" }),

  getShifts: (startDate, endDate) =>
    request(`/api/shifts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
  createShift: (body) => request("/api/shifts", { method: "POST", body: JSON.stringify(body) }),
  updateShift: (id, body) => request(`/api/shifts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteShift: (id) => request(`/api/shifts/${id}`, { method: "DELETE" }),

  getDateOverrides: () => request("/api/date-overrides"),
  putStaffDateOverrides: (staffId, dateOverrides, overrideScope) =>
    request(`/api/staff/${staffId}/date-overrides`, {
      method: "PUT",
      body: JSON.stringify({ dateOverrides, overrideScope }),
    }),

  getClinicDayReceptionistSlots: (startDate, endDate) =>
    request(
      `/api/clinic-day-receptionist-slots?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
    ),
  putClinicDayReceptionistSlots: (body) =>
    request("/api/clinic-day-receptionist-slots", { method: "PUT", body: JSON.stringify(body) }),
  assignShiftStaff: (shiftId, assignedStaffId, assignOptions = {}) => {
    const body = { assigned_staff_id: assignedStaffId };
    if (typeof assignOptions.assigned_staff_manual_override === "boolean") {
      body.assigned_staff_manual_override = assignOptions.assigned_staff_manual_override;
    }
    return request(`/api/shifts/${shiftId}/assign`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
};

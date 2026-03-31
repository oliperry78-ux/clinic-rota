/** Base URL: Vite dev server proxies /api to the Node backend. */
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || res.statusText;
    throw new Error(msg);
  }
  return data;
}

export const api = {
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
  assignShiftStaff: (shiftId, assignedStaffId) =>
    request(`/api/shifts/${shiftId}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ assigned_staff_id: assignedStaffId }),
    }),
};

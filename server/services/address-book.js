"use strict";

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : raw;
}

function pickDepartmentPathName(pathJson) {
  if (!pathJson) return "";
  try {
    const items = typeof pathJson === "string" ? JSON.parse(pathJson) : pathJson;
    if (!Array.isArray(items)) return "";
    return items.map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
  } catch {
    return "";
  }
}

function pickDepartmentPath(addressBookUser) {
  const direct = String(addressBookUser?.department_path || "").trim();
  if (direct) return direct;
  return pickDepartmentPathName(addressBookUser?.department_path_json);
}

async function findAddressBookUserByPhone(conn, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const [rows] = await conn.execute(
    `SELECT phone, user_name, union_id, customer_id, department_id, department_name, department_path, department_path_json
       FROM chatbot_address_book_users
      WHERE phone = ?
      LIMIT 1`,
    [normalizedPhone],
  );
  return rows?.[0] || null;
}

function enrichProfileWithAddressBook(normalized, addressBookUser) {
  if (!addressBookUser) return normalized;
  const departmentName =
    String(addressBookUser.department_name || "").trim() ||
    pickDepartmentPathName(addressBookUser.department_path_json);
  const departmentPath = pickDepartmentPath(addressBookUser);
  return {
    ...normalized,
    userName: normalized.userName || String(addressBookUser.user_name || "").trim(),
    phone: normalized.phone || normalizePhone(addressBookUser.phone),
    departmentId: String(addressBookUser.department_id || "").trim() || normalized.departmentId,
    departmentName: departmentName || normalized.departmentName,
    departmentPath: departmentPath || normalized.departmentPath,
    authSource: normalized.authSource || "address-book",
    hasProfileData: true,
  };
}

async function enrichProfileByPhone(conn, normalized) {
  const phone = normalizePhone(normalized?.phone || normalized?.userKey);
  if (!phone) return normalized;
  const addressBookUser = await findAddressBookUserByPhone(conn, phone);
  return enrichProfileWithAddressBook(normalized, addressBookUser);
}

module.exports = {
  enrichProfileByPhone,
  enrichProfileWithAddressBook,
  findAddressBookUserByPhone,
  normalizePhone,
  pickDepartmentPath,
};

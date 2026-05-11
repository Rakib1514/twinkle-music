// Identity helpers — no auth, just a name + persistent uuid in localStorage
const NAME_KEY = "gp:name";
const UID_KEY = "gp:uid";

export function getUserId(): string {
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export function getName(): string {
  return localStorage.getItem(NAME_KEY) || "";
}

export function setName(name: string) {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

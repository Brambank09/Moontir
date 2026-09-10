import Constants from "expo-constants";

const API_URL = Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;
if (!API_URL) throw new Error("Missing EXPO_BACKEND_URL");

export type User = { id: string; name: string; email: string };
export type Service = { id: string; name: string; name_id: string; category: string; category_id: string; description: string; description_id: string; duration: string; duration_id: string; price: number; featured: boolean; features: string[] };
export type Vehicle = { id: string; nickname: string; make: string; model: string; year: string; plate: string; type: string; created_at: string };
export type Address = { label: string; latitude?: number; longitude?: number };
export type InvoiceItem = { label: string; label_id?: string | null; amount: number };
export type Order = { id: string; service_id: string; service_name: string; vehicle: Vehicle; address: Address; schedule_date: string; schedule_time: string; notes: string; status: string; status_history: { key: string; label: string; label_id: string; at: string }[]; items: InvoiceItem[]; total: number; payment_status: string; created_at: string };
export type Quote = { items: InvoiceItem[]; total: number; multiplier: number; vehicle_type: string; base: number; surcharge: number };
export type Auth = { token: string; user: User };
export type GeocodeResult = { displayName: string; latitude: number; longitude: number; osmId?: number };

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || "Something went wrong.");
  return body as T;
}

export const api = {
  register: (data: { name: string; email: string; password: string }) => request<Auth>("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) => request<Auth>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  me: (token: string) => request<User>("/api/me", {}, token),
  updateMe: (token: string, data: { name: string }) => request<User>("/api/me", { method: "PATCH", body: JSON.stringify(data) }, token),
  services: () => request<Service[]>("/api/services"),
  quote: (data: { service_id: string; vehicle_type: string }) => request<Quote>("/api/quote", { method: "POST", body: JSON.stringify(data) }),
  vehicles: (token: string) => request<Vehicle[]>("/api/vehicles", {}, token),
  addVehicle: (token: string, data: Omit<Vehicle, "id" | "created_at">) => request<Vehicle>("/api/vehicles", { method: "POST", body: JSON.stringify(data) }, token),
  geocode: (query: string) => request<GeocodeResult[]>(`/api/geocode?q=${encodeURIComponent(query)}`),
  reverseGeocode: (latitude: number, longitude: number) => request<{ displayName: string; latitude: number; longitude: number }>(`/api/reverse-geocode?lat=${latitude}&lon=${longitude}`),
  orders: (token: string) => request<Order[]>("/api/orders", {}, token),
  createOrder: (token: string, data: { service_id: string; vehicle_id: string; address: Address; schedule_date: string; schedule_time: string; notes: string }) => request<Order>("/api/orders", { method: "POST", body: JSON.stringify(data) }, token),
};

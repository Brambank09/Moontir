import { useEffect, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Address, type GeocodeResult, type InvoiceItem, type Order, type Quote, type Service, type ServiceGroup, type User, type Vehicle, type VehiclePayload } from "@/src/api";
import { copy, type Lang } from "@/src/i18n";
import { storage } from "@/src/utils/storage";
import { makeStyles, useTheme, useThemeMode, type ThemeMode } from "@/src/theme";
import { LeafletMap } from "@/src/components/LeafletMap";
import { useToast } from "@/src/components/Toast";
import { MoontirLogo } from "@/src/components/MoontirLogo";

type Screen = "home" | "services" | "garage" | "orders" | "profile";
type Step = 1 | 2 | 3 | 4 | 5;
type GroupFilter = "all" | ServiceGroup;
const TOKEN_KEY = "moontir_auth_token";
const LANG_KEY = "moontir_lang";
const VEHICLE_TYPES = ["Sedan", "Hatchback", "MPV", "SUV", "Pickup", "Truck"] as const;
const money = (v: number) => `Rp ${v.toLocaleString("id-ID")}`;
const slots = ["09:00 – 11:00", "11:30 – 13:30", "14:00 – 16:00", "16:30 – 18:30"];
const nextDates = Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return { value: d.toISOString().slice(0, 10), day: d.toLocaleDateString("en-US", { weekday: "short" }), idDay: d.toLocaleDateString("id-ID", { weekday: "short" }), number: d.getDate() }; });
const HERO_IMG = "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=800&q=70&auto=format";

// A dispatch order is treated as "delivered" when its schedule date is today or earlier.
// The customer can then mark it completed and rate the specialist.
const isDelivered = (order: Order) => {
  if (order.status === "completed") return true;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const scheduled = new Date(`${order.schedule_date}T00:00:00`);
  return scheduled.getTime() <= today.getTime();
};

export default function Index() {
  const { colors } = useTheme(); const styles = useStyles(); const insets = useSafeAreaInsets(); const toast = useToast();
  const [lang, setLangState] = useState<Lang>("en"); const t = copy[lang];
  const [token, setToken] = useState<string | null>(null); const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<Service[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [orders, setOrders] = useState<Order[]>([]);
  const [screen, setScreen] = useState<Screen>("home"); const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" }); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [booking, setBooking] = useState(false); const [step, setStep] = useState<Step>(1);
  const [service, setService] = useState<Service | null>(null); const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [address, setAddress] = useState<Address>({ label: "" }); const [query, setQuery] = useState(""); const [results, setResults] = useState<GeocodeResult[]>([]);
  const [date, setDate] = useState(nextDates[0].value); const [time, setTime] = useState(slots[0]); const [notes, setNotes] = useState("");
  const [vehicleSheet, setVehicleSheet] = useState<{ open: boolean; edit: Vehicle | null }>({ open: false, edit: null });
  const [vehicleForm, setVehicleForm] = useState<VehiclePayload>({ nickname: "", make: "", model: "", year: "", plate: "", type: "Sedan" });
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null);
  const [invoice, setInvoice] = useState<Order | null>(null);
  const [rateFor, setRateFor] = useState<Order | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [serviceFilter, setServiceFilter] = useState<GroupFilter>("all");
  const [serviceSearch, setServiceSearch] = useState("");

  const setLang = async (next: Lang) => { setLangState(next); await storage.setItem(LANG_KEY, next); toast.show(copy[next].languageUpdated, "info"); };

  const refresh = async (authToken: string) => { const [s, v, o] = await Promise.all([api.services(), api.vehicles(authToken), api.orders(authToken)]); setServices(s); setVehicles(v); setOrders(o); };

  useEffect(() => {
    (async () => {
      const savedLang = await storage.getItem<Lang | null>(LANG_KEY, null);
      if (savedLang === "id" || savedLang === "en") setLangState(savedLang);
      const saved = await storage.secureGet<string | null>(TOKEN_KEY, null);
      try {
        if (saved) { setToken(saved); setUser(await api.me(saved)); await refresh(saved); }
        else setServices(await api.services());
      } catch {
        if (saved) await storage.secureRemove(TOKEN_KEY);
        setToken(null);
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!service || !vehicle) { setQuote(null); return; }
    let cancelled = false;
    api.quote({ service_id: service.id, vehicle_type: vehicle.type || "Sedan" })
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch(() => { if (!cancelled) setQuote(null); });
    return () => { cancelled = true; };
  }, [service, vehicle]);

  const authSubmit = async () => {
    if (!auth.email || !auth.password || (authMode === "register" && !auth.name)) return setError(t.required);
    setBusy(true); setError("");
    try {
      const result = authMode === "login" ? await api.login({ email: auth.email, password: auth.password }) : await api.register(auth);
      await storage.secureSet(TOKEN_KEY, result.token);
      setToken(result.token); setUser(result.user); await refresh(result.token);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to continue."); }
    finally { setBusy(false); }
  };

  const openBooking = (selected?: Service) => { setService(selected || null); setVehicle(vehicles[0] || null); setStep(selected ? 2 : 1); setBooking(true); setError(""); };
  const openAddVehicle = () => { setVehicleForm({ nickname: "", make: "", model: "", year: "", plate: "", type: "Sedan" }); setVehicleSheet({ open: true, edit: null }); setError(""); };
  const openEditVehicle = (v: Vehicle) => { setVehicleForm({ nickname: v.nickname, make: v.make, model: v.model, year: v.year, plate: v.plate, type: v.type }); setVehicleSheet({ open: true, edit: v }); setError(""); };

  const locate = async () => {
    setBusy(true); setError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Location permission denied. Enter your address manually.");
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const reversed = await api.reverseGeocode(position.coords.latitude, position.coords.longitude);
      setAddress(reversed);
    } catch (e) { setError(e instanceof Error ? e.message : "Location unavailable."); }
    finally { setBusy(false); }
  };
  const search = async () => { if (query.trim().length < 3) return; setBusy(true); try { setResults(await api.geocode(query)); } catch (e) { setError(e instanceof Error ? e.message : "Map search unavailable."); } finally { setBusy(false); } };
  const onPickPin = async (coords: { latitude: number; longitude: number }) => {
    setAddress((prev) => ({ ...prev, latitude: coords.latitude, longitude: coords.longitude }));
    try { const reversed = await api.reverseGeocode(coords.latitude, coords.longitude); setAddress({ label: reversed.displayName, latitude: reversed.latitude, longitude: reversed.longitude }); } catch { /* keep coords */ }
  };

  const confirmOrder = async () => {
    if (!token || !service || !vehicle || !address.label) return;
    setBusy(true);
    try { await api.createOrder(token, { service_id: service.id, vehicle_id: vehicle.id, address, schedule_date: date, schedule_time: time, notes }); await refresh(token); setBooking(false); setScreen("orders"); toast.show(`${t.success} · ${t.successHint}`, "success"); }
    catch (e) { const m = e instanceof Error ? e.message : "Could not confirm order."; setError(m); toast.show(m, "error"); }
    finally { setBusy(false); }
  };

  const saveVehicle = async () => {
    if (!token || Object.values(vehicleForm).some((x) => !x.trim())) return setError(t.required);
    setBusy(true);
    try {
      if (vehicleSheet.edit) {
        const updated = await api.updateVehicle(token, vehicleSheet.edit.id, vehicleForm);
        setVehicles((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
        if (vehicle?.id === updated.id) setVehicle(updated);
        toast.show(t.vehicleUpdated, "success");
      } else {
        const created = await api.addVehicle(token, vehicleForm);
        setVehicles([created, ...vehicles]);
        setVehicle(created);
        toast.show(`${created.nickname} · ${created.plate}`, "success");
      }
      setVehicleSheet({ open: false, edit: null });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save vehicle."); }
    finally { setBusy(false); }
  };

  const deleteVehicle = async (v: Vehicle) => {
    if (!token) return;
    setBusy(true);
    try {
      await api.deleteVehicle(token, v.id);
      setVehicles((prev) => prev.filter((x) => x.id !== v.id));
      if (vehicle?.id === v.id) setVehicle(null);
      toast.show(t.vehicleRemoved, "success");
    } catch (e) { toast.show(e instanceof Error ? e.message : "Delete failed.", "error"); }
    finally { setBusy(false); setConfirmDelete(null); }
  };

  const updateProfile = async (name: string) => {
    if (!token || !name.trim()) return;
    setBusy(true);
    try { const updated = await api.updateMe(token, { name: name.trim() }); setUser(updated); toast.show(t.profileUpdated, "success"); }
    catch (e) { toast.show(e instanceof Error ? e.message : "Update failed.", "error"); }
    finally { setBusy(false); }
  };

  const applyOrderUpdate = (updated: Order) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setInvoice((prev) => (prev && prev.id === updated.id ? updated : prev));
    setRateFor((prev) => (prev && prev.id === updated.id ? updated : prev));
  };

  const completeOrder = async (order: Order) => {
    if (!token) return;
    setBusy(true);
    try { const updated = await api.completeOrder(token, order.id); applyOrderUpdate(updated); toast.show(t.completedToast, "success"); }
    catch (e) { toast.show(e instanceof Error ? e.message : "Update failed.", "error"); }
    finally { setBusy(false); }
  };

  const submitRating = async (order: Order, stars: number, note: string) => {
    if (!token) return;
    setBusy(true);
    try { const updated = await api.rateOrder(token, order.id, { stars, note }); applyOrderUpdate(updated); toast.show(`${t.ratingSaved} · ${stars} ${t.stars}`, "success"); setRateFor(null); }
    catch (e) { toast.show(e instanceof Error ? e.message : "Rating failed.", "error"); }
    finally { setBusy(false); }
  };

  const logout = async () => { await storage.secureRemove(TOKEN_KEY); setToken(null); setUser(null); setScreen("home"); };

  if (loading) return <View style={styles.loading}><MoontirLogo width={180} height={44} /><ActivityIndicator size="small" color={colors.brand} style={{ marginTop: 22 }} /><Text style={styles.brandKicker}>{t.welcome}</Text></View>;

  if (!token || !user) return <Auth lang={lang} setLang={setLang} mode={authMode} setMode={setAuthMode} values={auth} setValues={setAuth} error={error} busy={busy} submit={authSubmit} />;

  const body = screen === "home" ? <Home user={user} services={services} orders={orders} vehicles={vehicles} t={t} lang={lang} book={() => openBooking()} select={openBooking} goServices={() => setScreen("services")} goOrders={() => setScreen("orders")} goServicesFiltered={(g: GroupFilter) => { setServiceFilter(g); setScreen("services"); }} />
    : screen === "services" ? <Catalog services={services} t={t} lang={lang} book={openBooking} filter={serviceFilter} setFilter={setServiceFilter} search={serviceSearch} setSearch={setServiceSearch} />
    : screen === "garage" ? <Garage vehicles={vehicles} t={t} add={openAddVehicle} edit={openEditVehicle} ask={setConfirmDelete} />
    : screen === "orders" ? <OrderList orders={orders} t={t} invoice={setInvoice} rate={setRateFor} complete={completeOrder} busy={busy} />
    : <Profile user={user} t={t} lang={lang} setLang={setLang} logout={logout} save={updateProfile} busy={busy} orders={orders} openOrder={setInvoice} />;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar t={t} orders={orders} setScreen={setScreen} lang={lang} setLang={setLang} />
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 128 + insets.bottom }} showsVerticalScrollIndicator={false}>{body}</ScrollView>
      <BottomNav screen={screen} setScreen={setScreen} t={t} insets={insets} />

      <BookingModal open={booking} close={() => setBooking(false)} step={step} setStep={setStep} t={t} lang={lang}
        services={services} vehicles={vehicles} service={service} vehicle={vehicle} setService={setService} setVehicle={setVehicle}
        address={address} setAddress={setAddress} query={query} setQuery={setQuery} results={results} setResults={setResults}
        date={date} setDate={setDate} time={time} setTime={setTime} notes={notes} setNotes={setNotes}
        locate={locate} search={search} confirm={confirmOrder} busy={busy} error={error} quote={quote} onPickPin={onPickPin}
        addVehicle={() => { setBooking(false); openAddVehicle(); }} />

      <VehicleModal state={vehicleSheet} close={() => setVehicleSheet({ open: false, edit: null })} form={vehicleForm} setForm={setVehicleForm} save={saveVehicle} t={t} busy={busy} error={error} />
      <ConfirmModal vehicle={confirmDelete} close={() => setConfirmDelete(null)} confirm={deleteVehicle} t={t} busy={busy} />
      <InvoiceModal order={invoice} close={() => setInvoice(null)} t={t} lang={lang} rate={setRateFor} complete={completeOrder} busy={busy} />
      <RateSheet order={rateFor} close={() => setRateFor(null)} submit={submitRating} t={t} busy={busy} />
    </View>
  );
}

/* ---------------- TOP BAR ---------------- */

function TopBar({ t, orders, lang, setLang }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  const active = orders.filter((o: Order) => o.status !== "completed").length;
  return (
    <View style={styles.topBar}>
      <Pressable testID="lang-toggle" style={styles.topBtn} onPress={() => setLang(lang === "en" ? "id" : "en")}>
        <Ionicons name="language-outline" size={19} color={colors.onSurface} />
      </Pressable>
      <MoontirLogo width={150} height={34} />
      <View style={styles.topBtn}>
        <Ionicons name="bag-handle-outline" size={19} color={colors.onSurface} />
        {active > 0 && <View testID="active-badge" style={styles.badge}><Text style={styles.badgeText}>{active}</Text></View>}
      </View>
    </View>
  );
}

/* ---------------- AUTH ---------------- */

function Auth({ lang, setLang, mode, setMode, values, setValues, error, busy, submit }: any) {
  const { colors } = useTheme(); const styles = useStyles(); const t = copy[lang];
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.auth}>
      <Pressable testID="language-toggle" style={styles.langChip} onPress={() => setLang(lang === "en" ? "id" : "en")}>
        <Ionicons name="language-outline" size={16} color={colors.onSurface} />
        <Text style={styles.langChipText}>{t.language}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
        <View style={styles.authBrand}>
          <MoontirLogo width={220} height={54} />
          <View style={styles.divider} />
          <Text style={styles.tagline}>{t.tagline.toUpperCase()}</Text>
        </View>
        <Text style={styles.authTitle}>{t.welcome}</Text>
        <Text style={styles.muted}>{mode === "login" ? (lang === "id" ? "Masuk untuk melanjutkan perawatan mobilmu." : "Sign in to continue your car's care.") : (lang === "id" ? "Buat akun untuk mengatur perawatan pertamamu." : "Create an account to schedule your first care session.")}</Text>
        <View style={styles.authCard}>
          {mode === "register" && <Field testID="auth-name" label={t.name} value={values.name} onChangeText={(name: string) => setValues({ ...values, name })} icon="person-outline" />}
          <Field testID="auth-email" label={t.email} value={values.email} onChangeText={(email: string) => setValues({ ...values, email })} icon="mail-outline" keyboardType="email-address" />
          <Field testID="auth-password" label={t.password} value={values.password} onChangeText={(password: string) => setValues({ ...values, password })} icon="lock-closed-outline" secureTextEntry />
          {error ? <Text testID="auth-error" style={styles.error}>{error}</Text> : null}
          <Button testID="auth-submit" label={mode === "login" ? t.signIn : t.create} onPress={submit} busy={busy} />
        </View>
        <Pressable testID="auth-toggle" style={styles.switch} onPress={() => setMode(mode === "login" ? "register" : "login")}>
          <Text style={styles.muted}>{mode === "login" ? t.newHere : t.haveAccount} </Text>
          <Text style={styles.link}>{mode === "login" ? t.create : t.signIn}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------------- HOME ---------------- */

function Home({ user, services, orders, t, lang, book, select, goServicesFiltered, goOrders }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const active = orders.find((x: Order) => x.status !== "completed");
  const recent = orders.slice(0, 2);
  return (
    <>
      <Text style={styles.hi}>{t.hello}, {user.name.split(" ")[0]}.</Text>
      <Text style={styles.hiSub}>{t.subtitle}</Text>

      <View style={styles.hero}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.heroKicker}>{t.heroKicker}</Text>
          <Text style={styles.heroBig}>{t.heroTitle}</Text>
          <Text style={styles.heroLine}>{t.heroSub}</Text>
          <Pressable testID="home-book" style={styles.heroBtn} onPress={book}>
            <Text style={styles.heroBtnText}>{t.shopNow}</Text>
          </Pressable>
        </View>
        <Image source={{ uri: HERO_IMG }} style={styles.heroImg} resizeMode="cover" />
      </View>

      {active && (
        <Pressable testID="home-active-order" style={styles.activeCard} onPress={goOrders}>
          <View style={styles.activeDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.activeKicker}>{t.active.toUpperCase()}</Text>
            <Text style={styles.activeTitle}>{active.service_name}</Text>
            <Text style={styles.muted}>{active.schedule_date} · {active.schedule_time}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionKicker}>{t.exploreCollection}</Text>
        <Pressable onPress={() => goServicesFiltered("all")}><Text style={styles.viewAll}>{t.viewAll}</Text></Pressable>
      </View>
      <View style={styles.circleRow}>
        <CategoryCircle icon="water-outline" label={t.groupLight} onPress={() => goServicesFiltered("light")} />
        <CategoryCircle icon="sparkles-outline" label={t.groupDetail} onPress={() => goServicesFiltered("detail")} />
        <CategoryCircle icon="moon-outline" label={t.groupSpecial} onPress={() => goServicesFiltered("special")} />
      </View>

      <Pressable style={styles.tile} onPress={() => goServicesFiltered("special")}>
        <Ionicons name="moon-outline" size={30} color={colors.onSurface} />
        <View style={{ flex: 1 }}>
          <Text style={styles.tileTitle}>{t.quickCare}</Text>
          <Text style={styles.tileTitle}>{t.quickCareLine}</Text>
          <Text style={styles.tileKicker}>{t.discoverMore}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
      </Pressable>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionKicker}>{t.popular}</Text>
      </View>
      <View style={{ gap: 12 }}>
        {services.filter((x: Service) => x.featured).slice(0, 3).map((x: Service) => (
          <ServiceRow key={x.id} service={x} lang={lang} testID={`home-service-${x.id}`} press={() => select(x)} />
        ))}
      </View>

      {recent.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionKicker}>{t.recentOrders.toUpperCase()}</Text>
            <Pressable onPress={goOrders}><Text style={styles.viewAll}>{t.viewAll}</Text></Pressable>
          </View>
          <View style={{ gap: 12 }}>
            {recent.map((o: Order) => <OrderRow key={o.id} order={o} t={t} onPress={goOrders} />)}
          </View>
        </>
      )}
    </>
  );
}

function CategoryCircle({ icon, label, onPress }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <Pressable style={styles.circleWrap} onPress={onPress} testID={`cat-${label}`}>
      <View style={styles.circle}><Ionicons name={icon} size={28} color={colors.onSurface} /></View>
      <Text style={styles.circleLabel} numberOfLines={2}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/* ---------------- SERVICES / CATALOG ---------------- */

function Catalog({ services, t, lang, book, filter, setFilter, search, setSearch }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const groups: { key: GroupFilter; label: string }[] = [
    { key: "all", label: lang === "id" ? "SEMUA" : "ALL" },
    { key: "light", label: t.groupLight.toUpperCase() },
    { key: "detail", label: t.groupDetail.toUpperCase() },
    { key: "special", label: t.groupSpecial.toUpperCase() },
  ];
  const q = search.trim().toLowerCase();
  // When the user types a search, ignore the group filter so results surface
  // across all groups (matches the "search across groups" spec).
  const activeFilter: GroupFilter = q ? "all" : filter;
  const filtered = services.filter((s: Service) => {
    if (activeFilter !== "all" && s.group !== activeFilter) return false;
    if (!q) return true;
    const hay = `${s.name} ${s.name_id} ${s.description} ${s.description_id} ${s.category} ${s.category_id}`.toLowerCase();
    return hay.includes(q);
  });
  const grouped: Record<ServiceGroup, Service[]> = { light: [], detail: [], special: [] };
  filtered.forEach((s: Service) => grouped[s.group].push(s));

  return (
    <>
      <Text style={styles.pageTitle}>{t.services.charAt(0) + t.services.slice(1).toLowerCase()}</Text>
      <Text style={styles.muted}>{lang === "id" ? "Pilih perawatan yang sesuai kendaraanmu." : "Find the right care package for your car."}</Text>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput testID="service-search" value={search} onChangeText={setSearch} placeholder={t.searchServices} placeholderTextColor={colors.muted} style={styles.searchInput} />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {groups.map((g) => (
          <Pressable key={g.key} testID={`filter-${g.key}`} style={[styles.chip, filter === g.key && styles.chipActive]} onPress={() => setFilter(g.key)}>
            <Text style={[styles.chipText, filter === g.key && styles.chipTextActive]}>{g.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={30} color={colors.muted} />
          <Text style={styles.cardTitle}>{lang === "id" ? "Tidak ada layanan cocok" : "No matching services"}</Text>
          <Text style={styles.muted}>{lang === "id" ? "Coba kata kunci atau kategori lain." : "Try another keyword or category."}</Text>
        </View>
      ) : (
        <View style={{ gap: 22 }}>
          {(Object.keys(grouped) as ServiceGroup[]).map((g) => (
            grouped[g].length > 0 && (activeFilter === "all" || activeFilter === g) ? (
              <View key={g} style={{ gap: 12 }}>
                <Text style={styles.groupTitle}>{(g === "light" ? t.groupLight : g === "detail" ? t.groupDetail : t.groupSpecial).toUpperCase()}</Text>
                {grouped[g].map((s) => <ServiceRow key={s.id} service={s} lang={lang} testID={`service-${s.id}`} press={() => book(s)} />)}
              </View>
            ) : null
          ))}
        </View>
      )}
    </>
  );
}

function ServiceRow({ service, lang, press, selected, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <Pressable testID={testID} style={[styles.rowCard, selected && styles.rowCardSelected]} onPress={press}>
      <View style={styles.rowIcon}><Ionicons name={service.group === "light" ? "water-outline" : service.group === "detail" ? "sparkles-outline" : "moon-outline"} size={22} color={colors.onSurface} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{lang === "id" ? service.name_id : service.name}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{lang === "id" ? service.description_id : service.description}</Text>
        <Text style={styles.rowMeta}>{lang === "id" ? service.duration_id : service.duration} · {money(service.price)}</Text>
      </View>
      <View style={styles.plusBtn}><Ionicons name={selected ? "checkmark" : "add"} size={18} color={colors.onBrand} /></View>
    </Pressable>
  );
}

/* ---------------- GARAGE ---------------- */

function Garage({ vehicles, t, add, edit, ask }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <>
      <Text style={styles.pageTitle}>{t.garage.charAt(0) + t.garage.slice(1).toLowerCase()}</Text>
      <Text style={styles.muted}>{t.myVehicles}</Text>

      <Pressable testID="vehicle-add" style={styles.outlineCta} onPress={add}>
        <Ionicons name="add" size={20} color={colors.onSurface} />
        <Text style={styles.outlineCtaText}>{t.addVehicle}</Text>
      </Pressable>

      {vehicles.length ? (
        <View style={{ gap: 12, marginTop: 18 }}>
          {vehicles.map((v: Vehicle) => (
            <View key={v.id} testID={`garage-vehicle-${v.id}`} style={styles.vehicleCard}>
              <View style={styles.rowIcon}><Ionicons name="car-sport-outline" size={22} color={colors.onSurface} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{v.nickname}</Text>
                <Text style={styles.rowSub}>{v.make} {v.model} · {v.year} · {v.type}</Text>
                <Text style={styles.plate}>{v.plate}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable testID={`vehicle-edit-${v.id}`} onPress={() => edit(v)} style={styles.iconAction}>
                  <Ionicons name="create-outline" size={17} color={colors.onSurface} />
                </Pressable>
                <Pressable testID={`vehicle-delete-${v.id}`} onPress={() => ask(v)} style={styles.iconAction}>
                  <Ionicons name="trash-outline" size={17} color={colors.error} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="car-outline" size={34} color={colors.muted} />
          <Text style={styles.cardTitle}>{copy.en === t ? "Your garage is empty" : "Garasi masih kosong"}</Text>
          <Text style={styles.muted}>{copy.en === t ? "Add your first car to get started." : "Tambahkan mobil pertamamu."}</Text>
        </View>
      )}
    </>
  );
}

/* ---------------- ORDERS ---------------- */

function OrderList({ orders, t, invoice, rate, complete, busy }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  return (
    <>
      <Text style={styles.pageTitle}>{t.orders.charAt(0) + t.orders.slice(1).toLowerCase()}</Text>
      <Text style={styles.muted}>{copy.en === t ? "Every dispatch and invoice in one place." : "Semua dispatch dan invoice kamu."}</Text>
      {orders.length ? (
        <View style={{ gap: 12, marginTop: 14 }}>
          {orders.map((o: Order) => <OrderRow key={o.id} order={o} t={t} onPress={() => invoice(o)} rate={rate} complete={complete} busy={busy} />)}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={34} color={colors.muted} />
          <Text style={styles.cardTitle}>{t.emptyHistory}</Text>
          <Text style={styles.muted}>{t.emptyHistoryHint}</Text>
        </View>
      )}
    </>
  );
}

function OrderRow({ order, t, onPress, rate, complete, busy }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  const delivered = isDelivered(order);
  const done = order.status === "completed";
  const canRate = delivered && !order.rating;
  return (
    <View testID={`order-${order.id}`} style={styles.orderCard}>
      <Pressable style={styles.orderTopRow} onPress={onPress}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{order.service_name}</Text>
          <Text style={styles.rowSub}>{order.vehicle.make} {order.vehicle.model} · {order.schedule_date} · {order.schedule_time}</Text>
          <Text style={styles.total}>{money(order.total)}</Text>
        </View>
        <View style={[styles.statusPill, done ? styles.statusPillDone : delivered ? styles.statusPillWarn : null]}>
          <Text style={styles.statusPillText}>{done ? t.completed.toUpperCase() : delivered ? t.completed.toUpperCase() : t.inService.toUpperCase()}</Text>
        </View>
      </Pressable>

      {order.rating ? (
        <View style={styles.ratingRow}>
          <Stars value={order.rating.stars} />
          <Text style={styles.ratingText} numberOfLines={2}>{order.rating.note ? `“${order.rating.note}”` : `${t.ratedLabel} ${order.rating.stars} ${t.stars}`}</Text>
        </View>
      ) : delivered && (rate || complete) ? (
        <View style={styles.orderActions}>
          {!done && complete && (
            <Pressable testID={`complete-${order.id}`} style={[styles.altBtn, { flex: 1 }]} onPress={() => complete(order)} disabled={busy}>
              <Ionicons name="checkmark-outline" size={15} color={colors.onSurface} />
              <Text style={styles.altBtnText}>{t.markComplete}</Text>
            </Pressable>
          )}
          {canRate && rate && (
            <Pressable testID={`rate-${order.id}`} style={[styles.smallCta, { flex: 1 }]} onPress={() => rate(order)}>
              <Ionicons name="star-outline" size={15} color={colors.onBrand} />
              <Text style={styles.smallCtaText}>{t.rateSpecialist}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Stars({ value, size = 16, interactive, onChange }: { value: number; size?: number; interactive?: boolean; onChange?: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const inner = <Ionicons name={filled ? "star" : "star-outline"} size={size} color={filled ? colors.brand : colors.muted} />;
        return interactive ? (
          <Pressable key={n} testID={`star-${n}`} hitSlop={6} onPress={() => onChange?.(n)}>{inner}</Pressable>
        ) : (
          <View key={n}>{inner}</View>
        );
      })}
    </View>
  );
}

/* ---------------- PROFILE ---------------- */

function Profile({ user, t, lang, setLang, logout, save, busy }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const { mode, cycleMode } = useThemeMode();
  const toast = useToast();
  const [name, setName] = useState<string>(user.name);
  useEffect(() => { setName(user.name); }, [user.name]);
  const dirty = name.trim() !== user.name;
  const modeLabel = (m: ThemeMode) => m === "system" ? t.themeSystem : m === "light" ? t.themeLight : t.themeDark;

  return (
    <>
      <Text style={styles.pageTitle}>{t.profile.charAt(0) + t.profile.slice(1).toLowerCase()}</Text>
      <Text style={styles.muted}>{lang === "id" ? "Kelola akun dan preferensi Moontir." : "Manage your account and Moontir preferences."}</Text>

      <View style={styles.profileHead}>
        <View style={styles.profileAvatar}><Text style={styles.profileInitial}>{(user.name?.[0] || "M").toUpperCase()}</Text></View>
        <Text style={styles.profileName}>{user.name}</Text>
        <Text style={styles.muted}>{user.email}</Text>
      </View>

      <View style={{ marginTop: 20, gap: 12 }}>
        <Text style={styles.fieldLabel}>{t.editName.toUpperCase()}</Text>
        <Field testID="profile-name" label={t.name} value={name} onChangeText={setName} icon="person-outline" />
        <Button testID="profile-save" label={t.saveProfile} onPress={() => save(name)} busy={busy} disabled={!dirty} />
      </View>

      <View style={styles.settingsBlock}>
        <Pressable testID="profile-theme" style={styles.settingRow} onPress={() => { const next = cycleMode(); toast.show(`${t.themeUpdated} · ${modeLabel(next)}`, "info"); }}>
          <Ionicons name={mode === "dark" ? "moon-outline" : mode === "light" ? "sunny-outline" : "contrast-outline"} size={20} color={colors.onSurface} />
          <Text style={[styles.settingLabel, { flex: 1 }]}>{t.themeSetting}</Text>
          <Text style={styles.settingValue}>{modeLabel(mode)}</Text>
          <Ionicons name="swap-horizontal" size={17} color={colors.muted} />
        </Pressable>
        <Pressable testID="profile-language" style={styles.settingRow} onPress={() => setLang(lang === "en" ? "id" : "en")}>
          <Ionicons name="language-outline" size={20} color={colors.onSurface} />
          <Text style={[styles.settingLabel, { flex: 1 }]}>{t.languageSetting}</Text>
          <Text style={styles.settingValue}>{lang === "en" ? "English" : "Bahasa Indonesia"}</Text>
          <Ionicons name="swap-horizontal" size={17} color={colors.muted} />
        </Pressable>
        <View style={styles.settingRow}>
          <Ionicons name="wallet-outline" size={20} color={colors.onSurface} />
          <Text style={[styles.settingLabel, { flex: 1 }]}>{t.payment}</Text>
          <Text style={styles.settingValue}>{t.unpaid}</Text>
        </View>
        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <Ionicons name="help-circle-outline" size={20} color={colors.onSurface} />
          <Text style={[styles.settingLabel, { flex: 1 }]}>{t.support}</Text>
          <Text style={styles.settingValue}>{t.supportValue}</Text>
        </View>
      </View>

      <Pressable testID="profile-logout" style={styles.logout} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.logoutText}>{t.logout}</Text>
      </Pressable>
    </>
  );
}

/* ---------------- BOTTOM NAV ---------------- */

function BottomNav({ screen, setScreen, t, insets }: any) {
  const styles = useStyles();
  return (
    <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.navInner}>
        {(["home", "services", "garage", "orders", "profile"] as Screen[]).map((s) => (
          <NavItem key={s} screen={s} current={screen} setScreen={setScreen} label={t[s]} />
        ))}
      </View>
    </View>
  );
}

function NavItem({ screen, current, setScreen, label }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const active = screen === current;
  const icons: any = { home: "home-outline", services: "bag-handle-outline", garage: "car-outline", orders: "receipt-outline", profile: "person-outline" };
  return (
    <Pressable testID={`tab-${screen}`} style={styles.navItem} onPress={() => setScreen(screen)}>
      <Ionicons name={icons[screen]} size={22} color={active ? colors.onSurface : colors.muted} />
      <Text style={[styles.navText, active && { color: colors.onSurface, fontWeight: "800" }]}>{label}</Text>
    </Pressable>
  );
}

/* ---------------- BOOKING MODAL ---------------- */

function BookingModal({ open, close, step, setStep, t, lang, services, vehicles, service, vehicle, setService, setVehicle, address, setAddress, query, setQuery, results, setResults, date, setDate, time, setTime, notes, setNotes, locate, search, confirm, busy, error, addVehicle, quote, onPickPin }: any) {
  const { colors } = useTheme(); const styles = useStyles(); const insets = useSafeAreaInsets();
  const ready = (step === 1 && service) || (step === 2 && vehicle) || (step === 3 && address.label) || step >= 4;
  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <Pressable testID="booking-close" style={styles.iconButton} onPress={close}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
          <MoontirLogo width={110} height={26} />
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.railWrap}>
          {[1, 2, 3, 4, 5].map((i) => <View key={i} style={[styles.railDot, i <= step && styles.railDotActive]} />)}
        </View>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalKicker}>{`BOOKING · 0${step}/5`}</Text>
          <Text style={styles.modalTitle}>{[t.selectService, t.selectVehicle, t.address, t.schedule, t.review][step - 1]}</Text>
          <Text style={styles.muted}>{step === 3 ? t.dragPinHint : (lang === "id" ? "Rawat mobilmu dengan tenang." : "Care for your car, mindfully.")}</Text>

          {step === 1 && (
            <View style={{ gap: 12, marginTop: 20 }}>
              {services.map((x: Service) => <ServiceRow key={x.id} testID={`booking-service-${x.id}`} service={x} lang={lang} selected={service?.id === x.id} press={() => setService(x)} />)}
            </View>
          )}
          {step === 2 && (
            <View style={{ gap: 12, marginTop: 20 }}>
              {vehicles.map((x: Vehicle) => (
                <Pressable key={x.id} testID={`booking-vehicle-${x.id}`} style={[styles.rowCard, vehicle?.id === x.id && styles.rowCardSelected]} onPress={() => setVehicle(x)}>
                  <View style={styles.rowIcon}><Ionicons name="car-sport-outline" size={22} color={colors.onSurface} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{x.nickname}</Text>
                    <Text style={styles.rowSub}>{x.make} {x.model} · {x.year} · {x.type}</Text>
                    <Text style={styles.plate}>{x.plate}</Text>
                  </View>
                  <Ionicons name={vehicle?.id === x.id ? "radio-button-on" : "radio-button-off"} size={20} color={vehicle?.id === x.id ? colors.brand : colors.muted} />
                </Pressable>
              ))}
              <Pressable testID="booking-add-vehicle" style={styles.outlineCta} onPress={addVehicle}>
                <Ionicons name="add" size={20} color={colors.onSurface} />
                <Text style={styles.outlineCtaText}>{t.addVehicle}</Text>
              </Pressable>
            </View>
          )}
          {step === 3 && <AddressStep t={t} lang={lang} address={address} setAddress={setAddress} query={query} setQuery={setQuery} results={results} setResults={setResults} locate={locate} search={search} busy={busy} onPickPin={onPickPin} />}
          {step === 4 && <ScheduleStep t={t} lang={lang} date={date} setDate={setDate} time={time} setTime={setTime} notes={notes} setNotes={setNotes} />}
          {step === 5 && <Review service={service} vehicle={vehicle} address={address} date={date} time={time} t={t} lang={lang} quote={quote} />}
          {error ? <Text testID="booking-error" style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          {step > 1 ? <Pressable testID="booking-back" style={styles.back} onPress={() => setStep((step - 1) as Step)}><Text style={styles.backText}>{t.back}</Text></Pressable> : <View />}
          {step < 5 ? <Button testID="booking-next" label={t.next} onPress={() => ready && setStep((step + 1) as Step)} disabled={!ready} /> : <Button testID="confirm-order" label={t.confirm} onPress={confirm} busy={busy} />}
        </View>
      </View>
    </Modal>
  );
}

function AddressStep({ t, lang, address, setAddress, query, setQuery, results, setResults, locate, search, busy, onPickPin }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={{ gap: 12, marginTop: 20 }}>
      <TextInput testID="address-input" value={address.label} onChangeText={(label) => setAddress({ ...address, label })} multiline placeholder="Jl. Sudirman 21, Semarang" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable testID="location-button" style={styles.altBtn} onPress={locate}><Ionicons name="locate-outline" size={16} color={colors.onSurface} /><Text style={styles.altBtnText}>{t.useLocation}</Text></Pressable>
        <Pressable testID="address-search" style={styles.altBtn} onPress={search}><Ionicons name="search-outline" size={16} color={colors.onSurface} /><Text style={styles.altBtnText}>{t.searchAddress}</Text></Pressable>
      </View>
      <TextInput testID="address-query" value={query} onChangeText={setQuery} placeholder={lang === "id" ? "Cari jalan atau kota" : "Search a street or city"} placeholderTextColor={colors.muted} style={styles.input} />
      {busy && <ActivityIndicator color={colors.brand} />}
      {results.map((x: GeocodeResult) => (
        <Pressable key={`${x.osmId}-${x.latitude}`} testID={`address-result-${x.osmId}`} style={styles.resultRow} onPress={() => { setAddress({ label: x.displayName, latitude: x.latitude, longitude: x.longitude }); setResults([]); }}>
          <Ionicons name="pin-outline" size={17} color={colors.onSurface} />
          <Text style={styles.resultText}>{x.displayName}</Text>
        </Pressable>
      ))}
      <LeafletMap testID="address-map" latitude={address.latitude} longitude={address.longitude} onPick={onPickPin} height={240} />
      {address.latitude ? (
        <View style={styles.mapMeta}>
          <Ionicons name="pin" size={16} color={colors.onSurface} />
          <Text style={styles.mapMetaText}>{address.latitude.toFixed(4)}, {address.longitude?.toFixed(4)}</Text>
          <Pressable onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${address.latitude}&mlon=${address.longitude}#map=17/${address.latitude}/${address.longitude}`)}><Text style={styles.link}>{t.openMap}</Text></Pressable>
        </View>
      ) : <Text style={styles.mapCredit}>{t.mapCredit}</Text>}
    </View>
  );
}

function ScheduleStep({ t, lang, date, setDate, time, setTime, notes, setNotes }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  return (
    <View style={{ gap: 16, marginTop: 20 }}>
      <Text style={styles.fieldLabel}>{lang === "id" ? "TANGGAL LAYANAN" : "SERVICE DATE"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {nextDates.map((x) => (
          <Pressable key={x.value} testID={`date-${x.value}`} style={[styles.dateChip, date === x.value && styles.dateChipActive]} onPress={() => setDate(x.value)}>
            <Text style={[styles.dateChipDay, date === x.value && { color: colors.onBrand }]}>{lang === "id" ? x.idDay : x.day}</Text>
            <Text style={[styles.dateChipNum, date === x.value && { color: colors.onBrand }]}>{x.number}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.fieldLabel}>{lang === "id" ? "SLOT WAKTU" : "TIME SLOT"}</Text>
      <View style={styles.timeGrid}>
        {slots.map((x) => (
          <Pressable key={x} testID={`slot-${x}`} style={[styles.timeChip, time === x && styles.timeChipActive]} onPress={() => setTime(x)}>
            <Ionicons name="time-outline" size={15} color={time === x ? colors.onBrand : colors.onSurface} />
            <Text style={[styles.timeChipText, time === x && { color: colors.onBrand }]}>{x}</Text>
          </Pressable>
        ))}
      </View>
      <Field testID="notes-input" label={t.notes} value={notes} onChangeText={setNotes} icon="create-outline" multiline />
    </View>
  );
}

function Review({ service, vehicle, address, date, time, t, lang, quote }: any) {
  const styles = useStyles();
  const items: InvoiceItem[] = quote?.items || [{ label: service.name, label_id: service.name_id, amount: service.price }];
  const total = quote?.total ?? service.price;
  return (
    <View style={{ gap: 12, marginTop: 20 }}>
      <ReviewRow icon="sparkles-outline" label={service.name} value={money(total)} />
      <ReviewRow icon="car-outline" label={t.selectVehicle} value={`${vehicle.make} ${vehicle.model} · ${vehicle.plate} · ${vehicle.type}`} />
      <ReviewRow icon="pin-outline" label={t.address} value={address.label} />
      <ReviewRow icon="calendar-outline" label={t.schedule} value={`${date} · ${time}`} />
      <View testID="review-breakdown" style={styles.breakdown}>
        <Text style={styles.groupTitle}>{t.priceBreakdown.toUpperCase()}</Text>
        {items.map((item, idx) => (
          <View key={`${item.label}-${idx}`} style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{lang === "id" && item.label_id ? item.label_id : item.label}</Text>
            <Text style={styles.breakdownAmount}>{money(item.amount)}</Text>
          </View>
        ))}
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={styles.breakdownTotalLabel}>{t.total.toUpperCase()}</Text>
          <Text testID="review-total" style={styles.breakdownTotalValue}>{money(total)}</Text>
        </View>
      </View>
    </View>
  );
}

function ReviewRow({ icon, label, value }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={styles.reviewRow}>
      <Ionicons name={icon} size={18} color={colors.onSurface} />
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ---------------- INVOICE MODAL ---------------- */

function InvoiceModal({ order, close, t, lang, rate, complete, busy }: any) {
  const styles = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  if (!order) return null;
  const delivered = isDelivered(order);
  const done = order.status === "completed";
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <Pressable testID="invoice-close" style={styles.iconButton} onPress={close}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
          <MoontirLogo width={110} height={26} />
          <View style={{ width: 44 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 22 }}>
          <Text style={styles.modalKicker}>HOME VEHICLE CARE · {order.id.slice(0, 8).toUpperCase()}</Text>

          <View style={styles.sectionHead}><Ionicons name="navigate-outline" size={17} color={colors.onSurface} /><Text style={styles.sectionHeadText}>{t.trackingHeading.toUpperCase()}</Text></View>
          <View style={styles.timeline}>
            {order.status_history.map((item: any, idx: number) => (
              <View key={item.at} style={styles.timelineRow}>
                <View style={styles.timelineTrackWrap}>
                  <View style={styles.timelineDot} />
                  {idx < order.status_history.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{lang === "id" ? item.label_id : item.label}</Text>
                  <Text style={styles.muted}>{new Date(item.at).toLocaleString(lang === "id" ? "id-ID" : "en-US")}</Text>
                </View>
              </View>
            ))}
          </View>

          {order.rating ? (
            <>
              <View style={styles.sectionHead}><Ionicons name="star-outline" size={17} color={colors.onSurface} /><Text style={styles.sectionHeadText}>{t.rateSpecialist.toUpperCase()}</Text></View>
              <View style={styles.ratingCard}>
                <Stars value={order.rating.stars} size={20} />
                {order.rating.note ? <Text style={styles.ratingCardNote}>“{order.rating.note}”</Text> : null}
                <Text style={styles.muted}>{new Date(order.rating.rated_at).toLocaleString(lang === "id" ? "id-ID" : "en-US")}</Text>
              </View>
            </>
          ) : delivered ? (
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
              {!done && complete && (
                <Pressable testID={`invoice-complete-${order.id}`} style={[styles.altBtn, { flex: 1 }]} onPress={() => complete(order)} disabled={busy}>
                  <Ionicons name="checkmark-outline" size={15} color={colors.onSurface} />
                  <Text style={styles.altBtnText}>{t.markComplete}</Text>
                </Pressable>
              )}
              {rate && (
                <Pressable testID={`invoice-rate-${order.id}`} style={[styles.smallCta, { flex: 1 }]} onPress={() => rate(order)}>
                  <Ionicons name="star-outline" size={15} color={colors.onBrand} />
                  <Text style={styles.smallCtaText}>{t.rateSpecialist}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          <View style={styles.sectionHead}><Ionicons name="document-text-outline" size={17} color={colors.onSurface} /><Text style={styles.sectionHeadText}>{t.invoiceHeading.toUpperCase()}</Text></View>
          <Text style={styles.rowTitle}>{order.service_name}</Text>
          <Text style={styles.rowSub}>{order.vehicle.make} {order.vehicle.model} · {order.vehicle.plate} · {order.vehicle.type}</Text>
          <View style={styles.invoiceBlock}>
            <Text style={styles.fieldLabel}>{t.address.toUpperCase()}</Text>
            <Text style={styles.rowSub}>{order.address.label}</Text>
            <Text style={styles.fieldLabel}>{t.schedule.toUpperCase()}</Text>
            <Text style={styles.rowSub}>{order.schedule_date} · {order.schedule_time}</Text>
          </View>
          <View style={styles.breakdown}>
            {(order.items || []).map((item: InvoiceItem, idx: number) => (
              <View key={`${item.label}-${idx}`} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{lang === "id" && item.label_id ? item.label_id : item.label}</Text>
                <Text style={styles.breakdownAmount}>{money(item.amount)}</Text>
              </View>
            ))}
            <View style={[styles.breakdownRow, styles.breakdownTotal]}>
              <Text style={styles.breakdownTotalLabel}>{t.total.toUpperCase()}</Text>
              <Text testID="invoice-total" style={styles.breakdownTotalValue}>{money(order.total)}</Text>
            </View>
          </View>
          <Text style={styles.unpaid}>{t.unpaid}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function RateSheet({ order, close, submit, t, busy }: any) {
  const insets = useSafeAreaInsets(); const styles = useStyles(); const { colors } = useTheme();
  const [stars, setStars] = useState<number>(order?.rating?.stars ?? 0);
  const [note, setNote] = useState<string>(order?.rating?.note ?? "");
  useEffect(() => {
    setStars(order?.rating?.stars ?? 0);
    setNote(order?.rating?.note ?? "");
  }, [order?.id, order?.rating?.stars, order?.rating?.note]);
  if (!order) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t.rateTitle}</Text>
            <Pressable testID="rate-close" style={styles.iconButton} onPress={close}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20, gap: 14 }}>
            <Text style={styles.muted}>{t.rateSub}</Text>
            <View style={styles.rateOrderCard}>
              <Ionicons name="person-circle-outline" size={26} color={colors.onSurface} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{order.service_name}</Text>
                <Text style={styles.rowSub}>{order.vehicle.make} {order.vehicle.model} · {order.schedule_date}</Text>
              </View>
            </View>
            <View style={styles.starsWrap}>
              <Stars value={stars} interactive size={34} onChange={setStars} />
              {stars > 0 && <Text style={styles.starsCount}>{stars} / 5</Text>}
            </View>
            <View style={[styles.inputWrap, styles.multilineWrap]}>
              <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.muted} />
              <TextInput testID="rate-note" value={note} onChangeText={setNote} multiline placeholder={t.rateNotePlaceholder} placeholderTextColor={colors.muted} style={styles.textInput} maxLength={500} />
            </View>
            <Pressable testID="rate-submit" onPress={() => submit(order, stars, note)} disabled={busy || stars === 0} style={({ pressed }) => [styles.button, (pressed || busy || stars === 0) && styles.dim]}>
              <Text style={styles.buttonText}>{busy ? "…" : t.submitRating}</Text>
              {!busy && <Ionicons name="arrow-forward" size={16} color={colors.onBrandPrimary} />}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- VEHICLE MODAL ---------------- */

function VehicleModal({ state, close, form, setForm, save, t, busy, error }: any) {
  const insets = useSafeAreaInsets(); const styles = useStyles(); const { colors } = useTheme();
  const update = (key: keyof VehiclePayload, value: string) => setForm({ ...form, [key]: value });
  const isEdit = !!state.edit;
  return (
    <Modal visible={state.open} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{isEdit ? t.editVehicle : t.addVehicle}</Text>
            <Pressable testID="vehicle-close" style={styles.iconButton} onPress={close}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
            <Field testID="vehicle-nickname" label={t.nickname} value={form.nickname} onChangeText={(v: string) => update("nickname", v)} icon="bookmark-outline" />
            <View style={styles.two}>
              <Field testID="vehicle-make" label={t.make} value={form.make} onChangeText={(v: string) => update("make", v)} icon="car-outline" />
              <Field testID="vehicle-model" label={t.model} value={form.model} onChangeText={(v: string) => update("model", v)} icon="construct-outline" />
            </View>
            <View style={styles.two}>
              <Field testID="vehicle-year" label={t.year} value={form.year} onChangeText={(v: string) => update("year", v)} icon="calendar-outline" keyboardType="number-pad" />
              <Field testID="vehicle-plate" label={t.plate} value={form.plate} onChangeText={(v: string) => update("plate", v.toUpperCase())} icon="keypad-outline" />
            </View>
            <Text style={styles.fieldLabel}>{t.vehicleType.toUpperCase()}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8, paddingHorizontal: 2 }}>
              {VEHICLE_TYPES.map((k) => (
                <Pressable key={k} testID={`vehicle-type-${k}`} onPress={() => update("type", k)} style={[styles.chip, form.type === k && styles.chipActive]}>
                  <Text style={[styles.chipText, form.type === k && styles.chipTextActive]}>{k.toUpperCase()}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button testID="vehicle-save" label={isEdit ? t.saveChanges : t.save} onPress={save} busy={busy} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmModal({ vehicle, close, confirm, t, busy }: any) {
  const styles = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  if (!vehicle) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14, maxHeight: "60%" }]}>
          <View style={styles.handle} />
          <View style={{ padding: 4, gap: 8 }}>
            <Text style={styles.modalTitle}>{t.deleteVehicle}</Text>
            <Text style={styles.muted}>{t.confirmDelete}</Text>
            <View style={styles.confirmVehicleCard}>
              <Ionicons name="car-sport-outline" size={18} color={colors.onSurface} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{vehicle.nickname}</Text>
                <Text style={styles.rowSub}>{vehicle.make} {vehicle.model} · {vehicle.plate}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable testID="confirm-cancel" style={[styles.button, styles.buttonGhost, { flex: 1 }]} onPress={close}>
                <Text style={[styles.buttonText, { color: colors.onSurface }]}>{t.cancel}</Text>
              </Pressable>
              <Pressable testID="confirm-delete" style={[styles.button, { flex: 1, backgroundColor: colors.error }]} onPress={() => confirm(vehicle)} disabled={busy}>
                <Text style={styles.buttonText}>{busy ? "…" : t.remove}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- FIELD & BUTTON ---------------- */

function Field({ label, value, onChangeText, icon, secureTextEntry, keyboardType, multiline, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <View style={[styles.inputWrap, multiline && styles.multilineWrap]}>
        <Ionicons name={icon} size={17} color={colors.muted} />
        <TextInput testID={testID} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} keyboardType={keyboardType} multiline={multiline} placeholder={label} placeholderTextColor={colors.muted} style={styles.textInput} />
      </View>
    </View>
  );
}

function Button({ label, onPress, busy, disabled, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={busy || disabled} style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dim]}>
      <Text style={styles.buttonText}>{busy ? "…" : label}</Text>
      {!busy && <Ionicons name="arrow-forward" size={16} color={colors.onBrandPrimary} />}
    </Pressable>
  );
}

/* ---------------- STYLES ---------------- */

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.surface },
  brandKicker: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2.4, marginTop: 12 },

  topBar: { minHeight: 52, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.onSurface, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.surface, fontSize: 9, fontWeight: "900" },

  hi: { color: colors.onSurface, fontSize: 22, fontWeight: "700", marginTop: 4 },
  hiSub: { color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 2, marginBottom: 20 },

  hero: { flexDirection: "row", padding: 18, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", overflow: "hidden" },
  heroKicker: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 6 },
  heroBig: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: 1 },
  heroLine: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 6, marginBottom: 14 },
  heroBtn: { alignSelf: "flex-start", paddingHorizontal: 14, minHeight: 36, borderRadius: 18, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  heroBtnText: { color: colors.onBrand, fontSize: 10, letterSpacing: 1.4, fontWeight: "900" },
  heroImg: { width: 110, height: 110, borderRadius: 14 },

  activeCard: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activeKicker: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  activeTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800", marginTop: 3 },

  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 28, marginBottom: 14 },
  sectionKicker: { color: colors.onSurface, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  viewAll: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1.6, textDecorationLine: "underline" },

  circleRow: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  circleWrap: { flex: 1, alignItems: "center", gap: 8 },
  circle: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  circleLabel: { color: colors.onSurface, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, textAlign: "center" },

  tile: { marginTop: 24, padding: 18, borderRadius: 16, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", gap: 14 },
  tileTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  tileKicker: { color: colors.onSurfaceSecondary, fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginTop: 6 },

  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 84, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  rowCardSelected: { borderColor: colors.brand, borderWidth: 1.5 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  rowSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3, lineHeight: 17 },
  rowMeta: { color: colors.onSurface, fontSize: 12, fontWeight: "700", marginTop: 6 },
  plusBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  plate: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 4 },

  vehicleCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  confirmVehicleCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginTop: 8 },

  pageTitle: { color: colors.onSurface, fontSize: 26, fontWeight: "800", marginTop: 4 },
  groupTitle: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 2 },

  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, marginTop: 18 },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14 },

  chipRow: { gap: 8, paddingVertical: 16 },
  chip: { paddingHorizontal: 14, minHeight: 34, borderRadius: 17, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  chipTextActive: { color: colors.onBrand },

  outlineCta: { minHeight: 48, marginTop: 16, borderRadius: 24, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: colors.surfaceTertiary },
  outlineCtaText: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },

  orderRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },

  orderCard: { padding: 14, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, gap: 12 },
  orderTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statusPill: { paddingHorizontal: 10, minHeight: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  statusPillWarn: { backgroundColor: colors.brandTertiary, borderColor: colors.borderStrong },
  statusPillDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  statusPillText: { color: colors.onSurface, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  orderActions: { flexDirection: "row", gap: 10 },
  smallCta: { minHeight: 40, borderRadius: 20, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brand },
  smallCtaText: { color: colors.onBrand, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4 },
  ratingText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, fontStyle: "italic" },
  ratingCard: { padding: 14, borderRadius: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 8, marginBottom: 6 },
  ratingCardNote: { color: colors.onSurface, fontSize: 14, fontStyle: "italic", lineHeight: 20 },

  rateOrderCard: { flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  starsWrap: { alignItems: "center", padding: 18, borderRadius: 16, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 10 },
  starsCount: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },

  profileHead: { alignItems: "center", padding: 22, marginTop: 18, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  profileInitial: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  profileName: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },

  settingsBlock: { marginTop: 24, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  settingRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  settingLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  settingValue: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  logout: { minHeight: 50, marginTop: 22, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  logoutText: { color: colors.error, fontWeight: "800" },

  nav: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  navInner: { flexDirection: "row", paddingTop: 10, paddingHorizontal: 4 },
  navItem: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4 },
  navText: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },

  auth: { flex: 1, backgroundColor: colors.surface },
  authContent: { padding: 26, paddingTop: 90, paddingBottom: 40 },
  authBrand: { alignItems: "center", gap: 8, marginBottom: 30 },
  divider: { width: 26, height: 1, backgroundColor: colors.borderStrong, marginTop: 4 },
  tagline: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 2.2 },
  authTitle: { color: colors.onSurface, fontSize: 30, lineHeight: 34, fontWeight: "800", marginBottom: 6 },
  authCard: { marginTop: 22, padding: 18, borderRadius: 20, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  switch: { minHeight: 48, alignItems: "center", justifyContent: "center", flexDirection: "row", marginTop: 12 },
  langChip: { position: "absolute", zIndex: 3, top: 56, right: 20, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  langChipText: { color: colors.onSurface, fontWeight: "900", fontSize: 12 },

  fieldWrap: { flex: 1, gap: 6, marginBottom: 12 },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  inputWrap: { minHeight: 50, borderRadius: 14, paddingHorizontal: 12, gap: 9, flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  multilineWrap: { alignItems: "flex-start", paddingTop: 11 },
  textInput: { flex: 1, color: colors.onSurface, minHeight: 46, fontSize: 14 },

  button: { minHeight: 50, borderRadius: 25, paddingHorizontal: 20, backgroundColor: colors.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  buttonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  buttonText: { color: colors.onBrand, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  dim: { opacity: 0.45 },

  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  link: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1, textDecorationLine: "underline" },
  error: { color: colors.error, fontSize: 12, marginBottom: 12, fontWeight: "700" },
  total: { color: colors.onSurface, fontSize: 15, fontWeight: "900", marginTop: 6 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },

  empty: { minHeight: 220, marginTop: 20, alignItems: "center", justifyContent: "center", gap: 8, padding: 22, borderRadius: 18, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },

  modal: { flex: 1, backgroundColor: colors.surface },
  modalHeader: { minHeight: 56, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  railWrap: { flexDirection: "row", gap: 6, paddingHorizontal: 22, paddingVertical: 12 },
  railDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.divider },
  railDotActive: { backgroundColor: colors.brand },
  modalScroll: { padding: 22, paddingBottom: 130 },
  modalKicker: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  modalTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 6, marginBottom: 6 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, flexDirection: "row", justifyContent: "space-between", gap: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  back: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12 },
  backText: { color: colors.onSurfaceSecondary, fontWeight: "900", letterSpacing: 1, fontSize: 12 },

  altBtn: { flex: 1, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 6, backgroundColor: colors.surfaceTertiary },
  altBtnText: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  input: { minHeight: 50, borderRadius: 14, padding: 14, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  multiline: { minHeight: 84, textAlignVertical: "top" },
  resultRow: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  resultText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  mapMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  mapMetaText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  mapCredit: { color: colors.muted, fontSize: 10, textAlign: "center" },

  dateChip: { width: 60, minHeight: 72, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  dateChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  dateChipDay: { color: colors.onSurfaceSecondary, fontWeight: "800", fontSize: 11 },
  dateChipNum: { color: colors.onSurface, fontWeight: "900", fontSize: 22 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  timeChip: { width: "47%", minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  timeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  timeChipText: { color: colors.onSurface, fontWeight: "800", fontSize: 12 },

  reviewRow: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  reviewValue: { color: colors.onSurface, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 3 },
  breakdown: { padding: 16, borderRadius: 16, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 8 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  breakdownLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", flex: 1, paddingRight: 8 },
  breakdownAmount: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  breakdownTotal: { borderTopWidth: 1, borderTopColor: colors.borderStrong, paddingTop: 10, marginTop: 4 },
  breakdownTotalLabel: { color: colors.onSurface, fontWeight: "900", fontSize: 12, letterSpacing: 1.4 },
  breakdownTotalValue: { color: colors.onSurface, fontWeight: "900", fontSize: 17 },
  unpaid: { color: colors.onSurfaceSecondary, fontWeight: "800", fontSize: 12, marginTop: 12, textAlign: "center", letterSpacing: 1 },

  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: { maxHeight: "88%", padding: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: "center", backgroundColor: colors.muted, marginBottom: 15 },
  two: { flexDirection: "row", gap: 10 },
  invoiceBlock: { gap: 6, marginVertical: 14 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 12 },
  sectionHeadText: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 },
  timeline: { gap: 4 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingBottom: 8 },
  timelineTrackWrap: { alignItems: "center", width: 12, paddingTop: 5 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand },
  timelineLine: { flex: 1, width: 2, minHeight: 22, backgroundColor: colors.divider, marginTop: 2 },
}));

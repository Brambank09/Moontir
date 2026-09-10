import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Address, type GeocodeResult, type InvoiceItem, type Order, type Quote, type Service, type User, type Vehicle } from "@/src/api";
import { copy, type Lang } from "@/src/i18n";
import { storage } from "@/src/utils/storage";
import { makeStyles, useTheme } from "@/src/theme";
import { LeafletMap } from "@/src/components/LeafletMap";
import { useToast } from "@/src/components/Toast";

type Screen = "home" | "services" | "garage" | "orders" | "profile";
type Step = 1 | 2 | 3 | 4 | 5;
const TOKEN_KEY = "moontir_auth_token";
const LANG_KEY = "moontir_lang";
const VEHICLE_TYPES = ["Sedan", "Hatchback", "MPV", "SUV", "Pickup", "Truck"] as const;
const money = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;
const slots = ["09:00 – 11:00", "11:30 – 13:30", "14:00 – 16:00", "16:30 – 18:30"];
const nextDates = Array.from({ length: 5 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() + i + 1); return { value: date.toISOString().slice(0, 10), day: date.toLocaleDateString("en-US", { weekday: "short" }), idDay: date.toLocaleDateString("id-ID", { weekday: "short" }), number: date.getDate() }; });

export default function Index() {
  const { colors } = useTheme(); const styles = useStyles(); const insets = useSafeAreaInsets(); const toast = useToast();
  const [lang, setLangState] = useState<Lang>("en"); const t = copy[lang];
  const [token, setToken] = useState<string | null>(null); const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<Service[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [orders, setOrders] = useState<Order[]>([]);
  const [screen, setScreen] = useState<Screen>("home"); const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" }); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [booking, setBooking] = useState(false); const [step, setStep] = useState<Step>(1); const [service, setService] = useState<Service | null>(null); const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [address, setAddress] = useState<Address>({ label: "" }); const [query, setQuery] = useState(""); const [results, setResults] = useState<GeocodeResult[]>([]); const [date, setDate] = useState(nextDates[0].value); const [time, setTime] = useState(slots[0]); const [notes, setNotes] = useState("");
  const [vehicleSheet, setVehicleSheet] = useState(false); const [invoice, setInvoice] = useState<Order | null>(null);
  const [vehicleForm, setVehicleForm] = useState({ nickname: "", make: "", model: "", year: "", plate: "", type: "Sedan" });
  const [quote, setQuote] = useState<Quote | null>(null);

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
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Refresh quote whenever service+vehicle changes.
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

  const search = async () => {
    if (query.trim().length < 3) return;
    setBusy(true);
    try { setResults(await api.geocode(query)); }
    catch (e) { setError(e instanceof Error ? e.message : "Map search unavailable."); }
    finally { setBusy(false); }
  };

  const onPickPin = async (coords: { latitude: number; longitude: number }) => {
    setAddress((prev) => ({ ...prev, latitude: coords.latitude, longitude: coords.longitude }));
    try {
      const reversed = await api.reverseGeocode(coords.latitude, coords.longitude);
      setAddress({ label: reversed.displayName, latitude: reversed.latitude, longitude: reversed.longitude });
    } catch { /* keep coords only */ }
  };

  const confirmOrder = async () => {
    if (!token || !service || !vehicle || !address.label) return;
    setBusy(true);
    try {
      await api.createOrder(token, { service_id: service.id, vehicle_id: vehicle.id, address, schedule_date: date, schedule_time: time, notes });
      await refresh(token);
      setBooking(false); setScreen("orders");
      toast.show(`${t.success} · ${t.successHint}`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not confirm order.";
      setError(message); toast.show(message, "error");
    } finally { setBusy(false); }
  };

  const saveVehicle = async () => {
    if (!token || Object.values(vehicleForm).some((x) => !x.trim())) return setError(t.required);
    setBusy(true);
    try {
      const created = await api.addVehicle(token, vehicleForm);
      setVehicles([created, ...vehicles]);
      setVehicle(created);
      setVehicleSheet(false);
      setVehicleForm({ nickname: "", make: "", model: "", year: "", plate: "", type: "Sedan" });
      toast.show(`${created.nickname} · ${created.plate}`, "success");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save vehicle."); }
    finally { setBusy(false); }
  };

  const updateProfile = async (name: string) => {
    if (!token || !name.trim()) return;
    setBusy(true);
    try {
      const updated = await api.updateMe(token, { name: name.trim() });
      setUser(updated);
      toast.show(t.profileUpdated, "success");
    } catch (e) { toast.show(e instanceof Error ? e.message : "Update failed.", "error"); }
    finally { setBusy(false); }
  };

  const logout = async () => { await storage.secureRemove(TOKEN_KEY); setToken(null); setUser(null); setScreen("home"); };

  if (loading) return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.moonGlow} />
      <Text style={styles.brand}>MOONTIR</Text>
    </View>
  );

  if (!token || !user) return <Auth lang={lang} setLang={setLang} mode={authMode} setMode={setAuthMode} values={auth} setValues={setAuth} error={error} busy={busy} submit={authSubmit} />;

  const body = screen === "home" ? <Home user={user} services={services} orders={orders} t={t} book={() => openBooking()} select={openBooking} goOrders={() => setScreen("orders")} />
    : screen === "services" ? <Catalog services={services} t={t} book={openBooking} />
    : screen === "garage" ? <Garage vehicles={vehicles} t={t} add={() => setVehicleSheet(true)} />
    : screen === "orders" ? <OrderList orders={orders} t={t} invoice={setInvoice} />
    : <Profile user={user} t={t} lang={lang} setLang={setLang} logout={logout} save={updateProfile} busy={busy} />;

  return (
    <View style={[styles.root, { paddingTop: insets.top, overflow: "hidden" }]}>
      <View style={styles.glow} />
      <View style={styles.glowSecondary} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 + insets.bottom }} showsVerticalScrollIndicator={false}>{body}</ScrollView>
      <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <BlurView tint="dark" intensity={40} style={styles.navBlur}>
          {(["home", "services", "garage", "orders", "profile"] as Screen[]).map((item) => (
            <Nav key={item} screen={item} current={screen} setScreen={setScreen} label={t[item]} />
          ))}
        </BlurView>
      </View>
      <BookingModal
        open={booking} close={() => setBooking(false)} step={step} setStep={setStep} t={t}
        services={services} vehicles={vehicles} service={service} vehicle={vehicle}
        setService={setService} setVehicle={setVehicle}
        address={address} setAddress={setAddress}
        query={query} setQuery={setQuery} results={results} setResults={setResults}
        date={date} setDate={setDate} time={time} setTime={setTime} notes={notes} setNotes={setNotes}
        locate={locate} search={search} confirm={confirmOrder} busy={busy} error={error}
        quote={quote}
        onPickPin={onPickPin}
        addVehicle={() => { setBooking(false); setVehicleSheet(true); }}
      />
      <VehicleModal open={vehicleSheet} close={() => setVehicleSheet(false)} form={vehicleForm} setForm={setVehicleForm} save={saveVehicle} t={t} busy={busy} error={error} />
      <InvoiceModal order={invoice} close={() => setInvoice(null)} t={t} lang={lang} />
    </View>
  );
}

function Auth({ lang, setLang, mode, setMode, values, setValues, error, busy, submit }: any) {
  const { colors } = useTheme(); const styles = useStyles(); const t = copy[lang];
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.auth}>
      <LinearGradient colors={[colors.surface, colors.surfaceSecondary, colors.surface]} style={StyleSheet.absoluteFill} />
      <Pressable testID="language-toggle" style={styles.lang} onPress={() => setLang(lang === "en" ? "id" : "en")}>
        <Ionicons name="language-outline" size={18} color={colors.moonGlow} />
        <Text style={styles.langText}>{t.language}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.authContent}>
        <View style={styles.brandRow}>
          <Ionicons name="moon" size={30} color={colors.moonGlow} />
          <Text style={styles.brand}>MOONTIR</Text>
          <View style={styles.brandGearBadge}>
            <Ionicons name="cog-outline" size={14} color={colors.moonGlow} />
          </View>
        </View>
        <Text style={styles.authTitle}>{t.welcome}</Text>
        <Text style={styles.muted}>{lang === "en" ? "Home vehicle care, in a softer light." : "Perawatan kendaraan di rumah, dalam cahaya yang lebih tenang."}</Text>
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

function Home({ user, services, orders, t, book, select, goOrders }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const active = orders.find((x: Order) => x.status !== "completed");
  return (
    <>
      <Header user={user} t={t} />
      <LinearGradient colors={[colors.brandSecondary, colors.brandPrimary]} style={styles.hero}>
        <Ionicons name="moon" size={38} color={colors.moonGlow} style={styles.heroMoon} />
        <View style={styles.heroGear}><Ionicons name="cog-outline" size={22} color={colors.moonGlow} /></View>
        <Text style={styles.kicker}>AT-HOME VEHICLE CARE</Text>
        <Text style={styles.heroTitle}>{t.book}</Text>
        <Text style={styles.heroBody}>{t.welcome}</Text>
        <Button testID="home-book" label={t.book} onPress={book} />
      </LinearGradient>
      {active ? (
        <Pressable testID="home-active-order" style={styles.card} onPress={goOrders}>
          <Ionicons name="navigate-outline" size={23} color={colors.success} />
          <View style={styles.flex}>
            <Text style={styles.label}>{t.active}</Text>
            <Text style={styles.cardTitle}>{active.service_name}</Text>
            <Text style={styles.muted}>{active.schedule_date} · {active.schedule_time}</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.muted} />
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Ionicons name="sparkles-outline" size={23} color={colors.moonGlow} />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{t.noActive}</Text>
            <Text style={styles.muted}>{t.noActiveHint}</Text>
          </View>
        </View>
      )}
      <Section title={t.popular} action={t.seeAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {services.filter((x: Service) => x.featured).map((x: Service) => (
          <ServiceCard key={x.id} service={x} lang={t === copy.id ? "id" : "en"} press={() => select(x)} compact />
        ))}
      </ScrollView>
      <Section title={t.services} action={t.seeAll} />
      <View style={styles.categories}>
        <Category icon="water-outline" label="Detailing" />
        <Category icon="construct-outline" label={t === copy.id ? "Perawatan" : "Maintenance"} />
        <Category icon="shield-checkmark-outline" label="Premium" />
      </View>
    </>
  );
}

function Catalog({ services, t, book }: any) {
  return (
    <>
      <Title eyebrow="MOONTIR CATALOG" title={t.services} subtitle={t === copy.id ? "Pilih perawatan yang sesuai kendaraanmu." : "Find the right care package for your vehicle."} />
      <View style={{ gap: 13 }}>
        {services.map((x: Service) => (
          <ServiceCard key={x.id} testID={`service-${x.id}`} service={x} lang={t === copy.id ? "id" : "en"} press={() => book(x)} />
        ))}
      </View>
    </>
  );
}

function Garage({ vehicles, t, add }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <>
      <Title eyebrow="MY GARAGE" title={t.garage} subtitle={t === copy.id ? "Simpan kendaraan untuk checkout lebih cepat." : "Save vehicles for a faster checkout."} />
      <Pressable testID="vehicle-add" style={styles.outline} onPress={add}>
        <Ionicons name="add" size={20} color={colors.moonGlow} />
        <Text style={styles.outlineText}>{t.addVehicle}</Text>
      </Pressable>
      {vehicles.length ? (
        <View style={{ gap: 13, marginTop: 16 }}>
          {vehicles.map((x: Vehicle) => <VehicleCard key={x.id} vehicle={x} testID={`garage-vehicle-${x.id}`} />)}
        </View>
      ) : (
        <Empty icon="car-outline" title={t === copy.id ? "Garasi masih kosong" : "Your garage is empty"} hint={t === copy.id ? "Tambahkan mobil pertamamu." : "Add your first car to get started."} />
      )}
    </>
  );
}

function OrderList({ orders, t, invoice }: any) {
  return (
    <>
      <Title eyebrow="SERVICE LOG" title={t.orders} subtitle={t === copy.id ? "Semua dispatch dan invoice kamu." : "Every dispatch and invoice in one place."} />
      {orders.length ? (
        <View style={{ gap: 13 }}>
          {orders.map((x: Order) => <OrderCard key={x.id} order={x} t={t} invoice={() => invoice(x)} />)}
        </View>
      ) : (
        <Empty icon="receipt-outline" title={t.emptyHistory} hint={t.emptyHistoryHint} />
      )}
    </>
  );
}

function Profile({ user, t, lang, setLang, logout, save, busy }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const [name, setName] = useState<string>(user.name);
  useEffect(() => { setName(user.name); }, [user.name]);
  const dirty = name.trim() !== user.name;
  return (
    <>
      <Title eyebrow="ACCOUNT / ORBIT" title={t.profile} subtitle={t === copy.id ? "Kelola akun dan bahasa Moontir." : "Manage your account and Moontir language."} />
      <View style={styles.profile}>
        <View style={styles.profileAvatar}>
          <Ionicons name="moon" size={20} color={colors.moonGlow} style={styles.profileMoon} />
          <Text style={styles.profileInitial}>{(user.name?.[0] || "M").toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{user.name}</Text>
        <Text style={styles.muted}>{user.email}</Text>
      </View>
      <View style={{ marginTop: 20, gap: 12 }}>
        <Text style={styles.fieldLabel}>{t.editName}</Text>
        <Field testID="profile-name" label={t.name} value={name} onChangeText={setName} icon="person-outline" />
        <Button testID="profile-save" label={t.saveProfile} onPress={() => save(name)} busy={busy} disabled={!dirty} />
      </View>
      <View style={styles.settings}>
        <Pressable testID="profile-language" style={styles.setting} onPress={() => setLang(lang === "en" ? "id" : "en")}>
          <Ionicons name="language-outline" size={20} color={colors.moonGlow} />
          <Text style={[styles.flex, styles.settingLabel]}>{t.languageSetting}</Text>
          <Text style={styles.settingValue}>{lang === "en" ? "English" : "Bahasa Indonesia"}</Text>
          <Ionicons name="swap-horizontal" size={17} color={colors.muted} />
        </Pressable>
        <View style={styles.setting}>
          <Ionicons name="wallet-outline" size={20} color={colors.moonGlow} />
          <Text style={[styles.flex, styles.settingLabel]}>{t.payment}</Text>
          <Text style={styles.settingValue}>{t.unpaid}</Text>
        </View>
        <View style={[styles.setting, { borderBottomWidth: 0 }]}>
          <Ionicons name="help-circle-outline" size={20} color={colors.moonGlow} />
          <Text style={[styles.flex, styles.settingLabel]}>{t.support}</Text>
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

function BookingModal({ open, close, step, setStep, t, services, vehicles, service, vehicle, setService, setVehicle, address, setAddress, query, setQuery, results, setResults, date, setDate, time, setTime, notes, setNotes, locate, search, confirm, busy, error, addVehicle, quote, onPickPin }: any) {
  const { colors } = useTheme(); const styles = useStyles(); const insets = useSafeAreaInsets();
  const ready = (step === 1 && service) || (step === 2 && vehicle) || (step === 3 && address.label) || step >= 4;
  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <Pressable testID="booking-close" style={styles.iconButton} onPress={close}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={styles.rail}>
            {[1, 2, 3, 4, 5].map((i) => <View key={i} style={[styles.railLine, i <= step && styles.railActive]} />)}
          </View>
          <Text style={styles.muted}>{step}/5</Text>
        </View>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Title
            eyebrow={`BOOKING / 0${step}`}
            title={[t.selectService, t.selectVehicle, t.address, t.schedule, t.review][step - 1]}
            subtitle={step === 3 ? t.dragPinHint : (t === copy.id ? "Jaga mobilmu tetap di orbit terbaik." : "Keep your vehicle in its best orbit.")}
          />
          {step === 1 && (
            <View style={{ gap: 13 }}>
              {services.map((x: Service) => (
                <ServiceCard key={x.id} testID={`booking-service-${x.id}`} service={x} lang={t === copy.id ? "id" : "en"} selected={service?.id === x.id} press={() => setService(x)} />
              ))}
            </View>
          )}
          {step === 2 && (
            <View style={{ gap: 13 }}>
              {vehicles.map((x: Vehicle) => (
                <VehicleCard key={x.id} testID={`booking-vehicle-${x.id}`} vehicle={x} selected={vehicle?.id === x.id} press={() => setVehicle(x)} />
              ))}
              <Pressable testID="booking-add-vehicle" style={styles.outline} onPress={addVehicle}>
                <Ionicons name="add" size={20} color={colors.moonGlow} />
                <Text style={styles.outlineText}>{t.addVehicle}</Text>
              </Pressable>
            </View>
          )}
          {step === 3 && <AddressStep t={t} address={address} setAddress={setAddress} query={query} setQuery={setQuery} results={results} setResults={setResults} locate={locate} search={search} busy={busy} onPickPin={onPickPin} />}
          {step === 4 && <ScheduleStep t={t} date={date} setDate={setDate} time={time} setTime={setTime} notes={notes} setNotes={setNotes} />}
          {step === 5 && <Review service={service} vehicle={vehicle} address={address} date={date} time={time} t={t} quote={quote} />}
          {error ? <Text testID="booking-error" style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          {step > 1 ? (
            <Pressable testID="booking-back" style={styles.back} onPress={() => setStep((step - 1) as Step)}>
              <Text style={styles.backText}>{t.back}</Text>
            </Pressable>
          ) : <View />}
          {step < 5 ? (
            <Button testID="booking-next" label={t.next} onPress={() => ready && setStep((step + 1) as Step)} disabled={!ready} />
          ) : (
            <Button testID="confirm-order" label={t.confirm} onPress={confirm} busy={busy} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function AddressStep({ t, address, setAddress, query, setQuery, results, setResults, locate, search, busy, onPickPin }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={{ gap: 13 }}>
      <TextInput testID="address-input" value={address.label} onChangeText={(label) => setAddress({ ...address, label })} multiline placeholder="Jl. Sudirman 21, Semarang" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} />
      <View style={styles.actions}>
        <Pressable testID="location-button" style={styles.location} onPress={locate}>
          <Ionicons name="locate-outline" size={18} color={colors.moonGlow} />
          <Text style={styles.small}>{t.useLocation}</Text>
        </Pressable>
        <Pressable testID="address-search" style={styles.location} onPress={search}>
          <Ionicons name="search-outline" size={18} color={colors.moonGlow} />
          <Text style={styles.small}>{t.searchAddress}</Text>
        </Pressable>
      </View>
      <TextInput testID="address-query" value={query} onChangeText={setQuery} placeholder={t === copy.id ? "Cari jalan atau kota" : "Search a street or city"} placeholderTextColor={colors.muted} style={styles.input} />
      {busy && <ActivityIndicator color={colors.moonGlow} />}
      {results.map((x: GeocodeResult) => (
        <Pressable key={`${x.osmId}-${x.latitude}`} testID={`address-result-${x.osmId}`} style={styles.result} onPress={() => { setAddress({ label: x.displayName, latitude: x.latitude, longitude: x.longitude }); setResults([]); }}>
          <Ionicons name="pin-outline" size={18} color={colors.moonGlow} />
          <Text style={styles.resultText}>{x.displayName}</Text>
        </Pressable>
      ))}
      <LeafletMap testID="address-map" latitude={address.latitude} longitude={address.longitude} onPick={onPickPin} height={240} />
      {address.latitude ? (
        <View style={styles.mapMeta}>
          <Ionicons name="pin" size={18} color={colors.moonGlow} />
          <Text style={styles.mapMetaText}>{address.latitude.toFixed(4)}, {address.longitude?.toFixed(4)}</Text>
          <Pressable onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${address.latitude}&mlon=${address.longitude}#map=17/${address.latitude}/${address.longitude}`)}>
            <Text style={styles.link}>{t.openMap}</Text>
          </Pressable>
        </View>
      ) : <Text style={styles.mapCredit}>{t.mapCredit}</Text>}
    </View>
  );
}

function ScheduleStep({ t, date, setDate, time, setTime, notes, setNotes }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  return (
    <View style={{ gap: 17 }}>
      <Text style={styles.fieldLabel}>{t === copy.id ? "Tanggal layanan" : "Service date"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {nextDates.map((x) => (
          <Pressable key={x.value} testID={`date-${x.value}`} style={[styles.date, date === x.value && styles.dateActive]} onPress={() => setDate(x.value)}>
            <Text style={[styles.dateDay, date === x.value && styles.activeText]}>{t === copy.id ? x.idDay : x.day}</Text>
            <Text style={[styles.dateNumber, date === x.value && styles.activeText]}>{x.number}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.fieldLabel}>{t === copy.id ? "Slot waktu" : "Time slot"}</Text>
      <View style={styles.timeGrid}>
        {slots.map((x) => (
          <Pressable key={x} testID={`slot-${x}`} style={[styles.time, time === x && styles.dateActive]} onPress={() => setTime(x)}>
            <Ionicons name="time-outline" size={17} color={time === x ? colors.moonGlow : colors.muted} />
            <Text style={styles.small}>{x}</Text>
          </Pressable>
        ))}
      </View>
      <Field testID="notes-input" label={t.notes} value={notes} onChangeText={setNotes} icon="create-outline" multiline />
    </View>
  );
}

function Review({ service, vehicle, address, date, time, t, quote }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  const lang: Lang = t === copy.id ? "id" : "en";
  const items: InvoiceItem[] = quote?.items || [{ label: service.name, label_id: service.name_id, amount: service.price }];
  const total = quote?.total ?? service.price;
  return (
    <View style={{ gap: 12 }}>
      <ReviewRow icon="sparkles-outline" label={service.name} value={money(total)} />
      <ReviewRow icon="car-outline" label={t.selectVehicle} value={`${vehicle.make} ${vehicle.model} · ${vehicle.plate} · ${vehicle.type}`} />
      <ReviewRow icon="pin-outline" label={t.address} value={address.label} />
      <ReviewRow icon="calendar-outline" label={t.schedule} value={`${date} · ${time}`} />
      <View testID="review-breakdown" style={styles.breakdown}>
        <View style={styles.breakdownHeader}>
          <Ionicons name="pricetag-outline" size={17} color={colors.moonGlow} />
          <Text style={styles.breakdownTitle}>{t.priceBreakdown}</Text>
        </View>
        {items.map((item, idx) => (
          <View key={`${item.label}-${idx}`} style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{lang === "id" && item.label_id ? item.label_id : item.label}</Text>
            <Text style={styles.breakdownAmount}>{money(item.amount)}</Text>
          </View>
        ))}
        <View style={[styles.breakdownRow, styles.breakdownTotal]}>
          <Text style={styles.breakdownTotalLabel}>{t.total}</Text>
          <Text testID="review-total" style={styles.breakdownTotalValue}>{money(total)}</Text>
        </View>
      </View>
      <View style={styles.unpaid}>
        <Ionicons name="wallet-outline" size={18} color={colors.moonGlow} />
        <Text style={styles.unpaidText}>{t.unpaid}</Text>
      </View>
    </View>
  );
}

function InvoiceModal({ order, close, t, lang }: any) {
  const styles = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  if (!order) return null;
  const langKey: Lang = lang;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <Pressable testID="invoice-close" style={styles.iconButton} onPress={close}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.modalTitle}>{t.invoice}</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView contentContainerStyle={styles.invoice}>
          <View style={styles.invoiceHead}>
            <Text style={styles.invoiceBrand}>MOONTIR</Text>
            <View style={styles.invoiceGear}>
              <Ionicons name="cog-outline" size={16} color={colors.moonGlow} />
              <Text style={styles.workshop}>{t.workshop}</Text>
            </View>
          </View>
          <Text style={styles.label}>HOME VEHICLE CARE / {order.id.slice(0, 8).toUpperCase()}</Text>
          <View style={styles.line} />

          {/* TRACKING SECTION */}
          <View style={styles.sectionHead}>
            <Ionicons name="navigate-outline" size={18} color={colors.moonGlow} />
            <Text style={styles.sectionHeadText}>{t.trackingHeading}</Text>
          </View>
          <View style={styles.timeline}>
            {order.status_history.map((item: any, idx: number) => (
              <View style={styles.timelineRow} key={item.at}>
                <View style={styles.timelineTrackWrap}>
                  <View style={styles.timelineDot} />
                  {idx < order.status_history.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>{langKey === "id" ? item.label_id : item.label}</Text>
                  <Text style={styles.muted}>{new Date(item.at).toLocaleString(langKey === "id" ? "id-ID" : "en-US")}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.line} />

          {/* INVOICE DETAIL SECTION */}
          <View style={styles.sectionHead}>
            <Ionicons name="document-text-outline" size={18} color={colors.moonGlow} />
            <Text style={styles.sectionHeadText}>{t.invoiceHeading}</Text>
          </View>
          <Text style={styles.cardTitle}>{order.service_name}</Text>
          <Text style={styles.muted}>{order.vehicle.make} {order.vehicle.model} · {order.vehicle.plate} · {order.vehicle.type}</Text>
          <View style={styles.invoiceBlock}>
            <Text style={styles.fieldLabel}>{t.address}</Text>
            <Text style={styles.invoiceText}>{order.address.label}</Text>
            <Text style={styles.fieldLabel}>{t.schedule}</Text>
            <Text style={styles.invoiceText}>{order.schedule_date} · {order.schedule_time}</Text>
          </View>

          <View style={styles.breakdown}>
            {(order.items || []).map((item: InvoiceItem, idx: number) => (
              <View key={`${item.label}-${idx}`} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{langKey === "id" && item.label_id ? item.label_id : item.label}</Text>
                <Text style={styles.breakdownAmount}>{money(item.amount)}</Text>
              </View>
            ))}
            <View style={[styles.breakdownRow, styles.breakdownTotal]}>
              <Text style={styles.breakdownTotalLabel}>{t.total}</Text>
              <Text testID="invoice-total" style={styles.breakdownTotalValue}>{money(order.total)}</Text>
            </View>
          </View>
          <Text style={styles.unpaidText}>{t.unpaid}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ServiceCard({ service, lang, press, selected, compact, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <Pressable testID={testID} style={[styles.card, selected && styles.selected, compact && styles.compact]} onPress={press}>
      <View style={styles.serviceIcon}>
        <Ionicons name={service.category === "Maintenance" ? "construct-outline" : service.category === "Premium" ? "shield-checkmark-outline" : "water-outline"} size={22} color={colors.moonGlow} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{lang === "id" ? service.name_id : service.name}</Text>
        <Text style={styles.muted}>{lang === "id" ? service.description_id : service.description}</Text>
        <Text style={styles.meta}>{lang === "id" ? service.duration_id : service.duration} · {money(service.price)}</Text>
      </View>
      {!compact && <Ionicons name={selected ? "checkmark-circle" : "chevron-forward"} size={21} color={selected ? colors.success : colors.muted} />}
    </Pressable>
  );
}

function VehicleCard({ vehicle, selected, press, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <Pressable testID={testID} style={[styles.card, selected && styles.selected]} onPress={press}>
      <View style={styles.serviceIcon}>
        <Ionicons name="car-sport-outline" size={24} color={colors.moonGlow} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{vehicle.nickname}</Text>
        <Text style={styles.muted}>{vehicle.make} {vehicle.model} · {vehicle.year} · {vehicle.type}</Text>
        <Text style={styles.plate}>{vehicle.plate}</Text>
      </View>
      {selected !== undefined && <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={21} color={selected ? colors.brand : colors.muted} />}
    </Pressable>
  );
}

function OrderCard({ order, t, invoice }: any) {
  const styles = useStyles(); const { colors } = useTheme();
  return (
    <View testID={`order-${order.id}`} style={[styles.card, { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={styles.orderTop}>
        <View style={styles.dot} />
        <Text style={styles.status}>{t === copy.id ? "Dispatch aktif" : "Dispatch active"}</Text>
        <Text style={styles.muted}>{order.schedule_date}</Text>
      </View>
      <Text style={styles.cardTitle}>{order.service_name}</Text>
      <Text style={styles.muted}>{order.vehicle.make} {order.vehicle.model} · {order.schedule_time}</Text>
      <View style={styles.orderBottom}>
        <Text style={styles.total}>{money(order.total)}</Text>
        <Pressable testID={`order-open-${order.id}`} style={styles.smallButton} onPress={invoice}>
          <Ionicons name="document-text-outline" size={16} color={colors.moonGlow} />
          <Text style={styles.small}>{t.invoice}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Header({ user, t }: any) {
  const styles = useStyles();
  const now = new Date();
  const hhmm = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.eyebrow}>MOONTIR · {hhmm}</Text>
        <Text style={styles.heading}>{t.hello}, {user.name.split(" ")[0]}</Text>
        <Text style={styles.muted}>{t.subtitle}</Text>
      </View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{user.name[0].toUpperCase()}</Text>
      </View>
    </View>
  );
}

function Title({ eyebrow, title, subtitle }: any) {
  const styles = useStyles();
  return (
    <View style={styles.title}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.muted}>{subtitle}</Text>
    </View>
  );
}

function Section({ title, action }: any) {
  const styles = useStyles();
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.link}>{action}</Text></View>;
}

function Category({ icon, label }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return <View style={styles.category}><Ionicons name={icon} size={20} color={colors.moonGlow} /><Text style={styles.small}>{label}</Text></View>;
}

function Empty({ icon, title, hint }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.moonGlow} />
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.muted}>{hint}</Text>
    </View>
  );
}

function ReviewRow({ icon, label, value }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={styles.reviewRow}>
      <Ionicons name={icon} size={20} color={colors.moonGlow} />
      <View style={styles.flex}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
    </View>
  );
}

function Nav({ screen, current, setScreen, label }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  const icons: any = { home: "home-outline", services: "sparkles-outline", garage: "car-outline", orders: "receipt-outline", profile: "person-outline" };
  return (
    <Pressable style={styles.navItem} onPress={() => setScreen(screen)} testID={`tab-${screen}`}>
      <Ionicons name={icons[screen]} size={21} color={screen === current ? colors.moonGlow : colors.muted} />
      <Text style={[styles.navText, screen === current && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, icon, secureTextEntry, keyboardType, multiline, testID }: any) {
  const { colors } = useTheme(); const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, multiline && styles.multilineWrap]}>
        <Ionicons name={icon} size={18} color={colors.muted} />
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
      {!busy && <Ionicons name="arrow-forward" size={17} color={colors.onBrandPrimary} />}
    </Pressable>
  );
}

function VehicleModal({ open, close, form, setForm, save, t, busy, error }: any) {
  const insets = useSafeAreaInsets(); const styles = useStyles(); const { colors } = useTheme();
  const update = (key: string, value: string) => setForm({ ...form, [key]: value });
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t.addVehicle}</Text>
            <Pressable testID="vehicle-close" style={styles.iconButton} onPress={close}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
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
            <Text style={styles.fieldLabel}>{t.vehicleType}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8, paddingHorizontal: 2 }}>
              {VEHICLE_TYPES.map((typeKey) => (
                <Pressable
                  key={typeKey}
                  testID={`vehicle-type-${typeKey}`}
                  onPress={() => update("type", typeKey)}
                  style={[styles.typeChip, form.type === typeKey && styles.typeChipActive]}
                >
                  <Ionicons name={typeKey === "Truck" || typeKey === "Pickup" ? "bus-outline" : typeKey === "SUV" || typeKey === "MPV" ? "car-sport-outline" : "car-outline"} size={16} color={form.type === typeKey ? colors.moonGlow : colors.muted} />
                  <Text style={[styles.typeChipText, form.type === typeKey && styles.typeChipTextActive]}>{typeKey}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button testID="vehicle-save" label={t.save} onPress={save} busy={busy} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  glow: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: colors.brandTertiary, top: -170, right: -100 },
  glowSecondary: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: colors.brandTertiary, bottom: -120, left: -60, opacity: 0.6 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: colors.surface },
  brand: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 3 },
  brandGearBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.borderStrong },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  eyebrow: { color: colors.moonGlow, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 },
  heading: { color: colors.onSurface, fontSize: 29, fontWeight: "900", marginTop: 5 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong },
  avatarText: { color: colors.moonGlow, fontWeight: "900", fontSize: 18 },
  hero: { minHeight: 225, borderRadius: 22, padding: 21, marginBottom: 17, overflow: "hidden" },
  heroMoon: { position: "absolute", right: 20, top: 20 },
  heroGear: { position: "absolute", left: -12, bottom: -12, width: 90, height: 90, borderRadius: 45, borderWidth: 1, borderColor: "rgba(147,197,253,0.25)", alignItems: "center", justifyContent: "center" },
  kicker: { color: colors.onBrandPrimary, opacity: 0.7, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  heroTitle: { color: colors.onBrandPrimary, fontSize: 27, fontWeight: "900", marginTop: 14, maxWidth: 220 },
  heroBody: { color: colors.onBrandPrimary, opacity: 0.8, marginVertical: 9 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900" },
  dim: { opacity: 0.45 },
  card: { flexDirection: "row", alignItems: "center", gap: 13, padding: 15, minHeight: 90, borderRadius: 18, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  flex: { flex: 1 },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800", marginTop: 3 },
  section: { flexDirection: "row", justifyContent: "space-between", marginTop: 28, marginBottom: 13 },
  sectionTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "900" },
  link: { color: colors.moonGlow, fontSize: 13, fontWeight: "800" },
  row: { gap: 12 },
  compact: { width: 270, alignItems: "flex-start" },
  serviceIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  selected: { backgroundColor: colors.brandTertiary, borderColor: colors.borderStrong },
  meta: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", marginTop: 7 },
  categories: { flexDirection: "row", gap: 10 },
  category: { flex: 1, minHeight: 82, justifyContent: "space-between", padding: 12, borderRadius: 15, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  small: { color: colors.moonGlow, fontSize: 12, fontWeight: "800" },
  title: { paddingTop: 8, marginBottom: 22 },
  outline: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  outlineText: { color: colors.moonGlow, fontWeight: "900" },
  plate: { color: colors.moonGlow, fontSize: 12, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
  empty: { minHeight: 260, marginTop: 16, alignItems: "center", justifyContent: "center", gap: 8, padding: 25, borderRadius: 20, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  orderTop: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  status: { color: colors.success, flex: 1, fontWeight: "800", fontSize: 12 },
  orderBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 16, paddingTop: 13 },
  total: { color: colors.onSurface, fontSize: 17, fontWeight: "900" },
  smallButton: { minHeight: 38, borderRadius: 10, paddingHorizontal: 12, gap: 6, backgroundColor: colors.brandTertiary, flexDirection: "row", alignItems: "center" },
  profile: { alignItems: "center", padding: 24, backgroundColor: colors.surfaceSecondary, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  profileAvatar: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: 12, borderWidth: 1, borderColor: colors.borderStrong },
  profileMoon: { position: "absolute", top: 6, right: 6 },
  profileInitial: { color: colors.moonGlow, fontSize: 30, fontWeight: "900" },
  profileName: { color: colors.onSurface, fontSize: 21, fontWeight: "900" },
  settings: { marginTop: 22, paddingHorizontal: 15, borderRadius: 18, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  setting: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  settingLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  settingValue: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  logout: { minHeight: 52, marginTop: 22, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  logoutText: { color: colors.error, fontWeight: "800" },
  nav: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 13, paddingTop: 9 },
  navBlur: { minHeight: 67, borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, flexDirection: "row" },
  navItem: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4 },
  navText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  auth: { flex: 1, backgroundColor: colors.surface },
  authContent: { padding: 24, paddingTop: 112, paddingBottom: 30 },
  brandRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 27 },
  authTitle: { color: colors.onSurface, fontSize: 34, lineHeight: 39, fontWeight: "900", maxWidth: 320, marginTop: 8 },
  lang: { position: "absolute", zIndex: 3, top: 52, right: 20, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  langText: { color: colors.moonGlow, fontWeight: "900" },
  authCard: { marginTop: 28, padding: 18, borderRadius: 22, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  switch: { minHeight: 50, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  field: { flex: 1, gap: 6, marginBottom: 12 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  inputWrap: { minHeight: 50, borderRadius: 13, paddingHorizontal: 12, gap: 9, flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  multilineWrap: { alignItems: "flex-start", paddingTop: 11 },
  textInput: { flex: 1, color: colors.onSurface, minHeight: 47, fontSize: 14 },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modal: { flex: 1, backgroundColor: colors.surface },
  modalHeader: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  rail: { flex: 1, flexDirection: "row", gap: 4, marginHorizontal: 12 },
  railLine: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceTertiary },
  railActive: { backgroundColor: colors.brand },
  modalScroll: { padding: 20, paddingBottom: 130 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, flexDirection: "row", justifyContent: "space-between", gap: 14, backgroundColor: colors.surface },
  back: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12 },
  backText: { color: colors.muted, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 10 },
  location: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 6 },
  input: { minHeight: 52, borderRadius: 14, padding: 14, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  result: { flexDirection: "row", gap: 9, padding: 13, borderRadius: 13, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  resultText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  mapMeta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  mapMetaText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  mapCredit: { color: colors.muted, fontSize: 11, textAlign: "center" },
  date: { width: 62, minHeight: 74, borderRadius: 15, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dateActive: { backgroundColor: colors.brandTertiary, borderColor: colors.borderStrong },
  dateDay: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  dateNumber: { color: colors.onSurface, fontWeight: "900", fontSize: 22 },
  activeText: { color: colors.moonGlow },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  time: { width: "47%", minHeight: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  unpaid: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.brandTertiary },
  unpaidText: { color: colors.moonGlow, fontWeight: "900", fontSize: 13 },
  reviewRow: { flexDirection: "row", gap: 12, padding: 15, borderRadius: 15, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  reviewValue: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 3 },
  breakdown: { padding: 15, borderRadius: 16, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 8 },
  breakdownHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  breakdownTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 14 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  breakdownLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", flex: 1, paddingRight: 8 },
  breakdownAmount: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  breakdownTotal: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10, marginTop: 4 },
  breakdownTotalLabel: { color: colors.onSurface, fontWeight: "900", fontSize: 15 },
  breakdownTotalValue: { color: colors.moonGlow, fontWeight: "900", fontSize: 17 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheet: { maxHeight: "88%", padding: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surfaceSecondary },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: "center", backgroundColor: colors.muted, marginBottom: 15 },
  two: { flexDirection: "row", gap: 10 },
  modalTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "900" },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  typeChipActive: { backgroundColor: colors.brandTertiary, borderColor: colors.borderStrong },
  typeChipText: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  typeChipTextActive: { color: colors.moonGlow },
  invoice: { padding: 22 },
  invoiceHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  invoiceBrand: { color: colors.moonGlow, fontSize: 26, fontWeight: "900", letterSpacing: 2 },
  invoiceGear: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  workshop: { color: colors.moonGlow, fontSize: 11, fontWeight: "800" },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionHeadText: { color: colors.moonGlow, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  invoiceBlock: { gap: 7, marginTop: 14, marginBottom: 18 },
  invoiceText: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  timeline: { gap: 4, marginBottom: 6 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingBottom: 4 },
  timelineTrackWrap: { alignItems: "center", width: 12, paddingTop: 6 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.brandTertiary },
  timelineLine: { flex: 1, width: 2, minHeight: 22, backgroundColor: colors.divider, marginTop: 2 },
}));

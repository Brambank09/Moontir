import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme";

type ToastKind = "success" | "info" | "error";
type Toast = { id: number; message: string; kind: ToastKind };

type ToastContextValue = {
  show: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-24)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, kind });
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -24, duration: 240, useNativeDriver: true }),
      ]).start(() => setToast(null));
    }, 3200);
  }, [opacity, translateY]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastOverlay toast={toast} opacity={opacity} translateY={translateY} onDismiss={() => setToast(null)} />
    </ToastContext.Provider>
  );
}

function ToastOverlay({ toast, opacity, translateY, onDismiss }: { toast: Toast | null; opacity: Animated.Value; translateY: Animated.Value; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!toast) return null;
  const accent = toast.kind === "success" ? colors.success : toast.kind === "error" ? colors.error : colors.moonGlow;
  const icon = toast.kind === "success" ? "checkmark-circle" : toast.kind === "error" ? "alert-circle" : "information-circle";
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 20, opacity, transform: [{ translateY }] }]}>
      <Pressable testID="toast-message" onPress={onDismiss} style={[styles.toast, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong }]}>
        <Ionicons name={icon} size={22} color={accent} />
        <Text style={[styles.text, { color: colors.onSurface }]} numberOfLines={2}>{toast.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 9999, alignItems: "center" },
  toast: { minHeight: 54, maxWidth: 440, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
  text: { flex: 1, fontSize: 13, fontWeight: "700", lineHeight: 18 },
});

import { useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useTheme } from "@/src/theme";

type Props = {
  latitude?: number;
  longitude?: number;
  onPick?: (coords: { latitude: number; longitude: number }) => void;
  height?: number;
  testID?: string;
};

// Default center: central Java, Indonesia (rough Moontir service area).
const DEFAULT_CENTER = { latitude: -6.9932, longitude: 110.4203 };

export function LeafletMap({ latitude, longitude, onPick, height = 240, testID }: Props) {
  const { colors } = useTheme();
  const webRef = useRef<WebView>(null);
  const html = useMemo(() => {
    const lat = latitude ?? DEFAULT_CENTER.latitude;
    const lng = longitude ?? DEFAULT_CENTER.longitude;
    return buildHtml({ latitude: lat, longitude: lng }, colors.brandPrimary, colors.moonGlow);
  }, [latitude, longitude, colors.brandPrimary, colors.moonGlow]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "pick" && typeof data.lat === "number" && typeof data.lng === "number") {
        onPick?.({ latitude: data.lat, longitude: data.lng });
      }
    } catch {
      // ignore
    }
  };

  return (
    <View testID={testID} style={[styles.wrap, { height, borderColor: colors.borderStrong, backgroundColor: colors.surfaceTertiary }]}>
      {Platform.OS === "web" ? (
        <WebMapFallback html={html} onPick={onPick} />
      ) : (
        <WebView
          ref={webRef}
          originWhitelist={["*"]}
          source={{ html }}
          style={styles.web}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          automaticallyAdjustContentInsets={false}
        />
      )}
    </View>
  );
}

function WebMapFallback({ html, onPick }: { html: string; onPick?: (c: { latitude: number; longitude: number }) => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Attach a message listener via ref; runs only on web.
  const onLoad = () => {
    if (typeof window === "undefined" || !onPick) return;
    const listener = (event: MessageEvent) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data && data.type === "pick" && typeof data.lat === "number" && typeof data.lng === "number") {
          onPick({ latitude: data.lat, longitude: data.lng });
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("message", listener);
    (iframeRef.current as unknown as { __cleanup?: () => void }).__cleanup = () => window.removeEventListener("message", listener);
  };
  // React Native Web renders View as a div; we render a raw iframe via createElement.
  const IFrame = "iframe" as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <IFrame
      ref={iframeRef}
      srcDoc={html}
      onLoad={onLoad}
      style={{ border: "0", width: "100%", height: "100%", backgroundColor: "transparent" }}
      title="Moontir map"
    />
  );
}

function buildHtml(center: { latitude: number; longitude: number }, accent: string, glow: string): string {
  const { latitude, longitude } = center;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0C0E14; }
  .moon-pin {
    width: 26px; height: 26px; border-radius: 50%;
    background: ${accent};
    border: 3px solid ${glow};
    box-shadow: 0 0 20px ${glow}, 0 0 40px ${accent};
    transform: translate(-13px, -13px);
  }
  .leaflet-container { background: #0C0E14; }
  .leaflet-tile { filter: brightness(0.55) contrast(1.15) hue-rotate(200deg) saturate(1.1); }
  .leaflet-control-attribution { background: rgba(12,14,20,0.7) !important; color: #93C5FD !important; font-size: 10px; }
  .leaflet-control-attribution a { color: #93C5FD !important; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var post = function(payload){
    var msg = JSON.stringify(payload);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    } else if (window.parent) {
      window.parent.postMessage(msg, '*');
    }
  };
  var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([${latitude}, ${longitude}], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(map);

  var icon = L.divIcon({ className: 'moon-pin', iconSize: [26, 26] });
  var marker = L.marker([${latitude}, ${longitude}], { draggable: true, icon: icon }).addTo(map);

  marker.on('dragend', function(e){
    var p = e.target.getLatLng();
    post({ type: 'pick', lat: p.lat, lng: p.lng });
  });
  map.on('click', function(e){
    marker.setLatLng(e.latlng);
    post({ type: 'pick', lat: e.latlng.lat, lng: e.latlng.lng });
  });

  function recenter(data){
    if (data && data.type === 'center' && typeof data.lat === 'number' && typeof data.lng === 'number') {
      map.setView([data.lat, data.lng], 16);
      marker.setLatLng([data.lat, data.lng]);
    }
  }
  document.addEventListener('message', function(e){
    try { recenter(JSON.parse(e.data)); } catch (err) {}
  });
  window.addEventListener('message', function(e){
    try { recenter(typeof e.data === 'string' ? JSON.parse(e.data) : e.data); } catch (err) {}
  });
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 18, overflow: "hidden", borderWidth: 1 },
  web: { flex: 1, backgroundColor: "transparent" },
});

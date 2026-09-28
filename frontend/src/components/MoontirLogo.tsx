import { Image, StyleSheet, type ImageStyle } from "react-native";
import { useTheme } from "@/src/theme";

// Two locked artworks (dark on cream, light on charcoal). Emergent bundles both
// and swaps based on the current scheme so the wordmark always contrasts.
const LOGO_DARK = require("../../assets/images/brand/moontir-logo-dark.png");
const LOGO_LIGHT = require("../../assets/images/brand/moontir-logo-light.png");

type Props = {
  width?: number;
  height?: number;
  style?: ImageStyle;
  testID?: string;
};

export function MoontirLogo({ width = 160, height = 40, style, testID }: Props) {
  const { scheme } = useTheme();
  const source = scheme === "dark" ? LOGO_LIGHT : LOGO_DARK;
  return <Image testID={testID ?? "moontir-logo"} source={source} resizeMode="contain" style={[styles.logo, { width, height }, style]} />;
}

const styles = StyleSheet.create({
  logo: { alignSelf: "center" },
});

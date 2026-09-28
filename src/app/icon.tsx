import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// App icon (home screen, install prompt): the "S" mark on the brand teal.
export default function Icon() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#177f78", color: "#fff", fontSize: 300, fontWeight: 800 }}>S</div>, size);
}

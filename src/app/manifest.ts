import type { MetadataRoute } from "next";

// Lets the app be added to the phone's home screen and open full screen, like an installed app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Staywise",
    short_name: "Staywise",
    description: "Quanto tempo posso ficar em cada lugar: dias de presença na Itália e no Brasil.",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#177f78",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

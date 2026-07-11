import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import App from "./App";
import { DesktopBridgeProvider } from "./platform/DesktopBridgeProvider";
import { queryClient } from "./queryClient";
import "./styles/tailwind.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DesktopBridgeProvider>
        <App />
      </DesktopBridgeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

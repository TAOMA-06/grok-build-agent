import type { PropsWithChildren } from "react";
import {
  defaultDesktopBridge,
  DesktopBridgeContext,
  type DesktopBridge,
} from "./DesktopBridge";

export function DesktopBridgeProvider({
  children,
  bridge = defaultDesktopBridge,
}: PropsWithChildren<{ bridge?: DesktopBridge }>) {
  return (
    <DesktopBridgeContext.Provider value={bridge}>
      {children}
    </DesktopBridgeContext.Provider>
  );
}

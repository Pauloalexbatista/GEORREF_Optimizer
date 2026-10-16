"use client";

import { useEffect } from "react";

/**
 * Suprime popups de erro intrusivos provocados por extensões de terceiros no navegador
 * (tais como MetaMask, Phantom, Rabby Wallet ou scripts inpage.js de extensões do Chrome/Edge).
 */
export default function ExtensionErrorSuppressor() {
  useEffect(() => {
    const isExtensionError = (err: any): boolean => {
      if (!err) return false;
      const str = String(err?.message || err?.stack || err || "");
      const stack = String(err?.stack || "");

      return (
        str.toLowerCase().includes("metamask") ||
        str.includes("inpage.js") ||
        str.includes("chrome-extension://") ||
        str.includes("moz-extension://") ||
        str.includes("disconnected from all chains") ||
        err?.code === 4900 ||
        stack.includes("chrome-extension://") ||
        stack.includes("moz-extension://")
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionError(event.reason)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const handleError = (event: ErrorEvent) => {
      if (
        isExtensionError(event.error) ||
        isExtensionError(event.message) ||
        String(event.filename || "").includes("extension://")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    // Usar capture = true para intercetar antes do overlay de desenvolvimento do Next.js
    window.addEventListener("unhandledrejection", handleUnhandledRejection, true);
    window.addEventListener("error", handleError, true);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection, true);
      window.removeEventListener("error", handleError, true);
    };
  }, []);

  return null;
}

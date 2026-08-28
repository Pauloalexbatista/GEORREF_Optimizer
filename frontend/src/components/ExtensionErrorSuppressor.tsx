"use client";

import { useEffect } from "react";

/**
 * Suppresses runtime error popups caused by third-party browser extensions
 * (such as MetaMask / Rabby Wallet code 4900 "The provider is disconnected from all chains").
 */
export default function ExtensionErrorSuppressor() {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (!reason) return;

      // Detect Web3 / Extension disconnection objects (e.g. { code: 4900, message: '...' })
      if (
        reason?.code === 4900 ||
        (typeof reason?.message === "string" && reason.message.includes("disconnected from all chains")) ||
        (typeof reason?.stack === "string" && reason.stack.includes("chrome-extension://")) ||
        (typeof reason === "object" && reason !== null && reason.code && reason.message)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

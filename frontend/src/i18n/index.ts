import { pt } from "./locales/pt";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";

export type Language = "pt" | "en" | "es" | "fr";

export const translations = {
  pt,
  en,
  es,
  fr,
};

export type TranslationType = typeof pt;

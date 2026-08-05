/**
 * Custom CodeMirror theme — zinc dark palette, pixel-perfect UI uyumu.
 * Hiçbir hazır tema kullanılmaz; her token zinc sistemiyle tanımlanır.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Zinc renk sabitleri — tailwind değerleriyle birebir */
const zinc = {
  950: "#09090b",  // bg
  900: "#18181b",  // surface
  800: "#27272a",  // border
  700: "#3f3f46",  // muted
  600: "#52525b",  // muted-mid
  500: "#71717a",  // muted-fg
  400: "#a1a1aa",  // fg-2
  300: "#d4d4d8",  // fg-muted-bright
  200: "#e4e4e7",  // accent / fg bright
  100: "#f4f4f5",  // fg near-white
  50:  "#fafafa",  // fg max
} as const;

export const zincTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: zinc[950],
      color: zinc[200],
      fontFamily: "'Geist Mono', ui-monospace, monospace",
      fontSize: "13px",
      height: "100%",
    },

    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.6",
    },

    /* Gutter (satır numaraları) */
    ".cm-gutters": {
      backgroundColor: zinc[900],
      color: zinc[600],
      borderRight: `1px solid ${zinc[800]}`,
      padding: "0 8px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 4px 0 8px",
      minWidth: "2.5em",
    },
    ".cm-activeLineGutter": {
      backgroundColor: zinc[800],
      color: zinc[400],
    },

    /* Aktif satır */
    ".cm-activeLine": {
      backgroundColor: `${zinc[800]}55`,
    },

    /* Seçim */
    ".cm-selectionBackground, ::selection": {
      backgroundColor: `${zinc[700]}88 !important`,
    },

    /* İmleç */
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: zinc[100],
      borderLeftWidth: "2px",
    },

    /* Odak halkası — kaldır, kendi border'ımız var */
    "&.cm-focused": {
      outline: "none",
    },

    /* Bracket eşleştirme */
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: `${zinc[700]}60`,
      outline: `1px solid ${zinc[600]}`,
      borderRadius: "2px",
    },

    /* Autocomplete paneli */
    ".cm-tooltip": {
      backgroundColor: zinc[900],
      border: `1px solid ${zinc[800]}`,
      borderRadius: "4px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul": {
        fontFamily: "'Geist Mono', monospace",
        fontSize: "12px",
        maxHeight: "200px",
      },
      "& > ul > li": {
        padding: "3px 8px",
        color: zinc[300],
      },
      "& > ul > li[aria-selected]": {
        backgroundColor: zinc[800],
        color: zinc[50],
      },
    },

    /* Search match */
    ".cm-searchMatch": {
      backgroundColor: `${zinc[700]}88`,
      outline: `1px solid ${zinc[600]}`,
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: `${zinc[600]}aa`,
    },

    /* Fold gutter */
    ".cm-foldGutter": {
      width: "16px",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: zinc[800],
      border: `1px solid ${zinc[700]}`,
      color: zinc[500],
    },

    /* Satır wrap göstergesi */
    ".cm-indent-markers": {
      "--indent-marker-bg-color": zinc[800],
      "--indent-marker-active-bg-color": zinc[700],
    },
  },
  { dark: true }
);

/** Token renkleri — SQL için özel */
export const zincHighlight = syntaxHighlighting(
  HighlightStyle.define([
    // SQL keyword'leri — SELECT, FROM, WHERE, INSERT, UPDATE...
    {
      tag: [t.keyword, t.operatorKeyword],
      color: zinc[100],
      fontWeight: "600",
    },
    // SQL fonksiyonları — COUNT, SUM, AVG, NOW, COALESCE...
    {
      tag: [t.function(t.variableName), t.function(t.propertyName)],
      color: zinc[200],
    },
    // String literaller — 'hello', $$...$$
    {
      tag: [t.string, t.special(t.string)],
      color: zinc[400],
    },
    // Sayılar
    {
      tag: [t.number, t.integer, t.float],
      color: zinc[300],
    },
    // Yorumlar — -- tek satır, /* çok satır */
    {
      tag: t.comment,
      color: zinc[600],
      fontStyle: "italic",
    },
    // Operatörler — =, !=, >, <, AND, OR, NOT, IS, IN
    {
      tag: t.operator,
      color: zinc[500],
    },
    // Tip adları — INTEGER, TEXT, BOOLEAN, TIMESTAMP...
    {
      tag: [t.typeName, t.className],
      color: zinc[300],
    },
    // Tablo/kolon adları — identifier
    {
      tag: t.variableName,
      color: zinc[200],
    },
    // Property (kolon adı, tablo.kolon)
    {
      tag: t.propertyName,
      color: zinc[300],
    },
    // Boolean literaller — true, false, null
    {
      tag: [t.bool, t.null],
      color: zinc[400],
      fontStyle: "italic",
    },
    // Özel (parametre, placeholder)
    {
      tag: t.special(t.variableName),
      color: zinc[400],
    },
    // Noktalama
    {
      tag: t.punctuation,
      color: zinc[600],
    },
    // Parantezler
    {
      tag: t.paren,
      color: zinc[500],
    },
    // Hata — kırmızı altı çizili
    {
      tag: t.invalid,
      color: "#ef4444",
      textDecoration: "underline",
    },
  ])
);
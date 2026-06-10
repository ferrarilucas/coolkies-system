"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { type Block, type PartialBlock, locales } from "@blocknote/core";
import { useTheme } from "next-themes";
import type { Theme } from "@blocknote/mantine";

// Tema que mapeia para as CSS variables do app.
// hsl(var(--xxx)) é resolvido pelo browser no contexto do DOM,
// portanto funciona mesmo sendo passado como string num objeto JS.
const lightTheme: Theme = {
  colors: {
    editor: {
      background: "hsl(var(--background))",
      text: "hsl(var(--foreground))",
    },
    menu: {
      background: "hsl(var(--popover))",
      text: "hsl(var(--popover-foreground))",
    },
    tooltip: {
      background: "hsl(var(--popover))",
      text: "hsl(var(--popover-foreground))",
    },
    hovered: {
      background: "hsl(var(--muted))",
      text: "hsl(var(--foreground))",
    },
    selected: {
      background: "hsl(var(--primary))",
      text: "hsl(var(--primary-foreground))",
    },
    disabled: {
      background: "hsl(var(--muted))",
      text: "hsl(var(--muted-foreground))",
    },
    shadow: "0 2px 8px hsl(var(--foreground) / .08)",
    border: "hsl(var(--border))",
    sideMenu: "hsl(var(--muted-foreground))",
  },
  borderRadius: 8,
  fontFamily: "inherit",
};

const darkTheme: Theme = { ...lightTheme };

// Usa o locale pt oficial do BlockNote como base completa,
// sobrescrevendo apenas os placeholders para português do Brasil.
const ptBR = {
  ...locales.pt,
  placeholders: {
    ...locales.pt.placeholders,
    default: "Digite ou use '/' para comandos",
  },
};

export function BlockEditor({
  initialContent,
  onChange,
  editable = true,
}: {
  initialContent?: PartialBlock[];
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
}) {
  const { resolvedTheme } = useTheme();

  const editor = useCreateBlockNote({
    initialContent:
      initialContent && initialContent.length > 0 ? initialContent : undefined,
    dictionary: ptBR,
  });

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={resolvedTheme === "dark" ? darkTheme : lightTheme}
      onChange={() => onChange?.(editor.document)}
    />
  );
}

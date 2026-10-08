// Line breaks and tabs in text, made visible: in the chart (↵ and →), for screen readers (in
// words), and in an edit field (as the escapes \n and \t, so they survive an edit).

export const shown = (s: string): string => s.replace(/\r?\n/g, '↵').replace(/\t/g, '→');

export const spoken = (s: string): string => s.replace(/\r?\n/g, ' (line break) ').replace(/\t/g, ' (tab) ').replace(/ {2,}/g, ' ').trim();

export const toField = (s: string): string => s.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t');

export const fromField = (s: string): string => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

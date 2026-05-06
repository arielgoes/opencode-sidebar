import { createHighlighter, type Highlighter } from 'shiki';

let _hl: Highlighter | null = null;

const LANGS = ['python','typescript','javascript','bash','sh','json','yaml','go','rust','cpp','c','java','css','html','markdown','sql','toml','dockerfile'] as const;

export async function initHighlighter(): Promise<void> {
  _hl = await createHighlighter({
    themes: ['github-dark-default', 'github-light'],
    langs: [...LANGS],
  });
}

export function highlight(code: string, lang: string): string | null {
  if (!_hl) return null;
  const isDark = document.body.classList.contains('vscode-light') ? false : true;
  const theme = isDark ? 'github-dark-default' : 'github-light';
  const supported = (_hl.getLoadedLanguages() as string[]).includes(lang);
  if (!supported) return null;
  try {
    return _hl.codeToHtml(code, { lang, theme });
  } catch {
    return null;
  }
}

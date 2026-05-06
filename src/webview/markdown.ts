import { marked } from 'marked';
import { highlight } from './highlight';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdownInto(el: HTMLElement, md: string): void {
  el.innerHTML = marked.parse(md, { async: false }) as string;

  // Syntax-highlight + add copy button to every code block
  el.querySelectorAll<HTMLPreElement>('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;

    // Detect language from class (marked uses class="language-xxx")
    const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : 'text';

    // Try Shiki highlighting
    const highlighted = highlight(code.textContent ?? '', lang);
    if (highlighted) {
      // Shiki returns a full <pre><code>...</code></pre> — extract just the inner HTML
      const tmp = document.createElement('div');
      tmp.innerHTML = highlighted;
      const shikiPre = tmp.querySelector('pre');
      if (shikiPre) {
        // Copy Shiki's styles/classes onto our pre, replace code content
        pre.style.cssText = shikiPre.style.cssText;
        pre.style.margin = '6px 0';
        pre.style.borderRadius = '4px';
        pre.style.padding = '10px 12px';
        pre.style.overflowX = 'auto';
        code.innerHTML = shikiPre.querySelector('code')?.innerHTML ?? code.innerHTML;
      }
    }

    // Copy button overlay
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent ?? '').then(() => {
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });

    // Wrap in a container so the button can overlay the pre
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    pre.replaceWith(wrapper);
    wrapper.appendChild(pre);
    wrapper.appendChild(copyBtn);
  });
}

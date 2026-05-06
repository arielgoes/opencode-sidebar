import { renderMarkdownInto } from '../markdown';
export function mountTextPart(el: HTMLElement, text: string): void {
  renderMarkdownInto(el, text);
}

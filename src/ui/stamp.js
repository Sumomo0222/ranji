// 朱砂印章：打卡后的「已打卡」章。
import { esc } from './dom.js';

/**
 * @param {{date:string, time:string, id?:string, cls?:string, text?:string}} opts date 形如 '11.25'，time 形如 '20:31'；text 默认「已打卡」
 */
export function stampSvg({ date, time, id = 'stamp-ink', cls = '', text = '已打卡' }) {
  return `<svg class="stamp ${cls}" viewBox="0 0 120 120" role="img" aria-label="${esc(text)} ${esc(date)} ${esc(time)}">
  <defs>
    <filter id="${id}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 5 -1.35" result="mask"/>
      <feComposite in="SourceGraphic" in2="mask" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#${id})">
    <circle cx="60" cy="60" r="55" fill="none" stroke="var(--cinnabar)" stroke-width="3.2"/>
    <circle cx="60" cy="60" r="48.5" fill="none" stroke="var(--cinnabar)" stroke-width="1"/>
    <path id="${id}-arc" d="M19.5 60a40.5 40.5 0 0 1 81 0" fill="none"/>
    <text font-family="Newsreader, serif" font-style="italic" font-size="7.6" letter-spacing="1.5" fill="var(--cinnabar)"><textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">RANJI · DAILY CHECK-IN</textPath></text>
    <text x="60" y="66.5" text-anchor="middle" font-family="'Songti SC', STSong, serif" font-weight="700" font-size="23" letter-spacing="1.5" fill="var(--cinnabar)">${esc(text)}</text>
    <text x="60" y="84" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="500" font-size="11.5" letter-spacing="1" fill="var(--cinnabar)">${esc(date)} · ${esc(time)}</text>
  </g>
</svg>`;
}

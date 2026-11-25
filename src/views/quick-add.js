// 底部中间的「记一笔」：选一条记录路径。
import { FOODS } from '../data/foods.js';
import { ymd } from '../core/dates.js';
import { icon } from '../ui/dom.js';
import { openSheet } from '../ui/kit.js';
import { openAddExercise, openAddFood } from '../ui/nav.js';

export function openQuickAdd({ date = ymd() } = {}) {
  const sheet = openSheet({
    title: '记一笔',
    eyebrow: 'New entry',
    body: `<div class="tiles">
      <button class="tile" data-go="food-photo"><span class="tile-ic amber">${icon('camera')}</span><span class="tile-main"><b>拍照记饮食</b><span>在设备上识别食物，估算热量与营养</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-go="food-lib"><span class="tile-ic amber">${icon('utensils')}</span><span class="tile-main"><b>从食物库选择</b><span>${FOODS.length} 种常见食物，按份量估算</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-go="ex-shot"><span class="tile-ic pine">${icon('scan-line')}</span><span class="tile-main"><b>上传运动截图</b><span>自动读出时长、距离和消耗</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-go="ex-manual"><span class="tile-ic pine">${icon('dumbbell')}</span><span class="tile-main"><b>手动记运动</b><span>按时长和运动类型估算消耗</span></span>${icon('chevron-right')}</button>
    </div>`,
  });
  sheet.panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const go = b.dataset.go;
    sheet.close();
    if (go === 'food-photo') openAddFood({ date, start: 'photo' });
    else if (go === 'food-lib') openAddFood({ date, start: 'library' });
    else if (go === 'ex-shot') openAddExercise({ date, start: 'shot' });
    else openAddExercise({ date, start: 'manual' });
  });
}

// 运动类型与 MET 值（Compendium of Physical Activities 常见取值）。
// 字段：[id, 中文名, MET, 图标, 别名（用于截图识别时的关键词匹配）]
export const EXERCISES = [
  ['walk', '步行', 3.5, 'footprints', ['步行', '健走', '走路', 'walk', 'walking', 'hike', '徒步', '登山']],
  ['brisk_walk', '快走', 4.3, 'footprints', ['快走', 'brisk', '健走']],
  ['jog', '慢跑', 7.0, 'person-standing', ['慢跑', 'jog', 'jogging']],
  ['run', '跑步', 9.8, 'person-standing', ['跑步', '户外跑', '路跑', 'run', 'running', '晨跑', '夜跑', ' treadmill', '跑步机']],
  ['cycle', '骑行', 6.8, 'bike', ['骑行', '骑车', '骑行', 'cycling', 'ride', 'bike', 'biking']],
  ['swim', '游泳', 6.0, 'waves', ['游泳', 'swim', 'swimming', '自由泳', '蛙泳']],
  ['strength', '力量训练', 3.5, 'dumbbell', ['力量', '撸铁', 'weight', 'strength', 'gym', '训练', '肌力', '抗阻']],
  ['hiit', 'HIIT / 有氧操', 8.0, 'flame', ['hiit', '高强度间歇', '有氧操', 'aerobic', 'bootcamp', 'insanity', '燃脂']],
  ['indoor_cycle', '动感单车', 6.8, 'gauge', ['动感单车', '单车', 'spin', 'indoor cycle', '室内骑行']],
  ['elliptical', '椭圆机', 5.0, 'orbit', ['椭圆机', 'elliptical', '椭圆']],
  ['rope', '跳绳', 11.8, 'activity', ['跳绳', 'rope', '跳绳']],
  ['yoga', '瑜伽', 2.5, 'flower-2', ['瑜伽', 'yoga', '普拉提', 'pilates', '冥想', '拉伸', 'stretch']],
  ['badminton', '羽毛球', 5.5, 'volleyball', ['羽毛球', 'badminton']],
  ['basketball', '篮球', 6.5, 'volleyball', ['篮球', 'basketball']],
  ['football', '足球', 7.0, 'volleyball', ['足球', 'football', 'soccer']],
  ['tennis', '网球', 7.3, 'volleyball', ['网球', 'tennis', '乒乓球', 'table tennis', 'ping pong', '乒乓']],
  ['row', '划船机', 7.0, 'kayak', ['划船', 'row', 'rowing', '划船机']],
  ['dance', '舞蹈', 5.0, 'music', ['舞蹈', '跳舞', 'dance', 'dancing', 'zumba', '尊巴']],
  ['hike', '徒步 / 登山', 6.0, 'mountain', ['徒步', 'hiking', '登山', 'hike', '爬']],
  ['stairs', '爬楼梯', 8.8, 'trending-up', ['楼梯', 'stair', '登阶']],
  ['other', '其他运动', 4.0, 'sparkles', []],
].map(([id, label, met, icon, keywords]) => ({ id, label, met, icon, keywords }));

export const EX_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/** 每公斤体重每小时消耗：MET × 1.05 kcal */
export function exerciseKcal(met, minutes, weightKg) {
  if (!(met > 0 && minutes > 0 && weightKg > 0)) return 0;
  return Math.round(((met * 3.5 * weightKg) / 200) * minutes);
}

// Inspired by Brian Eno & Peter Schmidt's Oblique Strategies; rewritten in our own words (not the original cards).
export const OBLIQUE: string[] = [
  '把最重要的那个元素拿掉，看剩下的还能不能成立',
  '假设前提是假的',
  '用最笨的材料做最精致的事',
  '只保留错误的部分',
  '让配角当主角',
  '把时间倒过来',
  '把它缩小到一个人能握在手里',
  '把它放大到整座城市',
  '换一种感官来表达',
  '它在十年前会是什么样？一百年后呢？',
  '把两个结尾对调',
  '去掉所有形容词',
  '用沉默代替高潮',
  '让它变得不舒服一点',
  '找到它最无聊的一面并放大',
  '如果只能用一种颜色',
  '从结尾开始',
  '给它一个不合理的限制',
  '模仿一个你讨厌的风格，但只模仿一半',
  '让陌生人来完成最后一步',
  '把背景音变成主旋律',
  '它最怕什么？',
  '用一个动作代替一句台词',
  '重复，直到它变成别的东西',
];

export function pickOblique(rand: () => number = Math.random): string {
  return OBLIQUE[Math.floor(rand() * OBLIQUE.length)];
}

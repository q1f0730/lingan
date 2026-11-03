import { m } from 'framer-motion';

/**
 * Rewamp「Word By Word Text」移植：逐词淡入、上移、去模糊。中文没有空格，按标点 / 空格切成短语，
 * 一句短中文就是一整块淡入，不会拆字（读屏与查找文字不受影响）。
 */
/** 按中文标点 / 空格切成短语，标点跟在前一段末尾；拼回去与原文一字不差 */
export function splitPhrases(text: string): string[] {
  return text.split(/(?<=[，。、；：！？\s])/).filter(Boolean);
}

export function WordReveal({ text, className, as = 'h2' }: { text: string; className?: string; as?: 'h1' | 'h2' | 'p' }) {
  const parts = splitPhrases(text);
  const Tag = as;
  return (
    <Tag className={className}>
      {parts.map((p, i) => (
        <m.span key={i} className="rw-word" initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: i * 0.1, duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}>
          {p}
        </m.span>
      ))}
    </Tag>
  );
}

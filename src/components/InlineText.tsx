import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTagSuggest } from './TagSuggest';

/**
 * v0.27 0409 详情页字段点一下直接改：平时是普通文字，点（或回车）变输入框，失焦 / 回车保存，Esc 放弃。
 * multiline：Ctrl+Enter 保存，回车换行。空值且不允许空时不保存。
 */
export function InlineText({
  value,
  onSave,
  label,
  multiline = false,
  placeholder = '点这里写',
  allowEmpty = true,
  className = '',
  maxLength = 4000,
  tags = false,
  children,
}: {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  maxLength?: number;
  /** 输入时给 #标签候选（bare = 整栏都是标签） */
  tags?: false | 'hash' | 'bare';
  children?: ReactNode;
}) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);
  const ts = useTagSuggest(v, setV, ref, { bare: tags === 'bare', className: 'tag-suggest-inline' });
  useEffect(() => {
    if (!edit) setV(value);
  }, [value, edit]);
  useEffect(() => {
    if (!edit) return;
    done.current = false;
    const el = ref.current;
    el?.focus();
    if (el) {
      const n = el.value.length;
      el.setSelectionRange(n, n);
      if (multiline) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    }
  }, [edit, multiline]);
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    const next = v.replace(/\r/g, '').trim();
    setEdit(false);
    if (next === value.trim() || (!next && !allowEmpty)) return;
    await onSave(next);
  };
  const cancel = () => {
    done.current = true;
    setV(value);
    setEdit(false);
  };
  if (!edit) {
    return (
      <span
        className={`inline-edit${value ? '' : ' empty'} ${className}`}
        role="button"
        tabIndex={0}
        aria-label={`${label}：${value || '空'}，点一下修改`}
        title="点一下直接改"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a,button')) return;
          setEdit(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEdit(true);
          }
        }}
      >
        {children ?? (value || <span className="inline-ph">{placeholder}</span>)}
      </span>
    );
  }
  const common = {
    ref,
    className: `inline-input ${className}`,
    value: v,
    'aria-label': label,
    maxLength,
    placeholder,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      if (ts.onKey(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void commit();
      }
    },
  };
  return (
    <span className="inline-wrap">
      {multiline ? (
        <textarea
          {...common}
          rows={2}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = t.scrollHeight + 'px';
          }}
        />
      ) : (
        <input {...common} enterKeyHint="done" />
      )}
      {ts.box}
      <span className="inline-hint meta-text" aria-hidden>
        {multiline ? 'Ctrl+回车保存 · Esc 放弃' : '回车保存 · Esc 放弃'}
      </span>
    </span>
  );
}

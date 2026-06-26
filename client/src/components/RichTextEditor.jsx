import { useRef, useEffect, useCallback } from 'react';

export default function RichTextEditor({ value, onChange, placeholder }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = value || '';
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  }, [value]);

  const emitChange = useCallback(() => {
    const html = ref.current?.innerHTML || '';
    const empty = !ref.current?.textContent?.trim();
    onChange(empty ? '' : html);
  }, [onChange]);

  const exec = (command, arg = null) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  const addLink = () => {
    const url = window.prompt('Link URL');
    if (url) exec('createLink', url);
  };

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar">
        <button type="button" className="rich-text-btn" onClick={() => exec('bold')} title="Bold">
          <strong>B</strong>
        </button>
        <button type="button" className="rich-text-btn" onClick={() => exec('italic')} title="Italic">
          <em>I</em>
        </button>
        <button type="button" className="rich-text-btn" onClick={() => exec('underline')} title="Underline">
          <u>U</u>
        </button>
        <button type="button" className="rich-text-btn" onClick={() => exec('insertUnorderedList')} title="Bullet list">
          •
        </button>
        <button type="button" className="rich-text-btn" onClick={() => exec('insertOrderedList')} title="Numbered list">
          1.
        </button>
        <button type="button" className="rich-text-btn" onClick={addLink} title="Link">
          Link
        </button>
      </div>
      <div
        ref={ref}
        className="rich-text-body"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emitChange}
        onBlur={emitChange}
      />
    </div>
  );
}

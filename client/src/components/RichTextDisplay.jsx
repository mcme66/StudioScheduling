export default function RichTextDisplay({ html, emptyText = 'Nothing added yet.' }) {
  if (!html?.trim()) {
    return <p className="muted rich-text-empty">{emptyText}</p>;
  }
  return <div className="rich-text-display" dangerouslySetInnerHTML={{ __html: html }} />;
}

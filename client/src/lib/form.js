/**
 * Read named fields from a form submit event.
 * Prefer this over React state for credentials: browser / Google Password
 * Manager autofill often fills the DOM without firing React onChange.
 */
export function formValues(event, names) {
  const fd = new FormData(event.currentTarget);
  const out = {};
  for (const name of names) {
    const raw = fd.get(name);
    out[name] = typeof raw === 'string' ? raw : '';
  }
  return out;
}
